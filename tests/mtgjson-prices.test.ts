import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  importMtgjsonPricePayload,
  mapMtgjsonIdentifiersToLocalCards,
  parseMtgjsonPriceSnapshotsForCard,
} from "../lib/mtgjson-prices";
import {
  formatSelectedPrice,
  inventoryValueByProvider,
  priceChangePercent,
  selectPreferredCardPrice,
} from "../lib/price-history";

const fixture = {
  meta: { date: "2026-06-13", version: "5.test" },
  data: {
    "uuid-sol-ring": {
      paper: {
        tcgplayer: {
          currency: "USD",
          retail: {
            normal: { "2026-03-15": 1.5, "2026-06-13": 2.25 },
            foil: { "2026-06-13": 5.5 },
          },
        },
        cardkingdom: {
          currency: "USD",
          buylist: { normal: { "2026-06-13": 1.1 } },
          retail: { normal: { "2026-06-13": 2.75 } },
        },
      },
    },
    "uuid-unmatched": {
      paper: {
        cardsphere: {
          currency: "USD",
          retail: { normal: { "2026-06-13": 0.5 } },
        },
      },
    },
  },
};

function mockDb() {
  const rows: any[] = [];
  const seen = new Set<string>();
  return {
    rows,
    card: {
      async findMany() {
        return [{ id: "card-sol-ring", mtgjsonUuid: "uuid-sol-ring" }];
      },
    },
    cardPriceSnapshot: {
      async createMany({ data }: { data: any[]; skipDuplicates: boolean }) {
        let count = 0;
        for (const row of data) {
          const key = [
            row.cardId,
            row.provider,
            row.finish,
            row.priceType,
            row.currency,
            row.observedDate.toISOString(),
          ].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
          count += 1;
        }
        return { count };
      },
    },
  } as any;
}

test("MTGJSON price parser maps providers, finishes, price types, currency, and dates", () => {
  const snapshots = parseMtgjsonPriceSnapshotsForCard(
    "uuid-sol-ring",
    fixture.data["uuid-sol-ring"],
  );
  assert.equal(snapshots.length, 5);
  assert.deepEqual(
    snapshots.map((snapshot) => [
      snapshot.provider,
      snapshot.finish,
      snapshot.priceType,
      snapshot.currency,
      snapshot.observedDate.toISOString().slice(0, 10),
    ]),
    [
      ["tcgplayer", "normal", "retail", "USD", "2026-03-15"],
      ["tcgplayer", "normal", "retail", "USD", "2026-06-13"],
      ["tcgplayer", "foil", "retail", "USD", "2026-06-13"],
      ["cardkingdom", "normal", "retail", "USD", "2026-06-13"],
      ["cardkingdom", "normal", "buylist", "USD", "2026-06-13"],
    ],
  );
});

test("MTGJSON price import is idempotent and reports unmatched UUIDs", async () => {
  const db = mockDb();
  const first = await importMtgjsonPricePayload(db, fixture, "today");
  const second = await importMtgjsonPricePayload(db, fixture, "today");
  assert.equal(first.totalMtgjsonCards, 2);
  assert.equal(first.matchedLocalCards, 1);
  assert.equal(first.unmatchedUuids, 1);
  assert.equal(first.snapshotsInserted, 5);
  assert.equal(second.snapshotsInserted, 0);
  assert.equal(second.duplicatesSkipped, 5);
  assert.equal(db.rows.length, 5);
  assert.deepEqual(first.providersImported, ["cardkingdom", "tcgplayer"]);
});

test("MTGJSON identifier mapping assigns UUIDs only through Scryfall IDs", async () => {
  const updates: any[] = [];
  const report = await mapMtgjsonIdentifiersToLocalCards(
    {
      card: {
        async findMany({ where }: any) {
          if (where.scryfallId === "sf-clear")
            return [{ id: "card-clear", mtgjsonUuid: null }];
          return [];
        },
        async update(update: any) {
          updates.push(update);
          return update;
        },
      },
    } as any,
    {
      data: {
        "uuid-clear": { identifiers: { scryfallId: "sf-clear" } },
        "uuid-missing": { identifiers: { scryfallId: "sf-missing" } },
        "uuid-no-id": { identifiers: {} },
      },
    },
  );
  assert.deepEqual(report, {
    scanned: 3,
    mapped: 1,
    ambiguous: 0,
    unmatched: 2,
  });
  assert.deepEqual(updates, [
    { where: { id: "card-clear" }, data: { mtgjsonUuid: "uuid-clear" } },
  ]);
});

test("latest price helper prefers MTGJSON providers and falls back to Scryfall", () => {
  const snapshots = [
    {
      provider: "cardkingdom",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "3.00",
      observedDate: new Date("2026-06-13T00:00:00Z"),
    },
    {
      provider: "tcgplayer",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "2.00",
      observedDate: new Date("2026-06-12T00:00:00Z"),
    },
  ];
  assert.equal(
    selectPreferredCardPrice(snapshots, { usd: "9.99" })?.provider,
    "tcgplayer",
  );
  assert.equal(
    selectPreferredCardPrice(
      snapshots,
      { usd: "9.99" },
      { preferredProvider: "cardkingdom" },
    )?.amount,
    3,
  );
  assert.equal(
    formatSelectedPrice(selectPreferredCardPrice([], { usd: "9.99" })),
    "Scryfall $9.99",
  );
});

test("price history helper computes 90-day change and inventory value", () => {
  const snapshots = [
    {
      provider: "tcgplayer",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "2.00",
      observedDate: new Date("2026-06-13T00:00:00Z"),
    },
    {
      provider: "tcgplayer",
      finish: "normal",
      priceType: "retail",
      currency: "USD",
      price: "1.00",
      observedDate: new Date("2026-03-15T00:00:00Z"),
    },
  ];
  assert.equal(priceChangePercent(snapshots, 90)?.toFixed(0), "100");
  assert.equal(
    inventoryValueByProvider([
      {
        quantity: 3,
        foilStatus: "NONFOIL",
        card: { prices: { usd: "1.00" }, priceSnapshots: snapshots },
      },
    ]),
    6,
  );
});

test("schema and admin route define MTGJSON price storage and admin-only imports", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260613120000_mtgjson_price_snapshots/migration.sql",
    "utf8",
  );
  const adminRoute = readFileSync(
    "app/api/admin/prices/import-mtgjson/route.ts",
    "utf8",
  );
  const adminPage = readFileSync("app/admin/prices/page.tsx", "utf8");
  assert.match(schema, /mtgjsonUuid\s+String\?\s+@unique/);
  assert.match(schema, /model CardPriceSnapshot/);
  assert.match(
    schema,
    /@@unique\(\[cardId, provider, finish, priceType, currency, observedDate\]\)/,
  );
  assert.match(migration, /CREATE TABLE "CardPriceSnapshot"/);
  assert.match(adminRoute, /requireAdminMode/);
  assert.match(adminPage, /Import today’s prices/);
  assert.match(adminPage, /Backfill 90-day price history/);
});
