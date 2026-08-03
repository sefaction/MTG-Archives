import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TRADE_ACTION_NOTE_LENGTH,
  normalizeTradeActionNote,
} from "../lib/trade-notes";

test("trade action notes trim user text and preserve useful line breaks", () => {
  assert.equal(
    normalizeTradeActionNote("  First line\nSecond line  ", "Fallback"),
    "First line\nSecond line",
  );
});

test("blank trade action notes use the supplied fallback", () => {
  assert.equal(
    normalizeTradeActionNote("   ", "Trade declined."),
    "Trade declined.",
  );
  assert.equal(
    normalizeTradeActionNote(null, "Trade declined."),
    "Trade declined.",
  );
});

test("trade action notes are bounded before persistence and notification", () => {
  const result = normalizeTradeActionNote(
    "x".repeat(MAX_TRADE_ACTION_NOTE_LENGTH + 50),
    "Fallback",
  );
  assert.equal(result.length, MAX_TRADE_ACTION_NOTE_LENGTH);
});
