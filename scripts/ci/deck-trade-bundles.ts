import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { Prisma, PrismaClient } from "@prisma/client";
import { readTradeDeck, lockTradeDeckSources, assertDeckUnreserved, lockWritableDeck, validateDeckReceipt,
  prepareTradeDeckBundles, revalidatePreparedTradeDecks, reservePreparedTradeDecks } from "../../lib/deck-trade-store";
import { recordTradeDeckReceipts, transferConfirmedTradeDecks } from "../../lib/deck-trade-transfer";
import { assertDeckDefaultVisibilityWritable } from "../../lib/deck-write-fence";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/trade_stock_fixture");
const db = new PrismaClient(), tag = `deck-bundle-${randomUUID()}`;
const users = [tag + "-user-a", tag + "-user-b"], owners = [tag + "-owner-a", tag + "-owner-b"];
const deckId = tag + "-deck", locationId = tag + "-location";
const fixtureDeckIds = [deckId];
const cards = Array.from({ length: 55 }, (_, index) => tag + "-card-" + index);
let failure: unknown;
const trades: string[] = [];
let actor: any;
let fixtureAdminMode = false;
function loadActual(relative: string, client: PrismaClient = db, extra = ""): any {
  const filename = path.resolve(relative), realRequire = createRequire(filename), loaded = new (Module as any)(filename);
  loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  loaded.require = (name: string) => {
    if (name === "@/lib/prisma") return { prisma: client };
    if (name === "@/lib/auth") return { requireLogin: async () => actor, getCurrentUser: async () => actor,
      getAccessScope: async () => ({ mode: fixtureAdminMode && actor.role === "ADMIN" ? "admin" : "user",
        userId: actor.id, playerId: actor.playerId, isAdminUser: actor.role === "ADMIN" }) };
    if (name === "next/cache") return { revalidatePath: () => {} };
    if (name === "next/navigation") return { redirect: () => { throw new Error("Unexpected fixture redirect"); } };
    if (name === "@/lib/deck-management-policy") return loadActual("lib/deck-management-policy.ts", client);
    if (name.startsWith("@/")) return realRequire(path.resolve(name.slice(2)));
    return realRequire(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, "utf8") + "\n" + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ deckId, name: "Forbidden while reserved", format: "CASUAL", visibility: "PRIVATE",
    folderId: tag + "-folder-0", tags: "Owned tag", destinationLocationId: tag + "-normal", strongConfirmation: "DELETE", ...values })) data.set(key, value);
  return data;
}
async function makeTrade() {
  const trade = await db.trade.create({ data: { proposerPlayerId: owners[0], receiverPlayerId: owners[1], createdByUserId: users[0], status: "PROPOSED" } });
  trades.push(trade.id); return trade;
}
async function run() {
  for (let index = 0; index < 2; index++) {
    await db.player.create({ data: { id: owners[index], name: owners[index], displayName: owners[index] } });
    await db.user.create({ data: { id: users[index], username: users[index], displayName: users[index], playerId: owners[index],
      role: index === 0 ? "ADMIN" : "PLAYER", passwordHash: "not-a-login-hash" } });
    await db.deckFolder.create({ data: { id: tag + "-folder-" + index, ownerUserId: users[index], name: "Owned folder" } });
    await db.deckTag.create({ data: { id: tag + "-tag-" + index, ownerUserId: users[index], name: "Owned tag", normalizedName: "owned tag" } });
  }
  await db.card.createMany({ data: cards.map((id, index) => ({ id, scryfallId: randomUUID(), name: "Bundle fixture " + index,
    setCode: "tst", collectorNumber: String(index), typeLine: "Artifact", rarity: "common" })) });
  await db.deck.create({ data: { id: deckId, ownerUserId: users[0], name: "Complete original deck", visibility: "INHERIT", folderId: tag + "-folder-0" } });
  await db.deckTagAssignment.create({ data: { deckId, tagId: tag + "-tag-0" } });
  await db.deckCard.createMany({ data: cards.map(cardId => ({ deckId, cardId, cardName: cardId, quantity: 2, section: "MAINBOARD" })) });
  await db.deckCard.create({ data: { deckId, cardName: "Uncommitted list-only Maybeboard", quantity: 3, section: "MAYBEBOARD" } });
  await db.inventoryLocation.create({ data: { id: locationId, ownerPlayerId: owners[0], deckId, kind: "DECK", systemManaged: true,
    name: "Deck fixture", normalizedName: tag, active: true, visibility: "PUBLIC" } });
  await db.inventoryLocation.create({ data: { id: tag + "-normal", ownerPlayerId: owners[0], name: "Normal destination", normalizedName: tag + "-normal" } });
  await db.inventoryItem.createMany({ data: cards.map(cardId => ({ currentOwnerId: owners[0], originalOpenerId: owners[1],
    cardId, quantity: 1, locationId, sourceType: "MANUAL", condition: "NM", notes: "Preserve physical provenance" })) });
  const zero = await db.inventoryItem.create({ data: { currentOwnerId: owners[0], cardId: cards[0], quantity: 0,
    locationId, sourceType: "MANUAL", condition: "NM", notes: "Reserved deck metadata without a positive line" } });
  const stock = await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } });
  const audits = await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } });
  const first = await makeTrade();
  const initial = await db.$transaction(async tx => {
    await lockTradeDeckSources(tx, [deckId]); await assertDeckUnreserved(tx, deckId);
    return readTradeDeck(tx, deckId, owners[0]);
  });
  assert.equal(initial.stock.length, 56); assert.equal(initial.stock.filter(item => item.quantity > 0).length, 55);
  assert.equal(initial.snapshot.cards.length, 56);
  const bundle = await db.tradeDeckBundle.create({ data: { tradeId: first.id, side: "PROPOSER", deckId,
    snapshotJson: initial.snapshot, snapshotDigest: initial.digest } });
  await db.tradeLine.createMany({ data: stock.filter(item => item.quantity > 0).map((item, position) => ({ tradeId: first.id, side: "PROPOSER", deckBundleId: bundle.id,
    inventoryItemId: item.id, quantity: item.quantity, position, snapshotJson: { sourceId: item.id, quantity: item.quantity } })) });
  assert.equal(await db.tradeLine.count({ where: { deckBundleId: bundle.id } }), 55);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  const actions = loadActual("app/decks/actions.ts");
  const inventoryActions = loadActual("app/inventory/actions.ts");
  const leagueActions = loadActual("app/league/actions.ts");
  await db.commanderLeague.create({ data: { id: tag + "-league", name: tag, slug: tag, year: 2026, createdByUserId: users[0],
    members: { create: { userId: users[0], role: "ADMIN" } } } });
  const wishlist = loadActual("app/wishlist/actions.ts", db, "exports.fixturePrintingChange=applyDeckCardPrintingChange;");
  const deckCard = await db.deckCard.findFirstOrThrow({ where: { deckId, cardId: cards[0] } });
  const graph = () => Promise.all([
    db.deck.findUnique({ where: { id: deckId }, include: { cards: { orderBy: { id: "asc" } }, tags: { orderBy: { tagId: "asc" } } } }),
    db.inventoryLocation.findMany({ where: { ownerPlayerId: { in: owners } }, orderBy: { id: "asc" } }),
    db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } }),
    db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }),
  ]);
  const routes = [
    ["app/api/decks/[deckId]/bulk-remove/route.ts", { rowIds: [deckCard.id], destinationLocationId: tag + "-normal" }],
    ["app/api/decks/[deckId]/bulk-move/route.ts", { rowIds: [deckCard.id], section: "MAYBEBOARD", maybeboardCommittedMode: "keep" }],
    ["app/api/decks/[deckId]/optimize-apply/route.ts", { changes: [{ deckCardId: deckCard.id, proposedCardId: cards[1], include: true }] }],
    ["app/api/decks/[deckId]/cards/[deckCardId]/change-printing/route.ts", { cardId: cards[1] }],
    ["app/api/decks/[deckId]/return-committed/route.ts", { rowIds: [deckCard.id], destinationLocationId: tag + "-normal", quantity: 1 }],
  ] as const;
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
    await assert.rejects(db.$transaction(async tx => {
      await assertDeckDefaultVisibilityWritable(tx, users[0], "PUBLIC");
      await tx.user.update({ where: { id: users[0] }, data: { deckDefaultVisibility: "PUBLIC" } });
    }), /reserved in an active trade/);
    await db.$transaction(tx => assertDeckDefaultVisibilityWritable(tx, users[0], "PRIVATE"));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: users[0] } })).deckDefaultVisibility, "PRIVATE");
    await assert.rejects(leagueActions.addLeagueLocation(form({ leagueId: tag + "-league", locationId })), /reserved in an active trade/);
    await assert.rejects(leagueActions.createCommanderLeague(form({ name: tag + "-blocked-league", year: "2026", locationId })), /reserved in an active trade/);
    assert.equal(await db.commanderLeagueLocation.count({ where: { locationId } }), 0);
    assert.equal(await db.commanderLeague.count({ where: { name: tag + "-blocked-league" } }), 0);
    const before = await graph();
    for (const [action, data] of [
      [actions.updateDeck, form()], [actions.moveDeckToFolder, form({ folderId: "" })],
      [actions.addDeckCard, form({ cardId: cards[0], quantity: "1", section: "MAINBOARD" })],
      [actions.removeDeckCard, form({ deckCardId: deckCard.id })], [actions.returnAllCommittedDeckInventory, form()],
      [actions.deleteDeck, form()], [actions.deleteDeckFolder, form({ folderId: tag + "-folder-0" })],
    ] as const) await assert.rejects(action(data), /reserved in an active trade/);
    await assert.rejects(wishlist.fixturePrintingChange({ deckId, deckCardId: deckCard.id, proposedCardId: cards[1], expectedOwnerUserId: users[0] }), /reserved in an active trade/);
    for (const [route, data] of routes) {
      const response = await loadActual(route).POST(new Request("http://fixture.local/api/decks/fixture", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
      }), { params: Promise.resolve({ deckId, deckCardId: deckCard.id }) });
      assert.equal(response.status, 409, route);
      assert.match((await response.json()).error, /reserved in an active trade/, route);
    }
    for (const item of [stock.find(item => item.quantity > 0)!, zero]) {
      await assert.rejects(inventoryActions.deleteInventoryItem(form({ inventoryItemId: item.id, deleteReason: "Reserved fixture must survive" })), /reserved in an active trade/);
    }
    fixtureAdminMode = true;
    try { await inventoryActions.cleanupZeroQuantityInventory(form({ reason: "Do not remove an active deck's zero metadata" })); }
    finally { fixtureAdminMode = false; }
    assert.deepEqual(await graph(), before, `${status} real writer refusals must preserve the complete deck/location/stock/audit graph`);
  }
  await db.trade.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
  await db.$transaction(tx => lockWritableDeck(tx, deckId, users[0]));
  await actions.updateDeck(form({ name: "Renamed Deck" }));
  assert.equal((await db.deck.findUniqueOrThrow({ where: { id: deckId } })).name, "Renamed Deck");
  assert.equal((await db.inventoryLocation.findUniqueOrThrow({ where: { id: locationId } })).name, "Deck: Renamed Deck");
  console.log("PASS deck writer integration: 13 actual deck action-route paths plus positive/zero Inventory Delete and admin zero cleanup preserve all three active bundle graphs; terminal metadata/location update still works");
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
  const currentSource = await readTradeDeck(db as unknown as Prisma.TransactionClient, deckId, owners[0]);
  const selection = { deckId, digest: currentSource.digest };
  const proposal = { actorUserId: users[0], proposerPlayerId: owners[0], receiverPlayerId: owners[1], offered: [selection], requested: [] };
  assert.equal((await db.$transaction(tx => prepareTradeDeckBundles(tx, proposal))).length, 1);
  await assert.rejects(db.$transaction(tx => prepareTradeDeckBundles(tx, { ...proposal, offered: [{ ...selection, digest: "0".repeat(64) }] })), /deck changed/);
  const sharedUser = tag + "-shared-player-user"; users.push(sharedUser);
  await db.user.create({ data: { id: sharedUser, username: sharedUser, displayName: sharedUser, playerId: owners[0], passwordHash: "not-a-login-hash" } });
  await assert.rejects(db.$transaction(tx => prepareTradeDeckBundles(tx, { ...proposal, actorUserId: sharedUser })), /actual deck owner/);
  const partnerDeckId = tag + "-partner-private"; fixtureDeckIds.push(partnerDeckId);
  await db.deck.create({ data: { id: partnerDeckId, ownerUserId: users[1], name: "Private partner deck", visibility: "PRIVATE" } });
  await db.deckCard.create({ data: { deckId: partnerDeckId, cardId: cards[0], cardName: "Private list entry", quantity: 1 } });
  const partnerSource = await readTradeDeck(db as unknown as Prisma.TransactionClient, partnerDeckId, owners[1]);
  const partnerSelection = { deckId: partnerDeckId, digest: partnerSource.digest };
  await assert.rejects(db.$transaction(tx => prepareTradeDeckBundles(tx, { ...proposal, offered: [], requested: [partnerSelection] })), /unavailable to request/);
  const parent = await db.trade.create({ data: { proposerPlayerId: owners[1], receiverPlayerId: owners[0], createdByUserId: users[1], status: "PROPOSED" } });
  trades.push(parent.id);
  await db.tradeDeckBundle.create({ data: { tradeId: parent.id, deckId: partnerDeckId, side: "PROPOSER",
    snapshotJson: partnerSource.snapshot, snapshotDigest: partnerSource.digest } });
  assert.equal((await db.$transaction(tx => prepareTradeDeckBundles(tx, {
    ...proposal, offered: [], requested: [partnerSelection], counterTradeId: parent.id,
  }))).length, 1, "a deck explicitly offered by its owner remains available as an indivisible private counter bundle");
  await db.trade.update({ where: { id: parent.id }, data: { createdByUserId: users[0] } });
  await assert.rejects(db.$transaction(tx => prepareTradeDeckBundles(tx, {
    ...proposal, offered: [], requested: [partnerSelection], counterTradeId: parent.id,
  })), /unavailable to request/);
  await db.trade.update({ where: { id: parent.id }, data: { status: "CANCELLED" } });
  await db.deck.update({ where: { id: partnerDeckId }, data: { visibility: "PUBLIC" } });
  const publicPartner = await readTradeDeck(db as unknown as Prisma.TransactionClient, partnerDeckId, owners[1]);
  const extraSelections: { deckId: string; digest: string }[] = [];
  for (let index = 0; index < 2; index++) {
    const id = tag + "-extra-deck-" + index; fixtureDeckIds.push(id);
    await db.deck.create({ data: { id, ownerUserId: users[index], name: "Another complete deck", visibility: index ? "PUBLIC" : "PRIVATE" } });
    const extra = await readTradeDeck(db as unknown as Prisma.TransactionClient, id, owners[index]);
    extraSelections.push({ deckId: id, digest: extra.digest });
  }
  const mixed = await db.$transaction(tx => prepareTradeDeckBundles(tx, { ...proposal,
    offered: [selection, extraSelections[0]], requested: [{ deckId: partnerDeckId, digest: publicPartner.digest }, extraSelections[1]],
  }));
  assert.equal(mixed.length, 4); assert.equal(mixed.filter(bundle => bundle.side === "PROPOSER").length, 2);
  assert.equal(mixed.filter(bundle => bundle.side === "RECEIVER").length, 2);
  await assert.rejects(db.$transaction(async tx => {
    const prepared = await prepareTradeDeckBundles(tx, proposal);
    await tx.inventoryItem.update({ where: { id: stock.find(item => item.quantity > 0)!.id }, data: { notes: "Changed after the displayed review" } });
    await revalidatePreparedTradeDecks(tx, prepared);
  }), /deck changed/);
  console.log("PASS deck source preparation: exact displayed digests, two decks per side, actual User authority despite shared Player, private request denial/owner-consented counter, recipient settings and stale-source rollback");
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } }), stock);
  assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
  const reservation = await makeTrade();
  const reserve = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Trade" WHERE id=${reservation.id} FOR UPDATE`;
    const selected = await prepareTradeDeckBundles(tx, { ...proposal,
      offered: [selection, extraSelections[0]], requested: [{ deckId: partnerDeckId, digest: publicPartner.digest }, extraSelections[1]],
    });
    return reservePreparedTradeDecks(tx, reservation.id, selected);
  };
  await assert.rejects(db.$transaction(async tx => { await reserve(tx); throw new Error("Injected after real bundle writes"); }), /Injected after real bundle writes/);
  assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: reservation.id } }), 0);
  assert.equal(await db.tradeLine.count({ where: { tradeId: reservation.id } }), 0);
  await db.$transaction(reserve);
  assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: reservation.id } }), 4);
  const reservedLots = await db.tradeLine.findMany({ where: { tradeId: reservation.id }, orderBy: { inventoryItemId: "asc" } });
  assert.equal(reservedLots.length, 55, "list-only and zero rows create no physical lot claims; all 55 positive lots remain indivisible");
  assert.deepEqual(reservedLots.map(line => [line.inventoryItemId, line.quantity]), stock.filter(item => item.quantity > 0).map(item => [item.id, item.quantity]));
  assert.ok(reservedLots.every(line => line.deckBundleId));
  await assert.rejects(db.$transaction(reserve), /reserved in an active trade/);
  assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: reservation.id } }), 4);
  await db.trade.update({ where: { id: reservation.id }, data: { status: "CANCELLED" } });
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } }), stock);
  assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
  console.log("PASS real bundle admission: four complete decks, all 55 positive lots beyond loose-card limits, zero/list-only preservation, actual write rollback and replay refusal without Inventory/audit mutation");
  const deckGraph = () => db.deck.findMany({ where: { id: { in: fixtureDeckIds } }, orderBy: { id: "asc" },
    include: { cards: { orderBy: { id: "asc" } }, tags: { orderBy: { tagId: "asc" } } } });
  const beforeTransfer = await deckGraph();
  await assert.rejects(db.$transaction(async tx => {
    await tx.trade.update({ where: { id: reservation.id }, data: { status: "ACCEPTED_PENDING_EXCHANGE" } });
    const bundles = await tx.tradeDeckBundle.findMany({ where: { tradeId: reservation.id } });
    const choices = (side: "PROPOSER" | "RECEIVER", index: number) => bundles.filter(bundle => bundle.side === side).map(bundle => ({
      bundleId: bundle.id, visibility: index ? "PUBLIC" : "PRIVATE", folderId: tag + "-folder-" + index, tagIds: [tag + "-tag-" + index],
    }));
    await assert.rejects(recordTradeDeckReceipts(tx, reservation.id, sharedUser, choices("RECEIVER", 0)), /actual deck owner/);
    await assert.rejects(recordTradeDeckReceipts(tx, reservation.id, users[0], []), /every received deck/);
    await recordTradeDeckReceipts(tx, reservation.id, users[0], choices("RECEIVER", 0));
    await tx.trade.update({ where: { id: reservation.id }, data: { proposerCommittedAt: new Date(), status: "PARTIALLY_COMMITTED" } });
    await assert.rejects(transferConfirmedTradeDecks(tx, reservation.id, users[0]), /Both participants/);
    assert.deepEqual(await tx.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } }), stock);
    assert.deepEqual(await tx.deck.findMany({ where: { id: { in: fixtureDeckIds } }, orderBy: { id: "asc" },
      include: { cards: { orderBy: { id: "asc" } }, tags: { orderBy: { tagId: "asc" } } } }), beforeTransfer);
    await recordTradeDeckReceipts(tx, reservation.id, users[1], choices("PROPOSER", 1));
    await tx.trade.update({ where: { id: reservation.id }, data: { receiverCommittedAt: new Date() } });
    assert.equal((await transferConfirmedTradeDecks(tx, reservation.id, users[1])).length, 4);
    const movedDeck = await tx.deck.findUniqueOrThrow({ where: { id: deckId }, include: { cards: { orderBy: { id: "asc" } }, tags: true } });
    assert.equal(movedDeck.ownerUserId, users[1]); assert.equal(movedDeck.folderId, tag + "-folder-1"); assert.equal(movedDeck.visibility, "PUBLIC");
    assert.deepEqual(movedDeck.tags.map(link => link.tagId), [tag + "-tag-1"]);
    assert.deepEqual(movedDeck.cards, beforeTransfer.find(deck => deck.id === deckId)!.cards);
    const movedLocation = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: locationId } });
    assert.equal(movedLocation.ownerPlayerId, owners[1]); assert.equal(movedLocation.deckId, deckId);
    assert.equal(movedLocation.parentLocationId, null); assert.equal(movedLocation.visibility, "PUBLIC");
    const movedStock = await tx.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } });
    assert.deepEqual(movedStock.map(({ currentOwnerId, updatedAt, ...item }) => item), stock.map(({ currentOwnerId, updatedAt, ...item }) => item));
    assert.ok(movedStock.every(item => item.currentOwnerId === owners[1]));
    assert.equal(await tx.inventoryAuditLog.count({ where: { tradeId: reservation.id, changeType: "trade_deck_completed" } }), 56);
    assert.equal((await tx.deck.findUniqueOrThrow({ where: { id: partnerDeckId } })).ownerUserId, users[0]);
    await tx.trade.update({ where: { id: reservation.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await assert.rejects(transferConfirmedTradeDecks(tx, reservation.id, users[1]), /not awaiting physical confirmation/);
    throw new Error("Injected after actual deck-location-stock transfers");
  }, { timeout: 30000 }), /Injected after actual deck-location-stock transfers/);
  assert.deepEqual(await deckGraph(), beforeTransfer);
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId }, orderBy: { id: "asc" } }), stock);
  assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: reservation.id } })).status, "CANCELLED");
  assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: reservation.id, receiptJson: { not: Prisma.DbNull } } }), 0);
  console.log("PASS actual deck transfers within rollback control: both confirmations required, actual owner consent, recipient organization/visibility, same Deck/list/location/56 stock rows and provenance, replay refusal, full post-write rollback");
  fixtureAdminMode = true;
  try { await inventoryActions.cleanupZeroQuantityInventory(form({ reason: "Terminal deck cleanup positive control" })); }
  finally { fixtureAdminMode = false; }
  assert.equal(await db.inventoryItem.count({ where: { id: zero.id } }), 0);
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId, quantity: { gt: 0 } }, orderBy: { id: "asc" } }), stock.filter(item => item.quantity > 0));
  assert.equal(await db.inventoryAuditLog.count(), audits.length + 1);
  assert.equal(await db.inventoryAuditLog.count({ where: { changedByUserId: users[0], changeType: "admin_cleanup_zero_quantity" } }), 1);
  await verifyMixedCounter();
  await verifyCommittedTransfer();
  await verifyDeckReviewApi();
  await verifyDeckReviewPrivacyRaces();
  console.log("PASS deck bundle foundation: real 55-lot/full-list snapshot, bundle/trade/side and positive-quantity constraints, three active reservation fences, competing owner/deck locks, stale owner denial, recipient-owned settings and Inventory/audit conservation");
}
async function verifyDeckReviewPrivacyRaces() {
  const id = tag + "-privacy-race"; fixtureDeckIds.push(id);
  await db.deck.create({ data: { id, ownerUserId: users[0], name: "Public reviewed deck", format: "CASUAL", visibility: "PUBLIC",
    cards: { create: { cardId: cards[0], cardName: "Previously public list", quantity: 1 } } } });
  const entry = await db.deckCard.findFirstOrThrow({ where: { deckId: id } });
  const actorFor = async (index: number) => { actor = await db.user.findUniqueOrThrow({ where: { id: users[index] }, include: { player: true } }); };
  const reset = async (visibility: "PUBLIC" | "PRIVATE" | "INHERIT" = "PUBLIC") => {
    await db.deck.update({ where: { id }, data: { ownerUserId: users[0], name: "Public reviewed deck", visibility } });
    await db.user.update({ where: { id: users[0] }, data: { deckDefaultVisibility: "PUBLIC" } });
    await db.deckCard.update({ where: { id: entry.id }, data: { cardName: "Previously public list" } });
  };
  const makePrivate = async () => {
    await db.$transaction([
      db.deck.update({ where: { id }, data: { visibility: "PRIVATE", name: "New unshared private name" } }),
      db.deckCard.update({ where: { id: entry.id }, data: { cardName: "New unshared private contents" } }),
    ]);
  };
  type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number };
  // The outer preflight really executes first. A second real DB connection
  // commits the revocation before the handler starts its source transaction.
  const beforeTransaction = (mutate: () => Promise<unknown>) => new Proxy(db, { get(target, property) {
    if (property === "$transaction") return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: Options) => {
      await mutate(); return db.$transaction(callback, options);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const request = (client: PrismaClient = db, extra: Record<string, string> = {}, routePath = "app/api/trades/decks/route.ts") =>
    loadActual(routePath, client).GET(new Request("http://fixture.local/api/trades/decks?" + new URLSearchParams({
      ownerId: owners[0], side: "requested", deckId: id, ...extra,
    })));
  const denied = async (response: Response) => { assert.equal(response.status, 404); assert.doesNotMatch(JSON.stringify(await response.json()), /New unshared private contents|Previously public list|"review"/); };
  const unchanged = () => Promise.all([db.inventoryItem.findMany({ orderBy: { id: "asc" } }),
    db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), db.tradeEvent.findMany({ orderBy: { id: "asc" } }),
    db.notification.findMany({ orderBy: { id: "asc" } })]);
  const before = await unchanged(); await actorFor(1);
  const baseline = await request(beforeTransaction(makePrivate), {}, ".local-data/trade-stock/privacy-baseline-route.ts");
  assert.equal(baseline.status, 200); assert.match(JSON.stringify(await baseline.json()), /New unshared private contents/);
  console.log("PASS pinned1b1eb0d9 negative: actual old review handler exposes newly private contents after successful public preflight");
  await reset(); assert.equal((await request()).status, 200);
  await denied(await request(beforeTransaction(makePrivate)));
  await reset("PRIVATE"); await denied(await request());
  await reset("INHERIT");
  await denied(await request(beforeTransaction(async () => {
    await db.$transaction([db.user.update({ where: { id: users[0] }, data: { deckDefaultVisibility: "PRIVATE" } }),
      db.deckCard.update({ where: { id: entry.id }, data: { cardName: "New unshared private contents" } })]);
  })));
  await reset(); await actorFor(0);
  await denied(await request(beforeTransaction(async () => {
    await db.deck.update({ where: { id }, data: { ownerUserId: users[2], visibility: "PRIVATE" } });
  }), { side: "offered" }));
  await reset("PRIVATE"); await actorFor(1);
  const source = await readTradeDeck(db as unknown as Prisma.TransactionClient, id, owners[0]);
  const parent = await makeTrade();
  const bundle = await db.tradeDeckBundle.create({ data: { tradeId: parent.id, deckId: id, side: "PROPOSER", position: 0,
    snapshotJson: source.snapshot, snapshotDigest: source.digest } });
  const counter = { counterTradeId: parent.id };
  assert.equal((await request(db, counter)).status, 200);
  const sharedPage = await request(db, { ...counter, deckId: "" });
  assert.equal(sharedPage.status, 200); assert.ok((await sharedPage.json()).items.some((item: { deckId: string }) => item.deckId === id));
  await denied(await request(beforeTransaction(async () => { await db.trade.update({ where: { id: parent.id }, data: { status: "CANCELLED" } }); }), { ...counter, deckId: "" }));
  await db.trade.update({ where: { id: parent.id }, data: { status: "PROPOSED" } });
  await denied(await request(beforeTransaction(async () => { await db.trade.update({ where: { id: parent.id }, data: { status: "CANCELLED" } }); }), counter));
  await db.trade.update({ where: { id: parent.id }, data: { status: "PROPOSED" } });
  await denied(await request(beforeTransaction(async () => { await db.tradeDeckBundle.update({ where: { id: bundle.id }, data: { side: "RECEIVER" } }); }), counter));
  await db.tradeDeckBundle.update({ where: { id: bundle.id }, data: { side: "PROPOSER" } });
  await denied(await request(beforeTransaction(async () => { await db.deck.update({ where: { id }, data: { ownerUserId: users[2] } }); }), counter));
  await db.trade.update({ where: { id: parent.id }, data: { status: "CANCELLED" } }); await reset();
  // Now mutate after the in-transaction access query. The actual MVCC snapshot
  // must return only the earlier public list; the next request must be denied.
  let changed = false;
  const duringTransaction = new Proxy(db, { get(target, property) {
    if (property !== "$transaction") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: Options) => {
      assert.equal(options?.isolationLevel, "RepeatableRead");
      return db.$transaction(tx => callback(new Proxy(tx, { get(transaction, key) {
        if (key !== "deck") { const value = Reflect.get(transaction, key); return typeof value === "function" ? value.bind(transaction) : value; }
        return new Proxy(tx.deck, { get(delegate, method) {
          if (method === "findFirst") return async (query: Prisma.DeckFindFirstArgs) => {
            const result = await tx.deck.findFirst(query);
            if (!changed) { changed = true; await makePrivate(); }
            return result;
          };
          const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
        } });
      } })), options);
    };
  } });
  const consistent = await request(duringTransaction); assert.equal(changed, true); assert.equal(consistent.status, 200);
  const body = JSON.stringify(await consistent.json()); assert.match(body, /Previously public list/); assert.doesNotMatch(body, /New unshared private contents/);
  await denied(await request());
  assert.deepEqual(await unchanged(), before, "Review races must not write Inventory, audit, trade events or notifications");
  console.log("PASS actual review privacy races: current public/inherited visibility, actual User ownership and parent/side/owner sharing revocation; same MVCC snapshot excludes newer private contents; no extra writes");
}
async function verifyDeckReviewApi() {
  const route = loadActual("app/api/trades/decks/route.ts");
  const request = (values: Record<string, string>) => route.GET(new Request("http://fixture.local/api/trades/decks?" + new URLSearchParams(values)));
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  const listing = await request({ ownerId: owners[1], side: "requested" });
  assert.equal(listing.status, 200);
  const page = await listing.json();
  assert.ok(page.items.some((item: { deckId: string }) => item.deckId === deckId));
  assert.ok(!page.items.some((item: { deckId: string }) => [tag + "-committed-gift", tag + "-counter-replacement-1"].includes(item.deckId)));
  const detail = await request({ ownerId: owners[1], side: "requested", deckId });
  assert.equal(detail.status, 200);
  const { review } = await detail.json();
  assert.equal(review.cards.length, 56); assert.equal(review.commitments.length, 55); assert.equal(review.committedCopies, 55);
  assert.equal(review.listedCopies, 110); assert.equal(review.maybeboardCopies, 3);
  assert.match(review.digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(review), /"notes"|"folderId"|"tagIds"|"ownerUserId"|"originalOpenerId"|"acquiredFromPullId"|"roundId"|"locationId"|"stock"/);
  fixtureAdminMode = true;
  try { assert.equal((await request({ ownerId: owners[1], side: "offered", deckId })).status, 403); }
  finally { fixtureAdminMode = false; }
  actor = await db.user.findUniqueOrThrow({ where: { id: users[2] }, include: { player: true } });
  assert.equal((await request({ ownerId: owners[0], side: "offered", deckId: tag + "-counter-replacement-0" })).status, 404);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  const privateDeckId = tag + "-partner-private";
  const hidden = await request({ ownerId: owners[0], side: "requested", deckId: privateDeckId });
  assert.equal(hidden.status, 404); assert.doesNotMatch(JSON.stringify(await hidden.json()), /Private partner deck/);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  const source = await readTradeDeck(db as unknown as Prisma.TransactionClient, privateDeckId, owners[0]);
  const actions = loadActual("app/trades/actions.ts");
  assert.equal((await actions.createTrade({ status: "idle", message: "" }, form({ receiverPlayerId: owners[1], message: tag + " private counter review",
    offeredDecksJson: JSON.stringify([{ deckId: privateDeckId, digest: source.digest }]), requestedDecksJson: "[]", offeredLinesJson: "[]", requestedLinesJson: "[]",
  }))).status, "success");
  const parent = await db.trade.findFirstOrThrow({ where: { message: tag + " private counter review" } }); trades.push(parent.id);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  const shared = await request({ ownerId: owners[0], side: "requested", deckId: privateDeckId, counterTradeId: parent.id });
  assert.equal(shared.status, 200); assert.equal((await shared.json()).review.deckId, privateDeckId);
  await actions.actOnTrade(form({ tradeId: parent.id, action: "decline" }));
  assert.equal((await request({ ownerId: owners[0], side: "requested", deckId: privateDeckId, counterTradeId: parent.id })).status, 404);
  console.log("PASS actual deck review API: complete 55-lot/public review, private uninvited deck exclusion, actual User ownership despite shared Player/admin mode, owner-consented private counter review and revoked terminal sharing, sanitized client fields");
}
async function verifyMixedCounter() {
  const actions = loadActual("app/trades/actions.ts");
  const replacements: { deckId: string; digest: string }[] = [];
  for (let index = 0; index < 2; index++) {
    const id = tag + "-counter-replacement-" + index; fixtureDeckIds.push(id);
    await db.deck.create({ data: { id, ownerUserId: users[index], name: "Replacement whole deck", visibility: index ? "PRIVATE" : "PUBLIC",
      cards: { create: [{ cardId: cards[0], cardName: "List-only replacement", quantity: 1 }] } } });
    replacements.push({ deckId: id, digest: (await readTradeDeck(db as unknown as Prisma.TransactionClient, id, owners[index])).digest });
  }
  await db.inventoryLocation.create({ data: { id: tag + "-normal-1", ownerPlayerId: owners[1], name: "Counter loose stock", normalizedName: "counter loose stock" } });
  const looseIds = [] as string[];
  for (let index = 0; index < 2; index++) {
    const item = await db.inventoryItem.create({ data: { cardId: cards[0], quantity: 5, condition: "NM", currentOwnerId: owners[index],
      locationId: index ? tag + "-normal-1" : tag + "-normal", notes: "Counter loose stock " + index } });
    looseIds.push(item.id);
  }
  const select = async (id: string, owner: number) => ({ deckId: id,
    digest: (await readTradeDeck(db as unknown as Prisma.TransactionClient, id, owners[owner])).digest });
  const offered = await Promise.all([select(deckId, 0), select(tag + "-extra-deck-0", 0)]);
  const requested = await Promise.all([select(tag + "-partner-private", 1), select(tag + "-extra-deck-1", 1)]);
  const stockBefore = await db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } });
  const auditsBefore = await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } });
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  const initial = await actions.createTrade({ status: "idle", message: "" }, form({ receiverPlayerId: owners[1], message: tag + " mixed original",
    offeredDecksJson: JSON.stringify(offered), requestedDecksJson: JSON.stringify(requested),
    offeredLinesJson: JSON.stringify([{ inventoryItemId: looseIds[0], quantity: 2 }]), requestedLinesJson: JSON.stringify([{ inventoryItemId: looseIds[1], quantity: 3 }]),
  }));
  assert.equal(initial.status, "success");
  const parent = await db.trade.findFirstOrThrow({ where: { message: tag + " mixed original" } }); trades.push(parent.id);
  assert.equal(await db.tradeDeckBundle.count({ where: { tradeId: parent.id } }), 4);
  assert.equal(await db.tradeLine.count({ where: { tradeId: parent.id, deckBundleId: { not: null } } }), 55);
  assert.equal(await db.tradeLine.count({ where: { tradeId: parent.id, deckBundleId: null } }), 2);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  const counterForm = () => form({ receiverPlayerId: owners[0], counterTradeId: parent.id, message: tag + " mixed replacement",
    offeredDecksJson: JSON.stringify([replacements[1]]), requestedDecksJson: JSON.stringify([replacements[0]]),
    offeredLinesJson: JSON.stringify([{ inventoryItemId: looseIds[1], quantity: 1 }]), requestedLinesJson: JSON.stringify([{ inventoryItemId: looseIds[0], quantity: 1 }]),
  });
  assert.equal((await actions.createTrade({ status: "idle", message: "" }, counterForm())).status, "success");
  const counter = await db.trade.findFirstOrThrow({ where: { message: tag + " mixed replacement" } }); trades.push(counter.id);
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: parent.id } })).status, "DECLINED");
  assert.equal(counter.status, "PROPOSED");
  assert.deepEqual((await db.tradeDeckBundle.findMany({ where: { tradeId: counter.id }, orderBy: { side: "asc" } })).map(bundle => bundle.deckId),
    [replacements[1].deckId, replacements[0].deckId]);
  assert.equal(await db.tradeLine.count({ where: { tradeId: counter.id, deckBundleId: null, quantity: 1 } }), 2);
  for (const selection of [...offered, ...requested]) await db.$transaction(tx => lockWritableDeck(tx, selection.deckId, users[offered.includes(selection) ? 0 : 1]));
  for (const selection of replacements) await assert.rejects(db.$transaction(tx => assertDeckUnreserved(tx, selection.deckId)), /reserved in an active trade/);
  for (const id of looseIds) assert.equal((await db.tradeLine.aggregate({ where: { inventoryItemId: id,
    trade: { status: { in: ["PROPOSED", "ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"] } } }, _sum: { quantity: true } }))._sum.quantity, 1);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  await actions.actOnTrade(form({ tradeId: counter.id, action: "accept" }));
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: counter.id } })).status, "ACCEPTED_PENDING_EXCHANGE");
  fixtureAdminMode = true;
  try { await actions.actOnTrade(form({ tradeId: counter.id, action: "cancel", reason: "Owned mixed-counter fixture cleanup" })); }
  finally { fixtureAdminMode = false; }
  for (const selection of replacements) await db.$transaction(tx => assertDeckUnreserved(tx, selection.deckId));
  assert.deepEqual(await db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } }), stockBefore);
  assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), auditsBefore);
  console.log("PASS actual mixed counter: two decks and loose cards on each side, 55 complete bundle lots, whole-deck removal/replacement and changed card amounts, fresh acceptance, exact old/new reservation release and zero ownership/quantity/audit changes");
  await verifyMixedCompletion(offered, requested, looseIds);
}
async function verifyMixedCompletion(offered: { deckId: string; digest: string }[], requested: { deckId: string; digest: string }[], looseIds: string[]) {
  const actions = loadActual("app/trades/actions.ts");
  for (let index = 0; index < 2; index++) await db.tradeWishlistItem.create({ data: { ownerUserId: users[index],
    targetOwnerPlayerId: owners[1 - index], cardId: cards[0], quantity: 10 } });
  const beforeStock = await db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } });
  const originalDeckStock = beforeStock.filter(item => item.locationId === locationId);
  const originalList = await db.deckCard.findMany({ where: { deckId }, orderBy: { id: "asc" } });
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  assert.equal((await actions.createTrade({ status: "idle", message: "" }, form({ receiverPlayerId: owners[1], message: tag + " mixed final",
    offeredDecksJson: JSON.stringify(offered), requestedDecksJson: JSON.stringify(requested),
    offeredLinesJson: JSON.stringify([{ inventoryItemId: looseIds[0], quantity: 2 }]), requestedLinesJson: JSON.stringify([{ inventoryItemId: looseIds[1], quantity: 3 }]),
  }))).status, "success");
  const trade = await db.trade.findFirstOrThrow({ where: { message: tag + " mixed final" } }); trades.push(trade.id);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  await actions.actOnTrade(form({ tradeId: trade.id, action: "accept" }));
  const bundles = await db.tradeDeckBundle.findMany({ where: { tradeId: trade.id } });
  const confirmForm = (index: number) => form({ tradeId: trade.id, destinationLocationId: index ? tag + "-normal-1" : tag + "-normal",
    deckReceiptsJson: JSON.stringify(bundles.filter(bundle => bundle.side === (index ? "PROPOSER" : "RECEIVER")).map(bundle => ({
      bundleId: bundle.id, visibility: index ? "PUBLIC" : "PRIVATE", folderId: tag + "-folder-" + index, tagIds: [tag + "-tag-" + index],
    }))),
  });
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  await actions.confirmPhysicalTrade(confirmForm(0));
  assert.deepEqual(await db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } }), beforeStock);
  const graph = () => Promise.all([
    db.deck.findMany({ where: { id: { in: fixtureDeckIds } }, orderBy: { id: "asc" }, include: { cards: { orderBy: { id: "asc" } }, tags: { orderBy: { tagId: "asc" } } } }),
    db.inventoryLocation.findMany({ where: { ownerPlayerId: { in: owners } }, orderBy: { id: "asc" } }),
    db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } }),
    db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }),
    db.trade.findUnique({ where: { id: trade.id }, include: { deckBundles: { orderBy: { id: "asc" } }, events: { orderBy: { id: "asc" } } } }),
    db.notification.findMany({ where: { recipientUserId: { in: users } }, orderBy: { id: "asc" } }),
    db.tradeWishlistItem.findMany({ where: { ownerUserId: { in: users } }, orderBy: { id: "asc" } }),
  ]);
  const originalGraph = await graph();
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  const noDestination = confirmForm(1); noDestination.set("destinationLocationId", "");
  await assert.rejects(actions.confirmPhysicalTrade(noDestination), /Choose a destination/);
  assert.deepEqual(await graph(), originalGraph);
  let injected = false;
  const failing = new Proxy(db, { get(target, property) {
    if (property !== "$transaction") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { timeout?: number }) => db.$transaction(tx => callback(new Proxy(tx, {
      get(transaction, key) {
        if (key !== "inventoryAuditLog") { const value = Reflect.get(transaction, key); return typeof value === "function" ? value.bind(transaction) : value; }
        return new Proxy(tx.inventoryAuditLog, { get(delegate, method) {
          if (method === "create") return async (query: Prisma.InventoryAuditLogCreateArgs) => {
            const audit = await tx.inventoryAuditLog.create(query);
            if (query.data.tradeId === trade.id && query.data.changeType === "trade_completed") {
              injected = true; throw new Error("Injected after deck transfers and actual loose-card debit/audit");
            }
            return audit;
          };
          const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
        } });
      },
    })), options);
  } });
  await assert.rejects(loadActual("app/trades/actions.ts", failing).confirmPhysicalTrade(confirmForm(1)), /Injected after deck transfers and actual loose-card debit/);
  assert.ok(injected); assert.deepEqual(await graph(), originalGraph);
  await actions.confirmPhysicalTrade(confirmForm(1));
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: trade.id } })).status, "COMPLETED");
  const afterStock = await db.inventoryItem.findMany({ where: { currentOwnerId: { in: owners } }, orderBy: { id: "asc" } });
  assert.equal(afterStock.reduce((sum, item) => sum + item.quantity, 0), beforeStock.reduce((sum, item) => sum + item.quantity, 0));
  const movedDeckStock = afterStock.filter(item => item.locationId === locationId);
  assert.deepEqual(movedDeckStock.map(({ currentOwnerId, updatedAt, ...item }) => item), originalDeckStock.map(({ currentOwnerId, updatedAt, ...item }) => item));
  assert.ok(movedDeckStock.every(item => item.currentOwnerId === owners[1]));
  assert.deepEqual(await db.deckCard.findMany({ where: { deckId }, orderBy: { id: "asc" } }), originalList);
  const newLots = afterStock.filter(item => !beforeStock.some(old => old.id === item.id));
  assert.equal(newLots.length, 2);
  for (let index = 0; index < 2; index++) {
    const source = beforeStock.find(item => item.id === looseIds[index])!;
    const quantity = index ? 3 : 2;
    const receipt = newLots.find(item => item.notes === source.notes)!;
    assert.ok(receipt); assert.equal(receipt.currentOwnerId, owners[1 - index]); assert.equal(receipt.quantity, quantity);
    assert.equal(receipt.locationId, index ? tag + "-normal" : tag + "-normal-1");
    assert.equal(receipt.sourceType, "TRADE", "ordinary received loose lots retain their established trade-acquisition classification");
    assert.equal(receipt.locationSection, null);
    for (const field of ["cardId", "foil", "foilStatus", "condition", "language", "originalOpenerId", "acquiredFromPullId", "roundId", "notes"] as const)
      assert.deepEqual(receipt[field], source[field]);
    assert.equal(afterStock.find(item => item.id === source.id)!.quantity, 5 - quantity);
  }
  assert.equal((await db.tradeWishlistItem.findFirstOrThrow({ where: { ownerUserId: users[0], cardId: cards[0] } })).quantity, 7);
  assert.equal(originalDeckStock.find(item => item.cardId === cards[0])!.quantity, 1);
  assert.equal(originalList.find(item => item.cardId === cards[0])!.quantity, 2);
  assert.equal((await db.tradeWishlistItem.findFirstOrThrow({ where: { ownerUserId: users[1], cardId: cards[0] } })).quantity, 7, "credit one committed deck copy plus two loose copies, never the missing listed copy");
  assert.equal(await db.inventoryAuditLog.count({ where: { tradeId: trade.id, changeType: "trade_deck_completed" } }), 55);
  assert.equal(await db.inventoryAuditLog.count({ where: { tradeId: trade.id, changeType: "trade_completed" } }), 4);
  const completedGraph = await graph();
  await assert.rejects(actions.confirmPhysicalTrade(confirmForm(1)), /not awaiting physical confirmation/);
  assert.deepEqual(await graph(), completedGraph);
  console.log("PASS actual mixed completion: four decks/55 physical lots plus two loose lots, distinct destinations, exact quantity/provenance and list conservation, only physical wishlist credit, full rollback after actual deck transfers and loose debit/audit, atomic second confirmation/events/notifications/receipts, replay equality");
}
async function verifyCommittedTransfer() {
  const giftDeckId = tag + "-committed-gift", giftLocationId = tag + "-gift-location";
  fixtureDeckIds.push(giftDeckId);
  await db.deck.create({ data: { id: giftDeckId, ownerUserId: users[0], name: "Incomplete gift", visibility: "PRIVATE",
    folderId: tag + "-folder-0", tags: { create: [{ tagId: tag + "-tag-0" }] },
    cards: { create: [
      { cardId: cards[0], cardName: "Five listed but only three committed", quantity: 5 },
      { cardId: cards[1], cardName: "List-only Maybeboard", quantity: 2, section: "MAYBEBOARD" },
    ] },
  } });
  await db.inventoryLocation.create({ data: { id: giftLocationId, ownerPlayerId: owners[0], deckId: giftDeckId,
    name: "Deck: Incomplete gift", normalizedName: "deck: incomplete gift", kind: "DECK", systemManaged: true,
    visibility: "PRIVATE", parentLocationId: tag + "-normal",
  } });
  for (const quantity of [3, 0]) await db.inventoryItem.create({ data: {
    id: tag + "-gift-stock-" + quantity, cardId: cards[0], currentOwnerId: owners[0], originalOpenerId: owners[0],
    quantity, condition: "NM", locationId: giftLocationId, locationSection: "Original commitment", notes: "Preserve original gift provenance",
  } });
  const source = await readTradeDeck(db as unknown as Prisma.TransactionClient, giftDeckId, owners[0]);
  const originalStock = await db.inventoryItem.findMany({ where: { locationId: giftLocationId }, orderBy: { id: "asc" } });
  const originalList = await db.deckCard.findMany({ where: { deckId: giftDeckId }, orderBy: { id: "asc" } });
  const actions = loadActual("app/trades/actions.ts");
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  const proposal = (digest = source.digest) => form({ receiverPlayerId: owners[1], offeredLinesJson: "[]", requestedLinesJson: "[]",
    offeredDecksJson: JSON.stringify([{ deckId: giftDeckId, digest }]), requestedDecksJson: "[]", message: "The complete existing deck, with missing cards left missing." });
  const beforeProposals = await db.trade.count();
  const invalid = await actions.createTrade({ status: "idle", message: "" }, proposal("0".repeat(64)));
  assert.equal(invalid.status, "error"); assert.match(invalid.message, /deck changed/);
  assert.equal(await db.trade.count(), beforeProposals);
  const created = await actions.createTrade({ status: "idle", message: "" }, proposal());
  assert.equal(created.status, "success");
  const gift = await db.trade.findFirstOrThrow({ where: { deckBundles: { some: { deckId: giftDeckId } } } });
  trades.push(gift.id);
  const bundle = await db.tradeDeckBundle.findFirstOrThrow({ where: { tradeId: gift.id } });
  assert.equal(await db.tradeLine.count({ where: { tradeId: gift.id } }), 1);
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  await actions.actOnTrade(form({ tradeId: gift.id, action: "accept" }));
  actor = await db.user.findUniqueOrThrow({ where: { id: users[0] }, include: { player: true } });
  await actions.confirmPhysicalTrade(form({ tradeId: gift.id }));
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId: giftLocationId }, orderBy: { id: "asc" } }), originalStock);
  assert.equal((await db.deck.findUniqueOrThrow({ where: { id: giftDeckId } })).ownerUserId, users[0]);
  fixtureAdminMode = true;
  try { await assert.rejects(actions.confirmPhysicalTrade(form({ tradeId: gift.id, forceComplete: "1", reason: "Must not bypass deck consent" })), /both participants/); }
  finally { fixtureAdminMode = false; }
  actor = await db.user.findUniqueOrThrow({ where: { id: users[1] }, include: { player: true } });
  const receiptForm = () => form({ tradeId: gift.id, destinationLocationId: "", deckReceiptsJson: JSON.stringify([
    { bundleId: bundle.id, visibility: "PRIVATE", folderId: tag + "-folder-1", tagIds: [tag + "-tag-1"], ownerUserId: users[0] },
  ]) });
  // Inject a source change after the actual conditional second-confirmation
  // write, while the real action owns its Trade/owner/deck gates. No competing
  // completer runs during this isolated rollback probe.
  const corrupting = new Proxy(db, { get(target, property) {
    if (property !== "$transaction") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { timeout?: number }) => db.$transaction(tx => callback(new Proxy(tx, {
      get(transaction, key) {
        if (key !== "trade") { const value = Reflect.get(transaction, key); return typeof value === "function" ? value.bind(transaction) : value; }
        return new Proxy(tx.trade, { get(delegate, method) {
          if (method === "updateMany") return async (query: Prisma.TradeUpdateManyArgs) => {
            const changed = await tx.trade.updateMany(query);
            if (changed.count) await tx.inventoryItem.update({ where: { id: originalStock[0].id }, data: { notes: "Changed after consent" } });
            return changed;
          };
          const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
        } });
      },
    })), options);
  } });
  const eventsBefore = await db.tradeEvent.findMany({ where: { tradeId: gift.id }, orderBy: { id: "asc" } });
  const notificationsBefore = await db.notification.findMany({ where: { recipientUserId: { in: users } }, orderBy: { id: "asc" } });
  await assert.rejects(loadActual("app/trades/actions.ts", corrupting).confirmPhysicalTrade(receiptForm()), /traded deck changed/);
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: gift.id } })).receiverCommittedAt, null);
  assert.equal((await db.tradeDeckBundle.findUniqueOrThrow({ where: { id: bundle.id } })).receiptJson, null);
  assert.deepEqual(await db.tradeEvent.findMany({ where: { tradeId: gift.id }, orderBy: { id: "asc" } }), eventsBefore);
  assert.deepEqual(await db.notification.findMany({ where: { recipientUserId: { in: users } }, orderBy: { id: "asc" } }), notificationsBefore);
  assert.deepEqual(await db.inventoryItem.findMany({ where: { locationId: giftLocationId }, orderBy: { id: "asc" } }), originalStock);
  const finish = () => actions.confirmPhysicalTrade(receiptForm());
  const completed = await Promise.allSettled([finish(), finish()]);
  assert.equal(completed.filter(result => result.status === "fulfilled").length, 1);
  const refused = completed.find(result => result.status === "rejected");
  assert.ok(refused?.status === "rejected"); assert.match(String(refused.reason), /not awaiting physical confirmation/);
  const moved = await db.inventoryItem.findMany({ where: { locationId: giftLocationId }, orderBy: { id: "asc" } });
  assert.deepEqual(moved.map(({ currentOwnerId, updatedAt, ...item }) => item), originalStock.map(({ currentOwnerId, updatedAt, ...item }) => item));
  assert.ok(moved.every(item => item.currentOwnerId === owners[1]));
  assert.equal(moved.reduce((sum, item) => sum + item.quantity, 0), 3, "missing listed copies must never be filled during transfer");
  assert.deepEqual(await db.deckCard.findMany({ where: { deckId: giftDeckId }, orderBy: { id: "asc" } }), originalList);
  const received = await db.deck.findUniqueOrThrow({ where: { id: giftDeckId }, include: { tags: true } });
  assert.equal(received.ownerUserId, users[1]); assert.equal(received.folderId, tag + "-folder-1"); assert.equal(received.visibility, "PRIVATE");
  assert.deepEqual(received.tags.map(link => link.tagId), [tag + "-tag-1"]);
  const location = await db.inventoryLocation.findUniqueOrThrow({ where: { id: giftLocationId } });
  assert.equal(location.ownerPlayerId, owners[1]); assert.equal(location.deckId, giftDeckId); assert.equal(location.parentLocationId, null);
  assert.equal(await db.inventoryAuditLog.count({ where: { tradeId: gift.id, changeType: "trade_deck_completed" } }), 2);
  assert.equal((await db.trade.findUniqueOrThrow({ where: { id: gift.id } })).status, "COMPLETED");
  assert.equal((await db.tradeDeckBundle.findUniqueOrThrow({ where: { id: bundle.id } })).snapshotDigest, source.digest);
  await assert.rejects(finish(), /not awaiting physical confirmation/);
  assert.equal(await db.inventoryAuditLog.count({ where: { tradeId: gift.id } }), 2);
  assert.equal(await db.tradeEvent.count({ where: { tradeId: gift.id, eventType: "completed" } }), 1);
  assert.equal(await db.tradeEvent.count({ where: { tradeId: gift.id, eventType: { in: ["proposer_confirmed_physical_exchange", "receiver_confirmed_physical_exchange"] } } }), 2);
  assert.equal((await db.tradeDeckBundle.findUniqueOrThrow({ where: { id: bundle.id } })).receiptJson &&
    ((await db.tradeDeckBundle.findUniqueOrThrow({ where: { id: bundle.id } })).receiptJson as Prisma.JsonObject).ownerUserId, users[1], "client-supplied recipient identity is ignored");
  console.log("PASS committed whole-deck gift: durable first/second confirmations, stale consent rollback, one winning concurrent completion, same deck/list/location/positive-zero rows and provenance, missing copies unfilled, sender organization detached, receiver choices and repeat-safe audits");
}
run().catch(error => { failure = error; }).finally(async () => {
  const failures: unknown[] = failure ? [failure] : [];
  try {
    await db.notification.deleteMany({ where: { recipientUserId: { in: users } } });
    await db.tradeEvent.deleteMany({ where: { tradeId: { in: trades } } });
    await db.trade.deleteMany({ where: { id: { in: trades } } });
    await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: { in: users } } });
    await db.inventoryItem.deleteMany({ where: { currentOwnerId: { in: owners } } });
    await db.tradeWishlistItem.deleteMany({ where: { ownerUserId: { in: users } } });
    await db.deck.deleteMany({ where: { id: { in: fixtureDeckIds } } });
    await db.commanderLeague.deleteMany({ where: { id: tag + "-league" } });
    await db.inventoryLocation.deleteMany({ where: { ownerPlayerId: { in: owners } } });
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
    assert.equal(await db.notification.count({ where: { recipientUserId: { in: users } } }), 0);
    assert.equal(await db.tradeEvent.count({ where: { tradeId: { in: trades } } }), 0);
    assert.equal(await db.tradeWishlistItem.count({ where: { ownerUserId: { in: users } } }), 0);
    assert.equal(await db.deck.count({ where: { id: { in: fixtureDeckIds } } }), 0);
    assert.equal(await db.card.count({ where: { id: { in: cards } } }), 0);
    assert.equal(await db.player.count({ where: { id: { in: owners } } }), 0);
    assert.equal(await db.deckFolder.count({ where: { ownerUserId: { in: users } } }), 0);
    assert.equal(await db.deckTag.count({ where: { ownerUserId: { in: users } } }), 0);
    assert.equal(await db.inventoryAuditLog.count({ where: { changedByUserId: { in: users } } }), 0);
    console.log("PASS deck bundle fixture: exact owned rows removed; no user/deck/location/trade/bundle/line/card residue");
  } catch (error) { failures.push(error); }
  await db.$disconnect();
  if (failures.length) { console.error(failures.length === 1 ? failures[0] : new AggregateError(failures, "Deck bundle test and cleanup failed")); process.exitCode = 1; }
});
