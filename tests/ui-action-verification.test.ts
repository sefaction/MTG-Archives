import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("each UI action has one current evidence path and checked revision", () => {
  const crosswalk = readFileSync("docs/design/ui-consolidation/CAPABILITIES.md", "utf8");
  const ledger = readFileSync("docs/UI_ACTION_VERIFICATION.md", "utf8");
  const checkedRevision = ledger.match(/last checked application code is `([0-9a-f]{7})`/i)?.[1];
  assert.ok(checkedRevision, "ledger needs its checked application revision");
  const expected = [...crosswalk.matchAll(/^\| ([A-Z]\d{2}) \|/gm)].map((match) => match[1]);
  const entries = [...ledger.matchAll(/^\| ([A-Z]\d{2}) \|[^|]*\| `([^`]+)` \| `([0-9a-f]{7})` \|/gm)]
    .map((match) => ({ id: match[1], path: match[2], revision: match[3] }));
  assert.equal(expected.length, 45, "update the historical action count when the crosswalk changes");
  assert.equal(new Set(expected).size, expected.length, "duplicate crosswalk action ID");
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, "duplicate verification action ID");
  assert.deepEqual(entries.map((entry) => entry.id).sort(), expected.sort());
  for (const entry of entries) {
    assert.ok(entry.path.startsWith("tests/"), `${entry.id} needs a test path`);
    assert.ok(existsSync(entry.path), `${entry.id} references missing ${entry.path}`);
    assert.equal(entry.revision, checkedRevision, `${entry.id} has a different app revision`);
  }
});
