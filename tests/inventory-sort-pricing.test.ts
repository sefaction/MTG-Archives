import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareInventoryGroups } from "../lib/inventory-sort";
import {
  collectionValueHistory,
  formatPercentChange,
  inventoryValueByProvider,
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
      priceSnapshots: [
        {
          provider: "tcgplayer",
          finish: "normal",
          priceType: "retail",
          currency: "USD",
          price: "12.00",
          observedDate: new Date("2026-06-14T00:00:00Z"),
        },
      ],
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
      priceSnapshots: [
        {
          provider: "cardkingdom",
          finish: "normal",
          priceType: "retail",
          currency: "USD",
          price: "3.00",
          observedDate: new Date("2026-06-14T00:00:00Z"),
        },
      ],
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
      priceSnapshots: [],
    },
  ],
]);

function sortedIds(
  sort: string,
  direction: "asc" | "desc" = "asc",
  preferredProvider?: string,
) {
  return [...groups]
    .sort((left, right) =>
      compareInventoryGroups(
        left,
        right,
        cards,
        sort,
        direction,
        preferredProvider,
      ),
    )
    .map((group) => group.cardId);
}

test("inventory sorting is type-aware for numeric, natural, semantic, and price columns", () => {
  assert.deepEqual(sortedIds("quantity"), ["c", "b", "a"]);
  assert.deepEqual(sortedIds("quantity", "desc"), ["a", "b", "c"]);
  assert.deepEqual(sortedIds("collectorNumber"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("rarity"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("manaValue"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("colorIdentity"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("priceUsd"), ["b", "a", "c"]);
  assert.deepEqual(sortedIds("priceUsd", "asc", "cardkingdom"), [
    "b",
    "a",
    "c",
  ]);
});

test("preferred pricing provider and Scryfall fallback are applied", () => {
  const snapshots = [
    {
      provider: "tcgplayer",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "4.00",
      observedDate: new Date("2026-06-14T00:00:00Z"),
    },
    {
      provider: "cardkingdom",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "5.00",
      observedDate: new Date("2026-06-14T00:00:00Z"),
    },
  ];
  assert.equal(
    selectPreferredCardPrice(
      snapshots,
      { usd: "1.00" },
      { preferredProvider: "cardkingdom" },
    )?.provider,
    "cardkingdom",
  );
  assert.equal(
    selectPreferredCardPrice(
      snapshots,
      { usd: "1.00" },
      { preferredProvider: "scryfall" },
    )?.provider,
    "scryfall",
  );
  assert.equal(
    selectPreferredCardPrice([], { usd: "1.00" })?.provider,
    "scryfall",
  );
});

test("collection value history multiplies quantities by provider snapshots", () => {
  const items = [
    {
      quantity: 2,
      foilStatus: "NONFOIL",
      card: {
        prices: { usd: "1.00" },
        priceSnapshots: [
          {
            provider: "tcgplayer",
            finish: "normal",
            priceType: "retail",
            currency: "USD",
            price: "3.00",
            observedDate: new Date("2026-06-14T00:00:00Z"),
          },
          {
            provider: "tcgplayer",
            finish: "normal",
            priceType: "retail",
            currency: "USD",
            price: "2.00",
            observedDate: new Date("2026-06-13T00:00:00Z"),
          },
        ],
      },
    },
  ];
  assert.equal(
    inventoryValueByProvider(items, { preferredProvider: "tcgplayer" }),
    6,
  );
  assert.deepEqual(collectionValueHistory(items, { provider: "tcgplayer" }), [
    { date: "2026-06-14", value: 6 },
    { date: "2026-06-13", value: 4 },
  ]);
  assert.equal(formatPercentChange(12.345), "+12.3%");
});

test("pricing UI exposes preference and history entry points", () => {
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const inventoryBrowser = readFileSync(
    "components/InventoryBrowser.tsx",
    "utf8",
  );
  const historyRoute = readFileSync(
    "app/api/cards/[cardId]/price-history/route.ts",
    "utf8",
  );
  const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
  assert.match(settings, /Preferred pricing source/);
  assert.match(settings, /preferredPriceProvider/);
  assert.match(inventoryBrowser, /View price history JSON/);
  assert.match(inventoryBrowser, /7d/);
  assert.match(historyRoute, /provider/);
  assert.match(historyRoute, /finish/);
  assert.match(historyRoute, /sevenDay/);
  assert.match(adminPrices, /Collection value history/);
});
