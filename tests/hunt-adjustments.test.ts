import assert from "node:assert/strict";
import test from "node:test";
import { planCardHunt, type HuntStock } from "../lib/card-hunt";
import {
  huntAdjustmentsInput,
  bulkScopeInput,
  locationIsBulk,
  pullExcluded,
} from "../lib/pull-scope";
const item = (
  id: string,
  quantity: number,
  location = "box",
  cardId = "a",
  bulk = false,
): HuntStock => ({
  id,
  quantity,
  ownerId: "me",
  reserved: 0,
  cardId,
  oracleId: "oracle",
  name: "Card",
  setCode: cardId,
  collectorNumber: "1",
  finish: "NONFOIL",
  language: "EN",
  condition: "NM",
  stamp: "a".repeat(64),
  isBulk: bulk,
  location: {
    id: location,
    name: location,
    section: "0",
    ownerId: "me",
    active: true,
    isDeck: false,
  },
});
const plan = (
  stock: HuntStock[],
  adjustments: Parameters<typeof planCardHunt>[0]["adjustments"] = {},
  quantity = 4,
) =>
  planCardHunt({
    ownerId: "me",
    requests: [
      { id: "need", name: "Card", cardId: "a", oracleId: "oracle", quantity },
    ],
    stock,
    mode: "boxes",
    finish: "ANY",
    adjustments,
  });
test("bulk purpose inherits across sections, legacy boxes work and cycles terminate", () => {
  const rows = new Map([
    ["root", { id: "root", isBulk: true }],
    ["child", { id: "child", parentLocationId: "root" }],
    ["legacy", { id: "legacy", type: "Bulk cleanup" }],
    ["cycle", { id: "cycle", parentLocationId: "cycle" }],
  ]);
  assert.equal(locationIsBulk("child", rows), true);
  assert.equal(locationIsBulk("legacy", rows), true);
  assert.equal(locationIsBulk("cycle", rows), false);
  assert.equal(
    pullExcluded({ excludedLocations: ["root"] }, "stock", "child", "0", rows),
    true,
  );
  assert.equal(
    pullExcluded(
      { excludedSections: [{ locationId: "child", section: "0" }] },
      "stock",
      "child",
      "1",
      rows,
    ),
    false,
  );
});
test("normal storage is exhausted before bulk even in optimize-boxes mode", () => {
  const result = plan([item("normal", 2), item("bulk", 20, "bulk", "a", true)]);
  assert.equal(
    result.boxes.find((box) => box.id === "box")!.picks[0].quantity,
    2,
  );
  assert.equal(
    result.boxes.find((box) => box.id === "bulk")!.picks[0].quantity,
    2,
  );
  assert.equal(
    plan([item("normal", 2), item("bulk", 20, "bulk", "a", true)], {
      includeBulk: false,
    }).shortage,
    2,
  );
});
test("excluding a location or source reallocates copies without mutating inventory", () => {
  const stock = [item("first", 4, "one"), item("second", 4, "two")],
    before = JSON.stringify(stock);
  assert.equal(plan(stock, { excludedLocations: ["one"] }).boxes[0].id, "two");
  assert.equal(
    plan(stock, { excludedItems: ["first"] }).boxes[0].picks[0].inventoryItemId,
    "second",
  );
  assert.equal(JSON.stringify(stock), before);
});
test("an explicit owned printing is a hard choice for the unpulled remainder", () => {
  const result = plan([item("a", 4), item("b", 2, "two", "b")], {
    printings: [{ requestId: "need", cardId: "b", finish: "NONFOIL" }],
  });
  assert.equal(result.planned, 2);
  assert.equal(result.shortage, 2);
  assert.equal(result.boxes[0].picks[0].cardId, "b");
});
test("partial pulled copies remain fixed while the other printing fills the remainder", () => {
  const stock = [item("a", 4), item("b", 4, "two", "b")];
  const result = plan(stock, {
    excludedLocations: ["box"],
    held: [{ requestId: "need", id: "a", quantity: 2, stamp: stock[0].stamp! }],
    printings: [{ requestId: "need", cardId: "b", finish: "NONFOIL" }],
  });
  assert.equal(result.planned, 4);
  assert.equal(
    result.boxes.find((box) => box.id === "box")!.picks[0].pulledQuantity,
    2,
  );
  assert.equal(
    result.boxes.find((box) => box.id === "two")!.picks[0].quantity,
    2,
  );
  assert.throws(
    () =>
      plan(stock, {
        held: [
          { requestId: "need", id: "a", quantity: 2, stamp: "b".repeat(64) },
        ],
      }),
    /changed/,
  );
});
test("held stock is consumed once across multiple destinations and gifts remain completed", () => {
  const stock = [item("a", 4)];
  const result = planCardHunt({
    ownerId: "me",
    requests: [
      { id: "one", name: "Card", oracleId: "oracle", quantity: 4 },
      { id: "two", name: "Card", oracleId: "oracle", quantity: 4 },
    ],
    stock,
    mode: "preferences",
    finish: "ANY",
    adjustments: {
      held: [
        { requestId: "two", id: "a", quantity: 3, stamp: stock[0].stamp! },
      ],
    },
  });
  assert.equal(result.planned, 4);
  assert.equal(
    result.boxes[0].picks.reduce((n, p) => n + p.quantity, 0),
    4,
  );
  assert.equal(
    plan(stock, { completed: [{ requestId: "need", quantity: 2 }] }).planned,
    2,
  );
});
test("scope rejects unbounded data and duplicate per-request choices", () => {
  assert.equal(
    huntAdjustmentsInput.safeParse({
      printings: [
        { requestId: "one", cardId: "a", finish: "FOIL" },
        { requestId: "one", cardId: "b", finish: "FOIL" },
      ],
    }).success,
    false,
  );
  assert.equal(
    bulkScopeInput.safeParse({ excludedItems: Array(1001).fill("a") }).success,
    false,
  );
});

test("bulk progress rejects a repeated physical stack", () => {
  const pin = { id: "stock", quantity: 1, stamp: "a".repeat(64) };
  assert.equal(bulkScopeInput.safeParse({ held: [pin, pin] }).success, false);
});
