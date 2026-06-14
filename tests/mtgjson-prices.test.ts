import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  importMtgjsonPriceEntries,
  importMtgjsonPricePayload,
  mapMtgjsonIdentifiersToLocalCards,
  parseMtgjsonPriceSnapshotsForCard,
  streamMtgjsonPriceEntriesFromTextChunks,
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
      async count({ where }: any = {}) {
        return where?.mtgjsonUuid?.not === null ? 1 : 1;
      },
      async findMany(args: any = {}) {
        if (args.where?.mtgjsonUuid?.in) {
          return [{ id: "card-sol-ring", mtgjsonUuid: "uuid-sol-ring" }];
        }
        return [
          {
            id: "card-sol-ring",
            scryfallId: "sf-sol-ring",
            mtgjsonUuid: "uuid-sol-ring",
            setCode: "LTC",
            collectorNumber: "314",
            name: "Sol Ring",
            lang: "en",
          },
        ];
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
  assert.equal(first.localCards, 1);
  assert.equal(first.localCardsWithMtgjsonUuidBefore, 1);
  assert.equal(first.matchedLocalCards, 1);
  assert.equal(first.unmatchedUuids, 1);
  assert.equal(first.snapshotsSkippedForUnmappedUuid, 1);
  assert.equal(first.snapshotsInserted, 5);
  assert.equal(second.snapshotsInserted, 0);
  assert.equal(second.duplicatesSkipped, 5);
  assert.equal(db.rows.length, 5);
  assert.deepEqual(first.providersImported, ["cardkingdom", "tcgplayer"]);
});

test("streaming MTGJSON importer filters to mapped local UUIDs and batches inserts", async () => {
  const db = mockDb();
  async function* chunks() {
    const json = JSON.stringify(fixture);
    for (let index = 0; index < json.length; index += 17) {
      yield json.slice(index, index + 17);
    }
  }
  const entries = streamMtgjsonPriceEntriesFromTextChunks(
    chunks(),
    new Set(["uuid-sol-ring"]),
  );
  const report = await importMtgjsonPriceEntries(db, entries, "today");
  assert.equal(report.memorySafeImporter, "streaming-json-entry-parser");
  assert.equal(report.totalMtgjsonCards, 2);
  assert.equal(report.matchedLocalCards, 1);
  assert.equal(report.unmatchedUuids, 1);
  assert.equal(report.snapshotsParsed, 5);
  assert.equal(report.snapshotsInserted, 5);
});

test("streaming import exits before reading price entries when no cards are mapped", async () => {
  let iterated = false;
  async function* entries() {
    iterated = true;
    yield { uuid: "uuid-sol-ring", formats: fixture.data["uuid-sol-ring"] };
  }
  const report = await importMtgjsonPriceEntries(
    {
      card: {
        async count({ where }: any = {}) {
          return where?.mtgjsonUuid?.not === null ? 0 : 1;
        },
        async findMany() {
          return [];
        },
      },
      cardPriceSnapshot: {
        async createMany() {
          throw new Error("should not insert without mapped cards");
        },
      },
    } as any,
    entries(),
    "today",
  );
  assert.equal(iterated, false);
  assert.equal(report.memorySafeImporter, "early-exit-no-price-download");
  assert.match(report.errors[0], /No local cards are mapped/);
});

test("MTGJSON identifier mapping uses Scryfall and tuple matches safely", async () => {
  const updates: any[] = [];
  const report = await mapMtgjsonIdentifiersToLocalCards(
    {
      card: {
        async findMany() {
          return [
            {
              id: "card-scryfall",
              scryfallId: "sf-clear",
              mtgjsonUuid: null,
              setCode: "LTC",
              collectorNumber: "314",
              name: "Sol Ring",
              lang: "en",
            },
            {
              id: "card-tuple",
              scryfallId: "sf-other",
              mtgjsonUuid: null,
              setCode: "WHO",
              collectorNumber: "10",
              name: "Forest",
              lang: "en",
            },
            {
              id: "card-ambiguous-a",
              scryfallId: "sf-a",
              mtgjsonUuid: null,
              setCode: "ABC",
              collectorNumber: "1",
              name: "Ambiguous Card",
              lang: "en",
            },
            {
              id: "card-ambiguous-b",
              scryfallId: "sf-b",
              mtgjsonUuid: null,
              setCode: "ABC",
              collectorNumber: "1",
              name: "Ambiguous Card",
              lang: "en",
            },
          ];
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
        "uuid-tuple": {
          setCode: "WHO",
          number: "010",
          name: "Forest",
          language: "en",
          identifiers: {},
        },
        "uuid-ambiguous": {
          setCode: "ABC",
          number: "1",
          name: "Ambiguous Card",
          language: "en",
          identifiers: {},
        },
        "uuid-missing": { identifiers: { scryfallId: "sf-missing" } },
      },
    },
  );
  assert.equal(report.scanned, 4);
  assert.equal(report.localCards, 4);
  assert.equal(report.mapped, 2);
  assert.equal(report.ambiguous, 1);
  assert.equal(report.unmatched, 1);
  assert.deepEqual(updates, [
    { where: { id: "card-scryfall" }, data: { mtgjsonUuid: "uuid-clear" } },
    { where: { id: "card-tuple" }, data: { mtgjsonUuid: "uuid-tuple" } },
  ]);
});

test("MTGJSON price import warns clearly when no local cards are mapped", async () => {
  const db = {
    card: {
      async count({ where }: any = {}) {
        return where?.mtgjsonUuid?.not === null ? 0 : 1;
      },
      async findMany() {
        return [];
      },
    },
    cardPriceSnapshot: {
      async createMany() {
        throw new Error("should not insert without mapped cards");
      },
    },
  } as any;
  const report = await importMtgjsonPricePayload(db, fixture, "today");
  assert.equal(report.localCards, 1);
  assert.equal(report.localCardsWithMtgjsonUuidBefore, 0);
  assert.equal(report.matchedLocalCards, 0);
  assert.equal(report.snapshotsParsed, 0);
  assert.equal(report.snapshotsInserted, 0);
  assert.match(report.errors[0], /No local cards are mapped/);
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
  const script = readFileSync("scripts/import-mtgjson-prices.ts", "utf8");
  const priceImporter = readFileSync("lib/mtgjson-prices.ts", "utf8");
  assert.match(schema, /mtgjsonUuid\s+String\?\s+@unique/);
  assert.match(schema, /model CardPriceSnapshot/);
  assert.match(
    schema,
    /@@unique\(\[cardId, provider, finish, priceType, currency, observedDate\]\)/,
  );
  assert.match(migration, /CREATE TABLE "CardPriceSnapshot"/);
  assert.match(adminRoute, /requireAdminMode/);
  assert.match(adminPage, /background jobs processed by the price/);
  assert.match(adminPage, /Map MTGJSON card UUIDs/);
  assert.match(script, /mapMtgjsonCards/);
  assert.doesNotMatch(priceImporter, /response\.text\(/);
  assert.doesNotMatch(priceImporter, /fetchMtgjsonPricePayload/);
  assert.match(priceImporter, /streamMtgjsonPriceEntriesFromTextChunks/);
});
