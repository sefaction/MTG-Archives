import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/locations/page.tsx", "utf8");
const moveFormSource = readFileSync("components/LocationMoveForm.tsx", "utf8");
const deleteFormSource = readFileSync(
  "components/LocationContentsDeleteForm.tsx",
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
