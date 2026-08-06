import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const globalPublicInventoryPage = fs.readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);
const inventoryBrowser = fs.readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const loginPage = fs.readFileSync("app/login/page.tsx", "utf8");
const middleware = fs.readFileSync("middleware.ts", "utf8");
const nav = fs.readFileSync("components/Nav.tsx", "utf8");
const dashboardPage = fs.readFileSync("app/dashboard/page.tsx", "utf8");
const publicCollectionQueries = fs.readFileSync(
  "lib/public-collection.ts",
  "utf8",
);
const publicInventoryPage = fs.readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);

const publicInventoryListApi = fs.readFileSync(
  "app/api/public/inventory/list/route.ts",
  "utf8",
);
const publicInventoryActions = fs.readFileSync(
  "app/public/inventory/actions.ts",
  "utf8",
);
const inventorySearch = fs.readFileSync(
  "components/InventoryAdvancedSearch.tsx",
  "utf8",
);
const filterSuggestionsApi = fs.readFileSync(
  "app/api/inventory/filter-suggestions/route.ts",
  "utf8",
);
const filterSuggestionScope = fs.readFileSync(
  "lib/inventory-filter-suggestions.ts",
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

test("public entry points point at the global public inventory", () => {
  assert.match(loginPage, /Browse public inventory/);
  assert.match(loginPage, /\/public\/inventory/);
  assert.match(nav, /<Link href="\/" className="app-nav-brand">/);
  assert.match(nav, /href: "\/public\/inventory", label: "Public"/);
  assert.match(dashboardPage, /href="\/public\/inventory"/);
  assert.match(dashboardPage, /Public Inventory/);
  assert.match(middleware, /"\/public"/);
});

test("global public inventory query enforces location visibility server-side", () => {
  assert.match(publicCollectionQueries, /getGlobalPublicInventory/);
  assert.doesNotMatch(publicCollectionQueries, /publicProfileEnabled/);
  assert.match(publicCollectionQueries, /publicOwnerVisibilityWhere/);
  assert.match(publicCollectionQueries, /publicInventoryVisibilityWhere/);
  assert.match(publicCollectionQueries, /select:\s*{\s*name: true\s*}/);
  assert.doesNotMatch(publicCollectionQueries, /email:\s*true/);
  assert.doesNotMatch(publicCollectionQueries, /auditLogs:\s*true/);
});

test("public inventory carries user identity colors into browse rows", () => {
  assert.match(publicCollectionQueries, /color: true/);
  assert.match(publicCollectionQueries, /color: profile\.player\?\.color/);
  assert.match(publicInventoryPage, /ownerColor: owner\.color/);
  assert.match(publicInventoryListApi, /ownerColor: owner\.color/);
  assert.match(publicInventoryPage, /currentOwnerColor/);
  assert.match(publicInventoryListApi, /currentOwnerColor/);
  assert.match(publicInventoryPage, /collectionCount === 1/);
  assert.match(inventoryBrowser, /canShowPublicOwnerIdentity/);
  assert.match(inventoryBrowser, /uiMode === "public-readonly"/);
  assert.match(inventoryBrowser, /shouldShowOwnerColor/);
  assert.match(inventoryBrowser, /shouldShowOwnerColor\s*\?\s*{/);
  assert.match(inventoryBrowser, /borderLeft: `8px solid/);
  assert.match(inventoryBrowser, /border-2 bg-zinc-900/);
  assert.match(inventoryBrowser, /ownerColorStyles/);
});

test("grouped public inventory aggregates location breakdown across all printings", () => {
  assert.match(publicInventoryPage, /aggregatePublicLocationBreakdown/);
  assert.match(
    publicInventoryPage,
    /entry\.printings\.flatMap\(\s*\(printing: any\) => printing\.locationBreakdown \|\| \[\]/,
  );
  assert.match(publicInventoryPage, /locationBreakdown: rowLocationBreakdown/);
  assert.match(
    publicInventoryPage,
    /locationCount: rowLocationBreakdown\.length/,
  );
  assert.match(publicInventoryListApi, /aggregatePublicLocationBreakdown/);
  assert.match(
    publicInventoryListApi,
    /locationBreakdown: rowLocationBreakdown/,
  );
});

test("public inventory search keeps browsing filters and removes private/admin filters", () => {
  assert.match(globalPublicInventoryPage, /<InventoryAdvancedSearch/);
  assert.match(globalPublicInventoryPage, /isPublic/);
  assert.match(globalPublicInventoryPage, /ownerParamName="owner"/);
  assert.match(globalPublicInventoryPage, /ownerFilterLabel="Current owner"/);
  assert.match(
    globalPublicInventoryPage,
    /players=\{result\.publicProfiles\.map/,
  );
  assert.match(globalPublicInventoryPage, /locationParamName="locationName"/);
  assert.match(
    globalPublicInventoryPage,
    /locations=\{result\.publicLocations\.map/,
  );
  assert.match(inventorySearch, /Advanced Inventory Search/);
  assert.match(inventorySearch, /label="Card name"/);
  assert.match(inventorySearch, /label="Type line"/);
  assert.match(inventorySearch, /Oracle text/);
  assert.match(inventorySearch, /label="Set"/);
  assert.match(inventorySearch, /label="Rarity"/);
  assert.match(inventorySearch, /label="Finish"/);
  assert.match(inventorySearch, /Language/);
  assert.match(inventorySearch, /Current owner/);
  assert.match(inventorySearch, /name=\{ownerParamName\}/);
  assert.match(inventorySearch, /label="Location"/);
  assert.match(inventorySearch, /Color ID/);
  assert.match(inventorySearch, /Mana value/);
  assert.match(inventorySearch, /USD/);
  assert.match(inventorySearch, /Apply filters/);
  assert.match(inventorySearch, /Clear Filters/);
  assert.match(inventorySearch, /FilterChipBar/);
  assert.match(inventorySearch, /CLOSE_FILTER_DROPDOWNS_EVENT/);
  assert.match(inventorySearch, /document\.addEventListener\("pointerdown"/);
  assert.match(inventorySearch, /window\.dispatchEvent\(new Event/);
  assert.match(inventorySearch, /showVisibilityFilter: !isPublic/);
  assert.match(inventorySearch, /showSourceFilter: !isPublic/);
  assert.match(inventorySearch, /showInventoryScopeFilter: !isPublic/);
  assert.match(inventorySearch, /showOwnerFilter: isPublic/);
  assert.match(inventorySearch, /showOwnerScopeControls: isAdmin && !isPublic/);
});

test("public inventory browser keeps read-only browse controls and hides write/admin controls", () => {
  assert.match(inventoryBrowser, /Table View/);
  assert.match(inventoryBrowser, /Binder View/);
  assert.match(inventoryBrowser, /Display:/);
  assert.match(inventoryBrowser, /Page size:/);
  assert.match(inventoryBrowser, /Browsing mode:/);
  assert.match(inventoryBrowser, /Columns/);
  assert.match(inventoryBrowser, /header: "Card Name"/);
  assert.match(inventoryBrowser, /header: "Total cards"/);
  assert.match(inventoryBrowser, /header: "Location summary"/);
  assert.match(inventoryBrowser, /header: "Set"/);
  assert.match(inventoryBrowser, /header: "Rarity"/);
  assert.match(inventoryBrowser, /header: "Mana Cost"/);
  assert.match(inventoryBrowser, /header: "Type Line"/);
  assert.match(inventoryBrowser, /header: "Color Identity"/);
  assert.match(inventoryBrowser, /header: "Preferred Price"/);
  assert.match(inventoryBrowser, /header: "Foil"/);
  assert.match(inventoryBrowser, /capabilities\.canBulkSelect/);
  assert.match(
    inventoryBrowser,
    /capabilities\.canEdit \|\| capabilities\.canDelete/,
  );
  assert.doesNotMatch(globalPublicInventoryPage, /Export Inventory/);
  assert.doesNotMatch(globalPublicInventoryPage, /Download CSV/);
  assert.doesNotMatch(globalPublicInventoryPage, /Moxfield foil/);
  assert.match(globalPublicInventoryPage, /Current owner/);
  assert.doesNotMatch(globalPublicInventoryPage, /Scope/);
  assert.doesNotMatch(globalPublicInventoryPage, /onBulkMoveLocation=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onBulkDeleteInventory=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onSaveEdit=/);
  assert.doesNotMatch(globalPublicInventoryPage, /onDeleteInventoryItem=/);
});

test("public inventory data and autocomplete routes are scoped to public-safe data", () => {
  assert.match(publicInventoryListApi, /getGlobalPublicInventory/);
  assert.match(publicInventoryListApi, /toInventoryBrowserRows/);
  assert.match(globalPublicInventoryPage, /onAddTradeWishlist=/);
  assert.match(inventoryBrowser, /Wishlist from/);
  assert.match(inventoryBrowser, /Choose trade target/);
  assert.match(publicInventoryListApi, /tradeWishlistTargets/);
  assert.match(publicInventoryPage, /tradeWishlistTargets/);
  assert.match(publicInventoryListApi, /sourceItemIds/);
  assert.match(publicInventoryPage, /sourceItemIds/);
  assert.match(publicInventoryActions, /requireLogin\(\)/);
  assert.match(publicInventoryActions, /buildPublicInventoryWhere/);
  assert.match(publicInventoryActions, /tradeWishlistItem\.upsert/);
  assert.match(publicInventoryActions, /quantity,/);
  assert.doesNotMatch(
    publicInventoryActions,
    /quantity: \{ increment: quantity \}/,
  );
  assert.match(publicInventoryPage, /openTradeWishlist/);
  assert.match(publicInventoryListApi, /openTradeWishlist/);
  assert.match(inventoryBrowser, /Already wishlisted/);
  assert.match(inventoryBrowser, /wishlistedQuantity/);
  assert.match(
    publicInventoryActions,
    /You cannot trade-wishlist your own card/,
  );
  assert.match(
    publicCollectionQueries,
    /publicFilterValues\(filters\.locationName\)/,
  );
  assert.match(publicCollectionQueries, /globalPublicInventoryLocationWhere/);
  assert.match(publicCollectionQueries, /publicInventoryVisibilityWhere/);
  assert.match(publicCollectionQueries, /publicOwnerDisplayName/);
  assert.match(
    publicCollectionQueries,
    /player:\s*\{ inventoryOwned:\s*\{ some: publicOwnerInventoryWhere \} \}/,
  );
  assert.match(publicCollectionQueries, /ownerPlayerId: profile\.playerId!/);
  assert.match(
    publicCollectionQueries,
    /inventoryItems:\s*\{ some: publicLocationInventoryWhere \}/,
  );
  assert.match(publicCollectionQueries, /id:\s*\{ in: publicOwnerIds \}/);
  assert.match(publicCollectionQueries, /select:\s*\{\s*name: true\s*\}/);
  assert.match(filterSuggestionsApi, /buildPublicInventoryWhere/);
  assert.match(
    filterSuggestionsApi,
    /url\.searchParams\.get\("public"\) === "1"/,
  );
  assert.match(filterSuggestionScope, /"owner"/);
  assert.match(filterSuggestionScope, /"locationName"/);
  assert.doesNotMatch(
    publicInventoryListApi,
    /onSaveEdit|onDeleteInventoryItem|onBulkDeleteInventory/,
  );
  assert.doesNotMatch(publicInventoryListApi, /auditHistory:\s*[^\[\]]/);
  assert.doesNotMatch(publicCollectionQueries, /sourceType:\s*true/);
  assert.doesNotMatch(publicCollectionQueries, /auditLogs:\s*true/);
  assert.doesNotMatch(publicCollectionQueries, /email:\s*true/);
});
