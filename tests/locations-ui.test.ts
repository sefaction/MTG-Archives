import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/locations/page.tsx", "utf8");
const moveFormSource = readFileSync("components/LocationMoveForm.tsx", "utf8");
const deleteFormSource = readFileSync(
  "components/LocationContentsDeleteForm.tsx",
  "utf8",
);
const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
const hierarchyMigration = readFileSync(
  "prisma/migrations/20260810020000_inventory_location_hierarchy/migration.sql",
  "utf8",
);

test("locations page uses compact manage drawers for normal locations", () => {
  assert.match(pageSource, /Normal locations/);
  assert.match(pageSource, /aria-label="Locations tree"/);
  assert.match(pageSource, /Location tree/);
  assert.match(pageSource, /normalLocationGroups/);
  assert.match(pageSource, /border-l border-zinc-800/);
  assert.match(pageSource, /<details className="group/);
  assert.match(pageSource, /Manage/);
  assert.match(pageSource, /Danger zone/);
  assert.match(pageSource, /Save location/);
  assert.doesNotMatch(pageSource, /Existing normal locations/);
});

test("locations controls use shared dark form styles", () => {
  assert.match(pageSource, /filterInputClass/);
  assert.match(pageSource, /filterSelectClass/);
  assert.match(pageSource, /filterPrimaryButtonClass/);
  assert.match(pageSource, /filterDangerButtonClass/);
  assert.match(moveFormSource, /filterSelectClass/);
  assert.match(moveFormSource, /filterPrimaryButtonClass/);
  assert.match(deleteFormSource, /filterInputClass/);
  assert.match(deleteFormSource, /filterDangerButtonClass/);
});

test("locations support safe hierarchical parent selection and breadcrumb paths", () => {
  assert.match(schemaSource, /parentLocationId\s+String\?/);
  assert.match(schemaSource, /InventoryLocationHierarchy/);
  assert.match(hierarchyMigration, /ON DELETE RESTRICT/);
  assert.match(hierarchyMigration, /WHERE "parentLocationId" IS NULL/);
  assert.match(hierarchyMigration, /WHERE "parentLocationId" IS NOT NULL/);
  assert.match(pageSource, /name="parentLocationId"/);
  assert.match(pageSource, /No parent \(top level\)/);
  assert.match(pageSource, /buildLocationTree/);
  assert.match(pageSource, /location\.path/);
  assert.match(pageSource, /including sub-locations/);
  assert.doesNotMatch(
    pageSource,
    /key=\{`\$\{ownerGroup\.id\}-\$\{typeGroup\.label\}`\}\s+open/,
  );
});
