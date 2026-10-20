import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMtgjsonIdentifierMappings,
  extractMtgjsonPriceSnapshots,
} from "../lib/pricing-mtgjson";
import {
  formatSelectedPrice,
  selectPreferredCardPrice,
} from "../lib/price-history";

test("extracts MTGJSON AllPricesToday snapshots from nested provider prices", () => {
  const snapshots = extractMtgjsonPriceSnapshots({
    data: {
      "uuid-one": {
        paper: {
          tcgplayer: {
            retail: {
              normal: {
                "2026-06-30": 1.23,
              },
              foil: {
                "2026-06-30": 2.34,
              },
            },
          },
          cardmarket: {
            retail: {
              EUR: {
                normal: {
                  "2026-06-30": 0.95,
                },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(
    snapshots.map((snapshot) => ({
      mtgjsonUuid: snapshot.mtgjsonUuid,
      provider: snapshot.provider,
      finish: snapshot.finish,
      priceType: snapshot.priceType,
      currency: snapshot.currency,
      observedDate: snapshot.observedDate,
      price: snapshot.price,
    })),
    [
      {
        mtgjsonUuid: "uuid-one",
        provider: "tcgplayer",
        finish: "normal",
        priceType: "retail",
        currency: "USD",
        observedDate: "2026-06-30",
        price: 1.23,
      },
      {
        mtgjsonUuid: "uuid-one",
        provider: "tcgplayer",
        finish: "foil",
        priceType: "retail",
        currency: "USD",
        observedDate: "2026-06-30",
        price: 2.34,
      },
      {
        mtgjsonUuid: "uuid-one",
        provider: "cardmarket",
        finish: "normal",
        priceType: "retail",
        currency: "EUR",
        observedDate: "2026-06-30",
        price: 0.95,
      },
    ],
  );
});

test("supports a development cap for fixture-sized imports", () => {
  const snapshots = extractMtgjsonPriceSnapshots(
    {
      data: {
        "uuid-one": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 1 } } } },
        },
        "uuid-two": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 2 } } } },
        },
      },
    },
    { maxCards: 1 },
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].mtgjsonUuid, "uuid-one");
});

test("target MTGJSON UUID filtering happens before the development cap", () => {
  const snapshots = extractMtgjsonPriceSnapshots(
    {
      data: {
        "unowned-one": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 1 } } } },
        },
        "owned-one": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 2 } } } },
        },
        "owned-two": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 3 } } } },
        },
      },
    },
    {
      maxCards: 1,
      targetMtgjsonUuids: ["owned-one", "owned-two"],
    },
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].mtgjsonUuid, "owned-one");
});

test("target MTGJSON UUID filtering skips unrelated cards", () => {
  const snapshots = extractMtgjsonPriceSnapshots(
    {
      data: {
        "unowned-one": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 1 } } } },
        },
        "owned-one": {
          paper: { tcgplayer: { retail: { normal: { "2026-06-30": 2 } } } },
        },
      },
    },
    {
      targetMtgjsonUuids: ["owned-one"],
    },
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].mtgjsonUuid, "owned-one");
});

test("extracts MTGJSON identifier mappings by Scryfall id", () => {
  const mappings = extractMtgjsonIdentifierMappings({
    data: {
      "mtgjson-uuid-one": {
        identifiers: {
          scryfallId: "scryfall-one",
          scryfallOracleId: "oracle-one",
        },
      },
      "mtgjson-uuid-two": {
        uuid: "canonical-uuid-two",
        identifiers: { scryfallId: "scryfall-two" },
      },
      "mtgjson-uuid-three": {
        identifiers: { scryfallOracleId: "oracle-three" },
      },
    },
  });

  assert.deepEqual(mappings, [
    { mtgjsonUuid: "mtgjson-uuid-one", scryfallId: "scryfall-one" },
    { mtgjsonUuid: "canonical-uuid-two", scryfallId: "scryfall-two" },
  ]);
});

test("preferred pricing selector uses current MTGJSON projection before Scryfall", () => {
  const price = selectPreferredCardPrice(
    [],
    {
      usd: "1.00",
      mtgjson: {
        tcgplayer: {
          normal: {
            retail: {
              USD: { amount: 4.25, observedDate: "2026-06-30" },
            },
          },
        },
      },
    },
    { preferredProvider: "tcgplayer" },
  );

  assert.equal(price?.source, "mtgjson");
  assert.equal(price?.providerLabel, "TCGplayer");
  assert.equal(price?.amount, 4.25);
  assert.equal(formatSelectedPrice(price), "$4.25");
});

test("reads provider currency metadata and mtgo provider names from the published schema", () => {
  const snapshots = extractMtgjsonPriceSnapshots({ data: { one: { paper: {
          cardmarket: { retail: { normal: { "2026-10-18": 4.25 } }, currency: "EUR" },
          tcgplayer: { currency: "USD", retail: { foil: { "2026-10-18": 5 } } },
        }, mtgo: { cardhoarder: { retail: { normal: { "2026-10-18": 0.06 } }, currency: "USD" } } } } });
  assert.deepEqual(snapshots.map(({ provider, currency, price }) => ({ provider, currency, price })), [
    { provider: "cardmarket", currency: "EUR", price: 4.25 },
    { provider: "tcgplayer", currency: "USD", price: 5 },
    { provider: "cardhoarder", currency: "USD", price: 0.06 },
  ]);
});
test("currency metadata stays within its branch and explicit currency paths retain priority", () => {
  const payload = { data: { one: { paper: {
          declared: { currency: " eur ", retail: { normal: { "2026-10-18": 1 }, USD: { foil: { "2026-10-18": 2 } } } },
          fallback: { retail: { normal: { "2026-10-18": 3 } } },
          invalid: { currency: 123, retail: { normal: { "2026-10-18": 4 } } },
        } } } };
  const before = structuredClone(payload);
  const snapshots = extractMtgjsonPriceSnapshots(payload, { defaultCurrency: "GBP" });
  assert.deepEqual(snapshots.map(v => v.currency), ["EUR", "USD", "GBP", "GBP"]);
  assert.deepEqual(payload, before);
  assert.deepEqual(snapshots[0].rawJson, {
    path: ["paper", "declared", "retail", "normal"], value: 1,
    currencyProvenance: { resolved: "EUR", resolution: "declaration",
      declaration: { path: ["paper", "declared", "currency"], value: " eur " } },
  });
  assert.deepEqual(snapshots[1].rawJson.currencyProvenance, {
    resolved: "USD", resolution: "path",
    declaration: { path: ["paper", "declared", "currency"], value: " eur " },
    currencyPath: ["paper", "declared", "retail", "USD"],
  });
  for (const row of snapshots.slice(2)) assert.deepEqual(row.rawJson.currencyProvenance,
    { resolved: "GBP", resolution: "default", defaultCurrency: "GBP" });
});
test("invalid currency declarations fall back without changing filtering or finite-price rules", () => {
  const payload = { data: { skip: { paper: { cardmarket: { currency: "EUR", retail: { normal: { "2026-10-18": 1 } } } } }, owned: { online: { cardhoarder: { currency: "EURO", retail: { normal: { "2026-10-18": 0, "2026-10-17": Infinity, "2026-10-16": "3" } } } } } } };
  const rows = extractMtgjsonPriceSnapshots(payload, { defaultCurrency: "CAD", targetMtgjsonUuids: ["owned"], maxCards: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currency, "CAD");
  assert.equal(rows[0].provider, "cardhoarder");
  assert.equal(rows[0].price, 0);
});


test("raw currency evidence follows nested declarations without leaking to sibling providers", () => {
  const payload = { data: { one: { paper: {
    declared: { currency: "EUR", retail: {
      currency: "CAD", normal: { "2026-10-18": 1 },
      foil: { currency: "invalid", "2026-10-18": 2 },
    }, buylist: { normal: { "2026-10-18": 3 } } },
    explicit: { retail: { USD: { normal: { "2026-10-18": 4 } } } },
    fallback: { retail: { normal: { "2026-10-18": 5 } } },
  } } } };
  const before = structuredClone(payload);
  const rows = extractMtgjsonPriceSnapshots(payload, { defaultCurrency: "gbp" });
  assert.deepEqual(rows.map(r => r.currency), ["CAD", "CAD", "EUR", "USD", "GBP"]);
  assert.deepEqual(rows.slice(0, 2).map(r => r.rawJson.currencyProvenance), [0, 1].map(() => ({
    resolved: "CAD", resolution: "declaration", declaration: {
      path: ["paper", "declared", "retail", "currency"], value: "CAD",
    },
  })));
  assert.deepEqual(rows[2].rawJson.currencyProvenance, { resolved: "EUR", resolution: "declaration",
    declaration: { path: ["paper", "declared", "currency"], value: "EUR" } });
  assert.deepEqual(rows[3].rawJson.currencyProvenance, { resolved: "USD", resolution: "path",
    currencyPath: ["paper", "explicit", "retail", "USD"] });
  assert.deepEqual(rows[4].rawJson.currencyProvenance, { resolved: "GBP", resolution: "default", defaultCurrency: "gbp" });
  assert.deepEqual(payload, before);
});
