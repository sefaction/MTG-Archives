import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync("app/decks/actions.ts", "utf8");
const page = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const inventoryMove = readFileSync("lib/inventory-move.ts", "utf8");

test("deleteDeck requires DELETE confirmation for any committed inventory", () => {
  assert.match(
    actions,
    /committed\.committedQuantity > 0 && strongConfirmation !== "DELETE"/,
  );
  assert.doesNotMatch(actions, /committed\.committedQuantity >= 20/);
  assert.match(actions, /returnCommittedInventoryFromDeckTx\(tx, \{/);
  assert.match(
    actions,
    /Cannot delete deck while committed inventory remains in its deck location/,
  );
});

test("deck delete UI requires destination and explicit DELETE before returning committed cards", () => {
  assert.match(
    page,
    /committedSummary\.committedQuantity} committed physical cards/,
  );
  assert.match(page, /committedSummary\.committedEntries} inventory entries/);
  assert.match(page, /name="destinationLocationId"[\s\S]*required/);
  assert.match(page, /Type DELETE to confirm/);
  assert.match(page, /name="strongConfirmation"/);
  assert.match(page, /Return committed cards and delete deck/);
});

test("deck move helper returns surviving audit target ids for merged and newly-created destinations", () => {
  assert.match(inventoryMove, /auditInventoryItemId: matching\.id/);
  assert.match(
    inventoryMove,
    /destinationInventoryItemId: created\.id,\n\s*auditInventoryItemId: created\.id/,
  );
  assert.match(actions, /inventoryItemId: move\.auditInventoryItemId/);
});
