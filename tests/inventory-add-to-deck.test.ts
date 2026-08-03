import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryBrowser = readFileSync(
  "components/InventoryBrowser.tsx",
  "utf8",
);
const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
const publicInventoryPage = readFileSync(
  "app/public/inventory/page.tsx",
  "utf8",
);
const inventoryListApi = readFileSync(
  "app/api/inventory/list/route.ts",
  "utf8",
);
const publicInventoryListApi = readFileSync(
  "app/api/public/inventory/list/route.ts",
  "utf8",
);
const deckActions = readFileSync("app/decks/actions.ts", "utf8");

test("inventory drawers add exact printings to editable deck lists", () => {
  assert.match(inventoryBrowser, /function InventoryAddToDeckControl/);
  assert.match(inventoryBrowser, /name="deckId"/);
  assert.match(inventoryBrowser, /name="cardId"/);
  assert.match(inventoryBrowser, /name="section"/);
  assert.match(inventoryBrowser, /name="quantity"/);
  assert.match(inventoryBrowser, /Add to deck list/);
  assert.match(inventoryBrowser, /Inventory stays where it is/);

  const controlStart = inventoryBrowser.indexOf(
    "function InventoryAddToDeckControl",
  );
  const controlEnd = inventoryBrowser.indexOf(
    "function CardDetail",
    controlStart,
  );
  const control = inventoryBrowser.slice(controlStart, controlEnd);
  assert.doesNotMatch(control, /inventoryItemId/);
  assert.doesNotMatch(control, /commitImmediately/);
});

test("grouped inventory requires a real printing card id", () => {
  assert.match(inventoryBrowser, /inventoryDeckPrintingOptions/);
  assert.match(inventoryBrowser, /printing\.cardId/);
  assert.match(inventoryBrowser, /options\.has\(printing\.cardId\)/);
  assert.match(inventoryPage, /cardId: p\.cardId/);
  assert.match(publicInventoryPage, /cardId: printing\.cardId/);
  assert.match(inventoryListApi, /cardId: printing\.cardId/);
  assert.match(publicInventoryListApi, /cardId: printing\.cardId/);
});

test("private and public inventories provide only editable deck targets", () => {
  assert.match(
    inventoryPage,
    /where: adminModeActive \? \{\} : \{ ownerUserId: user\.id \}/,
  );
  assert.match(publicInventoryPage, /where: \{ ownerUserId: viewer\.id \}/);
  assert.doesNotMatch(publicInventoryPage, /getAccessScope/);
  assert.match(inventoryPage, /deckTargets=\{editableDecks\.map/);
  assert.match(publicInventoryPage, /deckTargets=\{editableDecks\.map/);
  assert.match(inventoryPage, /onAddToDeck=\{addDeckCard\}/);
  assert.match(publicInventoryPage, /onAddToDeck=\{addDeckCard\}/);
});

test("the reused deck action authorizes the deck and leaves commitment opt-in", () => {
  const actionStart = deckActions.indexOf("export async function addDeckCard");
  const actionEnd = deckActions.indexOf(
    "export async function updateDeckCard",
    actionStart,
  );
  const action = deckActions.slice(actionStart, actionEnd);
  assert.match(action, /requireManagedDeck\(deckId\)/);
  assert.match(action, /formString\(fd, "commitImmediately"\) === "on"/);
  assert.match(action, /if \(!commitImmediately\) return/);
});
