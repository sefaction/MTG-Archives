import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeTradePairingPayload,
  parseTradePairingPayload,
  tradePairingSideMime,
} from "../lib/trade-pairing";

const item = {
  id: "inventory-1",
  cardName: "Lightning Bolt",
  setCode: "2xm",
  collectorNumber: "117",
  condition: "NM",
  foilStatus: "NONFOIL",
  quantity: 2,
  available: 2,
  priceAmount: 1.25,
};

test("wishlist pairing payloads preserve the destination side and card", () => {
  const payload = { side: "requested" as const, item };
  assert.deepEqual(
    parseTradePairingPayload(encodeTradePairingPayload(payload)),
    payload,
  );
});

test("wishlist pairing rejects malformed or unknown-side payloads", () => {
  assert.equal(parseTradePairingPayload("not json"), null);
  assert.equal(
    parseTradePairingPayload(
      JSON.stringify({ side: "other", item: { id: "x", cardName: "Card" } }),
    ),
    null,
  );
  assert.equal(
    parseTradePairingPayload(
      JSON.stringify({ side: "offered", item: { id: "", cardName: "" } }),
    ),
    null,
  );
});

test("pairing sides expose separate drag types for hover feedback", () => {
  assert.equal(
    tradePairingSideMime("offered"),
    "application/x-mtg-trade-card-offered",
  );
  assert.equal(
    tradePairingSideMime("requested"),
    "application/x-mtg-trade-card-requested",
  );
});
