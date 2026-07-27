import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cardImport = readFileSync("lib/card-import.ts", "utf8");
const deckSearch = readFileSync("lib/deck-search.ts", "utf8");

const printingSearchSurfaces = [
  "components/DeckCardPicker.tsx",
  "components/DeckImportPanel.tsx",
  "components/InventoryBrowser.tsx",
  "components/SingleCardInventoryAdd.tsx",
  "components/WishlistSearchAdd.tsx",
  "components/WishlistTable.tsx",
  "app/imports/page.tsx",
].map((path) => [path, readFileSync(path, "utf8")] as const);

test("shared printing searches pass Scryfall syntax through to Scryfall", () => {
  for (const source of [cardImport, deckSearch]) {
    assert.match(source, /hasScryfallSearchSyntax/);
    assert.match(source, /searchCardPrintsResult/);
    assert.match(source, /useScryfallSyntax\s*\?/);
  }
  assert.match(
    deckSearch,
    /useScryfallSyntax \|\| input\.includeScryfall \|\| local\.length < 8/,
  );
});

test("printing search surfaces advertise the shared Scryfall query contract", () => {
  for (const [path, source] of printingSearchSurfaces) {
    assert.match(
      source,
      /command tower set:c20|Card name or Scryfall query/,
      `${path} should explain Scryfall query support`,
    );
  }

  const deckPrintingChooser = readFileSync(
    "components/DeckPrintingChooser.tsx",
    "utf8",
  );
  assert.match(deckPrintingChooser, /q: cardName/);
  assert.doesNotMatch(deckPrintingChooser, /Card name or Scryfall query/);
});
