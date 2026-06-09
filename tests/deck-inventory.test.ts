import assert from "node:assert/strict";
import test from "node:test";
import {
  deckLocationNormalizedName,
  isNormalInventoryLocation,
  isSystemDeckLocation,
} from "../lib/deck-inventory";

test("deck locations are recognized as system-managed and not normal destinations", () => {
  assert.equal(
    isSystemDeckLocation({ type: "Deck", normalizedName: "deck-abc" }),
    true,
  );
  assert.equal(
    isSystemDeckLocation({ type: "Box", normalizedName: "deck-abc" }),
    true,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Deck",
      normalizedName: "deck-abc",
      active: true,
    }),
    false,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Box",
      normalizedName: "box-0001",
      active: true,
    }),
    true,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Binder",
      normalizedName: "binder-1",
      active: false,
    }),
    false,
  );
});

test("deck location normalized names are deterministic per deck", () => {
  assert.equal(deckLocationNormalizedName("deck-123"), "deck-deck-123");
  assert.notEqual(
    deckLocationNormalizedName("deck-123"),
    deckLocationNormalizedName("deck-456"),
  );
});
