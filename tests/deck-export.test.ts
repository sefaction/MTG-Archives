import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import { decklistFilename, formatDecklistText } from "../lib/deck-export";
import { parseDecklistText } from "../lib/deck-import";

test("deck export keeps sections, quantities and known printings importable", () => {
  const text = formatDecklistText([
    { section: DeckSection.SIDEBOARD, quantity: 2, cardName: "Negate", card: null },
    { section: DeckSection.MAINBOARD, quantity: 4, cardName: "Sol Ring",
      card: { setCode: "cmm", collectorNumber: "400" } },
    { section: DeckSection.COMMANDER, quantity: 1,
      cardName: "Esika, God of the Tree", card: null },
  ]);
  assert.equal(text, "Commander\n1 Esika, God of the Tree\n\n" +
    "Mainboard\n4 Sol Ring (CMM) 400\n\nSideboard\n2 Negate\n");
  const parsed = parseDecklistText(text);
  assert.deepEqual(parsed.lines.map(({ section, quantity, parsedName }) =>
    [section, quantity, parsedName]), [
    [DeckSection.COMMANDER, 1, "Esika, God of the Tree"],
    [DeckSection.MAINBOARD, 4, "Sol Ring"],
    [DeckSection.SIDEBOARD, 2, "Negate"],
  ]);
  assert.equal(parsed.lines[1].parsedSetCode, "cmm");
  assert.equal(parsed.lines[1].parsedCollectorNumber, "400");
});

test("deck export makes a safe filename and one-line card names", () => {
  assert.equal(decklistFilename('My "Deck"/2026'), "My-Deck-2026-decklist.txt");
  assert.equal(formatDecklistText([
    { section: DeckSection.MAINBOARD, quantity: 1,
      cardName: "Forest\nSideboard", card: null },
  ]), "Mainboard\n1 Forest Sideboard\n");
  assert.equal(formatDecklistText([]), "\n");
});
