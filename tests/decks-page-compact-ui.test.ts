import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const decksPage = readFileSync("app/decks/page.tsx", "utf8");
const deckWorkspace = readFileSync("components/DeckWorkspace.tsx", "utf8");
const actions = readFileSync("app/decks/actions.ts", "utf8");

test("deck workspace defaults to a sortable table with an alternate card view", () => {
  assert.match(deckWorkspace, /useState<ViewMode>\("table"\)/);
  assert.match(deckWorkspace, />\s*Table\s*</);
  assert.match(deckWorkspace, />\s*Cards\s*</);
  assert.match(deckWorkspace, /function SortButton/);
  assert.match(deckWorkspace, /field="name"/);
  assert.match(deckWorkspace, /field="folder"/);
  assert.match(deckWorkspace, /field="updated"/);
});

test("deck card view uses commander artwork with partner support", () => {
  assert.match(decksPage, /commanderImages:/);
  assert.match(decksPage, /commanderNames:/);
  assert.match(decksPage, /deckCard\.isCommander/);
  assert.match(deckWorkspace, /deck\.commanderImages\s*\.slice\(0, 2\)/);
  assert.match(deckWorkspace, /backgroundImage: `url\(\$\{image\}\)`/);
});

test("deck cards present primary details and physical committal progress", () => {
  assert.match(decksPage, /deckCard\.section === DeckSection\.MAINBOARD/);
  assert.match(decksPage, /deckCard\.section === DeckSection\.COMMANDER/);
  assert.match(decksPage, /committedCardCount/);
  assert.match(deckWorkspace, /deck\.commanderNames\.join\(" & "\)/);
  assert.match(
    deckWorkspace,
    /ColorIdentitySymbols value=\{deck\.colorIdentity\}/,
  );
  assert.match(deckWorkspace, /Committal progress/);
  assert.match(deckWorkspace, /role="progressbar"/);
  assert.match(deckWorkspace, /min-h-\[27rem\]/);
  assert.match(deckWorkspace, /bg-black\/35 px-2 py-1/);
  assert.doesNotMatch(
    deckWorkspace,
    /rounded-lg border border-white\/10 bg-black/,
  );
});

test("tag and bracket clouds cycle between include, exclude, and neutral", () => {
  assert.match(deckWorkspace, /function MultiStateFilterCloud/);
  assert.match(deckWorkspace, /Click[\s\S]*to cycle include → exclude → clear/);
  assert.match(deckWorkspace, />\s*Not\s*</);
  assert.match(deckWorkspace, /includedTagIds/);
  assert.match(deckWorkspace, /excludedTagIds/);
  assert.match(deckWorkspace, /includedBrackets/);
  assert.match(deckWorkspace, /excludedBrackets/);
  assert.match(deckWorkspace, /includedTagIds\.some/);
  assert.match(deckWorkspace, /excludedTagIds\.some/);
  assert.match(deckWorkspace, /includedBrackets\.includes/);
  assert.match(deckWorkspace, /excludedBrackets\.includes/);
});

test("folder structure changes require unlock and support drag and drop", () => {
  assert.match(deckWorkspace, /organizationUnlocked/);
  assert.match(deckWorkspace, /draggable=\{organizationUnlocked\}/);
  assert.match(deckWorkspace, /onDragStart/);
  assert.match(deckWorkspace, /onDrop/);
  assert.match(deckWorkspace, /Drop here to move a folder to the top level/);
  assert.match(
    deckWorkspace,
    /Folder structure[\s\S]*cannot change while locked/,
  );
  assert.match(deckWorkspace, /action=\{createDeckFolder\}/);
  assert.match(deckWorkspace, /action=\{renameDeckFolder\}/);
  assert.match(deckWorkspace, /action=\{deleteDeckFolder\}/);
});

test("deck rows open a focused index editor instead of nested action forms", () => {
  assert.match(deckWorkspace, /setEditingDeck\(deck\)/);
  assert.match(
    deckWorkspace,
    /Update its organization without leaving the deck list/,
  );
  assert.match(deckWorkspace, /action=\{saveDeckFromIndex\}/);
  assert.match(deckWorkspace, /Open full deck settings/);
  assert.match(actions, /export async function updateDeckFromIndex/);
  assert.doesNotMatch(
    deckWorkspace,
    /<details className="relative inline-block text-left">/,
  );
});

test("folder paths and the compact new deck form are supplied to the workspace", () => {
  assert.match(decksPage, /folderPath: deck\.folderId/);
  assert.match(decksPage, /folderById\.get\(deck\.folderId\)\?\.path/);
  assert.match(decksPage, /<DeckWorkspace/);
  assert.match(deckWorkspace, /\+ New deck/);
  assert.match(deckWorkspace, /action=\{createDeck\}/);
  assert.match(deckWorkspace, /name="bracket"/);
});
