import assert from "node:assert/strict";
import test from "node:test";
import { extractMtgjsonPriceSnapshots } from "../lib/pricing-mtgjson";
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
