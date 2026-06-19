import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tradesPage = readFileSync("app/trades/page.tsx", "utf8");
const tradeBuilder = readFileSync("components/TradeBuilder.tsx", "utf8");

test("trades page renders the searchable trade builder instead of active inventory dropdowns", () => {
  assert.match(tradesPage, /<TradeBuilder/);
  assert.match(tradesPage, /offerItems=\{myInventory\.map\(toTradeBuilderItem\)\}/);
  assert.match(
    tradesPage,
    /requestItems=\{partnerInventory\.map\(toTradeBuilderItem\)\}/,
  );
  assert.match(tradesPage, /\{false \? \(/);
});

test("trade builder keeps existing 1-for-1 server action fields", () => {
  assert.match(tradeBuilder, /"use client"/);
  assert.match(tradeBuilder, /You offer/);
  assert.match(tradeBuilder, /You receive/);
  assert.match(tradeBuilder, /Your inventory/);
  assert.match(tradeBuilder, /Their inventory/);
  assert.match(tradeBuilder, /Search cards/);
  assert.match(tradeBuilder, /name="offeredInventoryItemId"/);
  assert.match(tradeBuilder, /name="requestedInventoryItemId"/);
  assert.match(tradeBuilder, /name="receiverPlayerId"/);
  assert.match(tradeBuilder, /future multi-card queue/);
});
