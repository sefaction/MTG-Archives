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
const quickCardNameSearch = readFileSync(
  "components/InventoryQuickCardNameSearch.tsx",
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
const deckWorkspace = readFileSync("components/DeckWorkspace.tsx", "utf8");
const deckPage = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const wishlistPage = readFileSync("app/wishlist/page.tsx", "utf8");
const importsPage = readFileSync("app/imports/page.tsx", "utf8");

function assertUsesSharedStyles(source: string, name: string) {
  assert.match(source, /filterStyles/, `${name} imports shared filter styles`);
  assert.match(
    source,
    /filter(Input|Select|Button|PrimaryButton|Textarea|Field|InlineField)Class/,
    `${name} uses shared filter style classes`,
  );
}

test("filter style tokens define the shared theme-aware form language", () => {
  assert.match(filterStyles, /filterInputClass/);
  assert.match(filterStyles, /filterSelectClass/);
  assert.match(filterStyles, /filterOptionClass/);
  assert.match(filterStyles, /filterButtonClass/);
  assert.match(filterStyles, /filterPrimaryButtonClass/);
  assert.match(filterStyles, /var\(--app-control\)/);
  assert.match(filterStyles, /var\(--app-border\)/);
  assert.match(filterStyles, /var\(--app-accent\)/);
  assert.match(filterStyles, /disabled:cursor-not-allowed/);
  assert.match(filterStyles, /placeholder:text-\[var\(--app-muted\)\]/);
  assert.match(
    filterStyles,
    /filterOptionClass =\s*"bg-\[var\(--app-control\)\] text-\[var\(--app-text\)\]"/,
  );
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

test("quick card name search shares the canonical cardName filter", () => {
  assert.match(quickCardNameSearch, /name="cardName"/);
  assert.match(quickCardNameSearch, /value=\{value\}/);
  assert.match(quickCardNameSearch, /setValue\(cardName\)/);
  assert.match(
    quickCardNameSearch,
    /OMITTED_PARAMS = new Set\(\["cardName", "page"\]\)/,
  );
  assert.match(quickCardNameSearch, /next\.set\("cardName", clean\)/);
  assert.match(quickCardNameSearch, /next\.set\("page", "1"\)/);
  assert.match(quickCardNameSearch, /filterInputClass/);
  assert.match(inventorySearch, /name="cardName"/);
  assert.match(inventorySearch, /initialValue=\{first\(params, "cardName"\)\}/);
  assert.match(inventorySearch, /pushWhole\("cardName", "Name"/);
});

test("inventory pages render quick search outside advanced search", () => {
  assert.match(
    inventoryPage,
    /<InventoryQuickCardNameSearch actionPath="\/inventory" params=\{p\} \/>[\s\S]*?<InventoryAdvancedSearch/,
  );
  assert.match(
    publicInventoryPage,
    /<InventoryQuickCardNameSearch actionPath="\/public\/inventory" params=\{p\} \/>[\s\S]*?<InventoryAdvancedSearch/,
  );
});

test("inventory filter controls use shared dark filter styling", () => {
  assertUsesSharedStyles(inventorySearch, "InventoryAdvancedSearch");
  assertUsesSharedStyles(inventoryBrowser, "InventoryBrowser");
  assertUsesSharedStyles(inventoryPage, "inventory page import/export link");
  assertUsesSharedStyles(importsPage, "imports page export controls");
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
  assert.doesNotMatch(inventoryPage, /title="Export Inventory"/);
  assert.match(inventoryBrowser, /Import \/ Export/);
  assert.match(
    inventoryPage,
    /importExportHref=\{user \? importExportHref : undefined\}/,
  );
  assert.match(importsPage, /title="Export Inventory"/);
  assert.match(importsPage, /summary="Download CSV exports"/);
  assert.doesNotMatch(publicInventoryPage, /Export Inventory/);
  assert.doesNotMatch(publicInventoryPage, /onBulkDeleteInventory=/);
});

test("inventory autocomplete and Enter handling apply canonical filters", () => {
  assert.match(quickCardNameSearch, /suggestionsEndpoint/);
  assert.match(quickCardNameSearch, /kind", "cardName"/);
  assert.match(
    quickCardNameSearch,
    /navigateWithCardName\(suggestions\[highlighted\]\.value\)/,
  );
  assert.match(quickCardNameSearch, /onKeyDown=\{handleKeyDown\}/);
  assert.match(inventorySearch, /chooseAndSubmit/);
  assert.match(inventorySearch, /form\?\.requestSubmit\(\)/);
  assert.match(inventorySearch, /addTokenAndSubmit/);
});

test("color identity controls visibly track checkbox changes", () => {
  assert.match(
    inventorySearch,
    /const \[activeColors, setActiveColors\] = useState\(selected\)/,
  );
  assert.match(
    inventorySearch,
    /checked=\{activeColors\.includes\(color\.value\)\}/,
  );
  assert.match(
    inventorySearch,
    /toggleColor\(color\.value, event\.target\.checked\)/,
  );
  assert.match(
    inventorySearch,
    /activeColors\.includes\(color\.value\)[\s\S]*?border-sky-400 bg-sky-950/,
  );
});

test("active filter chips and Clear Filters render outside collapsed advanced search", () => {
  assert.match(
    inventorySearch,
    /activeChips\.length \? \([\s\S]*?<FilterChipBar chips=\{activeChips\} \/>[\s\S]*?Clear Filters[\s\S]*?<CollapsiblePanel/,
  );
  assert.match(inventorySearch, /aria-label="Active filters"/);
  assert.match(inventorySearch, /href=\{chip\.href\}/);
  assert.match(
    inventoryPage,
    /if \(p\.sort\) clearFilterParams\.set\("sort", String\(p\.sort\)\)/,
  );
  assert.match(
    publicInventoryPage,
    /if \(p\.sort\) clearFilterParams\.set\("sort", String\(p\.sort\)\)/,
  );
});

test("deck and wishlist filter controls use shared filter styles", () => {
  assertUsesSharedStyles(deckListEditor, "DeckListEditor");
  assertUsesSharedStyles(deckPage, "deck detail page");
  assertUsesSharedStyles(deckWorkspace, "decks workspace");
  assertUsesSharedStyles(wishlistPage, "wishlist page");
});
