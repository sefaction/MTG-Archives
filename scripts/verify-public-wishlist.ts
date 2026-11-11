import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { getPublicWishlist } from "../lib/public-wishlist";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
    !/^[a-f0-9-]{36}$/.test(process.env.MTG_ISOLATED_QUALIFICATION_RUN || "") ||
    !url.pathname.startsWith("/public_wishlist_") ||
    !["127.0.0.1", "localhost", "public-wishlist-db"].includes(url.hostname)) {
  throw new Error("Explicit disposable public_wishlist_* qualification target required.");
}
const db = new PrismaClient();
const prefix = "public-wishlist-fixture-";
const owner = prefix + "owner", peer = prefix + "peer";
const baselinePath = "/tmp/public-wishlist-baseline.json";
const cardId = (name: string) => prefix + name;

async function preserved() {
  const models = ["inventoryItem", "inventoryLocation", "deck", "deckCard", "wishlistItem", "tradeWishlistItem",
    "collectorWishlistItem", "trade", "tradeLine", "player", "commanderLeague", "commanderLeagueDeck"] as const;
  const result: Record<string, string> = {};
  for (const model of models) {
    const rows = await (db[model].findMany as (args: object) => Promise<unknown[]>)({ orderBy: { id: "asc" } });
    result[model] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  return result;
}

async function seed() {
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.card.count(), 0);
  const passwordHash = await bcrypt.hash("public-wishlist-fixture-only", 4);
  for (const [id, username] of [[owner, "public-wishlist-owner"], [peer, "public-wishlist-peer"]]) {
    await db.player.create({ data: { id, name: id, displayName: "PRIVATE-PARTNER-IDENTITY" } });
    await db.user.create({ data: { id, username, displayName: "PRIVATE-DISPLAY-NAME", passwordHash, playerId: id } });
  }
  for (const [suffix, username] of [["dot", "."], ["slash", "A/B #1"], ["tilde", "~public"], ["percent", "%2F"]]) {
    await db.user.create({ data: { id: prefix + suffix, username, displayName: "Special username", passwordHash } });
  }
  await db.user.create({ data: { id: prefix + "inactive", username: "public-wishlist-inactive", displayName: "Inactive", passwordHash, isActive: false } });
  for (const [suffix, name, typeLine] of [
    ["manual", "Manual public card", "Instant"], ["deck", "Deck public card", "Creature"],
    ["member", "Member public card", "Artifact"], ["foreign", "FOREIGN-PRIVATE-CARD", "Sorcery"],
    ["league", "LEAGUE-PRIVATE-CARD", "Creature"], ["basic", "Plains", "Basic Land — Plains"],
  ]) await db.card.create({ data: { id: cardId(suffix), scryfallId: cardId(suffix), oracleId: cardId(suffix), name,
    typeLine, setCode: "tst", collectorNumber: suffix, rarity: "common" } });
  await db.wishlistItem.createMany({ data: [
    { id: prefix + "manual-wish", ownerUserId: owner, cardId: cardId("manual"), quantity: 3, desiredFinish: "FOIL", notes: "PRIVATE-WISH-NOTE", desiredCondition: "PRIVATE-CONDITION", desiredLanguage: "PRIVATE-LANGUAGE" },
    { id: prefix + "foreign-wish", ownerUserId: peer, cardId: cardId("foreign"), quantity: 99, notes: "FOREIGN-NOTE" },
  ] });
  for (const suffix of ["deck", "league"]) await db.deck.create({ data: {
    id: prefix + suffix, ownerUserId: owner, name: "PRIVATE-DECK-NAME-" + suffix,
    cards: { create: [{ cardId: cardId(suffix), oracleId: cardId(suffix), cardName: suffix, quantity: 3, notes: "PRIVATE-DECK-NOTE" },
      { cardId: cardId("basic"), cardName: "Plains", quantity: 20 }] },
  } });
  await db.inventoryLocation.create({ data: { id: prefix + "deck-location", ownerPlayerId: owner,
    name: "PRIVATE-STORAGE-DETAILS", normalizedName: "private-storage-details", kind: "DECK", deckId: prefix + "deck" } });
  await db.inventoryItem.create({ data: { id: prefix + "stock", currentOwnerId: owner, cardId: cardId("deck"), quantity: 1,
    condition: "NM", locationId: prefix + "deck-location" } });
  await db.tradeWishlistItem.create({ data: { id: prefix + "member-wish", ownerUserId: owner, cardId: cardId("member"),
    targetOwnerPlayerId: peer, quantity: 2, notes: "PRIVATE-MEMBER-NOTE" } });
  await db.tradeWishlistItem.create({ data: { id: prefix + "fulfilled", ownerUserId: owner, cardId: cardId("foreign"),
    targetOwnerPlayerId: peer, quantity: 99, status: "FULFILLED" } });
  await db.collectorWishlistItem.create({ data: { id: prefix + "set-wish", ownerUserId: owner, setCode: "tst",
    mode: "variants", targetKey: "set-target", cardName: "Set public card", collectorNumber: "4", preferredFinish: "NONFOIL",
    allowOtherSets: true, allowOtherFinishes: true } });
  await db.commanderLeague.create({ data: { id: prefix + "league-root", name: "PRIVATE-LEAGUE", slug: prefix + "league", year: 2026,
    status: "ARCHIVED", createdByUserId: owner, members: { create: { id: prefix + "league-member", userId: owner } },
    rounds: { create: { id: prefix + "round", monthNumber: 1, name: "Round", startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01") } } } });
  await db.commanderLeagueDeck.create({ data: { id: prefix + "league-link", leagueId: prefix + "league-root",
    memberId: prefix + "league-member", roundId: prefix + "round", archiveDeckId: prefix + "league", name: "PRIVATE-LEAGUE-DECK" } });
  assert.deepEqual((await getPublicWishlist(db, "public-wishlist-owner"))!.wishes, []);
  assert.deepEqual((await db.user.findUniqueOrThrow({ where: { id: prefix + "dot" } })).publicWishlistCategories, []);
  await db.user.update({ where: { id: prefix + "dot" }, data: { publicWishlistCategories: ["manual"] } });
  await db.user.update({ where: { id: owner }, data: { publicWishlistCategories: ["manual", "decks", "members", "sets"] } });
  const view = (await getPublicWishlist(db, "public-wishlist-owner"))!;
  assert.deepEqual(Object.fromEntries(view.wishes.map(wish => [wish.category, wish.quantity])), { decks: 2, manual: 3, members: 2, sets: 1 });
  assert.equal(/PRIVATE|FOREIGN|Plains/.test(JSON.stringify(view)), false);
  await db.user.update({ where: { id: owner }, data: { publicWishlistCategories: [] } });
  await writeFile(baselinePath, JSON.stringify(await preserved()));
  console.log("PASS real PostgreSQL category quantities, private-field projection, League/basic exclusions and none-shared defaults; browser fixture ready.");
}

async function verify() {
  assert.deepEqual(await preserved(), JSON.parse(await readFile(baselinePath, "utf8")));
  assert.deepEqual((await db.user.findUniqueOrThrow({ where: { id: peer } })).publicWishlistCategories, []);
  console.log("PASS all 12 business-model fingerprints and peer sharing settings unchanged after browser/settings workflows.");
}

async function cleanup() {
  await verify();
  await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: { startsWith: prefix } } });
  await db.inventoryItem.deleteMany({ where: { id: prefix + "stock", currentOwnerId: owner } });
  await db.commanderLeagueDeck.deleteMany({ where: { id: prefix + "league-link" } });
  await db.commanderLeague.deleteMany({ where: { id: prefix + "league-root", createdByUserId: owner } });
  await db.deck.deleteMany({ where: { id: { in: [prefix + "deck", prefix + "league"] }, ownerUserId: owner } });
  await db.inventoryLocation.deleteMany({ where: { id: prefix + "deck-location", ownerPlayerId: owner } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.player.deleteMany({ where: { id: { in: [owner, peer] } } });
  await db.card.deleteMany({ where: { id: { startsWith: prefix } } });
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.card.count(), 0);
  console.log("PASS owned fixture rows retired; compare full public-table dump against prefixture baseline.");
}

async function main() {
 const phase = process.argv[2];
 try {
  if (phase === "seed") await seed();
  else if (phase === "verify") await verify();
  else if (phase === "cleanup") await cleanup();
  else throw new Error("Expected seed, verify or cleanup phase.");
 } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
