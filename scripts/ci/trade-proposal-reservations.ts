import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/trade_stock_fixture");
const db = new PrismaClient(), context = new AsyncLocalStorage<any>(), fixtures: any[] = [];
function gate() {
  let arrivals = 0, release!: () => void, reject!: (error: Error) => void, timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  return { get arrivals() { return arrivals; }, async wait() {
    if (++arrivals === 1) timer = setTimeout(() => reject(new Error("both real unlocked reservation reads must arrive")), 5000);
    if (arrivals === 2) { clearTimeout(timer); release(); } await ready;
  }, close() { clearTimeout(timer); } };
}
function wrap(client: any, transaction = false): any {
  return new Proxy(client, { get(target, key) {
    if (key === "$transaction") return (fn: any, options: any) => target.$transaction(
      typeof fn === "function" ? (tx: any) => fn(wrap(tx, true)) : fn, options);
    const value = target[key];
    if (key === "$queryRaw") return async (...args: any[]) => {
      const result = await value.apply(target, args), ctx = context.getStore();
      const sql = (Array.isArray(args[0]) ? args[0] : args[0]?.strings ?? []).join(" ");
      if (ctx && transaction && sql.includes('"InventoryItem"') && sql.includes("FOR UPDATE")) ctx.locked = true;
      return result;
    };
    if (key === "trade" || key === "tradeLine") return new Proxy(value, { get(model, method) {
      const fn = model[method]; if (typeof fn !== "function") return fn;
      return async (args: any) => {
        const result = await fn.call(model, args), ctx = context.getStore();
        if (ctx && method === "findMany" && key === "tradeLine" && args.select?.quantity) {
          ctx.reads.push({ lines: result.length, reserved: result.reduce((sum: number, line: any) => sum + line.quantity, 0), locked: ctx.locked });
        }
        // Wait only after the actual last reservation query returns. Real row
        // locks serialize naturally; never force a lock holder to wait here.
        if (ctx && method === "findMany" && key === "trade" && args.where?.lines?.none && !ctx.locked) await ctx.gate.wait();
        return result;
      };
    } });
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const filename = path.resolve("app/trades/actions.ts"), loaded = new (Module as any)(filename, module);
loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
const realRequire = loaded.require.bind(loaded);
loaded.require = (name: string) => {
  if (name === "@/lib/prisma") return { prisma: wrap(db) };
  if (name === "@/lib/auth") return { requireLogin: async () => context.getStore().actor, getAccessScope: async () => ({ mode: "owner" }) };
  if (name === "next/cache") return { revalidatePath: () => {} };
  return realRequire(name);
};
loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, filename);
async function fixture(quantity: number) {
  const tag = `proposal-reservation-${randomUUID()}`, f: any = { owners: [], people: [], cards: [], item: null }; fixtures.push(f);
  for (let i = 0; i < 3; i++) {
    const player = await db.player.create({ data: { name: `${tag}-${i}`, displayName: `${tag}-${i}` } }); f.owners.push(player.id);
    f.people.push(await db.user.create({ data: { username: `${tag}-${i}`, displayName: `${tag}-${i}`, playerId: player.id, passwordHash: "disabled-fixture" } }));
  }
  const card = await db.card.create({ data: { scryfallId: tag, name: tag, typeLine: "Artifact", setCode: "tst", collectorNumber: "1", rarity: "common" } }); f.cards.push(card.id);
  f.item = await db.inventoryItem.create({ data: { cardId: card.id, currentOwnerId: f.owners[0], originalOpenerId: f.owners[0],
    quantity, condition: "NM", language: "EN", sourceType: "MANUAL", notes: tag } });
  return f;
}
async function propose(f: any, orientation: string, index: number, overlap: ReturnType<typeof gate>, reads: any[]) {
  const fd = new FormData(), offered = orientation === "offered", actor = f.people[offered ? 0 : index];
  fd.set("receiverPlayerId", f.owners[offered ? index : 0]);
  fd.set("offeredLinesJson", JSON.stringify(offered ? [{ inventoryItemId: f.item.id, quantity: 1 }] : []));
  fd.set("requestedLinesJson", JSON.stringify(offered ? [] : [{ inventoryItemId: f.item.id, quantity: 1 }]));
  fd.set("message", `owned proposal ${index}`);
  return context.run({ actor, gate: overlap, reads, locked: false }, () => loaded.exports.createTrade({ status: "idle", message: "" }, fd));
}
async function main() {
  assert.equal(await db.user.count(), 0, "empty disposable database after shared-stock cleanup required");
  const results = [];
  for (const orientation of ["offered", "requested"]) for (const quantity of [1, 2]) {
    const f = await fixture(quantity), overlap = gate(), reads: any[] = [];
    try {
      const responses = await Promise.all([propose(f, orientation, 1, overlap, reads), propose(f, orientation, 2, overlap, reads)]);
      const trades = await db.trade.findMany({ where: { proposerPlayerId: { in: f.owners } }, include: { lines: true } });
      const reserved = trades.flatMap(t => t.lines).reduce((sum, line) => sum + line.quantity, 0);
      const success = responses.filter(r => r.status === "success").length;
      const result = { orientation, quantity, success, reserved, arrivals: overlap.arrivals, reads }; results.push(result); console.log(JSON.stringify(result));
      assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: f.item.id } }), f.item);
      assert.equal(await db.inventoryAuditLog.count(), 0);
      assert.equal(await db.tradeEvent.count({ where: { tradeId: { in: trades.map(t => t.id) }, eventType: "proposed" } }), success);
      assert.equal(await db.notification.count({ where: { recipientUserId: { in: f.people.map((u: any) => u.id) } } }), success);
      for (const response of responses.filter(r => r.status !== "success")) assert.match(response.message, /reserved|unavailable/);
    } finally { overlap.close(); }
  }
  assert.ok(results.every(r => r.reserved <= r.quantity && r.success === r.quantity), "two proposals must not reserve the same final physical copy");
  console.log("PASS: concurrent offered/requested proposals admit exactly available stock, preserve Inventory and emit events/notifications only for committed proposals");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    for (const f of fixtures.reverse()) {
      const trades = await db.trade.findMany({ where: { proposerPlayerId: { in: f.owners } }, select: { id: true } });
      const ids = trades.map(t => t.id);
      await db.notificationDeliveryJob.deleteMany({ where: { sourceId: { in: ids } } });
      await db.notification.deleteMany({ where: { recipientUserId: { in: f.people.map((u: any) => u.id) } } });
      await db.tradeEvent.deleteMany({ where: { tradeId: { in: ids } } });
      await db.trade.deleteMany({ where: { id: { in: ids } } });
      await db.inventoryItem.deleteMany({ where: { currentOwnerId: { in: f.owners } } });
      await db.user.deleteMany({ where: { id: { in: f.people.map((u: any) => u.id) } } });
      await db.player.deleteMany({ where: { id: { in: f.owners } } });
      await db.card.deleteMany({ where: { id: { in: f.cards } } });
    }
    assert.equal(await db.user.count(), 0); assert.equal(await db.player.count(), 0); assert.equal(await db.card.count(), 0);
    assert.equal(await db.trade.count(), 0); assert.equal(await db.notification.count(), 0); assert.equal(await db.inventoryAuditLog.count(), 0);
    console.log("PASS: exact proposal reservation fixture cleanup");
  } finally { await db.$disconnect(); }
});
