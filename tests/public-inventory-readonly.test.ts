import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const globalPublicInventoryPage = fs.readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);
const perUserPublicInventoryPage = fs.readFileSync(
  "app/u/[publicSlug]/inventory/page.tsx",
  "utf8",
);
const inventoryBrowser = fs.readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const loginPage = fs.readFileSync("app/login/page.tsx", "utf8");
const middleware = fs.readFileSync("middleware.ts", "utf8");
const publicCollectionQueries = fs.readFileSync(
  "lib/public-collection.ts",
  "utf8",
);

test("global public inventory page reuses the shared inventory browser in read-only mode", () => {
  assert.match(globalPublicInventoryPage, /<InventoryBrowser/);
  assert.match(globalPublicInventoryPage, /uiMode="public-readonly"/);
  assert.match(inventoryBrowser, /<CardManaCost card=\{row\.original\}/);
  assert.match(
    inventoryBrowser,
    /<ColorIdentityIcons value=\{row\.original\.colorIdentity\}/,
  );
  assert.doesNotMatch(globalPublicInventoryPage, /onBulkMoveLocation=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onBulkDeleteInventory=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onSaveEdit=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onDeleteInventoryItem=/);
});

test("shared inventory browser defines public read-only capabilities", () => {
  assert.match(inventoryBrowser, /public-readonly/);
  assert.match(inventoryBrowser, /canBulkSelect: false/);
  assert.match(inventoryBrowser, /canBulkMove: false/);
  assert.match(inventoryBrowser, /canBulkDelete: false/);
  assert.match(inventoryBrowser, /canViewAuditTrail: false/);
  assert.match(inventoryBrowser, /canViewPrivateSourceInfo: false/);
});

test("public entry points and per-user compatibility route point at global public inventory", () => {
  assert.match(loginPage, /Browse public inventory/);
  assert.match(loginPage, /\/public\/inventory/);
  assert.match(middleware, /"\/public"/);
  assert.match(
    perUserPublicInventoryPage,
    /redirect\(`\/public\/inventory\?owner=/,
  );
});

test("global public inventory query enforces public profile and location visibility server-side", () => {
  assert.match(publicCollectionQueries, /getGlobalPublicInventory/);
  assert.match(publicCollectionQueries, /publicProfileEnabled: true/);
  assert.match(publicCollectionQueries, /publicOwnerVisibilityWhere/);
  assert.match(publicCollectionQueries, /publicInventoryVisibilityWhere/);
  assert.match(publicCollectionQueries, /select:\s*{\s*name: true\s*}/);
  assert.doesNotMatch(publicCollectionQueries, /email:\s*true/);
  assert.doesNotMatch(publicCollectionQueries, /auditLogs:\s*true/);
});
