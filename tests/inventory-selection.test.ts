import assert from "node:assert/strict";
import test from "node:test";
import { selectInventoryRows } from "../lib/inventory-selection";

const rows = [
  { id: "a", sourceItemIds: ["a1", "a2"] },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];
test("empty source arrays use the row identity", () => {
  assert.deepEqual(
    [
      ...selectInventoryRows(
        [{ id: "a", sourceItemIds: [] }],
        new Set(),
        "a",
        null,
        {},
      ).ids,
    ],
    ["a"],
  );
});
test("plain click replaces selection and selects all stacks in a printing", () => {
  const result = selectInventoryRows(rows, new Set(["d"]), "a", null, {});
  assert.deepEqual([...result.ids], ["a1", "a2"]);
  assert.equal(result.anchorId, "a");
});
test("Ctrl toggles an entire printing without losing other selections", () => {
  const result = selectInventoryRows(
    rows,
    new Set(["a1", "a2", "d"]),
    "a",
    null,
    { additive: true },
  );
  assert.deepEqual([...result.ids], ["d"]);
});
test("Shift replaces with a forward or backward range and preserves anchor", () => {
  const first = selectInventoryRows(rows, new Set(["d"]), "c", "a", {
    range: true,
  });
  assert.deepEqual([...first.ids], ["a1", "a2", "b", "c"]);
  assert.equal(first.anchorId, "a");
  const second = selectInventoryRows(rows, first.ids, "b", first.anchorId, {
    range: true,
  });
  assert.deepEqual([...second.ids], ["a1", "a2", "b"]);
  assert.deepEqual(
    [...selectInventoryRows(rows, new Set(), "a", "c", { range: true }).ids],
    ["a1", "a2", "b", "c"],
  );
});
test("Ctrl+Shift adds a range; missing anchors fall back to the target", () => {
  assert.deepEqual(
    [
      ...selectInventoryRows(rows, new Set(["d"]), "b", "a", {
        range: true,
        additive: true,
      }).ids,
    ],
    ["d", "a1", "a2", "b"],
  );
  assert.deepEqual(
    [
      ...selectInventoryRows(rows, new Set(["d"]), "a", "unloaded", {
        range: true,
      }).ids,
    ],
    ["a1", "a2"],
  );
});
test("unknown targets leave selection untouched", () => {
  assert.deepEqual(
    [...selectInventoryRows(rows, new Set(["d"]), "missing", "d", {}).ids],
    ["d"],
  );
});
