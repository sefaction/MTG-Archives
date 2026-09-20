import assert from "node:assert/strict";
import test from "node:test";
import {
  compareInventoryGroups,
  compareInventorySortValues,
  parseCollectorNumber,
} from "../lib/inventory-sort";

const samples = [
  "",
  "Card 2",
  "Card 10",
  "card 02",
  "Æther",
  "Aether",
  "Éowyn",
  "Eowyn",
  "e\u0301",
  "é",
  "Forest",
  "forest",
  "森",
  "山",
  "∞",
  "★",
  "{W}",
  "{10}",
];
const sign = (value: number) => (value < 0 ? -1 : value > 0 ? 1 : 0);

test("reused inventory collation preserves legacy string and numeric-fallback ordering", () => {
  for (const left of samples)
    for (const right of samples)
      for (const direction of ["asc", "desc"] as const) {
        const expected = sign(
          left.localeCompare(right, undefined, {
            sensitivity: "base",
            numeric: true,
          }) * (direction === "asc" ? 1 : -1),
        );
        assert.equal(
          sign(
            compareInventorySortValues(
              { kind: "string", value: left },
              { kind: "string", value: right },
              direction,
            ),
          ),
          expected,
        );
        assert.equal(
          sign(
            compareInventorySortValues(
              { kind: "number", value: 1, fallback: left },
              { kind: "number", value: 1, fallback: right },
              direction,
            ),
          ),
          expected,
        );
      }
});

test("collector suffix ordering retains case sensitivity and numeric behavior", () => {
  for (const left of ["a", "A", "á", "a2", "a10"])
    for (const right of ["a", "A", "á", "a2", "a10"]) {
      assert.equal(
        sign(
          compareInventorySortValues(
            { kind: "collector", value: { number: 1, suffix: left } },
            { kind: "collector", value: { number: 1, suffix: right } },
          ),
        ),
        sign(left.localeCompare(right, undefined, { numeric: true })),
      );
    }
  for (const left of [
    "1a",
    "1A",
    "1á",
    "1a2",
    "1a10",
    "12",
    "100",
    "★",
    "",
    "12b",
  ]) {
    for (const right of [
      "1a",
      "1A",
      "1á",
      "1a2",
      "1a10",
      "12",
      "100",
      "★",
      "",
      "12b",
    ]) {
      const l = parseCollectorNumber(left),
        r = parseCollectorNumber(right);
      for (const direction of ["asc", "desc"] as const) {
        const multiplier = direction === "asc" ? 1 : -1;
        const expected = sign(
          (l.number - r.number) * multiplier ||
            l.suffix.localeCompare(r.suffix, undefined, { numeric: true }) *
              multiplier,
        );
        assert.equal(
          sign(
            compareInventorySortValues(
              { kind: "collector", value: l },
              { kind: "collector", value: r },
              direction,
            ),
          ),
          expected,
        );
      }
    }
  }
});

test("inventory ties and missing numeric values keep their original order", () => {
  const cards = new Map(samples.map((id) => [id, { name: "Same card" }]));
  for (const left of samples)
    for (const right of samples) {
      assert.equal(
        sign(
          compareInventoryGroups(
            { cardId: left },
            { cardId: right },
            cards,
            "cardName",
            "desc",
          ),
        ),
        sign(
          left.localeCompare(right, undefined, {
            sensitivity: "base",
            numeric: true,
          }),
        ),
      );
    }
  for (const direction of ["asc", "desc"] as const) {
    assert.equal(
      compareInventorySortValues(
        { kind: "number", value: null },
        { kind: "number", value: 4 },
        direction,
      ),
      1,
    );
    assert.equal(
      compareInventorySortValues(
        { kind: "number", value: 4 },
        { kind: "number", value: null },
        direction,
      ),
      -1,
    );
  }
});
