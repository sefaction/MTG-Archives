import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { getPublicWishlistBrowse } from "../lib/public-wishlist-browser";

export async function seedPublicWishlistBrowser(db: PrismaClient, tag: string, count = 27) {
  const password = randomUUID(), passwordHash = await bcrypt.hash(password, 4);
  for (const role of ["owner", "peer", "admin"]) {
    const id = `${tag}-${role}`;
    await db.player.create({ data: { id, name: id, displayName: `PRIVATE-PROFILE-${id}` } });
    await db.user.create({ data: { id, username: id, displayName: "PRIVATE-DISPLAY", playerId: id, passwordHash,
      role: role === "admin" ? "ADMIN" : "PLAYER", preferredPriceProvider: "tcgplayer", publicWishlistCategories: role === "owner" ? ["manual"] : [] } });
  }
  const owner = `${tag}-owner`, peer = `${tag}-peer`, admin = `${tag}-admin`;
  const image = (name: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="252" height="352"><rect width="252" height="352" rx="12" fill="#246b75"/><rect x="12" y="12" width="228" height="328" rx="8" fill="#142b3c"/><text x="24" y="58" font-size="16" fill="white">${name}</text><path d="M24 220 L100 90 L150 160 L200 95 L228 220" fill="#55b8ae"/></svg>`).toString("base64")}`;
  const cards = [];
  for (let i = 0; i < count; i++) cards.push(await db.card.create({ data: {
    id: `${tag}-card-${i}`, scryfallId: randomUUID(), name: `Wanted Card ${String(i).padStart(2, "0")}`, setCode: "tst", setName: "Test set", collectorNumber: String(i),
    typeLine: "Artifact", rarity: i % 2 ? "rare" : "common", manaCost: "{1}", manaValue: i, colorIdentity: ["U"], digital: false, lang: "en",
    imageUri: i === 3 ? null : image(`Card ${i}`), oracleText: "Public catalog rules.", releasedAt: new Date(Date.UTC(2000 + i, 0, 1)),
    ...(i === 0 ? { layout: "transform", cardFaces: [{ name: "Front", image_uris: { normal: image("Front") } }, { name: "Back", image_uris: { normal: image("Back") } }] } : {}),
    prices: i === 4 ? {} : { usd: String(i), usd_foil: String((30 - i) * 2), mtgjson: { tcgplayer: {
      normal: { retail: { USD: { amount: i * 3, observedDate: "2026-11-25" } } }, foil: { retail: { USD: { amount: (30 - i) * 6, observedDate: "2026-11-25" } } },
    } } },
  } }));
  await db.wishlistItem.createMany({ data: cards.map((card, i) => ({ ownerUserId: owner, cardId: card.id, quantity: i + 1,
    desiredFinish: i % 3 === 0 ? "NONFOIL" : i % 3 === 1 ? "FOIL" : null, notes: "PRIVATE-WISH-NOTE", desiredCondition: "PRIVATE-CONDITION", desiredLanguage: "PRIVATE-LANGUAGE" })) });
  const hidden = await db.card.create({ data: { scryfallId: randomUUID(), name: "FOREIGN-PRIVATE-WISH", setCode: "prv", collectorNumber: "1", typeLine: "Creature", rarity: "common" } });
  await db.wishlistItem.create({ data: { ownerUserId: peer, cardId: hidden.id, quantity: 999, notes: "PRIVATE-PEER-NOTE" } });
  const deck = await db.deck.create({ data: { ownerUserId: owner, name: "PRIVATE-DECK", cards: { create: { cardId: cards[0].id, cardName: cards[0].name, quantity: 3 } } } });
  const location = await db.inventoryLocation.create({ data: { ownerPlayerId: owner, name: "PRIVATE-STORAGE", normalizedName: "private-storage", kind: "DECK", deckId: deck.id } });
  await db.inventoryItem.createMany({ data: [
    { currentOwnerId: owner, cardId: cards[0].id, quantity: 1, condition: "NM", locationId: location.id },
    { currentOwnerId: owner, cardId: cards[1].id, quantity: 2, condition: "NM" },
    { currentOwnerId: owner, cardId: cards[1].id, quantity: 3, condition: "NM", foilStatus: "FOIL" },
  ] });
  await db.tradeWishlistItem.create({ data: { ownerUserId: owner, cardId: cards[1].id, targetOwnerPlayerId: peer, quantity: 2, notes: "PRIVATE-PARTNER-NOTE" } });
  await db.tradeWishlistItem.create({ data: { ownerUserId: owner, cardId: hidden.id, targetOwnerPlayerId: peer, quantity: 99, status: "FULFILLED" } });
  await db.collectorWishlistItem.createMany({ data: [
    { ownerUserId: owner, cardName: cards[2].name, setCode: "tst", mode: "variants", targetKey: "real", collectorNumber: cards[2].collectorNumber, preferredFinish: "NONFOIL", allowOtherSets: true, allowOtherFinishes: true },
    { ownerUserId: owner, cardName: "Missing catalog wish", setCode: "xyz", mode: "grouped", targetKey: "missing", preferredFinish: "NONFOIL" },
  ] });
  return { owner, peer, admin, password, cards, deck, location };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.MTG_PUBLIC_WISHLIST_BROWSE_TEST, "1");assert.equal(url.hostname, "public-wishlist-db");assert.ok(url.pathname.startsWith("/public_wishlist_browser_"));
  const db = new PrismaClient();
  try {
    const f = await seedPublicWishlistBrowser(db, `wish-${randomUUID().slice(0, 8)}`);
    const fingerprint = async () => {
      const data: Record<string, unknown> = {};
      for (const model of ["inventoryItem", "wishlistItem", "collectorWishlistItem", "tradeWishlistItem", "deck", "deckCard", "inventoryLocation", "card"] as const)
        data[model] = await (db[model].findMany as (args: object) => Promise<unknown[]>)({ orderBy: { id: "asc" } });
      return createHash("sha256").update(JSON.stringify(data)).digest("hex");
    };
    const before = await fingerprint();
    const all = (await getPublicWishlistBrowse(db, f.owner, { sort: "quantity", sortDir: "desc", pageSize: "250" }))!;
    assert.equal(all.rows.length, 27);assert.equal(all.rows[0].quantity, 27);assert.equal(/PRIVATE-|FOREIGN-/.test(JSON.stringify(all)), false);
    const pages = [];
    for (let page = 1; page <= 3; page++) pages.push(...(await getPublicWishlistBrowse(db, f.owner, { sort: "quantity", sortDir: "desc", pageSize: "10", page: String(page) }))!.rows);
    assert.deepEqual(pages.map(row => row.id), all.rows.map(row => row.id));
    assert.equal((await getPublicWishlistBrowse(db, f.owner, { category: "members", owner: f.peer }))!.rows.length, 0);
    assert.equal((await getPublicWishlistBrowse(db, f.peer, { owner: f.owner, categories: "all" }))!.rows.length, 0);
    await db.user.update({ where: { id: f.owner }, data: { publicWishlistCategories: ["manual", "decks", "members", "sets"] } });
    const shared = (await getPublicWishlistBrowse(db, f.owner, { pageSize: "250" }))!;
    assert.equal(shared.rows.find(row => row.wishlist?.category === "decks")!.quantity, 2);
    assert.equal(shared.rows.filter(row => row.wishlist?.category === "sets").length, 2);
    assert.equal(shared.rows.find(row => row.cardName === "Missing catalog wish")!.cardId, "");
    assert.equal(shared.rows.find(row => row.wishlist?.category === "sets" && row.cardName === f.cards[2].name)!.imageUri, f.cards[2].imageUri);
    await db.user.update({ where: { id: f.owner }, data: { publicInventoryHidePricing: true } });
    const hidden = (await getPublicWishlistBrowse(db, f.owner, { sort: "preferredPriceLabel", sortDir: "desc" }))!;
    assert.equal(hidden.params.sort, "cardName");assert.equal(hidden.showPricing, false);assert.ok(hidden.rows.every(row => !JSON.stringify(row).includes("preferredPriceLabel")));
    await db.user.update({ where: { id: f.owner }, data: { publicWishlistCategories: [], publicInventoryHidePricing: false } });
    assert.equal((await getPublicWishlistBrowse(db, f.owner, { categories: "all", owner: f.peer }))!.rows.length, 0);
    assert.equal(await fingerprint(), before);
    const scale = await db.user.create({ data: { username: `scale-${randomUUID()}`, displayName: "Scale fixture", passwordHash: "fixture-only", publicWishlistCategories: ["manual"] } });
    for (let offset = 0; offset < 25000; offset += 500) {
      const cards = Array.from({ length: 500 }, (_, i) => ({ id: `${scale.id}-${offset + i}`, scryfallId: randomUUID(), name: `Scale ${offset + i}`, setCode: "scl", collectorNumber: String(offset + i), typeLine: "Artifact", rarity: "common" }));
      await db.card.createMany({ data: cards });await db.wishlistItem.createMany({ data: cards.map(card => ({ ownerUserId: scale.id, cardId: card.id, quantity: 6 })) });
    }
    const started = performance.now(), result = (await getPublicWishlistBrowse(db, scale.username, { pageSize: "100" }))!;
    assert.equal(result.totalMatchingCount, 25000);assert.equal(result.totalMatchingCards, 150000);assert.equal(result.rows.length, 100);
    console.log(JSON.stringify({ scale: { wishes: 25000, requestedCopies: 150000, pageSize: 100, elapsedMs: Math.round(performance.now() - started) } }));
    console.log("PASS public Wishlist browser: scoped categories, global numeric paging, catalog fallback/placeholder, hidden pricing, revocation and exact read-only conservation.");
  } finally { await db.$disconnect(); }
}
if (process.argv.includes("--run")) main().catch(error => { console.error(error); process.exitCode = 1; });
