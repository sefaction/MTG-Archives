import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/DeckListEditor.tsx", "utf8");

test("deck row editor renders an individual commit form wired to the server action", () => {
  assert.match(source, /import[\s\S]*commitDeckCardToDeck[\s\S]*from "@\/app\/decks\/actions"/);
  assert.match(source, /<CommitInventoryToDeck deckId=\{deckId\} row=\{row\} \/>/);
  assert.match(source, /action=\{commitDeckCardToDeck\}/);
  assert.match(source, /name="deckId" value=\{deckId\}/);
  assert.match(source, /name="deckCardId" value=\{row\.id\}/);
  assert.match(source, /name="inventoryItemId"/);
  assert.match(source, /name="quantity"/);
  assert.match(source, /Commit to deck/);
});

test("deck row commit controls are editable-only and explain unavailable states", () => {
  const editableBlock = source.match(/\{canEdit \? \([\s\S]*?<CommitInventoryToDeck deckId=\{deckId\} row=\{row\} \/>[\s\S]*?\) : null\}/);

  assert.ok(editableBlock, "CommitInventoryToDeck should be inside the canEdit-only RowEditor controls");
  assert.match(source, /Commit inventory to deck/);
  assert.match(source, /This deck row is fully committed\./);
  assert.match(source, /No available inventory copies to commit for this row\./);
});

test("deck row commit options are sorted and labeled for exact and other-printing matches", () => {
  assert.match(source, /function sortedCommitOptions/);
  assert.match(source, /a\.matchType !== b\.matchType/);
  assert.match(source, /a\.matchType === "exact" \? -1 : 1/);
  assert.match(source, /a\.locationName\.localeCompare\(b\.locationName\)/);
  assert.match(source, /a\.setCode\.localeCompare\(b\.setCode\)/);
  assert.match(source, /a\.collectorNumber\.localeCompare\(b\.collectorNumber\)/);
  assert.match(source, /option\.matchType === "other" \? " — other printing" : ""/);
});

test("deck row commit quantity defaults and caps to the selected source and remaining need", () => {
  assert.match(source, /const remainingNeeded = Math\.max/);
  assert.match(source, /Math\.min\(selectedOption\.quantity, remainingNeeded\)/);
  assert.match(source, /max=\{quantityMax\}/);
  assert.match(source, /defaultValue=\{quantityMax\}/);
});
