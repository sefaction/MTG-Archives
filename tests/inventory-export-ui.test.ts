import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importsPage = readFileSync("app/imports/page.tsx", "utf8");
const exportForm = readFileSync("components/InventoryExportForm.tsx", "utf8");
const exportRoute = readFileSync("app/api/inventory/export/route.ts", "utf8");

test("imports centralizes whole-collection and normal-location exports", () => {
  assert.match(importsPage, /<InventoryExportForm/);
  assert.match(importsPage, /kind: InventoryLocationKind\.NORMAL/);
  assert.match(importsPage, /systemManaged: false/);
  assert.match(importsPage, /active: true/);
  assert.match(exportForm, /action="\/api\/inventory\/export"/);
  assert.match(exportForm, /<option value="owner">Whole collection<\/option>/);
  assert.match(
    exportForm,
    /<option value="location">Specific location<\/option>/,
  );
  assert.match(exportForm, /name="locationId"/);
  assert.match(exportForm, /required=\{needsLocation\}/);
  assert.match(exportForm, /disabled=\{!needsLocation\}/);
  assert.match(exportForm, /MTG Archives full CSV/);
  assert.match(exportForm, /Moxfield collection CSV/);
  assert.doesNotMatch(exportForm, /Moxfield foil/);
  assert.match(exportForm, /Deck-managed locations are excluded here/);
});

test("location exports are owner-scoped and receive location-aware filenames", () => {
  assert.match(exportRoute, /scope === "location"/);
  assert.match(exportRoute, /location\.kind !== InventoryLocationKind\.NORMAL/);
  assert.match(exportRoute, /location\.systemManaged/);
  assert.match(exportRoute, /ownerId !== location\.ownerPlayerId/);
  assert.match(
    exportRoute,
    /where\.currentOwnerId = selectedLocation\.ownerPlayerId/,
  );
  assert.match(exportRoute, /where\.locationId = selectedLocation\.id/);
  assert.match(
    exportRoute,
    /`mtg-inventory-\$\{safeFilenamePart\(selectedLocation\.name\)\}`/,
  );
  assert.match(
    exportRoute,
    /selectedLocation\?\.name \|\| selectedOwner\?\.displayName/,
  );
  assert.match(exportRoute, /"Collector Number"/);
  assert.match(exportRoute, /item\.card\.collectorNumber/);
  assert.match(exportRoute, /foilStatus === "ETCHED"\) return "etched"/);
  assert.match(exportRoute, /foilStatus === "FOIL"\) return "foil"/);
});
