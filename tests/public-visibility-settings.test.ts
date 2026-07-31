import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const settingsPage = readFileSync("app/settings/page.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260731140000_simplify_public_visibility/migration.sql",
  "utf8",
);
const publicInventory = readFileSync("lib/public-collection.ts", "utf8");
const publicInventoryPage = readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);

test("public visibility is controlled directly by deck and location settings", () => {
  assert.doesNotMatch(settingsPage, /publicProfileEnabled|publicSlug/);
  assert.doesNotMatch(schema, /publicProfileEnabled|publicSlug/);
  assert.match(settingsPage, /Public decks appear in the public deck list/);
  assert.match(settingsPage, /Inventory in public\s+locations appears/);
});

test("legacy public profile routes are removed", () => {
  assert.equal(existsSync("app/u/[publicSlug]/page.tsx"), false);
  assert.equal(existsSync("app/u/[publicSlug]/inventory/page.tsx"), false);
  assert.equal(existsSync("app/u/[publicSlug]/decks/page.tsx"), false);
  assert.equal(existsSync("components/PublicCollectionNav.tsx"), false);
});

test("migration makes existing users, locations, and decks public", () => {
  assert.match(migration, /"inventoryDefaultVisibility" = 'PUBLIC'/);
  assert.match(migration, /"deckDefaultVisibility" = 'PUBLIC'/);
  assert.match(migration, /UPDATE "InventoryLocation"/);
  assert.match(migration, /UPDATE "Deck"/);
  assert.match(migration, /SET "visibility" = 'PUBLIC'/);
  assert.match(migration, /DROP COLUMN "publicProfileEnabled"/);
  assert.match(migration, /DROP COLUMN "publicSlug"/);
});

test("public inventory owner filters use the existing player id", () => {
  assert.match(publicInventory, /id: \{ in: publicOwnerIds \}/);
  assert.match(publicInventory, /ownerPlayerId: profile\.playerId!/);
  assert.match(publicInventoryPage, /value: owner\.ownerPlayerId/);
  assert.doesNotMatch(publicInventory, /publicSlug/);
});
