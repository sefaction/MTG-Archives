import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareInventoryGroups,
  enrichInventoryGroupsForLocationSort,
} from "../lib/inventory-sort";
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

test("location sorting enriches grouped rows before comparison", async () => {
  const db = {
    inventoryItem: {
      groupBy: async () => [
        { cardId: "a", locationId: "loc-z" },
        { cardId: "b", locationId: "loc-a" },
        { cardId: "c", locationId: "loc-m" },
        { cardId: "c", locationId: "loc-a" },
      ],
    },
    inventoryLocation: {
      findMany: async () => [
        { id: "loc-z", name: "Zulu Binder" },
        { id: "loc-a", name: "Alpha Box" },
        { id: "loc-m", name: "Middle Shelf" },
      ],
    },
  };
  const enriched = await enrichInventoryGroupsForLocationSort(db, groups, {}, [
    "cardId",
  ]);
  const sorted = [...enriched]
    .sort((left, right) =>
      compareInventoryGroups(left, right, cards, "locationName", "asc"),
    )
    .map((group) => group.cardId);

  assert.deepEqual(sorted, ["b", "c", "a"]);
  assert.equal(
    enriched.find((group) => group.cardId === "c")?.locationSummary,
    "Alpha Box · Middle Shelf",
  );
});

test("Scryfall fallback prices are still selected and formatted", () => {
  assert.equal(
    selectPreferredCardPrice([], { usd: "1.00" })?.provider,
    "scryfall",
  );
  assert.equal(
    selectPreferredCardPrice(
      [],
      {
        usd: "1.00",
        mtgjson: {
          tcgplayer: {
            normal: {
              retail: {
                USD: { amount: 3.5, observedDate: "2026-06-30" },
              },
            },
          },
        },
      },
      { preferredProvider: "tcgplayer" },
    )?.provider,
    "tcgplayer",
  );
  assert.equal(
    selectPreferredCardPrice([], { usd_foil: "2.50" }, { finish: "foil" })
      ?.amount,
    2.5,
  );
  assert.equal(formatPercentChange(12.345), "+12.3%");
});

test("MTGJSON pricing history stays off main inventory page load surfaces", () => {
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
  const inventoryApi = readFileSync("app/api/inventory/list/route.ts", "utf8");
  const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
  const compose = readFileSync("docker-compose.yml", "utf8");

  assert.match(settings, /preferredPriceProvider/);
  assert.match(settings, /Preferred pricing source/);
  assert.doesNotMatch(
    inventoryPage,
    /CardPriceSnapshot|pricing-analytics|priceSnapshots/,
  );
  assert.doesNotMatch(
    inventoryApi,
    /CardPriceSnapshot|pricing-analytics|priceSnapshots/,
  );
  assert.match(adminPrices, /Pricing worker/);
  assert.match(adminPrices, /Queue refresh job/);
  assert.match(compose, /pricing-worker/);
  assert.match(compose, /pricing-postgres/);
});
