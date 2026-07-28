import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTradeSideValue,
  compareTradeValues,
  formatTradeMoney,
  selectTradeCardPrice,
} from "../lib/trade-value";

test("trade values multiply unit prices by selected quantities", () => {
  assert.deepEqual(
    calculateTradeSideValue([
      { quantity: 2, priceAmount: 4.5 },
      { quantity: 3, priceAmount: 1 },
    ]),
    {
      knownValue: 12,
      totalCards: 5,
      pricedCards: 5,
      unpricedCards: 0,
      complete: true,
    },
  );
});

test("trade value comparisons expose incomplete estimates and known-value gap", () => {
  assert.deepEqual(
    compareTradeValues(
      [
        { quantity: 1, priceAmount: 8 },
        { quantity: 2, priceAmount: null },
      ],
      [{ quantity: 2, priceAmount: 5 }],
    ),
    {
      left: {
        knownValue: 8,
        totalCards: 3,
        pricedCards: 1,
        unpricedCards: 2,
        complete: false,
      },
      right: {
        knownValue: 10,
        totalCards: 2,
        pricedCards: 2,
        unpricedCards: 0,
        complete: true,
      },
      difference: 2,
      absoluteDifference: 2,
      complete: false,
    },
  );
});

test("trade card prices respect finish and format currency", () => {
  assert.deepEqual(
    selectTradeCardPrice({ usd: "1.25", usd_foil: "3.50" }, "FOIL", "scryfall"),
    { amount: 3.5, label: "$3.50", provider: "Scryfall" },
  );
  assert.equal(formatTradeMoney(12), "$12.00");
});
