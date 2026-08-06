import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicTradeWishlistTargets,
  type PublicTradeWishlistSource,
} from "../lib/public-trade-wishlist-targets";

function source(
  overrides: Partial<PublicTradeWishlistSource>,
): PublicTradeWishlistSource {
  return {
    ownerPlayerId: "owner-1",
    ownerName: "Alice",
    ownerColor: "#112233",
    inventoryItemId: "item-1",
    cardId: "card-1",
    setCode: "6ed",
    collectorNumber: "161",
    foilStatus: "NONFOIL",
    condition: "NM",
    language: "en",
    quantity: 1,
    ...overrides,
  };
}

test("keeps separate wishlist targets for separate owners", () => {
  const targets = buildPublicTradeWishlistTargets([
    source({}),
    source({
      ownerPlayerId: "owner-2",
      ownerName: "Bob",
      inventoryItemId: "item-2",
    }),
  ]);

  assert.deepEqual(
    targets.map((target) => target.ownerName),
    ["Alice", "Bob"],
  );
});

test("combines an owner's matching exact stacks and keeps a representative item", () => {
  const targets = buildPublicTradeWishlistTargets([
    source({ quantity: 2 }),
    source({ inventoryItemId: "item-2", quantity: 3 }),
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].inventoryItemId, "item-1");
  assert.equal(targets[0].availableQuantity, 5);
});

test("keeps separate targets for different printings or treatments", () => {
  const targets = buildPublicTradeWishlistTargets([
    source({}),
    source({
      inventoryItemId: "item-2",
      cardId: "card-2",
      setCode: "tmp",
      collectorNumber: "100",
    }),
    source({ inventoryItemId: "item-3", foilStatus: "FOIL" }),
  ]);

  assert.equal(targets.length, 3);
});

test("does not offer the viewer's own inventory as a wishlist target", () => {
  const targets = buildPublicTradeWishlistTargets(
    [
      source({ ownerPlayerId: "viewer" }),
      source({
        ownerPlayerId: "owner-2",
        ownerName: "Bob",
        inventoryItemId: "item-2",
      }),
    ],
    "viewer",
  );

  assert.deepEqual(
    targets.map((target) => target.ownerName),
    ["Bob"],
  );
});

test("annotates every matching printing with the viewer's existing owner-specific request", () => {
  const targets = buildPublicTradeWishlistTargets(
    [
      source({}),
      source({
        inventoryItemId: "item-2",
        foilStatus: "FOIL",
      }),
      source({
        ownerPlayerId: "owner-2",
        ownerName: "Bob",
        inventoryItemId: "item-3",
      }),
    ],
    "viewer",
    [
      {
        id: "wishlist-1",
        targetOwnerPlayerId: "owner-1",
        cardId: "card-1",
        quantity: 4,
      },
    ],
  );

  assert.equal(targets[0].wishlistItemId, "wishlist-1");
  assert.equal(targets[0].wishlistedQuantity, 4);
  assert.equal(targets[1].wishlistItemId, "wishlist-1");
  assert.equal(targets[1].wishlistedQuantity, 4);
  assert.equal(targets[2].wishlistedQuantity, undefined);
});
