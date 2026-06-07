import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSetLabel,
  getScryfallSetIconUrl,
  parseColorIdentity,
  parseManaCost,
} from "../lib/mtg/symbols";

test("mana costs parse common symbols in order", () => {
  const tokens = parseManaCost("{2}{W}{U}");
  assert.deepEqual(
    tokens.map((token) => token.symbol),
    ["2", "W", "U"],
  );
  assert.deepEqual(
    tokens.map((token) => token.label),
    ["2 generic mana", "white mana", "blue mana"],
  );
});

test("mana costs parse hybrid and phyrexian symbols", () => {
  const tokens = parseManaCost("{W/U}{B/P}{S}{X}");
  assert.deepEqual(
    tokens.map((token) => token.symbol),
    ["W/U", "B/P", "S", "X"],
  );
  assert.equal(
    tokens.every((token) => token.isKnown),
    true,
  );
});

test("mana parser handles empty and malformed values gracefully", () => {
  assert.deepEqual(parseManaCost(null), []);
  assert.deepEqual(parseManaCost(""), []);
  assert.deepEqual(parseManaCost("not a mana cost"), []);
});

test("color identity parser supports comma and compact formats", () => {
  assert.deepEqual(
    parseColorIdentity("W,U").map((token) => token.symbol),
    ["W", "U"],
  );
  assert.deepEqual(
    parseColorIdentity("WUBRG").map((token) => token.symbol),
    ["W", "U", "B", "R", "G"],
  );
});

test("set icon helper resolves safe Scryfall set icon URLs and rejects unsafe codes", () => {
  assert.equal(
    getScryfallSetIconUrl("CMM"),
    "https://svgs.scryfall.io/sets/cmm.svg",
  );
  assert.equal(getScryfallSetIconUrl("../bad"), null);
  assert.equal(getScryfallSetIconUrl(""), null);
});

test("set labels retain readable fallback text", () => {
  assert.equal(
    formatSetLabel("CMM", "Commander Masters"),
    "Commander Masters (CMM)",
  );
  assert.equal(formatSetLabel("xyz", null), "XYZ");
  assert.equal(formatSetLabel(null, null), "Unknown set");
});
