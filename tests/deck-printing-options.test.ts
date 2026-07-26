import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DeckCardSearchResult } from "../lib/deck-search";
import {
  filterExactCardPrintings,
  getPrintingSetOptions,
} from "../lib/deck-printing-options";

function printing(
  cardId: string,
  name: string,
  setCode: string,
  setName: string,
) {
  return { cardId, name, setCode, setName } as DeckCardSearchResult;
}

const results = [
  printing("one", "Sol Ring", "cmm", "Commander Masters"),
  printing("two", "Sol Ring", "lea", "Limited Edition Alpha"),
  printing("three", "Sol Ring", "cmm", "Commander Masters"),
  printing("nearby", "Sol Ring Replica", "mrd", "Mirrodin"),
];

test("printing chooser keeps only the current card and filters by set", () => {
  assert.deepEqual(
    filterExactCardPrintings(results, "sol ring").map(
      (result) => result.cardId,
    ),
    ["one", "two", "three"],
  );
  assert.deepEqual(
    filterExactCardPrintings(results, "Sol Ring", "CMM").map(
      (result) => result.cardId,
    ),
    ["one", "three"],
  );
});

test("printing chooser derives unique sorted set options", () => {
  assert.deepEqual(getPrintingSetOptions(results, "Sol Ring"), [
    { code: "cmm", name: "Commander Masters" },
    { code: "lea", name: "Limited Edition Alpha" },
  ]);
});

test("add-real-copy and change-printing share the fixed-card chooser", () => {
  const editor = readFileSync("components/DeckListEditor.tsx", "utf8");
  const chooser = readFileSync("components/DeckPrintingChooser.tsx", "utf8");

  assert.equal(editor.match(/<DeckPrintingChooser/g)?.length, 2);
  assert.match(chooser, /Printings for/);
  assert.match(chooser, /Filter by set/);
  assert.match(chooser, /q: cardName/);
  assert.match(chooser, /limit: "175"/);
  assert.match(chooser, /filterPrimaryButtonClass/);
  assert.doesNotMatch(chooser, /placeholder="Card name/);

  const searchRoute = readFileSync(
    "app/api/decks/card-search/route.ts",
    "utf8",
  );
  assert.match(searchRoute, /Math\.min\(requestedLimit, 175\)/);
});
