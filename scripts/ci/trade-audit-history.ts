import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient, type User, type Card, type InventoryItem, type InventoryAuditLog } from "@prisma/client";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/trade_audit_fixture");
const p = new PrismaClient(), actor = new AsyncLocalStorage<User>();
const users: string[] = [], owners: string[] = [], cards: string[] = [], trades: string[] = [];

function loadActions(source: string) {
  const filename = path.resolve("app/trades/actions.ts");
  const loaded: any = new (Module as any)(filename, module);
  loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = (id: string) => {
    if (id === "@/lib/prisma") return { prisma: p };
    if (id === "@/lib/auth") return { requireLogin: async () => actor.getStore(), getAccessScope: async () => ({ mode: "owner" }) };
    if (id === "next/cache") return { revalidatePath: () => {} };
    return original(id);
  };
  loaded._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return loaded.exports;
}

async function profile(label: string, source: string) {
  const tag = `trade-history-${randomUUID()}`, actions = loadActions(source);
  const people: Array<User & { locationId: string }> = [], printings: Card[] = [], items: InventoryItem[] = [];
  for (const index of [0, 1]) {
    const player = await p.player.create({ data: { name: `${tag}-${index}`, displayName: `${tag}-${index}` } }); owners.push(player.id);
    const user = await p.user.create({ data: { username: `${tag}-${index}`, displayName: String(index), passwordHash: "synthetic-disabled", playerId: player.id } }); users.push(user.id);
    const location = await p.inventoryLocation.create({ data: { ownerPlayerId: player.id, name: "Incoming", normalizedName: "incoming" } });
    people.push({ ...user, locationId: location.id });
    const card = await p.card.create({ data: { scryfallId: `${tag}-${index}`, name: `${tag}-${index}`, typeLine: "Artifact", setCode: "tst", collectorNumber: String(index), rarity: "common" } }); cards.push(card.id); printings.push(card);
    items.push(await p.inventoryItem.create({ data: { cardId: card.id, currentOwnerId: player.id, originalOpenerId: player.id, quantity: 20, condition: "NM", foil: true, foilStatus: "FOIL", language: "JA", sourceType: "MANUAL", notes: `${tag}-source-${index}`, locationId: location.id } }));
  }
  const resident = await p.inventoryItem.create({ data: { cardId: printings[0].id, currentOwnerId: people[1].playerId!, originalOpenerId: people[1].playerId!, quantity: 7, condition: "NM", sourceType: "MANUAL", notes: "resident must stay untouched", locationId: people[1].locationId } });
  const completed: string[] = [], bytes: number[] = [];
  let firstAudit: InventoryAuditLog | undefined, latestBefore: any;
  const complete = async (quantity: number) => {
    const trade = await p.trade.create({ data: {
      proposerPlayerId: people[0].playerId!, receiverPlayerId: people[1].playerId!, createdByUserId: people[0].id,
      status: "PARTIALLY_COMMITTED", proposerCommittedAt: new Date(), proposerDestinationLocationId: people[0].locationId, receiverDestinationLocationId: people[1].locationId,
      lines: { create: [
        { side: "PROPOSER", inventoryItemId: items[0].id, quantity, position: 0, snapshotJson: {} },
        { side: "RECEIVER", inventoryItemId: items[1].id, quantity, position: 0, snapshotJson: {} },
      ] },
    } }); trades.push(trade.id);
    const fd = new FormData(); fd.set("tradeId", trade.id); fd.set("destinationLocationId", people[1].locationId);
    await actor.run(people[1], () => actions.confirmPhysicalTrade(fd));
    assert.equal((await p.trade.findUniqueOrThrow({ where: { id: trade.id } })).status, "COMPLETED");
    assert.equal(await p.tradeEvent.count({ where: { tradeId: trade.id, eventType: "completed" } }), 1);
    const logs = await p.inventoryAuditLog.findMany({ where: { tradeId: trade.id } });
    assert.equal(logs.length, 4);
    const sourceAudit = logs.find(log => (log.beforeJson as any)?.id === items[0].id);
    assert(sourceAudit); firstAudit ??= sourceAudit; latestBefore = sourceAudit.beforeJson;
    const before = sourceAudit.beforeJson as any, after = sourceAudit.afterJson as any;
    for (const field of ["id", "cardId", "currentOwnerId", "originalOpenerId", "foil", "foilStatus", "condition", "language", "notes", "roundId", "acquiredFromPullId"] as const) assert.deepEqual(before[field], items[0][field]);
    assert.equal(before.quantity - after.quantity, quantity);
    completed.push(trade.id);
    return Buffer.byteLength(JSON.stringify(before));
  };
  // At most eight tiny legitimate sequential trades. Stop once a saved source
  // snapshot exceeds256KiB; never expand an unbounded historical collection.
  for (let turn = 0; turn < 8; turn++) {
    bytes.push(await complete(1));
    if (bytes.at(-1)! > 256 * 1024) break;
  }
  assert(firstAudit);
  const oldestReferences = JSON.stringify(latestBefore).split(firstAudit.id).length - 1;
  const report = { label, steps: bytes.length, beforeBytes: bytes, ratio: Math.max(...bytes) / bytes[0], oldestAuditCopiesInsideLatest: oldestReferences };
  console.log(JSON.stringify(report));
  assert.deepEqual(await p.inventoryAuditLog.findUniqueOrThrow({ where: { id: firstAudit.id } }), firstAudit, "new transfers do not rewrite prior canonical audit rows");
  assert.deepEqual(await p.inventoryItem.findUniqueOrThrow({ where: { id: resident.id } }), resident);
  for (const [index, quantity] of [27, 20].entries()) assert.equal((await p.inventoryItem.aggregate({ where: { cardId: printings[index].id }, _sum: { quantity: true } }))._sum.quantity, quantity);
  if (label === "baseline-b810") {
    assert(report.ratio > 8, "old source must demonstrate material recursive amplification");
    assert(oldestReferences >= 8, "oldest canonical row is redundantly embedded many times");
    console.log("BASELINE REPRODUCED: repeated partial transfers recursively duplicate prior audit rows");
    return;
  }
  assert.equal(bytes.length, 8);
  assert(Math.max(...bytes) < 2 * bytes[0], "fixed metadata must remain bounded as transfer history grows");
  assert.equal(oldestReferences, 0);
  // Preserve the full-source deletion path and all original canonical history.
  await complete(20 - bytes.length);
  assert.equal(await p.inventoryItem.findUnique({ where: { id: items[0].id } }), null);
  assert.equal(await p.inventoryItem.findUnique({ where: { id: items[1].id } }), null);
  const retained = await p.inventoryAuditLog.findUniqueOrThrow({ where: { id: firstAudit.id } });
  assert.deepEqual(retained.beforeJson, firstAudit.beforeJson); assert.deepEqual(retained.afterJson, firstAudit.afterJson);
  assert.equal(await p.inventoryAuditLog.count({ where: { tradeId: { in: completed } } }), 36);
  assert.deepEqual(await p.inventoryItem.findUniqueOrThrow({ where: { id: resident.id } }), resident);
  for (const [index, quantity] of [27, 20].entries()) assert.equal((await p.inventoryItem.aggregate({ where: { cardId: printings[index].id }, _sum: { quantity: true } }))._sum.quantity, quantity);
  const incoming = await p.inventoryItem.findMany({ where: { cardId: printings[0].id, sourceType: "TRADE", currentOwnerId: people[1].playerId! } });
  assert.equal(incoming.length, 9); assert.equal(incoming.reduce((sum, item) => sum + item.quantity, 0), 20);
  for (const item of incoming) for (const field of ["originalOpenerId", "foil", "foilStatus", "condition", "language", "notes", "roundId", "acquiredFromPullId"] as const) assert.deepEqual(item[field], items[0][field]);
  console.log("PASS: bounded partial/full transfer snapshots, preserved canonical history, copies, lots, attributes and resident stock");
}

async function main() {
  assert.equal(await p.user.count(), 0, "empty hosted disposable database required");
  const baseline = readFileSync(".local-data/trade-audit/baseline-actions.ts", "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(baseline).digest("hex"), "579b117f569141e0dba93a356cde099121c61aa0a4d14df95cd591b859aac70b");
  await profile("baseline-b810", baseline);
  await profile("current", readFileSync("app/trades/actions.ts", "utf8"));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    await p.notificationDeliveryJob.deleteMany({ where: { sourceType: "trade.completed", sourceId: { in: trades } } });
    await p.inventoryAuditLog.deleteMany({ where: { tradeId: { in: trades } } });
    await p.tradeEvent.deleteMany({ where: { tradeId: { in: trades } } });
    await p.trade.deleteMany({ where: { id: { in: trades } } });
    await p.inventoryItem.deleteMany({ where: { currentOwnerId: { in: owners } } });
    await p.inventoryLocation.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await p.user.deleteMany({ where: { id: { in: users } } }); await p.player.deleteMany({ where: { id: { in: owners } } });
    await p.card.deleteMany({ where: { id: { in: cards } } });
    assert.equal(await p.user.count(), 0); assert.equal(await p.card.count(), 0);
    console.log("PASS: exact audit-history fixture cleanup");
  } finally { await p.$disconnect(); }
});
