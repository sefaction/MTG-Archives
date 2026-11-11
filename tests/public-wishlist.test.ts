import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getPublicWishlist, normalizePublicWishlistCategories } from "../lib/public-wishlist";
import { publicInventoryUsername, publicWishlistLink } from "../lib/public-inventory-link";

const card = { id: "card-1", name: "Wish card", oracleId: "oracle-1", setCode: "tst", collectorNumber: "7", typeLine: "Creature" };

function database(categories: string[], missing = false) {
  const calls: Array<{ model: string; query: any }> = [];
  const rows = {
    user: missing ? null : { id: "owner", username: "brian", playerId: "owner-player", publicWishlistCategories: categories },
    wishlistItem: [{ quantity: 3, desiredFinish: "FOIL", card, notes: "PRIVATE-NOTE" }],
    deck: [{ id: "private-deck", name: "PRIVATE-DECK", cards: [
      { cardId: card.id, oracleId: card.oracleId, cardName: card.name, quantity: 4, card },
      { cardId: "basic", oracleId: "basic", cardName: "Plains", quantity: 9, card: { ...card, name: "Plains", typeLine: "Basic Land — Plains" } },
    ] }],
    inventoryItem: [{ quantity: 1, card, location: { deckId: "private-deck", name: "PRIVATE-STORAGE" } }],
    tradeWishlistItem: [{ quantity: 2, card, targetOwnerPlayer: { displayName: "PRIVATE-PARTNER" } }],
    collectorWishlistItem: [{ cardName: card.name, setCode: "tst", collectorNumber: "7", preferredFinish: "NONFOIL", allowOtherSets: true, allowOtherFinishes: true }],
  };
  const tx = Object.fromEntries(Object.entries(rows).map(([model, data]) => [model, {
    [model === "user" ? "findUnique" : "findMany"]: async (query: any) => {
      calls.push({ model, query });
      return data;
    },
  }]));
  return { calls, db: { $transaction: (fn: any) => fn(tx) } as unknown as PrismaClient };
}

test("none-shared and unknown accounts never query private sources", async () => {
  for (const missing of [false, true]) {
    const { db, calls } = database([], missing);
    const view = await getPublicWishlist(db, "brian");
    assert.deepEqual(view, missing ? null : { username: "brian", categories: [], wishes: [] });
    assert.deepEqual(calls.map(call => call.model), ["user"]);
    assert.deepEqual(calls[0].query.where, { username: "brian", isActive: true });
  }
});

test("categories fail closed, deduplicate and cannot be enabled by arbitrary input", () => {
  assert.deepEqual(normalizePublicWishlistCategories(["all", "manual", "manual", "DECKS", null]), ["manual"]);
});

test("public projection keeps each reason's quantity and strips every private source field", async () => {
  const { db, calls } = database(["manual", "decks", "members", "sets"]);
  const view = (await getPublicWishlist(db, "brian"))!;
  assert.deepEqual(Object.fromEntries(view.wishes.map(wish => [wish.category, wish.quantity])), { manual: 3, decks: 3, members: 2, sets: 1 });
  for (const wish of view.wishes) assert.deepEqual(Object.keys(wish).sort(), ["category", "finish", "name", "printing", "quantity"]);
  assert.equal(JSON.stringify(view).includes("PRIVATE-"), false);
  assert.equal(JSON.stringify(view).includes("private-deck"), false);
  assert.match(view.wishes.find(wish => wish.category === "sets")!.finish, /other finishes accepted/);
  for (const call of calls) {
    if (call.query.where.ownerUserId) assert.equal(call.query.where.ownerUserId, "owner");
    const selection = JSON.stringify(call.query.select);
    for (const field of ["notes", "targetOwnerPlayer", "targetInventoryItem", "displayName", "passwordHash", "email"])
      assert.equal(selection.includes(`"${field}"`), false, `${call.model} selected ${field}`);
  }
  assert.deepEqual(calls.find(call => call.model === "deck")!.query.where, { ownerUserId: "owner", commanderLeagueDeck: null });
  assert.equal(calls.find(call => call.model === "inventoryItem")!.query.where.currentOwnerId, "owner-player");
  assert.equal(calls.find(call => call.model === "tradeWishlistItem")!.query.where.status, "OPEN");
});

test("a disabled category is not queried even when other categories are shared", async () => {
  const { db, calls } = database(["members"]);
  const view = (await getPublicWishlist(db, "brian"))!;
  assert.deepEqual(calls.map(call => call.model), ["user", "tradeWishlistItem"]);
  assert.deepEqual(view.wishes.map(wish => wish.category), ["members"]);
});

test("public Wishlist links round trip special usernames without changing inventory URLs", () => {
  for (const username of ["brian", ".", "..", "~brian", "A/B #1", "Éowyn", "%2F"]) {
    const url = new URL(publicWishlistLink(username), "https://example.test");
    assert.equal(publicInventoryUsername(decodeURIComponent(url.pathname.split("/").at(-1)!)), username);
    assert.ok(url.pathname.startsWith("/public/wishlist/"));
  }
});
