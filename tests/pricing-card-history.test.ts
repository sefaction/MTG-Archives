import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  calculatePriceHistoryChange,
  normalizePriceHistoryRange,
} from "../lib/pricing-worker-store";

test("price history change calculation handles empty, gain, and zero-start data", () => {
  assert.deepEqual(calculatePriceHistoryChange([]), {
    start: null,
    current: null,
    absolute: null,
    percent: null,
  });

  assert.deepEqual(
    calculatePriceHistoryChange([
      { observedDate: "2026-06-01", price: 2 },
      { observedDate: "2026-06-02", price: 3.25 },
    ]),
    { start: 2, current: 3.25, absolute: 1.25, percent: 62.5 },
  );

  assert.deepEqual(
    calculatePriceHistoryChange([
      { observedDate: "2026-06-01", price: 0 },
      { observedDate: "2026-06-02", price: 1 },
    ]),
    { start: 0, current: 1, absolute: 1, percent: null },
  );
});

test("price history ranges are constrained to supported windows", () => {
  assert.equal(normalizePriceHistoryRange("7"), "7");
  assert.equal(normalizePriceHistoryRange("30"), "30");
  assert.equal(normalizePriceHistoryRange("90"), "90");
  assert.equal(normalizePriceHistoryRange("all"), "all");
  assert.equal(normalizePriceHistoryRange("365"), "90");
  assert.equal(normalizePriceHistoryRange(null), "90");
});

test("card history API is scoped, authenticated, and separated from inventory page loads", () => {
  const routePath = "app/api/pricing/card-history/route.ts";
  assert.equal(existsSync(routePath), true);
  const route = readFileSync(routePath, "utf8");
  const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
  const inventoryApi = readFileSync("app/api/inventory/list/route.ts", "utf8");

  assert.match(route, /getCurrentUser/);
  assert.match(route, /getAccessScope/);
  assert.match(route, /prisma\.inventoryItem\.count/);
  assert.match(route, /currentOwnerId: user\.playerId/);
  assert.match(route, /getCardPriceHistory/);
  assert.match(route, /available: false/);
  assert.doesNotMatch(inventoryPage, /getCardPriceHistory|price_snapshots/);
  assert.doesNotMatch(inventoryApi, /getCardPriceHistory|price_snapshots/);
});
