import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const importPageSource = readFileSync(
  "app/decks/[deckId]/import/page.tsx",
  "utf8",
);
const panelSource = readFileSync("components/DeckActionPanels.tsx", "utf8");
const bannerEditorSource = readFileSync(
  "components/DeckBannerEditor.tsx",
  "utf8",
);
const editorSource = readFileSync("components/DeckListEditor.tsx", "utf8");
const importPanelSource = readFileSync(
  "components/DeckImportPanel.tsx",
  "utf8",
);
const importResolveRoute = readFileSync(
  "app/api/decks/import/resolve/route.ts",
  "utf8",
);
const deckImportHelper = readFileSync("lib/deck-import.ts", "utf8");

test("deck detail page uses compact action panels instead of always-expanded page forms", () => {
  assert.match(pageSource, /<DeckActionPanels/);
  assert.match(pageSource, /Deck builder/);
  assert.match(pageSource, /DeckHealthCard/);
  assert.match(pageSource, /Owned coverage/);
  assert.match(pageSource, /Effective commitment/);
  assert.match(pageSource, /Estimated value/);
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

test("deck detail page uses commander art and hover preview rail", () => {
  assert.match(pageSource, /deckCardArtCrop/);
  assert.match(pageSource, /heroCard/);
  assert.match(pageSource, /backgroundImage/);
  assert.match(pageSource, /backgroundPosition/);
  assert.match(pageSource, /backgroundRepeat/);
  assert.match(pageSource, /heroSize/);
  assert.match(pageSource, /bannerPositionX/);
  assert.match(pageSource, /bannerPositionY/);
  assert.match(pageSource, /bannerZoom/);
  assert.match(pageSource, /DeckBannerEditor/);
  assert.match(bannerEditorSource, /onPointerDown/);
  assert.match(bannerEditorSource, /backgroundSize: foregroundSize/);
  assert.match(bannerEditorSource, /blur-2xl/);
  assert.match(editorSource, /DeckPreviewRail/);
  assert.match(editorSource, /previewRowId/);
  assert.match(editorSource, /setPreviewRowId/);
  assert.match(
    editorSource,
    /onMouseEnter=\{\(\) => props\.setPreviewRowId\(row\.id\)\}/,
  );
  assert.match(editorSource, /Available/);
  assert.match(editorSource, /Committed/);
  assert.match(editorSource, /Locations/);
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
  assert.match(
    pageSource,
    /pasteDecklistHref=\{`\/decks\/\$\{deck\.id\}\/import`\}/,
  );
  assert.match(panelSource, /href: pasteDecklistHref/);
  assert.match(pageSource, /returnCommitted=\{/);
  assert.match(pageSource, /settings=\{/);
  assert.match(pageSource, /deleteDeck=\{/);
  assert.match(panelSource, /activePanel === "add-card"[\s\S]*?\? addCard/);
  assert.match(panelSource, /activePanel === "paste-decklist"/);
  assert.match(panelSource, /activePanel === "settings"/);
});

test("collapsed deck action panels preserve existing form submissions", () => {
  assert.match(pageSource, /<DeckCardPicker/);
  assert.match(pageSource, /Open deck import page/);
  assert.match(pageSource, /\/decks\/\$\{deck\.id\}\/import/);
  assert.match(importPageSource, /<DeckImportPanel deckId=\{deck\.id\} \/>/);
  assert.match(importPageSource, /canManageDeck/);
  assert.match(pageSource, /action=\{returnAllCommittedDeckInventory\}/);
  assert.match(pageSource, /action=\{updateDeck\}/);
  assert.match(pageSource, /name="bracket"/);
  assert.match(bannerEditorSource, /name="bannerPositionX"/);
  assert.match(bannerEditorSource, /name="bannerPositionY"/);
  assert.match(bannerEditorSource, /name="bannerZoom"/);
  assert.match(pageSource, /action=\{deleteDeck\}/);
  assert.match(pageSource, /name="strongConfirmation"/);
  assert.match(pageSource, /name="destinationLocationId"/);
});

test("deck paste review renders after parsing before slower printing resolution", () => {
  assert.match(importPanelSource, /fetchDecklistResolution\("parse"\)/);
  assert.match(importPanelSource, /fetchDecklistResolution\("resolve-lines"/);
  assert.match(importPanelSource, /setLines\(parsed\.lines\)/);
  assert.match(importPanelSource, /Bulk resolution progress/);
  assert.match(importPanelSource, /Resolve unresolved lines/);
  assert.match(importPanelSource, /resolveProgress\.completed/);
  assert.match(importResolveRoute, /body\.mode === "parse"/);
  assert.match(importResolveRoute, /body\.mode === "resolve-lines"/);
  assert.match(importResolveRoute, /buildDeckImportResolution/);
});

test("deck paste bulk resolution exposes owned-first and cheapest fallback policy", () => {
  assert.match(importPanelSource, /Owned printing, then cheapest/);
  assert.match(importPanelSource, /Owned printing only/);
  assert.match(importPanelSource, /Cheapest printing only/);
  assert.match(importPanelSource, /policy: resolutionPolicy/);
  assert.match(importResolveRoute, /cleanResolutionPolicy/);
  assert.match(deckImportHelper, /DeckImportResolutionPolicy/);
  assert.match(deckImportHelper, /policy === "owned-then-cheapest"/);
  assert.match(deckImportHelper, /policy === "owned-only"/);
  assert.match(deckImportHelper, /policy === "cheapest-only"/);
  assert.match(deckImportHelper, /No owned printing was found/);
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
