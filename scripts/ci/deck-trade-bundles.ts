import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { readTradeDeck, lockTradeDeckSources, assertDeckUnreserved, lockWritableDeck, validateDeckReceipt } from "../../lib/deck-trade-store";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/trade_stock_fixture");
const db = new PrismaClient(), tag = `deck-bundle-${randomUUID()}`;
const users = [tag + "-user-a", tag + "-user-b"], owners = [tag + "-owner-a", tag + "-owner-b"];
const deckId = tag + "-deck", locationId = tag + "-location";
const cards = Array.from({ length: 55 }, (_, index) => tag + "-card-" + index);
let failure: unknown;
const trades: string[] = [];
async function makeTrade() {
  const trade = await db.trade.create({ data: { proposerPlayerId: owners[0], receiverPlayerId: owners[1], createdByUserId: users[0], status: "PROPOSED" } });
  trades.push(trade.id); return trade;
}
async function run() {
  for (let index = 0; index < 2; index++) {
    await db.player.create({ data: { id: owners[index], name: owners[index], displayName: owners[index] } });
    await db.user.create({ data: { id: users[index], username: users[index], displayName: users[index], playerId: owners[index], passwordHash: "not-a-login-hash" } });
    await db.deckFolder.create({ data: { id: tag + "-folder-" + index, ownerUserId: users[index], name: "Owned folder" } });
    await db.deckTag.create({ data: { id: tag + "-tag-" + index, ownerUserId: users[index], name: "Owned tag", normalizedName: "owned tag" } });
  }
  await db.card.createMany({ data: cards.map((id, index) => ({ id, scryfallId: randomUUID(), name: "Bundle fixture " + index,
    setCode: "tst", collectorNumber: String(index), typeLine: "Artifact", rarity: "common" })) });
  await db.deck.create({ data: { id: deckId, ownerUserId: users[0], name: "Complete original deck", visibility: "PRIVATE", folderId: tag + "-folder-0" } });
  await db.deckTagAssignment.create({ data: { deckId, tagId: tag + "-tag-0" } });
  await db.deckCard.createMany({ data: cards.map(cardId => ({ deckId, cardId, cardName: cardId, quantity: 2, section: "MAINBOARD" })) });
  await db.deckCard.create({ data: { deckId, cardName: "Uncommitted list-only Maybeboard", quantity: 3, section: "MAYBEBOARD" } });
  await db.inventoryLocation.create({ data: { id: locationId, ownerPlayerId: owners[0], deckId, kind: "DECK", systemManaged: true,
    name: "Deck fixture", normalizedName: tag, active: true } });
  await db.inventoryItem.createMany({ data: cards.map(cardId => ({ currentOwnerId: owners[0], originalOpenerId: owners[1],
    cardId, quantity: 1, locationId, sourceType: "MANUAL", condition: "NM", notes: "Preserve physical provenance" })) });
  const stock = await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } });
  const audits = await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } });
  const first = await makeTrade();
  const initial = await db.$transaction(async tx => {
    await lockTradeDeckSources(tx, [deckId]); await assertDeckUnreserved(tx, deckId);
    return readTradeDeck(tx, deckId, owners[0]);
  });
  assert.equal(initial.stock.length, 55); assert.equal(initial.snapshot.cards.length, 56);
  const bundle = await db.tradeDeckBundle.create({ data: { tradeId: first.id, side: "PROPOSER", deckId,
    snapshotJson: initial.snapshot, snapshotDigest: initial.digest } });
  await db.tradeLine.createMany({ data: stock.map((item, position) => ({ tradeId: first.id, side: "PROPOSER", deckBundleId: bundle.id,
    inventoryItemId: item.id, quantity: item.quantity, position, snapshotJson: { sourceId: item.id, quantity: item.quantity } })) });
  assert.equal(await db.tradeLine.count({ where: { deckBundleId: bundle.id } }), 55);
  await assert.rejects(db.$executeRaw`INSERT INTO "TradeLine"
    (id,"tradeId",side,"deckBundleId",quantity,"snapshotJson","updatedAt")
    VALUES (${randomUUID()},${first.id},'RECEIVER',${bundle.id},1,'{}',clock_timestamp())`,
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "23503");
  await assert.rejects(db.$executeRaw`INSERT INTO "TradeLine"
    (id,"tradeId",side,"deckBundleId",quantity,"snapshotJson","updatedAt")
    VALUES (${randomUUID()},${first.id},'PROPOSER',${bundle.id},0,'{}',clock_timestamp())`,
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "23514");
  for (const status of ["PROPOSED", "ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"] as const) {
    await db.trade.update({ where: { id: first.id }, data: { status } });
    await assert.rejects(db.$transaction(tx => lockWritableDeck(tx, deckId, users[0])), /reserved in an active trade/);
    await db.$transaction(tx => assertDeckUnreserved(tx, deckId, first.id));
  }
  await db.trade.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
  await db.$transaction(tx => lockWritableDeck(tx, deckId, users[0]));
  const contenders = await Promise.all([makeTrade(), makeTrade()]);
  const results = await Promise.allSettled(contenders.map(trade => db.$transaction(async tx => {
    await lockTradeDeckSources(tx, [deckId]); await assertDeckUnreserved(tx, deckId);
    const source = await readTradeDeck(tx, deckId, owners[0]);
    return tx.tradeDeckBundle.create({ data: { tradeId: trade.id, side: "PROPOSER", deckId,
      snapshotJson: source.snapshot, snapshotDigest: source.digest } });
  })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const refused = results.find(result => result.status === "rejected");
  assert.ok(refused?.status === "rejected"); assert.match(String(refused.reason), /reserved in an active trade/);
  assert.equal(await db.tradeDeckBundle.count({ where: { deckId, trade: { status: "PROPOSED" } } }), 1);
  await db.trade.updateMany({ where: { id: { in: contenders.map(trade => trade.id) } }, data: { status: "CANCELLED" } });
  await db.deck.update({ where: { id: deckId }, data: { ownerUserId: users[1] } });
  await assert.rejects(db.$transaction(tx => lockWritableDeck(tx, deckId, users[0])), /ownership changed/);
  await db.deck.update({ where: { id: deckId }, data: { ownerUserId: users[0] } });
  const receipt = { visibility: "PRIVATE", folderId: tag + "-folder-1", tagIds: [tag + "-tag-1"] };
  const chosen = await db.$transaction(tx => validateDeckReceipt(tx, users[1], owners[1], receipt));
  assert.equal(chosen.ownerUserId, users[1]);
  await assert.rejects(db.$transaction(tx => validateDeckReceipt(tx, users[0], owners[1], receipt)), /receiving deck owner/);
  await assert.rejects(db.$transaction(tx => validateDeckReceipt(tx, users[1], owners[1], { ...receipt, folderId: tag + "-folder-0" })), /own deck library/);
  await assert.rejects(db.$transaction(tx => validateDeckReceipt(tx, users[1], owners[1], { ...receipt, tagIds: [tag + "-tag-0"] })), /own deck library/);
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } }), stock);
  assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
  console.log("PASS deck bundle foundation: real 55-lot/full-list snapshot, bundle/trade/side and positive-quantity constraints, three active reservation fences, competing owner/deck locks, stale owner denial, recipient-owned settings and Inventory/audit conservation");
}
run().catch(error => { failure = error; }).finally(async () => {
  const failures: unknown[] = failure ? [failure] : [];
  try {
    await db.trade.deleteMany({ where: { id: { in: trades } } });
    await db.inventoryItem.deleteMany({ where: { locationId } });
    await db.deck.deleteMany({ where: { id: deckId } });
    await db.deckFolder.deleteMany({ where: { ownerUserId: { in: users } } });
    await db.deckTag.deleteMany({ where: { ownerUserId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.player.deleteMany({ where: { id: { in: owners } } });
    await db.card.deleteMany({ where: { id: { in: cards } } });
    assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: { in: trades } } }), 0);
    assert.equal(await db.tradeLine.count({ where: { tradeId: { in: trades } } }), 0);
    assert.equal(await db.user.count({ where: { id: { in: users } } }), 0);
    assert.equal(await db.inventoryLocation.count({ where: { id: locationId } }), 0);
    assert.equal(await db.trade.count({ where: { id: { in: trades } } }), 0);
    assert.equal(await db.deck.count({ where: { id: deckId } }), 0);
    assert.equal(await db.card.count({ where: { id: { in: cards } } }), 0);
    assert.equal(await db.player.count({ where: { id: { in: owners } } }), 0);
    assert.equal(await db.deckFolder.count({ where: { ownerUserId: { in: users } } }), 0);
    assert.equal(await db.deckTag.count({ where: { ownerUserId: { in: users } } }), 0);
    console.log("PASS deck bundle fixture: exact owned rows removed; no user/deck/location/trade/bundle/line/card residue");
  } catch (error) { failures.push(error); }
  await db.$disconnect();
  if (failures.length) { console.error(failures.length === 1 ? failures[0] : new AggregateError(failures, "Deck bundle test and cleanup failed")); process.exitCode = 1; }
});
