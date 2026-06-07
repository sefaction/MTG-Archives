import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inventoryPage = fs.readFileSync("app/inventory/page.tsx", "utf8");
const publicInventoryQueries = fs.readFileSync(
  "lib/public-collection.ts",
  "utf8",
);
const inventoryBrowser = fs.readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");

test("authenticated inventory list uses bounded server-side raw row paging", () => {
  assert.match(inventoryPage, /rawPageSize/);
  assert.match(inventoryPage, /skip:\s*rawSkip/);
  assert.match(inventoryPage, /take:\s*rawPageSize \+ 1/);
  assert.match(inventoryPage, /hasNextPage/);
  assert.match(inventoryPage, /\[inventory-list\] paged query diagnostics/);
  assert.doesNotMatch(inventoryPage, /auditLogs:\s*{/);
});

test("global public inventory query is bounded and logs slow public chunks", () => {
  assert.match(publicInventoryQueries, /rawPageSize/);
  assert.match(publicInventoryQueries, /skip:\s*\(page - 1\) \* rawPageSize/);
  assert.match(publicInventoryQueries, /take:\s*rawPageSize \+ 1/);
  assert.match(
    publicInventoryQueries,
    /\[public-inventory-list\] paged query diagnostics/,
  );
  assert.match(publicInventoryQueries, /hasNextPage/);
});

test("inventory card images use lazy asynchronous loading with dimensions", () => {
  assert.match(inventoryBrowser, /loading="lazy"/);
  assert.match(inventoryBrowser, /decoding="async"/);
  assert.match(inventoryBrowser, /width=\{240\}/);
  assert.match(inventoryBrowser, /height=\{336\}/);
  assert.match(inventoryBrowser, /width=\{265\}/);
  assert.match(inventoryBrowser, /height=\{370\}/);
});

test("schema includes indexes for paged inventory and public visibility queries", () => {
  assert.match(schema, /@@index\(\[currentOwnerId, quantity, createdAt\]\)/);
  assert.match(schema, /@@index\(\[locationId, quantity\]\)/);
  assert.match(schema, /@@index\(\[cardId, quantity\]\)/);
  assert.match(schema, /@@index\(\[ownerPlayerId, visibility, active\]\)/);
  assert.match(
    schema,
    /@@index\(\[publicProfileEnabled, isActive, inventoryDefaultVisibility\]\)/,
  );
});
