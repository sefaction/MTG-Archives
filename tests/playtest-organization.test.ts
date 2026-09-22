import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sandbox = readFileSync("components/PlaytestSandbox.tsx", "utf8");
const advanced = readFileSync("components/PlaytestAdvancedControls.tsx", "utf8");

test("playtest keeps frequent actions and advanced tools separately labeled", () => {
  assert.match(sandbox, /aria-label="Frequent playtest actions"/);
  assert.match(sandbox, /aria-label="Playtest controls"/);
  assert.match(advanced, /aria-label="Advanced playtest tools"/);
  assert.match(advanced, />\s*Battlefield workspace\s*</);
  assert.match(advanced, />\s*Selected cards\s*</);
  assert.match(advanced, /Tokens, library and random tools/);
  assert.match(advanced, /Players and commander damage/);
});
