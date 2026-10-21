import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient, type TradeStatus } from "@prisma/client";
import { writeInventoryReceipt } from "../../lib/inventory-receipt";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/inventory_delete_fixture");
const db = new PrismaClient(), context = new AsyncLocalStorage<any>();
function pause() {
  let reached!: () => void, release!: () => void;
  const observed = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  return { observed, release, async hold() { reached(); await resume; } };
}
function wrap(client: any): any {
  return new Proxy(client, { get(target, key) {
    if (key === "$transaction") return (fn: any, options: any) => target.$transaction(
      typeof fn === "function" ? async (tx: any) => {
        const result = await fn(wrap(tx));
        if (context.getStore()?.rollback) throw new Error("owned failure after actual deletion/audit writes");
        return result;
      } : fn, options);
    const value = target[key];
    if (key === "$queryRaw") return async (...args: any[]) => {
      const actor = context.getStore();
      const sql = (Array.isArray(args[0]) ? args[0] : args[0]?.strings ?? []).join(" ");
      if (actor?.race?.kind === "delete" && sql.includes('"InventoryItem"') && sql.includes("FOR UPDATE") && !actor.race.paused) {
        actor.race.paused = true; actor.race.boundary = "before-row-lock"; await actor.race.pause.hold();
      }
      const result = await value.apply(target, args);
      if (actor?.race && sql.includes('"InventoryItem"') && sql.includes("FOR UPDATE")) actor.race.locked = true;
      return result;
    };
    if (key === "inventoryItem") return new Proxy(value, { get(model, method) {
      const fn = model[method]; if (typeof fn !== "function") return fn;
      return async (args: any) => {
        const result = await fn.call(model, args), actor = context.getStore(), race = actor?.race;
        if (race && !race.paused && !race.locked && (
          race.kind === "delete" && method === "findUnique" && args.where?.id === race.itemId ||
          race.kind === "cleanup" && method === "findMany" && args.where?.quantity?.lte === 0 && result.some((row: any) => row.id === race.itemId)
        )) {
          race.paused = true; race.boundary = race.kind === "delete" ? "after-unlocked-item-read" : "after-zero-selection";
          await race.pause.hold();
        }
        return result;
      };
    } });
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function loadActions(relative: string) {
const filename = path.resolve(relative), loaded = new (Module as any)(filename, module);
loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
const realRequire = loaded.require.bind(loaded);
loaded.require = (name: string) => {
  if (name === "@/lib/prisma") return { prisma: wrap(db) };
  if (name === "@/lib/auth") return { requireLogin: async () => context.getStore(),
    getAccessScope: async (user: any) => ({ mode: user.scopeMode ?? (user.role === "ADMIN" ? "admin" : "owner") }) };
  if (name === "next/cache") return { revalidatePath: () => {} };
  return realRequire(name);
};
loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, filename);
return loaded.exports;
}
const actions = loadActions("app/inventory/actions.ts"), tradeActions = loadActions("app/trades/actions.ts");
const fixtures: any[] = [];
async function fixture(status: TradeStatus, quantity = 2, reserved = true) {
  const tag = `delete-reservation-${randomUUID()}`;
  const f: any = { players: [], users: [], items: [], cards: [], tradeId: null }; fixtures.push(f);
  const a = await db.player.create({ data: { name: tag, displayName: tag } });
  f.players.push(a.id);
  const b = await db.player.create({ data: { name: `${tag}-other`, displayName: `${tag}-other` } });
  f.players.push(b.id);
  for (const role of ["PLAYER", "ADMIN"] as const) f.users.push(await db.user.create({ data: {
    username: `${tag}-${role}`, displayName: role, role, playerId: role === "PLAYER" ? a.id : b.id, passwordHash: "disabled-fixture",
  } }));
  const card = await db.card.create({ data: { scryfallId: tag, name: tag, typeLine: "Artifact", setCode: "tst", collectorNumber: "1", rarity: "common" } });
  f.cards.push(card.id);
  for (const [i, qty] of [2, quantity, 1].entries()) f.items.push(await db.inventoryItem.create({ data: {
    cardId: card.id, currentOwnerId: i === 2 ? b.id : a.id, originalOpenerId: a.id, quantity: qty,
    condition: "NM", language: "EN", sourceType: "MANUAL", notes: `${tag}-${i}`,
  } }));
  const trade = await db.trade.create({ data: { proposerPlayerId: a.id, receiverPlayerId: b.id, status,
    offeredInventoryItemId: f.items[0].id, requestedInventoryItemId: f.items[2].id,
    lines: { create: f.items.filter((_: unknown, i: number) => reserved || i !== 1).map((item: any, i: number) => ({
      inventoryItemId: item.id, side: item.currentOwnerId === a.id ? "PROPOSER" : "RECEIVER", quantity: 1, position: i,
      snapshotJson: { inventoryItemId: item.id, quantity: 1, cardName: card.name },
    })) },
  } }); f.tradeId = trade.id;
  return f;
}
async function remove(f: any, admin = false, target = f.items[1].id, race?: any) {
  const fd = new FormData(); fd.set("inventoryItemId", target); fd.set("deleteReason", "owned reservation fixture");
  return context.run({ ...f.users[admin ? 1 : 0], race }, () => actions.deleteInventoryItem(fd));
}
async function graph(f: any) {
  return { items: await db.inventoryItem.findMany({ where: { id: { in: f.items.map((i: any) => i.id) } }, orderBy: { id: "asc" } }),
    trade: await db.trade.findUniqueOrThrow({ where: { id: f.tradeId }, include: { lines: { orderBy: { id: "asc" } } } }),
    audits: await db.inventoryAuditLog.findMany({ where: { changedByUserId: { in: f.users.map((u: any) => u.id) } }, orderBy: { id: "asc" } }) };
}
async function main() {
  assert.equal(await db.user.count(), 0, "empty disposable database required");
  const results = [];
  for (const status of ["PROPOSED", "ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"] as const) {
    for (const mode of ["owner-delete", "admin-delete", "admin-zero-cleanup"] as const) {
      const f = await fixture(status, mode === "admin-zero-cleanup" ? 0 : 2), before = await graph(f);
      let error = "";
      try {
        if (mode === "admin-zero-cleanup") await context.run(f.users[1], () => actions.cleanupZeroQuantityInventory());
        else await remove(f, mode === "admin-delete");
      } catch (caught) { error = String(caught); }
      const after = await graph(f), unchanged = JSON.stringify(after) === JSON.stringify(before);
      const result = { status, mode, unchanged, deleted: !after.items.some(i => i.id === f.items[1].id),
        severedLine: after.trade.lines.some(line => line.inventoryItemId === null), audits: after.audits.length, refused: /reserved/.test(error) };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  assert.ok(results.every(r => r.unchanged), "active TradeLine reservations must survive both delete actions without severed references or audits");
  const legacy = await fixture("PROPOSED");
  await assert.rejects(remove(legacy, false, legacy.items[0].id), /reserved/);
  await assert.rejects(context.run(legacy.users[0], () => actions.cleanupZeroQuantityInventory()), /Admin mode/);
  const terminal = await fixture("COMPLETED");
  await remove(terminal);
  assert.equal(await db.inventoryItem.findUnique({ where: { id: terminal.items[1].id } }), null);
  const unreserved = await fixture("PROPOSED", 0, false);
  await context.run(unreserved.users[1], () => actions.cleanupZeroQuantityInventory());
  assert.equal(await db.inventoryItem.findUnique({ where: { id: unreserved.items[1].id } }), null);
  const races = [];
  for (const kind of ["delete", "cleanup"] as const) {
    const f = await fixture("CANCELLED", kind === "delete" ? 2 : 0, false), barrier = pause();
    const race: any = { kind, itemId: f.items[1].id, pause: barrier };
    const operation = (kind === "delete" ? remove(f, false, race.itemId, race) :
      context.run({ ...f.users[1], race }, () => actions.cleanupZeroQuantityInventory()))
      .then(() => "", (error: unknown) => String(error));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([barrier.observed, operation.then(() => { throw new Error("expected live mutation observation boundary"); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("mutation observation timed out")), 5000); })]);
      if (kind === "delete") {
        const fd = new FormData(); fd.set("receiverPlayerId", f.players[1]);
        fd.set("offeredLinesJson", JSON.stringify([{ inventoryItemId: race.itemId, quantity: 1 }])); fd.set("requestedLinesJson", "[]");
        const proposal = await context.run(f.users[0], () => tradeActions.createTrade({ status: "idle", message: "" }, fd));
        assert.equal(proposal.status, "success", proposal.message);
      } else {
        const item = f.items[1];
        await db.$transaction(tx => writeInventoryReceipt(tx, {
          lot: { currentOwnerId: item.currentOwnerId, originalOpenerId: item.originalOpenerId, cardId: item.cardId, quantity: 2,
            foilStatus: item.foilStatus, sourceType: item.sourceType, condition: item.condition, language: item.language,
            locationId: item.locationId, locationSection: item.locationSection, acquiredFromPullId: item.acquiredFromPullId,
            roundId: item.roundId, notes: item.notes },
          merge: { where: { id: item.id }, update: {} },
          audit: { action: "inventory_added", actingUserId: f.users[0].id, reason: "owned concurrent receipt" },
        }));
        assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 2);
      }
    } finally { clearTimeout(timer); barrier.release(); await operation; }
    const error = await operation;
    const item = await db.inventoryItem.findUnique({ where: { id: race.itemId } });
    const lines = await db.tradeLine.findMany({ where: { trade: { proposerPlayerId: f.players[0], status: "PROPOSED" } } });
    const deletedAudits = await db.inventoryAuditLog.count({ where: { changedByUserId: { in: f.users.map((u: any) => u.id) },
      changeType: { in: ["user_delete_inventory", "admin_cleanup_zero_quantity"] } } });
    const result = { kind, boundary: race.boundary, remainingQuantity: item?.quantity ?? null,
      severedProposal: lines.some(line => line.inventoryItemId === null), deletedAudits, refused: /reserved/.test(error) };
    races.push(result); console.log(JSON.stringify(result));
  }
  assert.ok(races.every(r => r.remainingQuantity === 2 && !r.severedProposal && r.deletedAudits === 0),
    "deletion must recheck fresh reservations/zero quantity after a committed proposal or receipt");
  console.log("PASS: committed proposal and shared receipt survive delayed Delete/zero cleanup with fresh guards and no deletion audit");
  for (const kind of ["delete", "cleanup"] as const) {
    const f = await fixture("CANCELLED", kind === "delete" ? 2 : 0, false), before = await graph(f);
    const fd = new FormData(); fd.set("inventoryItemId", f.items[1].id); fd.set("deleteReason", "owned rollback fixture");
    await assert.rejects(context.run({ ...f.users[kind === "delete" ? 0 : 1], rollback: true }, () =>
      kind === "delete" ? actions.deleteInventoryItem(fd) : actions.cleanupZeroQuantityInventory()), /owned failure after actual deletion/);
    assert.deepEqual(await graph(f), before);
    if (kind === "delete") {
      await assert.rejects(context.run({ ...f.users[1], scopeMode: "owner" }, () => actions.deleteInventoryItem(fd)), /only delete inventory you own/);
      assert.deepEqual(await graph(f), before);
    }
  }
  console.log("PASS: actual Delete/zero-cleanup audit and FK writes roll back with stock; owner scope still refuses another owner's row");
  console.log("PASS: all active statuses retain secondary TradeLine reservations for owner/admin delete and zero cleanup; legacy, terminal, unreserved and admin-mode controls pass");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    for (const f of fixtures.reverse()) {
      await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: { in: f.users.map((u: any) => u.id) } } });
      const trades = await db.trade.findMany({ where: { proposerPlayerId: { in: f.players } }, select: { id: true } });
      const tradeIds = trades.map(t => t.id);
      await db.notificationDeliveryJob.deleteMany({ where: { sourceId: { in: tradeIds } } });
      await db.notification.deleteMany({ where: { recipientUserId: { in: f.users.map((u: any) => u.id) } } });
      await db.tradeEvent.deleteMany({ where: { tradeId: { in: tradeIds } } });
      await db.trade.deleteMany({ where: { id: { in: tradeIds } } });
      await db.inventoryItem.deleteMany({ where: { cardId: { in: f.cards } } });
      await db.card.deleteMany({ where: { id: { in: f.cards } } });
      await db.user.deleteMany({ where: { id: { in: f.users.map((u: any) => u.id) } } });
      await db.player.deleteMany({ where: { id: { in: f.players } } });
    }
    assert.equal(await db.user.count(), 0); assert.equal(await db.inventoryItem.count(), 0);
    assert.equal(await db.trade.count(), 0); assert.equal(await db.inventoryAuditLog.count(), 0);
    assert.equal(await db.player.count(), 0); assert.equal(await db.card.count(), 0);
    assert.equal(await db.tradeEvent.count(), 0); assert.equal(await db.notification.count(), 0); assert.equal(await db.notificationDeliveryJob.count(), 0);
    console.log("PASS: exact inventory reservation fixture cleanup");
  } finally { await db.$disconnect(); }
});
