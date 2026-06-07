import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publicInventoryPage = fs.readFileSync(
  "app/u/[publicSlug]/inventory/page.tsx",
  "utf8",
);
const inventoryBrowser = fs.readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);

test("public inventory page reuses the shared inventory browser in read-only mode", () => {
  assert.match(publicInventoryPage, /<InventoryBrowser/);
  assert.match(publicInventoryPage, /uiMode="public-readonly"/);
  assert.doesNotMatch(publicInventoryPage, /onBulkMoveLocation=/);
  assert.doesNotMatch(publicInventoryPage, /onBulkDeleteInventory=/);
  assert.doesNotMatch(publicInventoryPage, /onSaveEdit=/);
  assert.doesNotMatch(publicInventoryPage, /onDeleteInventoryItem=/);
});

test("shared inventory browser defines public read-only capabilities", () => {
  assert.match(inventoryBrowser, /public-readonly/);
  assert.match(inventoryBrowser, /canBulkSelect: false/);
  assert.match(inventoryBrowser, /canBulkMove: false/);
  assert.match(inventoryBrowser, /canBulkDelete: false/);
  assert.match(inventoryBrowser, /canViewAuditTrail: false/);
  assert.match(inventoryBrowser, /canViewPrivateSourceInfo: false/);
});
