import assert from "node:assert/strict";
import test from "node:test";
import { parseDecklistText } from "../lib/deck-import";
import { matchesCardOrFaceName, cardOrFaceNameWhere } from "../lib/card-import";

test("plain export needs an explicit commander heading, not an inferred blank line", () => {
  const text = `${Array.from({ length: 99 }, (_, i) => `1 Example Card ${i}`).join("\n")}\n\n1 Esika, God of the Tree`;
  const plain = parseDecklistText(text);
  assert.equal(plain.lines.length, 100);
  assert.ok(plain.lines.every((line) => line.section === "MAINBOARD"));
  const explicit = parseDecklistText(
    text.replace("\n\n1 Esika", "\n\nCommander\n1 Esika"),
  );
  assert.equal(
    explicit.lines.filter((line) => line.section === "MAINBOARD").length,
    99,
  );
  assert.equal(explicit.lines.at(-1)?.section, "COMMANDER");
  assert.ok(
    explicit.lines.every(
      (line) =>
        line.quantity === 1 &&
        !line.warnings.length &&
        !line.errors.length &&
        line.physicalQuantity === 0,
    ),
  );
});

test("Foil is a card name; only explicit trailing annotations set its finish", () => {
  const parsed = parseDecklistText(
    "1 Foil\n1 Foil (MMQ) 82\n1 Foil (MMQ) 82 *F*\n1 Sol Ring [foil]\n1 Arcane Signet (foil)",
  );
  assert.deepEqual(
    parsed.lines.map((line) => line.parsedName),
    ["Foil", "Foil", "Foil", "Sol Ring", "Arcane Signet"],
  );
  assert.deepEqual(
    parsed.lines.map((line) => line.foil),
    [false, false, true, true, true],
  );
  assert.equal(parsed.lines[2].parsedSetCode, "mmq");
  assert.equal(parsed.lines[2].parsedCollectorNumber, "82");
  assert.equal(parsed.lines[2].physicalFoilStatus, "FOIL");
  assert.ok(
    parsed.lines.every(
      (line) => !line.errors.length && line.physicalQuantity === 0,
    ),
  );
});

test("double-faced names match complete names or exact faces, not partial names", () => {
  const name = "Esika, God of the Tree // The Prismatic Bridge";
  for (const query of [name, "Esika, God of the Tree", "the prismatic bridge"])
    assert.equal(matchesCardOrFaceName(name, query), true);
  for (const query of ["Esika", "Prismatic", "", "Esika's Chariot"])
    assert.equal(matchesCardOrFaceName(name, query), false);
  assert.equal(
    matchesCardOrFaceName("Atraxa, Praetors' Voice", "Atraxa, Praetors’ Voice"),
    true,
  );
  const where = cardOrFaceNameWhere("Esika, God of the Tree");
  assert.equal(where.OR[1].name.startsWith, "esika, god of the tree // ");
  assert.equal(where.OR[2].name.endsWith, " // esika, god of the tree");
});
