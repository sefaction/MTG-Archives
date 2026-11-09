import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getWishlistView } from "../lib/wishlist";
import { loadServerActions } from "../tests/helpers/server-actions";

// This fixture is intentionally disposable and must never target a snapshot or
// an installed application database. It remains populated for the browser check.
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (process.env.MTG_WISHLIST_LEAGUE_FIXTURE !== "1" ||
    url.pathname !== "/wishlist_league_1002" ||
    !["127.0.0.1", "localhost", "mtg-1002-db"].includes(url.hostname)) {
  throw new Error("Explicit isolated wishlist_league_1002 fixture target required.");
}
const db = new PrismaClient();
// Keep the real optimizer/local catalogue path, without asking a public service
// to resolve deliberately synthetic fixture cards.
globalThis.fetch = async () => new Response(JSON.stringify({ object: "error", status: 404,
  code: "not_found", details: "Synthetic fixture has no remote catalogue." }), { status: 404 });
const uid = "wish-user", pid = "wish-player";
let checks = 0;
function same(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function form(deckId: string, cardId = "shared-alt") {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ deckId, deckCardId: `${deckId}-shared`, cardId,
    inventoryItemId: "stock", quantity: "1" })) fd.set(key, value);
  return fd;
}
async function preserved() {
  return {
    league: await db.commanderLeague.findMany({ orderBy: { id: "asc" } }),
    links: await db.commanderLeagueDeck.findMany({ orderBy: { id: "asc" } }),
    submissions: await db.commanderLeagueDeckSubmission.findMany({ orderBy: { id: "asc" } }),
    leagueCards: await db.deckCard.findMany({ where: { deckId: { in: ["league", "frozen"] } }, orderBy: { id: "asc" } }),
    stock: await db.inventoryItem.findMany({ orderBy: { id: "asc" } }),
    wishes: await db.wishlistItem.findMany({ orderBy: { id: "asc" } }),
  };
}
async function main() {
  same(await db.user.count(), 0);
  same(await db.card.count(), 0);
  await db.player.create({ data: { id: pid, name: "wishlist1002", displayName: "Wishlist fixture" } });
  await db.user.create({ data: { id: uid, username: "wishlist1002", displayName: "Wishlist fixture",
    passwordHash: await bcrypt.hash("wishlist1002-test", 4), playerId: pid } });
  await db.user.create({ data: { id: "other-user", username: "other1002", displayName: "Other fixture", passwordHash: "unused" } });
  for (const [id, name, price, oracleId] of [
    ["shared", "Shared Wishlist Card", "5.00", "oracle-shared"],
    ["shared-alt", "Shared Wishlist Card", "1.00", "oracle-shared"],
    ["league-only", "League Only Card", "100.00", "oracle-league"],
    ["manual", "Manual Only Card", "2.00", "oracle-manual"],
  ]) await db.card.create({ data: { id, name, oracleId, scryfallId: `sf-${id}`, typeLine: "Artifact",
    setCode: "tst", collectorNumber: id, rarity: "common", prices: { usd: price },
    legalities: { commander: "legal" }, games: ["paper"], digital: false } });
  for (const id of ["normal", "league", "frozen", "foreign"]) {
    await db.deck.create({ data: { id, ownerUserId: id === "foreign" ? "other-user" : uid,
      name: `${id} Commander`, format: "COMMANDER", cards: { create: [
        { id: `${id}-shared`, cardId: "shared", cardName: "Shared Wishlist Card", oracleId: "oracle-shared", quantity: id === "normal" ? 3 : 9 },
        ...(id === "league" || id === "frozen" ? [{ id: `${id}-only`, cardId: "league-only", cardName: "League Only Card", oracleId: "oracle-league", quantity: 8 }] : []),
      ] } } });
  }
  await db.commanderLeague.create({ data: { id: "league-root", name: "Fixture League", slug: "fixture1002",
    year: 2026, createdByUserId: uid, members: { create: { id: "member", userId: uid } },
    rounds: { create: [1, 2].map(n => ({ id: `round-${n}`, monthNumber: n, name: `Round ${n}`,
      startDate: new Date("2026-01-01"), endDate: new Date("2026-02-28") })) } } });
  for (const [i, id] of ["league", "frozen"].entries()) await db.commanderLeagueDeck.create({ data: {
    id: `link-${id}`, leagueId: "league-root", memberId: "member", roundId: `round-${i + 1}`, archiveDeckId: id, name: id } });
  await db.commanderLeagueGame.create({ data: { id: "game", leagueId: "league-root", roundId: "round-2",
    createdByUserId: uid, playedAt: new Date("2026-02-01"), participants: { create: { id: "participant", memberId: "member",
      result: "WIN", pointsAwarded: 3, deckSubmission: { create: { sourceLeagueDeckId: "link-frozen", deckName: "frozen" } } } } } });
  await db.wishlistItem.createMany({ data: [{ id: "wish-shared", ownerUserId: uid, cardId: "shared", quantity: 2 },
    { id: "wish-manual", ownerUserId: uid, cardId: "manual", quantity: 1 }] });
  await db.inventoryItem.create({ data: { id: "stock", currentOwnerId: pid, cardId: "shared", quantity: 2, condition: "NM" } });
  await db.inventoryLocation.create({ data: { id: "league-location", ownerPlayerId: pid,
    name: "League physical storage", normalizedName: "league physical storage", kind: "DECK", deckId: "league" } });
  await db.inventoryItem.create({ data: { id: "league-stock", currentOwnerId: pid, cardId: "shared", quantity: 7,
    condition: "NM", locationId: "league-location" } });
  const baseline = await preserved();
  for (const status of ["ACTIVE", "COMPLETED", "ARCHIVED"] as const) {
    await db.commanderLeague.update({ where: { id: "league-root" }, data: { status } });
    const view = await getWishlistView(db, uid, pid);
    same(view.groups.map(g => g.card.name).sort(), ["Manual Only Card", "Shared Wishlist Card"]);
    same(view.summary, { manualRows: 2, deckRows: 1, needQuantity: 6, readyQuantity: 2, getQuantity: 4, estimatedGetCost: 17 });
    const shared = view.groups.find(g => g.card.id === "shared")!;
    same([shared.manualQuantity, shared.deckQuantity, shared.needQuantity, shared.readyQuantity, shared.getQuantity], [2, 3, 5, 2, 3]);
    same(shared.sources.decks.map(d => d.deckId), ["normal"]);
    same(shared.inventory.ownedTotal, 9);
    same(shared.inventory.committedToDecks, 7);
    same(shared.sources.decks[0].committedToOtherDecks, 7);
  }
  await db.commanderLeague.update({ where: { id: "league-root" }, data: { status: "ACTIVE" } });
  const noPlayer = await getWishlistView(db, uid, null);
  same(noPlayer.summary.needQuantity, 6);
  same(noPlayer.summary.readyQuantity, 0);
  same((await getWishlistView(db, "other-user", null)).groups[0].sources.decks[0].deckId, "foreign");
  await db.wishlistItem.create({ data: { id: "manual-league-card", ownerUserId: uid, cardId: "league-only", quantity: 2 } });
  const manualLeagueCard = (await getWishlistView(db, uid, pid)).groups.find(g => g.card.id === "league-only")!;
  same([manualLeagueCard.manualQuantity, manualLeagueCard.deckQuantity, manualLeagueCard.getQuantity, manualLeagueCard.estimatedGetCost], [2, 0, 2, 200]);
  same(manualLeagueCard.sources.decks, []);
  await db.wishlistItem.delete({ where: { id: "manual-league-card" } });
  // Updating the fixture's League status is deliberate; restore it before exact conservation.
  baseline.league = await db.commanderLeague.findMany({ orderBy: { id: "asc" } });
  let admin = false;
  const dependencies = { "@/lib/prisma": { prisma: db }, "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": { requireLogin: async () => db.user.findUniqueOrThrow({ where: { id: uid } }),
      getAccessScope: async () => ({ mode: admin ? "admin" : "user" }) } };
  const actions = loadServerActions("app/wishlist/actions.ts", dependencies);
  const commit = loadServerActions("app/decks/actions.ts", dependencies).commitDeckCardToDeck;
  for (const mode of [false, true]) {
    admin = mode;
    for (const id of ["league", "frozen"]) {
      for (const name of ["changeWishlistDeckCardPrinting", "switchWishlistDeckCardToOwnedPrinting", "switchWishlistDeckCardToCheapestPrinting"]) {
        await assert.rejects(actions[name](form(id)), /League decks are not part/); checks++;
      }
      await assert.rejects(commit(form(id)), /League deck/); checks++;
    }
  }
  same(await preserved(), baseline);
  admin = false;
  await assert.rejects(actions.changeWishlistDeckCardPrinting(form("foreign")), /own decks/); checks++;
  // Exercise each ordinary printing route against actual catalogue/stock queries.
  for (const name of ["changeWishlistDeckCardPrinting", "switchWishlistDeckCardToOwnedPrinting", "switchWishlistDeckCardToCheapestPrinting"]) {
    await actions[name](form("normal"));
    same((await db.deckCard.findUniqueOrThrow({ where: { id: "normal-shared" } })).cardId,
      name === "switchWishlistDeckCardToOwnedPrinting" ? "shared" : "shared-alt");
  }
  // Restore the row and commit one real physical copy with its real audit trail.
  await actions.changeWishlistDeckCardPrinting(form("normal", "shared"));
  const total = await db.inventoryItem.aggregate({ _sum: { quantity: true } });
  await commit(form("normal"));
  same((await db.inventoryItem.aggregate({ _sum: { quantity: true } }))._sum, total._sum);
  same(await db.inventoryAuditLog.count(), 1);
  same((await getWishlistView(db, uid, pid)).summary, { manualRows: 2, deckRows: 1,
    needQuantity: 5, readyQuantity: 1, getQuantity: 4, estimatedGetCost: 17 });
  const manualView = await getWishlistView(db, uid, pid, "manual");
  const deckView = await getWishlistView(db, uid, pid, "decks");
  same(manualView.groups.map(g => g.card.id).sort(), ["manual", "shared"]);
  same(manualView.summary, { manualRows: 2, deckRows: 0, needQuantity: 3,
    readyQuantity: 0, getQuantity: 3, estimatedGetCost: 12 });
  same(deckView.groups.map(g => g.card.id), ["shared"]);
  same(deckView.summary, { manualRows: 0, deckRows: 1, needQuantity: 2,
    readyQuantity: 1, getQuantity: 1, estimatedGetCost: 5 });
  same(deckView.groups[0].sources.decks.map(d => d.deckId), ["normal"]);
  // Manual changes remain available even for a printing also used by League decks.
  const manual = new FormData(); manual.set("wishlistItemId", "wish-shared");
  manual.set("quantity", "4");
  await actions.updateManualWishlistItem(manual);
  same((await db.wishlistItem.findUniqueOrThrow({ where: { id: "wish-shared" } })).quantity, 4);
  manual.set("quantity", "2"); await actions.updateManualWishlistItem(manual);
  const after = await preserved();
  same(after.leagueCards, baseline.leagueCards); same(after.links, baseline.links);
  same(after.submissions, baseline.submissions);
  same(after.wishes.map(({ updatedAt, ...row }) => row), baseline.wishes.map(({ updatedAt, ...row }) => row));
  await db.player.create({ data: { id: "trade-member", name: "trade-member", displayName: "Fixture trade partner" } });
  await db.player.create({ data: { id: "private-member", name: "private-member", displayName: "Private trade partner" } });
  await db.tradeWishlistItem.createMany({ data: [
    { ownerUserId: uid, cardId: "shared", targetOwnerPlayerId: "trade-member", quantity: 4 },
    { ownerUserId: uid, cardId: "league-only", targetOwnerPlayerId: "trade-member", status: "CANCELLED" },
    { ownerUserId: "other-user", cardId: "manual", targetOwnerPlayerId: "private-member", quantity: 7 },
  ] });
  console.log(`PASS ${checks} isolated PostgreSQL query/action/conservation checks; populated fixture retained for browser tests.`);
}
main().finally(() => db.$disconnect());
