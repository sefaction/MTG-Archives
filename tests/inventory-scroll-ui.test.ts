import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryBrowser = readFileSync("components/InventoryBrowser.tsx", "utf8");
const quickSearch = readFileSync(
  "components/InventoryQuickCardNameSearch.tsx",
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
