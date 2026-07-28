import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReservedInventoryQuantities,
  normalizeTradeLineSelections,
  parseTradeLineSelections,
} from "../lib/trade-lines";

test("trade line selections combine duplicate inventory stacks", () => {
  assert.deepEqual(
    normalizeTradeLineSelections([
      { inventoryItemId: "item-a", quantity: 1 },
      { inventoryItemId: "item-a", quantity: 2 },
      { inventoryItemId: "item-b", quantity: 1 },
    ]),
    [
      { inventoryItemId: "item-a", quantity: 3 },
      { inventoryItemId: "item-b", quantity: 1 },
    ],
  );
});

test("trade line parser supports JSON selections and legacy one-card fields", () => {
  assert.deepEqual(
    parseTradeLineSelections(
      JSON.stringify([{ inventoryItemId: "item-a", quantity: 2 }]),
    ),
    [{ inventoryItemId: "item-a", quantity: 2 }],
  );
  assert.deepEqual(parseTradeLineSelections(null, "legacy-item"), [
    { inventoryItemId: "legacy-item", quantity: 1 },
  ]);
});

test("trade line quantities must be positive whole numbers", () => {
  assert.throws(
    () =>
      normalizeTradeLineSelections([
        { inventoryItemId: "item-a", quantity: 0 },
      ]),
    /whole numbers/,
  );
});

test("reservations include multi-line quantities and unmigrated legacy trades", () => {
  const reserved = buildReservedInventoryQuantities(
    [
      { inventoryItemId: "item-a", quantity: 2 },
      { inventoryItemId: "item-a", quantity: 1 },
    ],
    [
      {
        offeredInventoryItemId: "item-b",
        requestedInventoryItemId: "item-a",
      },
    ],
  );

  assert.equal(reserved.get("item-a"), 4);
  assert.equal(reserved.get("item-b"), 1);
});
