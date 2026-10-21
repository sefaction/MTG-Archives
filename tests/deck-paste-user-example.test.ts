import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseDecklistText } from "../lib/deck-import";

// Supplied October 21 example; not evidence of the historical failing payload.
// Catalog identity and final application acceptance require separate DB/browser tests.
test("user example parses without losing quantities, punctuation, identifiers or finish", () => {
  const text = readFileSync(new URL("./fixtures/deck-paste-user-2026-10-21.txt", import.meta.url), "utf8");
  const rows = text.split("\n");
  const parsed = parseDecklistText(text);
  assert.equal(parsed.lines.length, 87);
  assert.equal(parsed.skippedLines.length, 0);
  assert.equal(parsed.lines.reduce((sum, line) => sum + line.quantity!, 0), 100);
  for (const [index, line] of parsed.lines.entries()) {
    const expected = /^(\d+) (.+) \(([A-Z0-9]+)\) ([0-9]+)( \*F\*)?$/.exec(rows[index])!;
    assert.equal(line.rawLine, rows[index]);
    assert.equal(line.quantity, Number(expected[1]));
    assert.equal(line.parsedName, expected[2]);
    assert.equal(line.parsedSetCode, expected[3].toLowerCase());
    assert.equal(line.parsedCollectorNumber, expected[4]);
    assert.equal(line.physicalFoilStatus, expected[5] ? "FOIL" : "NONFOIL");
    assert.equal(line.physicalQuantity, 0);
    assert.equal(line.selectedCardId, null);
    assert.equal(line.section, "MAINBOARD");
    assert.deepEqual(line.errors, []);
    assert.deepEqual(line.warnings, []);
  }
});
