import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminMetadataPage = readFileSync("app/admin/metadata/page.tsx", "utf8");
const adminPage = readFileSync("app/admin/page.tsx", "utf8");
const panel = readFileSync("components/AdminMetadataRefreshPanel.tsx", "utf8");
const bracketPanel = readFileSync(
  "components/AdminCommanderBracketPanel.tsx",
  "utf8",
);
const helper = readFileSync("lib/card-metadata-refresh.ts", "utf8");
const bracketHelper = readFileSync("lib/commander-brackets.ts", "utf8");
const refreshRoute = readFileSync(
  "app/api/admin/card-metadata/refresh-all/route.ts",
  "utf8",
);
const bracketRefreshRoute = readFileSync(
  "app/api/admin/commander-brackets/refresh/route.ts",
  "utf8",
);
const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");

test("admin metadata page is protected and linked from admin", () => {
  assert.match(adminMetadataPage, /await requireAdminMode\(\)/);
  assert.match(adminMetadataPage, /<AdminMetadataRefreshPanel \/>/);
  assert.match(adminMetadataPage, /<AdminCommanderBracketPanel/);
  assert.match(adminPage, /\["Metadata", "\/admin\/metadata"\]/);
});

test("metadata refresh route requires admin mode", () => {
  assert.match(refreshRoute, /isAdminModeEnabled/);
  assert.match(refreshRoute, /isAdminUser/);
  assert.match(refreshRoute, /Admin mode required/);
});

test("commander bracket refresh route requires admin mode", () => {
  assert.match(bracketRefreshRoute, /isAdminModeEnabled/);
  assert.match(bracketRefreshRoute, /isAdminUser/);
  assert.match(bracketRefreshRoute, /Admin mode required/);
  assert.match(bracketRefreshRoute, /refreshCommanderBracketMetadata/);
});

test("metadata refresh panel exposes one all-cards refresh action", () => {
  assert.match(panel, /Refresh all card metadata/);
  assert.match(panel, /\/api\/admin\/card-metadata\/refresh-all/);
  assert.match(panel, /Inventory quantities, locations, decks, and user data/);
  assert.doesNotMatch(panel, /Accept all/);
  assert.doesNotMatch(panel, /Clear selection/);
  assert.doesNotMatch(panel, /Scan for changes/);
});

test("commander bracket panel exposes refreshable Game Changer metadata", () => {
  assert.match(bracketPanel, /Commander bracket metadata/);
  assert.match(bracketPanel, /Refresh bracket metadata/);
  assert.match(bracketPanel, /\/api\/admin\/commander-brackets\/refresh/);
  assert.match(bracketPanel, /Game Changers/);
  assert.match(bracketPanel, /COMMANDER_BRACKET_RULESET_URL/);
  assert.match(bracketPanel, /COMMANDER_BRACKET_SCRYFALL_QUERY/);
});

test("metadata refresh helper updates all cached Scryfall cards in batches", () => {
  assert.match(helper, /refreshAllCachedCardMetadata/);
  assert.match(helper, /submitCardCollectionResult/);
  assert.match(helper, /SCRYFALL_COLLECTION_BATCH_SIZE = 75/);
  assert.match(helper, /upsertScryfallCard\(card\)/);
  assert.match(helper, /relatedRefreshed/);
  assert.match(helper, /card\.all_parts/);
});

test("commander bracket metadata is versioned and refreshable", () => {
  assert.match(prismaSchema, /model CommanderBracketRuleSet/);
  assert.match(prismaSchema, /model CommanderGameChanger/);
  assert.match(prismaSchema, /rulesJson\s+Json/);
  assert.match(bracketHelper, /COMMANDER_BRACKET_RULESET_URL/);
  assert.match(
    bracketHelper,
    /DEFAULT_SCRYFALL_GAME_CHANGER_QUERY = "is:gamechanger"/,
  );
  assert.match(bracketHelper, /searchCardsResult\(query\)/);
  assert.match(bracketHelper, /dedupeGameChangers/);
  assert.match(bracketHelper, /oracleId/);
  assert.match(bracketHelper, /isActive: false/);
  assert.match(bracketHelper, /isActive: true/);
});
