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
  assert.match(source, /href="\/imports\?view=history#import-history"/);
  assert.match(source, /id="import-history"/);
});

test("compact sticky summary links to one explicit commit workspace", () => {
  assert.match(source, /sticky top-2/);
  assert.match(source, /Commit Ready Cards/);
  assert.equal((source.match(/action=\{confirmImport\}/g) ?? []).length, 1);
  assert.match(source, /id="import-commit"/);
});

test("import confirmation distinguishes physical copies and ready rows", () => {
  assert.match(
    source,
    /confirmMessage=\{`Commit \$\{readyCopyCount\} physical copies from \$\{summary.readyToCommit\} ready rows/,
  );
});

test("inventory imports accept an on-demand section for a whole batch or CSV row", () => {
  assert.match(source, /destinationLocationSection/);
  assert.match(source, /locationSection: getCell\(row, "section"\)/);
  assert.match(
    readFileSync("lib/import-commit.ts", "utf8"),
    /parsedRow\.locationSection \?\? defaultLocationSection/,
  );
});

test("import maintenance and manual add have separate task homes", () => {
  assert.match(source, /workspaceView === "add"/);
  assert.match(source, /workspaceView === "history"/);
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
