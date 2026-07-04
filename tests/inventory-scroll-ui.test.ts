import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryBrowser = readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const quickSearch = readFileSync(
  "components/InventoryQuickCardNameSearch.tsx",
  "utf8",
);
const advancedSearch = readFileSync(
  "components/InventoryAdvancedSearch.tsx",
  "utf8",
);
const collapsiblePanel = readFileSync(
  "components/CollapsiblePanel.tsx",
  "utf8",
);

test("inventory control query updates preserve scroll position", () => {
  assert.match(inventoryBrowser, /INVENTORY_SCROLL_STORAGE_KEY/);
  assert.match(inventoryBrowser, /rememberScrollPosition/);
  assert.match(inventoryBrowser, /window\.sessionStorage\.setItem/);
  assert.match(inventoryBrowser, /window\.sessionStorage\.removeItem/);
  assert.match(
    inventoryBrowser,
    /window\.requestAnimationFrame\(\(\) => window\.scrollTo\(0, scrollY\)\)/,
  );
  assert.match(
    inventoryBrowser,
    /router\.replace\(`\$\{window\.location\.pathname\}\?\$\{params\.toString\(\)\}`, \{\s*scroll: false,\s*\}\)/,
  );
});

test("quick inventory search uses client navigation without scroll reset", () => {
  assert.match(quickSearch, /useRouter/);
  assert.match(quickSearch, /INVENTORY_SCROLL_STORAGE_KEY/);
  assert.match(quickSearch, /window\.sessionStorage\.setItem/);
  assert.match(
    quickSearch,
    /router\.replace\(buildUrl\(nextCardName\), \{ scroll: false \}\)/,
  );
  assert.doesNotMatch(quickSearch, /window\.location\.assign/);
});

test("advanced inventory search preserves scroll and expanded state on submit", () => {
  assert.match(advancedSearch, /useRouter/);
  assert.match(advancedSearch, /ADVANCED_SEARCH_PANEL_STORAGE_KEY/);
  assert.match(advancedSearch, /INVENTORY_SCROLL_STORAGE_KEY/);
  assert.match(advancedSearch, /onSubmit=\{handleSubmit\}/);
  assert.match(advancedSearch, /event\.preventDefault\(\)/);
  assert.match(
    advancedSearch,
    /router\.replace\(query \? `\$\{actionPath\}\?\$\{query\}` : actionPath, \{\s*scroll: false,\s*\}\)/,
  );
  assert.match(collapsiblePanel, /storageKey\?: string/);
  assert.match(
    collapsiblePanel,
    /window\.sessionStorage\.getItem\(storageKey\)/,
  );
  assert.match(collapsiblePanel, /window\.sessionStorage\.setItem/);
});
