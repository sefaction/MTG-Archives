import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  formatSetLabel,
  getManaFontClassName,
  getScryfallSetIconUrl,
  parseColorIdentity,
  parseManaCost,
} from "../lib/mtg/symbols";

const manaCostComponent = fs.readFileSync(
  "components/mtg/ManaCost.tsx",
  "utf8",
);
const manaSymbolComponent = fs.readFileSync(
  "components/mtg/ManaSymbol.tsx",
  "utf8",
);
const colorIdentityComponent = fs.readFileSync(
  "components/mtg/ColorIdentitySymbols.tsx",
  "utf8",
);
const rootLayout = fs.readFileSync("app/layout.tsx", "utf8");

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("mana-font package and global CSS are wired", () => {
  assert.equal(typeof packageJson.dependencies["mana-font"], "string");
  assert.match(rootLayout, /import "mana-font\/css\/mana\.css"/);
});

test("mana costs parse common symbols in order with Mana font classes", () => {
  const tokens = parseManaCost("{2}{W}{U}");
  assert.deepEqual(
    tokens.map((token) => token.symbol),
    ["2", "W", "U"],
  );
  assert.deepEqual(
    tokens.map((token) => token.label),
    ["2 generic mana", "white mana", "blue mana"],
  );
  assert.deepEqual(
    tokens.map((token) => token.manaClassName),
    [
      "ms ms-cost ms-shadow ms-2",
      "ms ms-cost ms-shadow ms-w",
      "ms ms-cost ms-shadow ms-u",
    ],
  );
});

test("mana costs parse hybrid and phyrexian symbols", () => {
  const tokens = parseManaCost("{W/U}{2/W}{B/P}{S}{X}");
  assert.deepEqual(
    tokens.map((token) => token.symbol),
    ["W/U", "2/W", "B/P", "S", "X"],
  );
  assert.deepEqual(
    tokens.map((token) => token.manaClassName),
    [
      "ms ms-cost ms-shadow ms-wu",
      "ms ms-cost ms-shadow ms-2w",
      "ms ms-cost ms-shadow ms-bp",
      "ms ms-cost ms-shadow ms-s",
      "ms ms-cost ms-shadow ms-x",
    ],
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

test("unknown mana symbols are preserved as readable fallbacks", () => {
  const tokens = parseManaCost("{CHAOS}{W}");
  assert.equal(tokens[0]?.symbol, "CHAOS");
  assert.equal(tokens[0]?.isKnown, false);
  assert.equal(tokens[0]?.manaClassName, null);
  assert.equal(tokens[0]?.label, "CHAOS mana");
  assert.equal(tokens[1]?.manaClassName, "ms ms-cost ms-shadow ms-w");
});

test("Mana font class mapper matches installed class naming", () => {
  assert.equal(getManaFontClassName("W"), "ms ms-cost ms-shadow ms-w");
  assert.equal(getManaFontClassName("W/U"), "ms ms-cost ms-shadow ms-wu");
  assert.equal(getManaFontClassName("W/P"), "ms ms-cost ms-shadow ms-wp");
  assert.equal(getManaFontClassName("T"), "ms ms-cost ms-shadow ms-tap");
  assert.equal(getManaFontClassName("NOPE"), null);
});

test("color identity parser supports comma, compact, JSON, and array formats", () => {
  assert.deepEqual(
    parseColorIdentity("W,U").map((token) => token.symbol),
    ["W", "U"],
  );
  assert.deepEqual(
    parseColorIdentity("WUBRG").map((token) => token.symbol),
    ["W", "U", "B", "R", "G"],
  );
  assert.deepEqual(
    parseColorIdentity('["W","U"]').map((token) => token.symbol),
    ["W", "U"],
  );
  assert.deepEqual(
    parseColorIdentity(["B", "R"]).map((token) => token.symbol),
    ["B", "R"],
  );
});

test("MTG symbol components render Mana font symbols and fallback text", () => {
  assert.match(manaCostComponent, /parseManaCost/);
  assert.match(manaCostComponent, /<ManaSymbol/);
  assert.match(colorIdentityComponent, /parseColorIdentity/);
  assert.match(colorIdentityComponent, /<ManaSymbol/);
  assert.match(manaSymbolComponent, /data-mana-symbol/);
  assert.match(manaSymbolComponent, /data-mana-fallback/);
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
