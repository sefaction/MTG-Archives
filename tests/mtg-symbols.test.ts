import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getDisplayManaCosts,
  getManaFacesForDto,
  getManaCostSeparatorText,
} from "../lib/mtg/mana-display";

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
const globalStyles = fs.readFileSync("app/globals.css", "utf8");
const cardSymbolsComponent = fs.readFileSync(
  "components/mtg/CardSymbols.tsx",
  "utf8",
);

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

test("MTG symbol components render aligned Mana font symbols and fallback text", () => {
  assert.match(manaCostComponent, /parseManaCost/);
  assert.match(
    manaCostComponent,
    /className="mtg-symbol-group flex-wrap gap-0\.5"/,
  );
  assert.match(manaCostComponent, /text-zinc-500">-<\/span>/);
  assert.match(manaCostComponent, /<ManaSymbol[\s\S]*ariaHidden/);
  assert.match(colorIdentityComponent, /parseColorIdentity/);
  assert.match(
    colorIdentityComponent,
    /className="mtg-symbol-group flex-wrap gap-0\.5"/,
  );
  assert.match(colorIdentityComponent, /text-zinc-500">-<\/span>/);
  assert.match(colorIdentityComponent, /<ManaSymbol[\s\S]*ariaHidden/);
  assert.match(manaSymbolComponent, /mtg-mana-symbol/);
  assert.match(manaSymbolComponent, /data-mana-symbol/);
  assert.match(manaSymbolComponent, /data-mana-fallback/);
  assert.match(globalStyles, /\.mtg-mana-symbol[\s\S]*align-items: center/);
  assert.match(globalStyles, /\.mtg-mana-symbol\.ms-cost[\s\S]*height: 1\.3em/);
});

test("set symbol component renders icons and text in an aligned wrapper", () => {
  assert.match(
    cardSymbolsComponent,
    /className="mtg-set-symbol-group gap-1\.5"/,
  );
  assert.match(cardSymbolsComponent, /"mtg-set-symbol mtg-set-symbol-mask"/);
  assert.match(cardSymbolsComponent, /className\?: string/);
  assert.match(cardSymbolsComponent, /symbolClassName\?: string/);
  assert.match(cardSymbolsComponent, /<span>\{code\}<\/span>/);
  assert.match(
    globalStyles,
    /\.mtg-set-symbol-group[\s\S]*align-items: center/,
  );
  assert.match(globalStyles, /\.mtg-set-symbol[\s\S]*height: 1\.1em/);
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

const cardManaCostComponent = fs.readFileSync(
  "components/mtg/CardManaCost.tsx",
  "utf8",
);

// Face-aware mana tests intentionally use lightweight DTO-shaped objects so
// inventory pages never need raw Scryfall JSON in browser rows.
test("face-aware mana costs prefer normal top-level costs", () => {
  assert.deepEqual(getDisplayManaCosts({ manaCost: "{2}{W}" }), {
    kind: "single",
    manaCost: "{2}{W}",
  });
});

test("face-aware mana costs fall back to the first card face cost", () => {
  assert.deepEqual(
    getDisplayManaCosts({
      manaCost: "",
      layout: "transform",
      manaFaces: [
        { name: "Aang, Swift Savior", manaCost: "{1}{W}" },
        { name: "Aang and La, Ocean's Fury", manaCost: "" },
      ],
    }),
    { kind: "single", manaCost: "{1}{W}" },
  );
});

test("face-aware mana costs separate MDFC, split, and adventure costs", () => {
  assert.deepEqual(
    getDisplayManaCosts({
      layout: "modal_dfc",
      manaFaces: [
        { name: "Front", manaCost: "{2}{G}" },
        { name: "Back", manaCost: "{1}{U}" },
      ],
    }),
    {
      kind: "faces",
      separator: "modal",
      faces: [
        { name: "Front", manaCost: "{2}{G}" },
        { name: "Back", manaCost: "{1}{U}" },
      ],
    },
  );
  assert.equal(getManaCostSeparatorText("modal"), "//");
  assert.equal(
    getDisplayManaCosts({
      layout: "split",
      manaFaces: [{ manaCost: "{R}" }, { manaCost: "{G}" }],
    }).kind,
    "faces",
  );
  assert.equal(
    getDisplayManaCosts({
      layout: "adventure",
      manaFaces: [{ manaCost: "{1}{W}{W}" }, { manaCost: "{1}{W}" }],
    }).kind,
    "faces",
  );
});

test("face-aware mana costs show a dash when no cost exists and tolerate malformed face data", () => {
  assert.deepEqual(getDisplayManaCosts({ manaCost: null, cardFaces: null }), {
    kind: "none",
  });
  assert.deepEqual(
    getManaFacesForDto([null, "bad", { name: "Face", mana_cost: "{U}" }]),
    [{ name: "Face", manaCost: "{U}" }],
  );
});

test("CardManaCost component renders Mana font costs with a visible face separator", () => {
  assert.match(cardManaCostComponent, /getDisplayManaCosts/);
  assert.match(cardManaCostComponent, /<ManaCost value=\{face\.manaCost\}/);
  assert.match(cardManaCostComponent, /mtg-face-mana-separator/);
  assert.match(cardManaCostComponent, /showFaceNames/);
  assert.match(globalStyles, /\.mtg-face-mana-costs[\s\S]*align-items: center/);
});

test("set symbol rarity classes cover Scryfall rarities and graceful fallbacks", () => {
  assert.match(cardSymbolsComponent, /common: "mtg-set-symbol-rarity-common"/);
  assert.match(
    cardSymbolsComponent,
    /uncommon: "mtg-set-symbol-rarity-uncommon"/,
  );
  assert.match(cardSymbolsComponent, /rare: "mtg-set-symbol-rarity-rare"/);
  assert.match(cardSymbolsComponent, /mythic: "mtg-set-symbol-rarity-mythic"/);
  assert.match(cardSymbolsComponent, /bonus: "mtg-set-symbol-rarity-rare"/);
  assert.match(cardSymbolsComponent, /special: "mtg-set-symbol-rarity-rare"/);
  assert.match(cardSymbolsComponent, /mtg-set-symbol-rarity-common/);
  assert.match(cardSymbolsComponent, /mtg-set-symbol-mask/);
  assert.match(globalStyles, /\.mtg-set-symbol-rarity-rare/);
});
