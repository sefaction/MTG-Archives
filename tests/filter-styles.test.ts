import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const filterStyles = readFileSync("components/filterStyles.ts", "utf8");
const collapsiblePanel = readFileSync(
  "components/CollapsiblePanel.tsx",
  "utf8",
);
const inventorySearch = readFileSync(
  "components/InventoryAdvancedSearch.tsx",
  "utf8",
);
const inventoryBrowser = readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
const publicInventoryPage = readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);
const deckListEditor = readFileSync("components/DeckListEditor.tsx", "utf8");
const deckPage = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const decksPage = readFileSync("app/decks/page.tsx", "utf8");
const wishlistPage = readFileSync("app/wishlist/page.tsx", "utf8");

function assertUsesSharedStyles(source: string, name: string) {
  assert.match(source, /filterStyles/, `${name} imports shared filter styles`);
  assert.match(
    source,
    /filter(Input|Select|Button|PrimaryButton|Textarea|Field|InlineField)Class/,
    `${name} uses shared filter style classes`,
  );
}

test("filter style tokens define the shared dark form language", () => {
  assert.match(filterStyles, /filterInputClass/);
  assert.match(filterStyles, /filterSelectClass/);
  assert.match(filterStyles, /filterOptionClass/);
  assert.match(filterStyles, /filterButtonClass/);
  assert.match(filterStyles, /filterPrimaryButtonClass/);
  assert.match(filterStyles, /bg-zinc-900/);
  assert.match(filterStyles, /border-zinc-700/);
  assert.match(filterStyles, /focus:border-sky-500/);
  assert.match(filterStyles, /disabled:cursor-not-allowed/);
  assert.match(filterStyles, /placeholder:text-zinc-500/);
  assert.match(filterStyles, /filterOptionClass = "bg-zinc-900 text-zinc-100"/);
});

test("collapsible panels use accessible shared dark styling", () => {
  assert.match(collapsiblePanel, /filterPanelClass/);
  assert.match(collapsiblePanel, /type="button"/);
  assert.match(collapsiblePanel, /aria-expanded=\{open\}/);
  assert.match(collapsiblePanel, /aria-controls=\{panelId\}/);
  assert.match(collapsiblePanel, /id=\{panelId\}/);
  assert.match(collapsiblePanel, /hidden=\{!open\}/);
  assert.match(collapsiblePanel, /focus:ring-2/);
});

test("inventory filter controls use shared dark filter styling", () => {
  assertUsesSharedStyles(inventorySearch, "InventoryAdvancedSearch");
  assertUsesSharedStyles(inventoryBrowser, "InventoryBrowser");
  assertUsesSharedStyles(inventoryPage, "inventory page export controls");
  assert.match(
    inventorySearch,
    /name=\{ownerParamName\}[\s\S]*?className=\{cn\(filterSelectClass, "min-w-32"\)\}/,
  );
  assert.match(
    inventorySearch,
    /name=\{ownerParamName\}[\s\S]*?<option className=\{filterOptionClass\}/,
  );
  assert.match(inventorySearch, /label="Location"/);
  assert.match(
    inventorySearch,
    /name="commitment"[\s\S]*?className=\{cn\(filterSelectClass, "min-w-32"\)\}/,
  );
  assert.match(inventorySearch, /value="available"[\s\S]*?Available/);
  assert.match(inventorySearch, /value="committed"[\s\S]*?Committed/);
  assert.match(
    inventorySearch,
    /name="commitment"[\s\S]*?<option className=\{filterOptionClass\} value="available"/,
  );
  assert.match(inventoryBrowser, /Display:/);
  assert.match(inventoryBrowser, /Page size:/);
  assert.match(inventoryBrowser, /Browsing mode:/);
});

test("public inventory keeps owner/location filters while using shared styling", () => {
  assert.match(publicInventoryPage, /ownerFilterLabel="Current owner"/);
  assert.match(publicInventoryPage, /locationParamName="locationName"/);
  assert.match(inventorySearch, /showOwnerFilter: isPublic/);
  assert.match(
    inventoryPage,
    /<CollapsiblePanel[\s\S]*?title="Export Inventory"/,
  );
  assert.match(inventoryPage, /summary="Download CSV exports"/);
  assert.doesNotMatch(publicInventoryPage, /Export Inventory/);
  assert.doesNotMatch(publicInventoryPage, /onBulkDeleteInventory=/);
});

test("deck and wishlist filter controls use shared filter styles", () => {
  assertUsesSharedStyles(deckListEditor, "DeckListEditor");
  assertUsesSharedStyles(deckPage, "deck detail page");
  assertUsesSharedStyles(decksPage, "decks page");
  assertUsesSharedStyles(wishlistPage, "wishlist page");
});
