import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient, type TradeStatus } from "@prisma/client";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/inventory_delete_fixture");
const db = new PrismaClient(), context = new AsyncLocalStorage<any>();
const filename = path.resolve("app/inventory/actions.ts"), loaded = new (Module as any)(filename, module);
loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
const realRequire = loaded.require.bind(loaded);
loaded.require = (name: string) => {
  if (name === "@/lib/prisma") return { prisma: db };
  if (name === "@/lib/auth") return { requireLogin: async () => context.getStore(),
    getAccessScope: async (user: any) => ({ mode: user.role === "ADMIN" ? "admin" : "owner" }) };
  if (name === "next/cache") return { revalidatePath: () => {} };
  return realRequire(name);
};
loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, filename);
const actions = loaded.exports;
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
async function remove(f: any, admin = false, target = f.items[1].id) {
  const fd = new FormData(); fd.set("inventoryItemId", target); fd.set("deleteReason", "owned reservation fixture");
  return context.run(f.users[admin ? 1 : 0], () => actions.deleteInventoryItem(fd));
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
  console.log("PASS: all active statuses retain secondary TradeLine reservations for owner/admin delete and zero cleanup; legacy, terminal, unreserved and admin-mode controls pass");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    for (const f of fixtures.reverse()) {
      await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: { in: f.users.map((u: any) => u.id) } } });
      if (f.tradeId) await db.trade.delete({ where: { id: f.tradeId } });
      await db.inventoryItem.deleteMany({ where: { cardId: { in: f.cards } } });
      await db.card.deleteMany({ where: { id: { in: f.cards } } });
      await db.user.deleteMany({ where: { id: { in: f.users.map((u: any) => u.id) } } });
      await db.player.deleteMany({ where: { id: { in: f.players } } });
    }
    assert.equal(await db.user.count(), 0); assert.equal(await db.inventoryItem.count(), 0);
    assert.equal(await db.trade.count(), 0); assert.equal(await db.inventoryAuditLog.count(), 0);
    assert.equal(await db.player.count(), 0); assert.equal(await db.card.count(), 0);
    console.log("PASS: exact inventory reservation fixture cleanup");
  } finally { await db.$disconnect(); }
});
