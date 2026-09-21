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
const pickerSource = readFileSync(
  "components/LocationSearchSelect.tsx",
  "utf8",
);
const hierarchyMigration = readFileSync(
  "prisma/migrations/20260810020000_inventory_location_hierarchy/migration.sql",
  "utf8",
);

test("locations workspace browses first with one selected detail and lazy management", () => {
  assert.match(pageSource, /Normal locations/);
  assert.match(pageSource, /aria-label="Locations tree"/);
  assert.match(pageSource, /Location tree/);
  assert.match(pageSource, /data-location-result/);
  assert.match(pageSource, /selectedLocation\].map/);
  assert.match(pageSource, /panel === "create" \|\| panel === "types"/);
  assert.match(pageSource, /aria-label="Selected location"/);
  assert.match(pageSource, /browseParams\.edit === location\.id \? \(/);
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
  assert.match(pickerSource, /filterSelectClass/);
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
  assert.match(pickerSource, /No parent \(top level\)/);
  assert.match(pageSource, /buildLocationTree/);
  assert.match(pageSource, /location\.path/);
  assert.match(pageSource, /including sub-locations/);
  assert.match(pageSource, /browseLocations\(normalLocations, browseParams\)/);
  assert.match(pageSource, /browser\.items/);
  assert.match(pageSource, /LocationBrowseFilters/);
  assert.match(pageSource, /aria-label="Location pages"/);
});

test("location pickers bound DOM options and scoped moves retain explicit confirmation", () => {
  assert.match(pickerSource, /matches\.slice\(0, 30\)/);
  assert.match(pickerSource, /selected && !options.some/);
  assert.match(
    pageSource,
    /candidate\.ownerPlayerId ===\s+location\.ownerPlayerId/,
  );
  assert.match(moveFormSource, /name="sourceLocationId" value=\{source.id\}/);
  assert.match(moveFormSource, /name="confirmMove"/);
  assert.match(moveFormSource, /setConfirmed\(false\)/);
  assert.match(pageSource, /fd.get\("confirmMove"\) !== "on"/);
  assert.match(
    pageSource,
    /source.ownerPlayerId !== destination.ownerPlayerId/,
  );
});
