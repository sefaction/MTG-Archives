import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient, type User, type Card, type InventoryItem, type Trade } from "@prisma/client";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/trade_stock_fixture");
const p = new PrismaClient();
const context = new AsyncLocalStorage<any>();
const owners: string[] = [], users: string[] = [], cards: string[] = [], tradeIds: string[] = [];

function gate() {
  let arrivals = 0, release!: () => void, reject!: (error: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  return {
    get arrivals() { return arrivals; },
    async wait() {
      if (++arrivals === 1) timer = setTimeout(() => reject(new Error("both unlocked real stock reads must arrive")), 5000);
      if (arrivals === 2) { clearTimeout(timer); release(); }
      await ready;
    },
    close() { clearTimeout(timer); },
  };
}

function wrap(client: any, transaction = false): any {
  return new Proxy(client, { get(target, key) {
    if (key === "$transaction") return (fn: any, options: any) => target.$transaction(
      typeof fn === "function" ? (tx: any) => fn(wrap(tx, true)) : fn, options,
    );
    const value = target[key];
    if (key === "$queryRaw" || key === "$executeRaw") return async (...args: any[]) => {
      const result = await value.apply(target, args);
      const ctx = context.getStore();
      const sql = (Array.isArray(args[0]) ? args[0] : args[0]?.strings ?? []).join(" ");
      if (transaction && ctx && sql.includes('"InventoryItem"') && sql.includes("FOR UPDATE") && JSON.stringify(args).includes(ctx.sourceId)) ctx.inventoryLocked = true;
      return result;
    };
    if (key === "inventoryItem") return new Proxy(value, { get(model, method) {
      const fn = model[method];
      if (typeof fn !== "function") return fn;
      return async (args: any) => {
        const result = await fn.call(model, args);
        const ctx = context.getStore();
        if (transaction && ctx && method === "findMany" && args.where?.id?.in?.includes(ctx.sourceId)) {
          const source = result.find((item: any) => item.id === ctx.sourceId);
          const [backend] = await target.$queryRaw`SELECT pg_backend_pid() AS pid`;
          ctx.backends.add(backend.pid);
          ctx.reads.push({ quantity: source?.quantity, locked: ctx.inventoryLocked });
          // Observe actual reads only. A real source-row lock naturally makes
          // these reads serial; an unlocked implementation is forced to overlap.
          if (!ctx.inventoryLocked) await ctx.gate.wait();
        }
        return result;
      };
    } });
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function loadActions(source: string) {
  const filename = path.resolve("app/trades/actions.ts");
  const loaded: any = new (Module as any)(filename, module);
  loaded.filename = filename;
  loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = (id: string) => {
    if (id === "@/lib/prisma") return { prisma: wrap(p) };
    if (id === "@/lib/auth") return { requireLogin: async () => context.getStore().actor, getAccessScope: async () => ({ mode: "owner" }) };
    if (id === "next/cache") return { revalidatePath: () => {} };
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}

async function fixture() {
  const tag = `trade-stock-${randomUUID()}`;
  const people: Array<User & { locationId: string }> = [];
  const printings: Card[] = [], items: InventoryItem[] = [], trades: Trade[] = [];
  for (let index = 0; index < 3; index++) {
    const player = await p.player.create({ data: { name: `${tag}-${index}`, displayName: `${tag}-${index}` } });
    owners.push(player.id);
    const user = await p.user.create({ data: { username: `${tag}-${index}`, displayName: String(index), passwordHash: "synthetic-disabled", playerId: player.id } });
    users.push(user.id);
    const location = await p.inventoryLocation.create({ data: { ownerPlayerId: player.id, name: "Incoming", normalizedName: "incoming" } });
    people.push({ ...user, locationId: location.id });
    const card = await p.card.create({ data: { scryfallId: `${tag}-${index}`, name: `${tag}-${index}`, typeLine: "Artifact", setCode: "tst", collectorNumber: String(index), rarity: "common" } });
    cards.push(card.id); printings.push(card);
    items.push(await p.inventoryItem.create({ data: { cardId: card.id, currentOwnerId: player.id, originalOpenerId: player.id, quantity: index === 0 ? 4 : 3, condition: "NM", foil: true, foilStatus: "FOIL", language: "JA", sourceType: "MANUAL", notes: `${tag}-provenance-${index}`, locationId: location.id } }));
  }
  const resident = await p.inventoryItem.create({ data: { cardId: printings[0].id, currentOwnerId: people[1].playerId!, originalOpenerId: people[1].playerId!, quantity: 7, condition: "NM", sourceType: "MANUAL", notes: `${tag}-resident`, locationId: people[1].locationId } });
  for (const recipient of [1, 2]) {
    const trade = await p.trade.create({ data: {
      proposerPlayerId: people[0].playerId!, receiverPlayerId: people[recipient].playerId!, createdByUserId: people[0].id,
      status: "PARTIALLY_COMMITTED", proposerCommittedAt: new Date(), proposerDestinationLocationId: people[0].locationId, receiverDestinationLocationId: people[recipient].locationId,
      lines: { create: [
        { side: "PROPOSER", inventoryItemId: items[0].id, quantity: 2, position: 0, snapshotJson: {} },
        { side: "RECEIVER", inventoryItemId: items[recipient].id, quantity: 1, position: 0, snapshotJson: {} },
      ] },
    } });
    trades.push(trade); tradeIds.push(trade.id);
  }
  return { people, printings, items, resident, trades };
}

async function runMode(label: string, source: string, expectDefect: boolean) {
  const f = await fixture(), actions = loadActions(source), overlap = gate();
  const reads: Array<{ quantity: number; locked: boolean }> = [], backends = new Set<number>();
  try {
    const outcomes = await Promise.allSettled([1, 2].map(recipient => {
      const fd = new FormData(); fd.set("tradeId", f.trades[recipient - 1].id); fd.set("destinationLocationId", f.people[recipient].locationId);
      return context.run({ actor: f.people[recipient], sourceId: f.items[0].id, inventoryLocked: false, gate: overlap, reads, backends }, () => actions.confirmPhysicalTrade(fd));
    }));
    assert(outcomes.every(outcome => outcome.status === "fulfilled"), JSON.stringify(outcomes.map(outcome => outcome.status === "rejected" ? String(outcome.reason) : outcome.status)));
    const sourceRow = await p.inventoryItem.findUnique({ where: { id: f.items[0].id } });
    const audits = await p.inventoryAuditLog.findMany({ where: { tradeId: { in: f.trades.map(trade => trade.id) } } });
    const sourceAudits = audits.filter(audit => (audit.beforeJson as any)?.id === f.items[0].id);
    const transitions = sourceAudits.map(audit => [(audit.beforeJson as any).quantity, (audit.afterJson as any).quantity]).sort((a, b) => b[1] - a[1]);
    console.log(JSON.stringify({ label, sourceQuantity: sourceRow?.quantity ?? null, transitions, reads, actualBackends: backends.size, overlapArrivals: overlap.arrivals }));
    if (expectDefect) {
      assert.equal(overlap.arrivals, 2); assert.equal(backends.size, 2);
      assert.equal(sourceRow?.quantity, 0); assert.deepEqual(transitions, [[4, 2], [4, 0]]);
      console.log("BASELINE REPRODUCED: two valid independent trades leave a zero source lot and stale second source-audit quantity");
      return;
    }
    assert.equal(sourceRow, null, "fully consumed source follows the existing full-transfer deletion path");
    assert.deepEqual(transitions, [[4, 2], [2, 0]], "each source audit uses the actual current stock before its transfer");
    assert.equal(audits.length, 8);
    assert.deepEqual(await p.inventoryItem.findUniqueOrThrow({ where: { id: f.resident.id } }), f.resident);
    for (const [index, expected] of [11, 3, 3].entries()) assert.equal((await p.inventoryItem.aggregate({ where: { cardId: f.printings[index].id }, _sum: { quantity: true } }))._sum.quantity, expected);
    for (const recipient of [1, 2]) {
      assert.equal((await p.trade.findUniqueOrThrow({ where: { id: f.trades[recipient - 1].id } })).status, "COMPLETED");
      assert.equal(await p.tradeEvent.count({ where: { tradeId: f.trades[recipient - 1].id, eventType: "completed" } }), 1);
      const receipt = await p.inventoryItem.findFirstOrThrow({ where: { cardId: f.printings[0].id, currentOwnerId: f.people[recipient].playerId!, sourceType: "TRADE" } });
      assert.equal(receipt.quantity, 2); assert.equal(receipt.locationId, f.people[recipient].locationId);
      for (const field of ["originalOpenerId", "foil", "foilStatus", "condition", "language", "notes"] as const) assert.equal(receipt[field], f.items[0][field]);
    }
    console.log("PASS: independent valid trades preserve source deletion, actual audit transitions, lots, copies and completion events");
  } finally { overlap.close(); }
}

async function main() {
  assert.equal(await p.user.count(), 0, "empty disposable database required");
  const baseline = readFileSync(".local-data/trade-stock/baseline-actions.ts", "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(baseline).digest("hex"), "579b117f569141e0dba93a356cde099121c61aa0a4d14df95cd591b859aac70b");
  await runMode("baseline-b810", baseline, true);
  await runMode("current", readFileSync("app/trades/actions.ts", "utf8"), false);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    await p.notificationDeliveryJob.deleteMany({ where: { sourceType: "trade.completed", sourceId: { in: tradeIds } } });
    await p.inventoryAuditLog.deleteMany({ where: { tradeId: { in: tradeIds } } });
    await p.tradeEvent.deleteMany({ where: { tradeId: { in: tradeIds } } });
    await p.trade.deleteMany({ where: { id: { in: tradeIds } } });
    await p.inventoryItem.deleteMany({ where: { currentOwnerId: { in: owners } } });
    await p.inventoryLocation.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await p.user.deleteMany({ where: { id: { in: users } } });
    await p.player.deleteMany({ where: { id: { in: owners } } });
    await p.card.deleteMany({ where: { id: { in: cards } } });
    assert.equal(await p.user.count(), 0); assert.equal(await p.card.count(), 0);
    console.log("PASS: exact shared-stock fixture cleanup");
  } finally { await p.$disconnect(); }
});
