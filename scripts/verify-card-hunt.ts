import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { buildCardHunt } from "../lib/card-hunt-service";

export async function seedCardHuntFixture(db: Prisma.TransactionClient, tag: string) {
  const owner = await db.player.create({data: {name: tag, displayName: tag}});
  const peer = await db.player.create({data: {name: `${tag}-peer`, displayName: `${tag}-peer`}});
  const user = await db.user.create({data: {username: tag, displayName: "Card Hunt reviewer", passwordHash: "synthetic-not-a-login", playerId: owner.id}});
  const peerUser = await db.user.create({data: {username: `${tag}-peer`, displayName: "Other owner", passwordHash: "synthetic-not-a-login", playerId: peer.id}});
  const cards = [];
  for (const [index, name] of ["Alpha", "Beta", "Gamma", "Missing"].entries()) {
    cards.push(await db.card.create({data: {scryfallId: randomUUID(), oracleId: `${tag}-${index}`, name: `${name} ${tag}`,
      setCode: "tst", collectorNumber: String(index + 1), typeLine: "Artifact", rarity: "common"}}));
  }
  const alternate = await db.card.create({data: {scryfallId: randomUUID(), oracleId: cards[0].oracleId, name: cards[0].name,
    setCode: "alt", collectorNumber: "99", typeLine: "Artifact", rarity: "common"}});
  const deck = await db.deck.create({data: {ownerUserId: user.id, name: "Three cards to hunt", visibility: "PRIVATE"}});
  const peerDeck = await db.deck.create({data: {ownerUserId: peerUser.id, name: "Private peer deck", visibility: "PRIVATE"}});
  const otherDeck = await db.deck.create({data: {ownerUserId: user.id, name: "Other committed deck"}});
  await db.deckCard.createMany({data: cards.slice(0, 3).map((card, i) => ({deckId: deck.id, cardId: card.id,
    oracleId: card.oracleId, cardName: card.name, quantity: i === 0 ? 2 : 1, section: "MAINBOARD"}))});
  await db.deckCard.create({data: {deckId: deck.id, cardId: cards[3].id, cardName: cards[3].name, quantity: 1, section: "MAYBEBOARD"}});
  const locations = [];
  for (const [index, name] of ["Shared box", "Foil box A", "Foil box B", "Already in deck", "Other deck", "Inactive box"].entries()) {
    locations.push(await db.inventoryLocation.create({data: {ownerPlayerId: owner.id, name, normalizedName: `${tag}-${index}`,
      active: index !== 5, ...(index === 3 || index === 4 ? {kind: "DECK", systemManaged: true, deckId: index === 3 ? deck.id : otherDeck.id} : {})}}));
  }
  const makeItem = (cardIndex: number, locationIndex: number, quantity: number, finish: "FOIL" | "NONFOIL" = "NONFOIL", cardId = cards[cardIndex].id) =>
    db.inventoryItem.create({data: {currentOwnerId: owner.id, cardId, quantity, locationId: locations[locationIndex].id,
      locationSection: String(cardIndex + 1), foilStatus: finish, foil: finish === "FOIL", condition: "NM", language: "EN"}});
  const shared = await makeItem(0, 0, 3);
  await makeItem(1, 0, 1); await makeItem(2, 0, 1, "FOIL");
  await makeItem(0, 1, 1, "FOIL"); await makeItem(1, 2, 1, "FOIL");
  await makeItem(0, 3, 1); await makeItem(0, 4, 20, "FOIL", alternate.id);
  await makeItem(3, 5, 100);
  await db.inventoryItem.create({data: {currentOwnerId: peer.id, cardId: alternate.id, quantity: 100,
    condition: "NM", language: "EN", foilStatus: "FOIL"}});
  const trade = await db.trade.create({data: {proposerPlayerId: owner.id, receiverPlayerId: peer.id,
    createdByUserId: user.id, status: "PROPOSED"}});
  await db.tradeLine.create({data: {tradeId: trade.id, side: "PROPOSER", inventoryItemId: shared.id, quantity: 1,
    snapshotJson: {synthetic: true}}});
  await db.trade.create({data: {proposerPlayerId: owner.id, receiverPlayerId: peer.id, createdByUserId: user.id,
    status: "ACCEPTED_PENDING_EXCHANGE", offeredInventoryItemId: shared.id}});
  return {user, peerUser, deck, peerDeck, otherDeck, cards, alternate, locations, shared};
}

export async function cardHuntSnapshot(db: PrismaClient | Prisma.TransactionClient) {
  const tables = await db.$queryRaw<{tablename: string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, unknown> = {};
  for (const {tablename} of tables) {
    assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
    result[tablename] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(j::text),'' ORDER BY md5(j::text)),'')) AS hash FROM (SELECT to_jsonb(x) AS j FROM "${tablename}" x) rows`);
  }
  return result;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    !["127.0.0.1", "localhost", "[::1]", "mtg-hunt-1008-db"].includes(url.hostname) ||
    !/^\/(?:card_hunt_1008|import_integrity)$/.test(url.pathname)) throw new Error("Use only the explicit disposable Card Hunt/CI database.");
  const db = new PrismaClient();
  const rollback = new Error("EXPECTED_FIXTURE_ROLLBACK");
  try {
    const before = await cardHuntSnapshot(db);
    await db.$transaction(async tx => {
      const f = await seedCardHuntFixture(tx, `hunt-${randomUUID()}`);
      const baseline = await cardHuntSnapshot(tx);
      const preferred = await buildCardHunt(tx, f.user, {deckId: f.deck.id, finish: "FOIL"});
      assert.equal(preferred.boxes.length, 3); assert.equal(preferred.planned, 3);
      assert.equal(preferred.alreadyInDeck, 1); assert.equal(preferred.shortage, 0);
      assert.ok(preferred.boxes.every(box => box.picks.every(pick => pick.finish === "FOIL")));
      const optimized = await buildCardHunt(tx, f.user, {deckId: f.deck.id, finish: "FOIL", mode: "boxes"});
      assert.equal(optimized.boxes.length, 1); assert.equal(optimized.boxes[0].name, "Shared box");
      assert.equal(optimized.boxes[0].picks.filter(pick => pick.finishCompromise).length, 2);
      const maybe = await buildCardHunt(tx, f.user, {deckId: f.deck.id, includeMaybeboard: true});
      assert.equal(maybe.shortage, 1); // Inactive storage is not a fallback.
      const pasted = await buildCardHunt(tx, f.user, {text: `5 ${f.cards[0].name} (TST) 1\n1 ${f.cards[3].name}`});
      assert.equal(pasted.planned, 2); assert.equal(pasted.shortage, 4); // Modern + legacy reservations excluded.
      assert.equal(pasted.lines[0].alternativeCount, 0); // Foreign and other-deck alternates excluded.
      const duplicates = await buildCardHunt(tx, f.user, {text: `2 ${f.cards[0].name}\n2 ${f.cards[0].name}`});
      assert.equal(duplicates.planned, 2); assert.equal(duplicates.shortage, 2);
      const peer = await buildCardHunt(tx, f.peerUser, {text: `1 ${f.cards[0].name}`, ownerId: f.user.playerId});
      assert.equal(peer.planned, 1); assert.equal(peer.boxes[0].name, "Unassigned location");
      await assert.rejects(buildCardHunt(tx, f.peerUser, {deckId: f.deck.id}), /Deck not found/);
      await assert.rejects(buildCardHunt(tx, f.user, {deckId: f.peerDeck.id}), /Deck not found/);
      await assert.rejects(buildCardHunt(tx, {...f.user, playerId: null}, {deckId: f.deck.id}), /Link your account/);
      await assert.rejects(buildCardHunt(tx, f.user, {text: ""}), /Choose a deck/);
      await assert.rejects(buildCardHunt(tx, f.user, {text: "1000001 Card"}), /whole quantities/);
      await assert.rejects(buildCardHunt(tx, f.user, {text: "1 Card\n".repeat(501)}), /500 card lines/);
      assert.deepEqual(await cardHuntSnapshot(tx), baseline, "All public tables remain unchanged by plans and refused requests");
      console.log(JSON.stringify({case: "card-hunt-postgres", tables: Object.keys(baseline).length,
        preferredBoxes: preferred.boxes.length, optimizedBoxes: optimized.boxes.length,
        modernAndLegacyReservations: "pass", ownerIsolation: "pass", duplicateDemand: "pass", readOnly: "pass"}));
      throw rollback;
    }, {timeout: 60_000}).catch(error => {if (error !== rollback) throw error;});
    assert.deepEqual(await cardHuntSnapshot(db), before, "Fixture rollback conserves every public table");
    console.log("Card Hunt actual PostgreSQL and complete rollback passed.");
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {console.error(error); process.exitCode = 1;});
