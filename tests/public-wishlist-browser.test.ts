import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getPublicWishlistBrowse, publicWishlistBrowseParams } from "../lib/public-wishlist-browser";
import { publicWishlistPrice } from "../lib/public-wishlist-sort";
import { inventorySortHref } from "../components/inventorySortNavigation";
import { PUBLIC_WISHLIST_SORT_FIELDS } from "../lib/public-wishlist-sort";

function fixture({ count = 27, categories = ["manual"], hidePricing = false, missing = false }: { count?: number; categories?: string[]; hidePricing?: boolean; missing?: boolean } = {}) {
  const calls: any[] = [];
  const cards = Array.from({ length: count }, (_, i) => ({ id: `catalog-${i}`, name: `Card ${i}`, setCode: "tst", setName: "Test", collectorNumber: String(i),
    rarity: "common", typeLine: "Artifact", manaValue: i, manaCost: "{1}", colorIdentity: [], releasedAt: new Date("2020-01-01"),
    prices: { usd: String(i), usd_foil: String(count - i) }, imageUri: `/cards/${i}.jpg`, oracleText: "Public rules", notes: "PRIVATE-CARD-EXTRA" }));
  const owner = { id: "PRIVATE-OWNER-ID", username: "shared", playerId: "PRIVATE-PLAYER-ID", publicWishlistCategories: categories, publicInventoryHidePricing: hidePricing };
  const wishes = cards.map((card, i) => ({ quantity: i + 1, desiredFinish: i % 2 ? "FOIL" : null, card, notes: "PRIVATE-NOTE" }));
  const tx: any = {
    user: { findUnique: async (query: any) => { calls.push({ model: "user", query }); return missing ? null : owner; } },
    wishlistItem: { findMany: async (query: any) => { calls.push({ model: "wishes", query }); return wishes; } },
  };
  const db = { $transaction: async (fn: any) => fn(tx), card: { findMany: async (query: any) => {
    calls.push({ model: "catalog", query });return [...cards].reverse().filter(card => query.where.id?.in.includes(card.id));
  } } } as unknown as PrismaClient;
  return { db, calls, cards, wishes };
}

test("public wishlist parameters reject private scope and constrain paging/sort", () => {
  const params = publicWishlistBrowseParams({ owner: "other", category: "manual", sort: "locationSummary", pageSize: "100000", page: "-1", cardName: " abc " });
  assert.equal(params.sort, "cardName");assert.equal(params.pageSize, 25);assert.equal(params.page, 1);assert.equal(params.cardName, "abc");assert.equal("owner" in params, false);
  assert.equal(publicWishlistBrowseParams({ sort: "preferredPriceLabel" }, true).sort, "cardName");
});

test("any-finish quote is a starting price; known finish never borrows a different finish", () => {
  const any = publicWishlistPrice({ usd: "2", usd_foil: "0" }, null);assert.equal(any.quote?.amount, 0);assert.equal(any.from, true);
  assert.equal(publicWishlistPrice({ usd: "2" }, "FOIL").quote, null);
  assert.equal(publicWishlistPrice({ usd: "2", usd_foil: "9" }, "foil").quote?.amount, 9);
});

test("sorting is global, deterministic across pages and page hydration stays bounded", async () => {
  const { db, calls } = fixture();const all = (await getPublicWishlistBrowse(db, "shared", { sort: "quantity", sortDir: "desc", pageSize: "250" }))!;
  assert.deepEqual(all.rows.map(row => row.quantity), Array.from({ length: 27 }, (_, i) => 27 - i));
  const pages = [];
  for (let page = 1; page <= 3; page++) pages.push(...(await getPublicWishlistBrowse(db, "shared", { sort: "quantity", sortDir: "desc", pageSize: "10", page: String(page) }))!.rows);
  assert.deepEqual(pages.map(row => row.id), all.rows.map(row => row.id));assert.equal(new Set(pages.map(row => row.id)).size, 27);
  for (const call of calls.filter(call => call.model === "catalog" && call.query.select.oracleText)) assert.ok(call.query.where.id.in.length <= 27);
  assert.ok(calls.filter(call => call.model === "catalog" && !call.query.select.oracleText).every(call => !call.query.select.prices));
  assert.equal(/PRIVATE-/.test(JSON.stringify(all)), false);assert.equal(all.rows[0].wishlist?.categoryLabel, "Manual wishes");
});

test("price labels and sorting use the desired finish including real zero and unknown", async () => {
  const { db, cards } = fixture({ count: 3 });cards[1].prices = { usd: "100", usd_foil: "9" };cards[2].prices = { usd: "", usd_foil: "" };
  const view = (await getPublicWishlistBrowse(db, "shared", { sort: "preferredPriceLabel", sortDir: "desc" }))!;
  assert.deepEqual(view.rows.map(row => row.preferredPriceLabel), ["$9.00", "From $0.00", "--"]);
  assert.equal(view.rows[1].foilStatus, undefined);assert.equal(view.rows[1].wishlist?.finish, "Any finish");
});

test("categories cannot be widened and none-shared/missing views do not hydrate catalog", async () => {
  for (const missing of [false, true]) {
    const { db, calls } = fixture({ categories: [], missing });const view = await getPublicWishlistBrowse(db, "shared", { owner: "other", categories: "all", category: "manual" });
    assert.equal(view?.rows.length ?? 0, 0);assert.deepEqual(calls.map(call => call.model), ["user"]);
  }
  const { db, calls } = fixture();const view = (await getPublicWishlistBrowse(db, "shared", { category: "members", ownerId: "other" }))!;
  assert.equal(view.rows.length, 0);assert.equal(calls.some(call => call.model === "catalog"), false);
});

test("owner-hidden pricing is absent from catalog selection and every public row", async () => {
  const { db, calls } = fixture({ hidePricing: true });const view = (await getPublicWishlistBrowse(db, "shared", { sort: "preferredPriceLabel" }))!;
  assert.equal(view.showPricing, false);assert.equal(view.params.sort, "cardName");
  assert.ok(view.rows.every(row => !Object.keys(row).some(key => key.startsWith("price") || key === "preferredPriceLabel")));
  assert.ok(calls.filter(call => call.model === "catalog").every(call => !call.query.select.prices));
});

test("search, clamped pages and stable public preference IDs preserve wishes", async () => {
  const { db } = fixture();const view = (await getPublicWishlistBrowse(db, "shared", { cardName: "Card 26", page: "9999" }))!;
  assert.equal(view.rows.length, 1);assert.equal(view.rows[0].cardName, "Card 26");assert.equal(view.page, 1);
  assert.ok(view.rows[0].id.includes("manual"));assert.equal(view.rows[0].currentOwnerId, "public-wishlist");
});

test("wishlist-only sort navigation preserves its fixed username and resets page", () => {
  const url = inventorySortHref("/public/wishlist/brian", "category=manual&page=4&browse=infinite", "wishCategory", "asc", PUBLIC_WISHLIST_SORT_FIELDS);
  assert.equal(url, "/public/wishlist/brian?category=manual&browse=infinite&sort=wishCategory&sortDir=asc");
  assert.throws(() => inventorySortHref("/inventory", "", "wishCategory", "asc"));
});

test("Set Completion keeps missing artwork and matches catalog name as well as printing", async () => {
  const calls: any[] = [];
  const target = { cardName: "Legacy wish", setCode: "tst", collectorNumber: "1", preferredFinish: "NONFOIL", allowOtherSets: false, allowOtherFinishes: false };
  const candidates = [{ id: "wrong", name: "Different card", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: "wrong.jpg" }];
  const tx = { user: { findUnique: async () => ({ username: "shared", publicWishlistCategories: ["sets"] }) },
    collectorWishlistItem: { findMany: async () => [target, { ...target, cardName: "Entirely missing", collectorNumber: null }] } };
  const db = { $transaction: async (fn: any) => fn(tx), card: { findMany: async (query: any) => { calls.push(query);return candidates; } } } as unknown as PrismaClient;
  const view = (await getPublicWishlistBrowse(db, "shared", {}))!;
  assert.equal(view.rows.length, 2);assert.ok(view.rows.every(row => row.cardId === "" && !row.imageUri));
  assert.ok(calls[0].where.AND[0].OR.every((clause: any) => clause.name.equals));
  candidates.push({ id: "right", name: "Legacy wish", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: "right.jpg" });
  const resolved = (await getPublicWishlistBrowse(db, "shared", {}))!;
  assert.equal(resolved.rows.find(row => row.cardName === "Legacy wish")!.imageUri, "right.jpg");
});
