import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryBrowser = readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);

test("inventory table row actions use a compact overflow menu", () => {
  assert.match(
    inventoryBrowser,
    /aria-label=\{`Actions for \$\{row\.original\.cardName\}`\}/,
  );
  assert.match(inventoryBrowser, /View details/);
  assert.match(inventoryBrowser, /Edit inventory/);
  assert.match(inventoryBrowser, /Delete inventory/);
  assert.match(inventoryBrowser, /absolute right-0 z-20/);
  assert.doesNotMatch(
    inventoryBrowser,
    /<button[\s\S]{0,140}>\s*Edit\s*<\/button>/,
  );
  assert.doesNotMatch(
    inventoryBrowser,
    /<button[\s\S]{0,140}>\s*Delete\s*<\/button>/,
  );
});

test("inventory edit workflow exposes stack split and merge controls", () => {
  assert.match(inventoryBrowser, /Copies by location/);
  assert.match(inventoryBrowser, /onSplitInventoryStack/);
  assert.match(inventoryBrowser, /inventoryItemId/);
  assert.match(inventoryBrowser, /Split stack/);
  assert.match(inventoryBrowser, /Save stack/);
  assert.match(inventoryBrowser, /Matching stacks merge automatically/);
  assert.match(inventoryBrowser, /Use deck return/);
  assert.match(inventoryBrowser, /capabilities\.canEdit \? \(/);
});
