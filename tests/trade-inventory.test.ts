import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FoilStatus } from "@prisma/client";
import { receivedTradeInventoryData } from "../lib/trade-inventory";

test("trade receipts preserve original provenance and physical attributes", () => {
  const source = {
    id: "must-not-copy",
    currentOwnerId: "sender",
    locationId: "source-location",
    locationSection: "Sect 4",
    cardId: "exact-printing",
    originalOpenerId: "original-opener",
    foil: true,
    foilStatus: FoilStatus.ETCHED,
    condition: "LP",
    language: "JA",
    roundId: "original-round",
    acquiredFromPullId: "original-pull",
    notes: "Distinct ink mark",
    quantity: 8,
    sourceType: "PULL",
    auditLogs: [],
  };
  assert.deepEqual(
    receivedTradeInventoryData(source, 2, "receiver", "destination"),
    {
      cardId: "exact-printing",
      originalOpenerId: "original-opener",
      foil: true,
      foilStatus: "ETCHED",
      condition: "LP",
      language: "JA",
      roundId: "original-round",
      acquiredFromPullId: "original-pull",
      notes: "Distinct ink mark",
      currentOwnerId: "receiver",
      quantity: 2,
      sourceType: "TRADE",
      locationId: "destination",
      locationSection: null,
    },
  );
  assert.equal(source.quantity, 8);
});

test("trade receipts preserve missing provenance fields without inventing an origin", () => {
  const result = receivedTradeInventoryData(
    {
      cardId: "printing",
      originalOpenerId: "sender",
      foil: false,
      foilStatus: FoilStatus.NONFOIL,
      condition: "NM",
      language: "EN",
      roundId: null,
      acquiredFromPullId: null,
      notes: null,
    },
    1,
    "receiver",
    "destination",
  );
  assert.equal(result.originalOpenerId, "sender");
  assert.equal(result.roundId, null);
  assert.equal(result.acquiredFromPullId, null);
  assert.equal(result.notes, null);
});

test("trade receipt path creates a separate lot instead of changing existing stacks", () => {
  const source = readFileSync("app/trades/actions.ts", "utf8");
  const receipt = source.slice(
    source.indexOf("async function addToReceiver("),
    source.indexOf("async function completeTradeIfReady("),
  );
  assert.match(receipt, /receivedTradeInventoryData\(\s*item,/);
  assert.doesNotMatch(receipt, /inventoryItem\.(findFirst|update)/);
});
