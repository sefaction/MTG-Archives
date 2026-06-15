import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/DeckListEditor.tsx", "utf8");

test("deck row editor renders an individual commit form wired to the server action", () => {
  assert.match(
    source,
    /import[\s\S]*commitDeckCardToDeck[\s\S]*from "@\/app\/decks\/actions"/,
  );
  assert.match(
    source,
    /<CommitInventoryToDeck deckId=\{deckId\} row=\{row\} \/>/,
  );
  assert.match(source, /action=\{commitDeckCardToDeck\}/);
  assert.match(source, /name="deckId" value=\{deckId\}/);
  assert.match(source, /name="deckCardId" value=\{row\.id\}/);
  assert.match(source, /name="inventoryItemId"/);
  assert.match(source, /name="quantity"/);
  assert.match(source, /Commit to deck/);
});

test("deck row commit controls are editable-only and explain unavailable states", () => {
  const editableBlock = source.match(
    /\{canEdit \? \([\s\S]*?<CommitInventoryToDeck deckId=\{deckId\} row=\{row\} \/>[\s\S]*?\) : null\}/,
  );

  assert.ok(
    editableBlock,
    "CommitInventoryToDeck should be inside the canEdit-only RowEditor controls",
  );
  assert.match(source, /Commit inventory to deck/);
  assert.match(source, /This deck row is fully committed\./);
  assert.match(
    source,
    /No available inventory copies to commit for this row\./,
  );
});

test("deck row commit options are sorted and labeled for exact and other-printing matches", () => {
  assert.match(source, /function sortedCommitOptions/);
  assert.match(source, /a\.matchType !== b\.matchType/);
  assert.match(source, /a\.matchType === "exact" \? -1 : 1/);
  assert.match(source, /a\.locationName\.localeCompare\(b\.locationName\)/);
  assert.match(source, /a\.setCode\.localeCompare\(b\.setCode\)/);
  assert.match(
    source,
    /a\.collectorNumber\.localeCompare\(b\.collectorNumber\)/,
  );
  assert.match(
    source,
    /option\.matchType === "other" \? " — other printing" : ""/,
  );
});

test("deck row commit quantity defaults and caps to the selected source and remaining need", () => {
  assert.match(source, /const remainingNeeded = Math\.max/);
  assert.match(
    source,
    /Math\.min\(selectedOption\.quantity, remainingNeeded\)/,
  );
  assert.match(source, /max=\{quantityMax\}/);
  assert.match(source, /defaultValue=\{quantityMax\}/);
});

test("deck row editor renders individual return controls wired to returnDeckCardToInventory", () => {
  assert.match(
    source,
    /import[\s\S]*returnDeckCardToInventory[\s\S]*from "@\/app\/decks\/actions"/,
  );
  assert.match(
    source,
    /<ReturnCommittedCopies[\s\S]*returnLocations=\{returnLocations\}/,
  );
  assert.match(source, /action=\{returnDeckCardToInventory\}/);
  assert.match(source, /name="deckId" value=\{deckId\}/);
  assert.match(source, /name="deckCardId" value=\{row\.id\}/);
  assert.match(source, /name="inventoryItemId"/);
  assert.match(source, /name="destinationLocationId"/);
  assert.match(source, /name="quantity"/);
  assert.match(source, /Return to inventory/);
});

test("deck bulk tools include selected committed inventory return workflow", () => {
  assert.match(source, /function returnSelectedCommitted/);
  assert.match(source, /\/api\/decks\/\$\{deckId\}\/return-committed/);
  assert.match(source, /Return selected committed cards/);
  assert.match(source, /destinationLocationId: returnDestinationId/);
  assert.match(
    source,
    /Skipped \$\{result\.skippedRows\} selected rows with no committed copies/,
  );
});

test("deck list rows stay compact and delegate details to a responsive drawer", () => {
  assert.match(source, /function DeckEntryDrawer/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(
    source,
    /md:right-0 md:w=\{\"\[min\(92vw,760px\)\]\"\}|md:w-\[min\(92vw,760px\)\]/,
  );
  assert.match(source, /Deck entry details/);
  assert.match(source, /<RowEditor[\s\S]*returnLocations=\{returnLocations\}/);
  assert.match(source, /<th className="px-2 py-1\.5">Qty<\/th>/);
  assert.match(source, /<th className="px-2 py-1\.5">MV \/ Mana<\/th>/);
  assert.match(source, /<th className="px-2 py-1\.5">Section<\/th>/);
  const textRow = source.slice(
    source.indexOf("function TextDeckRow"),
    source.indexOf("function VisualDeckView"),
  );
  assert.doesNotMatch(textRow, /Use owned printing/);
  assert.doesNotMatch(textRow, /Use cheapest printing/);
});
