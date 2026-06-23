import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminMetadataPage = readFileSync("app/admin/metadata/page.tsx", "utf8");
const adminPage = readFileSync("app/admin/page.tsx", "utf8");
const panel = readFileSync("components/AdminMetadataRefreshPanel.tsx", "utf8");
const helper = readFileSync("lib/card-metadata-refresh.ts", "utf8");
const refreshRoute = readFileSync(
  "app/api/admin/card-metadata/refresh-all/route.ts",
  "utf8",
);

test("admin metadata page is protected and linked from admin", () => {
  assert.match(adminMetadataPage, /await requireAdminMode\(\)/);
  assert.match(adminMetadataPage, /<AdminMetadataRefreshPanel \/>/);
  assert.match(adminPage, /href="\/admin\/metadata"/);
});

test("metadata refresh route requires admin mode", () => {
  assert.match(refreshRoute, /isAdminModeEnabled/);
  assert.match(refreshRoute, /isAdminUser/);
  assert.match(refreshRoute, /Admin mode required/);
});

test("metadata refresh panel exposes one all-cards refresh action", () => {
  assert.match(panel, /Refresh all card metadata/);
  assert.match(panel, /\/api\/admin\/card-metadata\/refresh-all/);
  assert.match(panel, /Inventory quantities, locations, decks, and user data/);
  assert.doesNotMatch(panel, /Accept all/);
  assert.doesNotMatch(panel, /Clear selection/);
  assert.doesNotMatch(panel, /Scan for changes/);
});

test("metadata refresh helper updates all cached Scryfall cards in batches", () => {
  assert.match(helper, /refreshAllCachedCardMetadata/);
  assert.match(helper, /submitCardCollectionResult/);
  assert.match(helper, /SCRYFALL_COLLECTION_BATCH_SIZE = 75/);
  assert.match(helper, /upsertScryfallCard\(card\)/);
  assert.match(helper, /relatedRefreshed/);
  assert.match(helper, /card\.all_parts/);
});
