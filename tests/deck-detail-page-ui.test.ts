import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const panelSource = readFileSync("components/DeckActionPanels.tsx", "utf8");

test("deck detail page uses compact action panels instead of always-expanded page forms", () => {
  assert.match(pageSource, /<DeckActionPanels/);
  assert.doesNotMatch(
    pageSource,
    /<section className="grid gap-4 lg:grid-cols-2">/,
  );
  assert.doesNotMatch(pageSource, /<a href="#safe-delete"/);
  assert.match(panelSource, /useState<DeckActionPanelId>\(null\)/);
  assert.match(
    panelSource,
    /setActivePanel\(\(current\) => \(current === panel \? null : panel\)\)/,
  );
  assert.match(
    panelSource,
    /Open an action only when needed; the deck list stays visible below\./,
  );
});

test("deck action toolbar exposes compact entry points for page-level workflows", () => {
  for (const label of [
    "Add card",
    "Paste decklist",
    "Return committed",
    "Deck settings",
    "More: Delete deck",
  ]) {
    assert.match(panelSource, new RegExp(label));
  }
  assert.match(pageSource, /addCard=\{/);
  assert.match(pageSource, /pasteDecklist=\{/);
  assert.match(pageSource, /returnCommitted=\{/);
  assert.match(pageSource, /settings=\{/);
  assert.match(pageSource, /deleteDeck=\{/);
});

test("collapsed deck action panels preserve existing form submissions", () => {
  assert.match(pageSource, /<DeckCardPicker/);
  assert.match(pageSource, /<DeckImportPanel deckId=\{deck\.id\} \/>/);
  assert.match(pageSource, /action=\{returnAllCommittedDeckInventory\}/);
  assert.match(pageSource, /action=\{updateDeck\}/);
  assert.match(pageSource, /action=\{deleteDeck\}/);
  assert.match(pageSource, /name="strongConfirmation"/);
  assert.match(pageSource, /name="destinationLocationId"/);
});
