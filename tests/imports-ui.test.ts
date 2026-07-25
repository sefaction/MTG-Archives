import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/imports/page.tsx", "utf8");

test("import upload redirects directly to the active review workspace", () => {
  assert.match(
    source,
    /redirect\(`\$\{buildImportReviewUrl\(batch\.id\)\}#import-review`\)/,
  );
  assert.match(source, /id="import-review"/);
});

test("import page surfaces recent batches near upload controls", () => {
  assert.match(source, /New CSV import/);
  assert.match(source, /Recent imports/);
  assert.match(source, /href="#import-history"/);
  assert.match(source, /id="import-history"/);
});

test("import commit action is kept in the sticky command bar", () => {
  assert.match(source, /sticky top-2/);
  assert.match(source, /Commit Ready Cards/);
  assert.equal((source.match(/action=\{confirmImport\}/g) ?? []).length, 2);
  assert.match(source, /action=\{confirmImport\}\s+className="hidden"/);
});

test("import confirmation uses the selected destination location", () => {
  assert.match(
    source,
    /confirmMessage=\{[\s\S]*?ready rows to \{selection\}\?[\s\S]*?confirmSelectionName="destinationLocationId"/,
  );
});

test("import maintenance keeps single add collapsed and exposes history cleanup", () => {
  assert.match(source, /title="Add single card"/);
  assert.match(source, /storageKey="imports-single-card-add"/);
  assert.match(source, /Undo most recent import/);
  assert.match(source, /Clear all import history/);
  assert.match(source, /Clear this history/);
  assert.match(source, /Undo import/);
});

test("users can clear only their own import history", () => {
  assert.match(source, /const actionUser = await requireAuth\(\)/);
  assert.match(source, /selectedPlayerId: actionUserWithPlayer\.playerId/);
  assert.match(
    source,
    /batch\.selectedPlayerId !== actionUserWithPlayer\?\.playerId/,
  );
  assert.match(source, /Clear my import history/);
  assert.match(source, /<th>Actions<\/th>/);
  assert.match(source, /isAdmin &&\s+\["IMPORTED", "imported"\]/);
});
