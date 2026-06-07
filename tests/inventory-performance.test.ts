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
const inventoryListApi = fs.readFileSync(
  "app/api/inventory/list/route.ts",
  "utf8",
);
const publicInventoryListApi = fs.readFileSync(
  "app/api/public/inventory/list/route.ts",
  "utf8",
);

test("authenticated inventory list uses one server-side page source of truth", () => {
  assert.match(inventoryPage, /queryPageSize = initialPageSize/);
  assert.match(inventoryPage, /skip: querySkip/);
  assert.match(inventoryPage, /take: queryPageSize/);
  assert.match(
    inventoryPage,
    /totalPages = Math\.max\(1, Math\.ceil\(totalMatchingCount \/ queryPageSize\)\)/,
  );
  assert.match(inventoryPage, /server-side page query diagnostics/);
  assert.doesNotMatch(
    inventoryPage,
    /rawPageSize|rawSkip|rawRowsLoaded|Server page|Previous server page|Next server page/,
  );
  assert.doesNotMatch(inventoryPage, /auditLogs:\s*{/);
});

test("global public inventory query is bounded by real server page size", () => {
  assert.match(publicInventoryQueries, /skip: \(page - 1\) \* pageSize/);
  assert.match(publicInventoryQueries, /take: pageSize/);
  assert.match(publicInventoryQueries, /totalMatchingCount: allGroups\.length/);
  assert.match(publicInventoryQueries, /server-side page query diagnostics/);
  assert.match(
    publicInventoryQueries,
    /hasNextPage: page \* pageSize < allGroups\.length/,
  );
  assert.doesNotMatch(
    publicInventoryQueries,
    /rawPageSize|rawRowsLoaded|server chunk/,
  );
});

test("inventory browser exposes real server pagination and infinite-scroll counts", () => {
  assert.match(inventoryBrowser, /Page \{currentPage\} of/);
  assert.match(
    inventoryBrowser,
    /Loaded \$\{loadedRows\.length\} of \$\{totalMatchingCount\}/,
  );
  assert.match(
    inventoryBrowser,
    /fetch\(`\$\{infiniteApiPath\}\?\$\{params\.toString\(\)\}`/,
  );
  assert.match(inventoryBrowser, /setLoadedRows\(\(current\) =>/);
  assert.match(inventoryBrowser, /const appended = payload\.rows\.filter/);
  assert.match(inventoryBrowser, /rootMargin: "600px 0px"/);
  assert.match(inventoryBrowser, /Retry/);
  assert.match(inventoryBrowser, /Select loaded/);
  assert.match(inventoryBrowser, /Select visible/);
  assert.doesNotMatch(
    inventoryBrowser,
    /getPaginationRowModel|table\.nextPage\(|table\.previousPage\(/,
  );
});

test("infinite-scroll APIs use the same bounded server page model", () => {
  assert.match(inventoryPage, /infiniteApiPath="\/api\/inventory\/list"/);
  assert.match(inventoryListApi, /skip: \(page - 1\) \* pageSize/);
  assert.match(inventoryListApi, /take: pageSize/);
  assert.match(inventoryListApi, /hasNextPage: page < totalPages/);
  assert.match(
    inventoryListApi,
    /nextPage: page < totalPages \? page \+ 1 : null/,
  );
  assert.match(inventoryListApi, /getCurrentUser\(\)/);
  assert.match(inventoryListApi, /getAccessScope\(user\)/);
  assert.match(inventoryListApi, /rowsFromDisplayItems/);
  assert.match(inventoryPage, /initialBrowsingMode === "infinite"/);
});

test("public infinite-scroll API preserves public-only server paging", () => {
  assert.match(
    inventoryPage + publicInventoryQueries,
    /initialBrowsingMode === "infinite"/,
  );
  assert.match(publicInventoryListApi, /getGlobalPublicInventory/);
  assert.match(publicInventoryListApi, /hasNextPage: result\.hasNextPage/);
  assert.match(
    publicInventoryListApi,
    /nextPage: result\.hasNextPage \? result\.page \+ 1 : null/,
  );
  assert.match(publicInventoryListApi, /toInventoryBrowserRows/);
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
