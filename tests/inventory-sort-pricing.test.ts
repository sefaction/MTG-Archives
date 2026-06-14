import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareInventoryGroups } from "../lib/inventory-sort";
import {
  formatPercentChange,
  selectPreferredCardPrice,
} from "../lib/price-history";

const groups = [
  { cardId: "a", _sum: { quantity: 10 }, foilStatus: "NONFOIL" },
  { cardId: "b", _sum: { quantity: 2 }, foilStatus: "FOIL" },
  { cardId: "c", _sum: { quantity: 1 }, foilStatus: "ETCHED" },
];
const cards = new Map<string, any>([
  [
    "a",
    {
      name: "Alpha",
      setCode: "ABC",
      collectorNumber: "10",
      rarity: "rare",
      manaValue: 5,
      colorIdentity: ["W"],
      prices: { usd: "10.00" },
    },
  ],
  [
    "b",
    {
      name: "Beta",
      setCode: "ABC",
      collectorNumber: "2",
      rarity: "common",
      manaValue: 1,
      colorIdentity: [],
      prices: { usd: "2.00" },
    },
  ],
  [
    "c",
    {
      name: "Gamma",
      setCode: "ABC",
      collectorNumber: "100a",
      rarity: "mythic",
      manaValue: null,
      colorIdentity: ["W", "U"],
      prices: { usd: "100.00" },
    },
  ],
]);

function sortedIds(sort: string, direction: "asc" | "desc" = "asc") {
  return [...groups]
    .sort((left, right) =>
      compareInventoryGroups(left, right, cards, sort, direction),
    )
    .map((group) => group.cardId);
}

test("inventory sorting remains type-aware and uses Scryfall price fields", () => {
  assert.deepEqual(sortedIds("quantity"), ["c", "b", "a"]);
  assert.deepEqual(sortedIds("quantity", "desc"), ["a", "b", "c"]);
  assert.deepEqual(sortedIds("collectorNumber"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("rarity"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("manaValue"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("colorIdentity"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("priceUsd"), ["b", "a", "c"]);
});

test("Scryfall fallback prices are still selected and formatted", () => {
  assert.equal(selectPreferredCardPrice([], { usd: "1.00" })?.provider, "scryfall");
  assert.equal(
    selectPreferredCardPrice([], { usd_foil: "2.50" }, { finish: "foil" })
      ?.amount,
    2.5,
  );
  assert.equal(formatPercentChange(12.345), "+12.3%");
});

test("MTGJSON pricing UI and history entry points are removed from main surfaces", () => {
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
  const inventoryApi = readFileSync("app/api/inventory/list/route.ts", "utf8");
  const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const compose = readFileSync("docker-compose.yml", "utf8");

  assert.doesNotMatch(settings, /preferredPriceProvider|Preferred pricing source/);
  assert.doesNotMatch(inventoryPage, /CardPriceSnapshot|pricing-analytics|priceSnapshots/);
  assert.doesNotMatch(inventoryApi, /CardPriceSnapshot|pricing-analytics|priceSnapshots/);
  assert.match(adminPrices, /Pricing history disabled/);
  assert.doesNotMatch(adminPrices, /PriceImportJobsPanel|price-worker|queue/);
  assert.doesNotMatch(packageJson, /worker:prices|prices:import|prices:map/);
  assert.doesNotMatch(compose, /price-worker/);
});
