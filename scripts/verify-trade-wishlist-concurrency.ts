import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PrismaClient, type Prisma } from "@prisma/client";
import { fulfillCompletedTradeWishlists } from "../lib/trade-wishlist";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/trade_wishlist_fixture");
const p = new PrismaClient();
const players: string[] = [], users: string[] = [], cards: string[] = [];
// Exact pre-repair service at main b810f06a. Only its first real status UPDATE
// is followed by an observation barrier; no query result or write is mocked.
const baselinePath = path.resolve(".github/fixtures/trade-wishlist-before-atomic.ts");
const baseline = readFileSync(baselinePath, "utf8").replace(/\r\n/g, "\n");
assert.equal(createHash("sha256").update(baseline).digest("hex"), "31bc10391caa1ce653e8e23c65abc2e9c1ec8768a33c6678efafcf0b2c6a6a61");
const old: any = new (Module as any)(baselinePath, module);
old.filename = baselinePath;
old.paths = (Module as any)._nodeModulePaths(path.dirname(baselinePath));
old._compile(ts.transpileModule(baseline, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, baselinePath);

async function main() {
  assert.equal(await p.user.count(), 0, "empty hosted disposable database required");
  const tag = `wishlist-race-${randomUUID()}`;
  for (const suffix of ["giver", "recipient"]) {
    const player = await p.player.create({ data: { name: `${tag}-${suffix}`, displayName: suffix } });
    players.push(player.id);
    const user = await p.user.create({ data: { username: `${tag}-${suffix}`, displayName: suffix, passwordHash: "synthetic-disabled", playerId: player.id } });
    users.push(user.id);
  }
  const card = await p.card.create({ data: { scryfallId: tag, name: tag, typeLine: "Artifact", setCode: "tst", collectorNumber: "1", rarity: "common" } });
  cards.push(card.id);
  const wanted = await p.tradeWishlistItem.create({ data: { ownerUserId: users[1], targetOwnerPlayerId: players[0], cardId: card.id, quantity: 2 } });
  const unrelated = await p.tradeWishlistItem.create({ data: { ownerUserId: users[0], targetOwnerPlayerId: players[1], cardId: card.id, quantity: 4 } });
  const input = { proposerPlayerId: players[0], receiverPlayerId: players[1], offeredCards: [{ cardId: card.id, quantity: 1 }], requestedCards: [] };
  let arrivals = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  const barrier = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const timeout = setTimeout(() => reject(new Error("both real baseline first updates must arrive")), 5000);
  const backendIds = new Set<number>();
  try {
    await Promise.all([0, 1].map(() => p.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      backendIds.add(backend.pid);
      const adapter = new Proxy(tx, { get(target, key) {
        if (key === "tradeWishlistItem") return { updateMany: async (args: any) => {
          const result = await target.tradeWishlistItem.updateMany(args);
          if (args.data.status === "FULFILLED") {
            assert.equal(result.count, 0, "quantity starts at two, so first status checks do not fulfill it");
            if (++arrivals === 2) release();
            await barrier;
          }
          return result;
        } };
        const value = (target as any)[key];
        return typeof value === "function" ? value.bind(target) : value;
      } });
      await old.exports.fulfillCompletedTradeWishlists(adapter, input);
    }, { timeout: 10000 })));
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(backendIds.size, 2, "distinct actual PostgreSQL transactions overlap");
  const broken = await p.tradeWishlistItem.findUniqueOrThrow({ where: { id: wanted.id } });
  assert.equal(arrivals, 2);
  assert.equal(broken.status, "OPEN");
  assert.equal(broken.quantity, 1);
  console.log("BASELINE REPRODUCED: two one-copy completions against a two-copy wishlist leave OPEN quantity1; two real connections/first-query barrier");

  for (const [quantity, status, expectedStatus, expectedQuantity] of [
    [2, "OPEN", "FULFILLED", 1],
    [3, "OPEN", "OPEN", 1],
    [3, "IN_TRADE", "IN_TRADE", 1],
    [1, "OPEN", "FULFILLED", 1],
    [2, "CANCELLED", "CANCELLED", 2],
    [2, "FULFILLED", "FULFILLED", 2],
  ] as const) {
    await p.tradeWishlistItem.update({ where: { id: wanted.id }, data: { quantity, status } });
    await Promise.all([0, 1].map(() => p.$transaction((tx: Prisma.TransactionClient) => fulfillCompletedTradeWishlists(tx, input))));
    const result = await p.tradeWishlistItem.findUniqueOrThrow({ where: { id: wanted.id } });
    assert.equal(result.status, expectedStatus, `two completions from ${status}/${quantity}`);
    assert.equal(result.quantity, expectedQuantity);
    assert.deepEqual(await p.tradeWishlistItem.findUniqueOrThrow({ where: { id: unrelated.id } }), unrelated);
  }
  assert.equal(await p.inventoryItem.count(), 0);
  assert.equal(await p.inventoryAuditLog.count(), 0);
  console.log("PASS: atomic exact/partial/in-trade fulfillment, terminal exclusion, unrelated scope and zero Inventory writes");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    await p.tradeWishlistItem.deleteMany({ where: { ownerUserId: { in: users } } });
    await p.user.deleteMany({ where: { id: { in: users } } });
    await p.player.deleteMany({ where: { id: { in: players } } });
    await p.card.deleteMany({ where: { id: { in: cards } } });
    assert.equal(await p.user.count(), 0);
    assert.equal(await p.card.count(), 0);
    console.log("PASS: exact fixture cleanup");
  } finally { await p.$disconnect(); }
});
