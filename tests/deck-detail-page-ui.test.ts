import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const panelSource = readFileSync("components/DeckActionPanels.tsx", "utf8");
const importPanelSource = readFileSync(
  "components/DeckImportPanel.tsx",
  "utf8",
);
const importResolveRoute = readFileSync(
  "app/api/decks/import/resolve/route.ts",
  "utf8",
);

test("deck detail page uses compact action panels instead of always-expanded page forms", () => {
  assert.match(pageSource, /<DeckActionPanels/);
  assert.match(pageSource, /Deck builder/);
  assert.match(pageSource, /Exact owned/);
  assert.match(pageSource, /Est\. value/);
  assert.doesNotMatch(
    pageSource,
    /<section className="grid gap-4 lg:grid-cols-2">/,
  );
  assert.doesNotMatch(pageSource, /<a href="#safe-delete"/);
  assert.match(
    panelSource,
    /useState<DeckActionPanelId \| null>\([\s\S]*?null,[\s\S]*?\)/,
  );
  assert.match(panelSource, /role="dialog" aria-modal="true"/);
  assert.match(panelSource, /aria-label="Deck action panels"/);
  assert.match(panelSource, /Escape/);
  assert.match(
    panelSource,
    /<summary[\s\S]*?>[\s\S]*Actions[\s\S]*?<\/summary>/,
  );
  assert.match(pageSource, /actionControls=\{/);
});

test("deck action toolbar exposes compact entry points for page-level workflows", () => {
  for (const label of [
    "Add card",
    "Paste decklist",
    "Return committed",
    "Deck settings",
    "Delete deck",
  ]) {
    assert.match(panelSource, new RegExp(label));
  }
  assert.match(pageSource, /addCard=\{/);
  assert.match(pageSource, /pasteDecklist=\{/);
  assert.match(pageSource, /returnCommitted=\{/);
  assert.match(pageSource, /settings=\{/);
  assert.match(pageSource, /deleteDeck=\{/);
  assert.match(panelSource, /activePanel === "add-card"[\s\S]*?\? addCard/);
  assert.match(panelSource, /activePanel === "paste-decklist"/);
  assert.match(panelSource, /activePanel === "settings"/);
});

test("collapsed deck action panels preserve existing form submissions", () => {
  assert.match(pageSource, /<DeckCardPicker/);
  assert.match(pageSource, /<DeckImportPanel deckId=\{deck\.id\} \/>/);
  assert.match(pageSource, /action=\{returnAllCommittedDeckInventory\}/);
  assert.match(pageSource, /action=\{updateDeck\}/);
  assert.match(pageSource, /name="bracket"/);
  assert.match(pageSource, /action=\{deleteDeck\}/);
  assert.match(pageSource, /name="strongConfirmation"/);
  assert.match(pageSource, /name="destinationLocationId"/);
});

test("deck paste review renders after parsing before slower printing resolution", () => {
  assert.match(importPanelSource, /fetchDecklistResolution\("parse"\)/);
  assert.match(importPanelSource, /fetchDecklistResolution\("resolve"\)/);
  assert.match(importPanelSource, /setLines\(parsed\.lines\)/);
  assert.match(
    importPanelSource,
    /Review ready\. Resolving local and Scryfall printing matches/,
  );
  assert.match(importResolveRoute, /body\.mode === "parse"/);
  assert.match(importResolveRoute, /buildDeckImportResolution/);
});

test("deck detail inventory loading is scoped and avoids full owner inventory hydration", () => {
  assert.doesNotMatch(
    pageSource,
    /where:\s*\{\s*currentOwnerId:\s*inventoryOwnerId,\s*quantity:\s*\{\s*gt:\s*0\s*\}\s*\}\s*,\s*include:\s*\{\s*card:\s*true,\s*location:\s*true\s*\}/,
  );
  assert.match(pageSource, /OR: inventoryWhereClauses/);
  assert.match(
    pageSource,
    /select:\s*\{[\s\S]*cardId: true[\s\S]*quantity: true/,
  );
  assert.match(
    pageSource,
    /byCardId: new Map<string, DeckPageInventoryItem\[\]>/,
  );
  assert.match(pageSource, /candidatesForDeckCard\(deckCard, inventoryMaps\)/);
  assert.match(pageSource, /DEBUG_DECK_PERFORMANCE/);
});
