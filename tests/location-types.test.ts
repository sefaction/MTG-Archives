import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cleanLocationTypeName,
  isReservedLocationTypeName,
  normalizeLocationTypeName,
} from "../lib/location-types";
import { buildPublicInventoryWhere } from "../lib/public-collection";

test("location type names are normalized for shared catalog uniqueness", () => {
  assert.equal(normalizeLocationTypeName("  Trade Binder  "), "trade-binder");
  assert.equal(cleanLocationTypeName("  Deck   Box  "), "Deck Box");
  assert.equal(isReservedLocationTypeName("Deck"), true);
  assert.equal(isReservedLocationTypeName("Deck Box"), false);
});

test("location type schema and migration create a global catalog", async () => {
  const [schema, migration] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile(
      "prisma/migrations/20260628100000_location_types/migration.sql",
      "utf8",
    ),
  ]);

  assert.match(schema, /model LocationType/);
  assert.match(schema, /normalizedName\s+String\s+@unique/);
  assert.match(schema, /createdByUserId\s+String\?/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "LocationType"/);
  assert.match(migration, /INSERT INTO "LocationType"/);
  assert.match(migration, /FROM "InventoryLocation"/);
});

test("location type ownership migration tracks user-created types", async () => {
  const migration = await readFile(
    "prisma/migrations/20260628110000_location_type_ownership/migration.sql",
    "utf8",
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "createdByUserId"/);
  assert.match(migration, /LocationType_createdByUserId_fkey/);
  assert.match(migration, /ON DELETE SET NULL/);
});

test("locations page uses shared type dropdowns and create-new type input", async () => {
  const source = await readFile("app/locations/page.tsx", "utf8");

  assert.match(source, /prisma\.locationType\.findMany/);
  assert.match(source, /isReservedLocationTypeName/);
  assert.match(source, /locationTypeNameFromForm\(prisma, fd,/);
  assert.match(source, /name="type"/);
  assert.match(source, /name="newType"/);
  assert.match(source, /Or create type/);
});

test("locations page lets creators delete unused types and admins migrate before delete", async () => {
  const source = await readFile("app/locations/page.tsx", "utf8");

  assert.match(source, /async function deleteLocationTypeAction/);
  assert.match(source, /Deck is a system-managed location type/);
  assert.match(source, /createdByUserId !== ctx\.user\.id/);
  assert.match(source, /usedByAnotherOwner/);
  assert.match(source, /replacementTypeId/);
  assert.match(source, /migratedLocationCount/);
  assert.match(source, /changeType: "location_type_deleted"/);
  assert.match(source, /Migrate locations to/);
});

test("inventory pages expose shared location type filters", async () => {
  const [advancedSearch, inventoryPage, publicInventoryPage] =
    await Promise.all([
      readFile("components/InventoryAdvancedSearch.tsx", "utf8"),
      readFile("app/inventory/page.tsx", "utf8"),
      readFile("app/public/inventory/page.tsx", "utf8"),
    ]);

  assert.match(advancedSearch, /locationTypes\?: FilterOption\[\]/);
  assert.match(advancedSearch, /label="Location type"/);
  assert.match(advancedSearch, /name="locationType"/);
  assert.match(inventoryPage, /locationTypes=\{locationTypes\.map/);
  assert.match(publicInventoryPage, /locationTypes=\{locationTypes\.map/);
});

test("public inventory where supports location type filtering", () => {
  const where = buildPublicInventoryWhere({
    locationType: ["Binder", "Box"],
  });

  assert.deepEqual((where.AND as any[])[1], {
    OR: [
      { location: { type: { equals: "Binder", mode: "insensitive" } } },
      { location: { type: { equals: "Box", mode: "insensitive" } } },
    ],
  });
});

test("public inventory where supports multiple public owner filters", () => {
  const where = buildPublicInventoryWhere({
    owner: ["brian", "codex"],
  });

  assert.deepEqual((where.AND as any[])[1], {
    currentOwner: {
      users: {
        some: {
          publicSlug: { in: ["brian", "codex"] },
          isActive: true,
          publicProfileEnabled: true,
          playerId: { not: null },
        },
      },
    },
  });
});
