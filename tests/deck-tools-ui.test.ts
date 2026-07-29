import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const snapshotSource = readFileSync("lib/deck-snapshot.ts", "utf8");
const analysisPage = readFileSync(
  "app/decks/[deckId]/analysis/page.tsx",
  "utf8",
);
const builderPage = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const navigation = readFileSync("components/DeckToolsNav.tsx", "utf8");
const chart = readFileSync("components/ManaCurveAnalysis.tsx", "utf8");

test("deck snapshot applies existing visibility policy and selects presentation-safe data", () => {
  assert.match(snapshotSource, /canViewDeck\(user, deck, adminModeEnabled\)/);
  assert.match(snapshotSource, /loadVisibleDeckSnapshot/);
  assert.match(snapshotSource, /publicProfileEnabled: true/);
  assert.match(snapshotSource, /deckDefaultVisibility: true/);
  assert.match(snapshotSource, /manaValue: true/);
  assert.match(snapshotSource, /cardFaces: true/);
  assert.doesNotMatch(snapshotSource, /inventoryItems/);
  assert.doesNotMatch(snapshotSource, /locationId/);
  assert.doesNotMatch(snapshotSource, /committed/);
});

test("builder and analysis share coherent deck tools navigation", () => {
  assert.match(
    builderPage,
    /<DeckToolsNav deckId=\{deck\.id\} active="builder"/,
  );
  assert.match(
    analysisPage,
    /<DeckToolsNav deckId=\{deck\.id\} active="analysis"/,
  );
  assert.match(navigation, /Builder/);
  assert.match(navigation, /Analysis/);
  assert.match(navigation, /Sample Hands/);
  assert.match(navigation, /Playtest/);
  assert.match(navigation, /aria-disabled="true"/);
  assert.match(navigation, /aria-current=/);
});

test("analysis screen has interactive SVG and accessible table views", () => {
  assert.match(chart, /<svg/);
  assert.match(chart, /role="img"/);
  assert.match(chart, /role="button"/);
  assert.match(chart, /tabIndex=\{0\}/);
  assert.match(chart, /event\.key === "Enter"/);
  assert.match(chart, /Accessible curve table/);
  assert.match(chart, /aria-pressed=/);
  assert.match(chart, /Include commander/);
  assert.match(chart, /Select a chart bar or table row/);
  assert.match(analysisPage, /Sideboard and maybeboard/);
});

test("selected curve cards support compact, detailed, grid, and spoiler views", () => {
  assert.match(chart, /Compact text/);
  assert.match(chart, /Detailed table/);
  assert.match(chart, /Visual grid/);
  assert.match(chart, /Visual spoiler/);
  assert.match(chart, /Card view/);
  assert.match(chart, /getInventoryCardImagePair/);
  assert.match(chart, /function AnalysisCardImage/);
  assert.match(chart, /Show back face/);
  assert.match(chart, /CardManaCost/);
});

test("mana value summary wording is consistent and visually compact", () => {
  assert.match(chart, /Average mana value/);
  assert.match(chart, /Median mana value/);
  assert.match(chart, /Total mana value/);
  assert.doesNotMatch(chart, /Average MV|Median MV/);
  assert.match(chart, /text-lg font-semibold text-stone-50/);
  assert.doesNotMatch(chart, /text-2xl font-semibold text-stone-50/);
});
