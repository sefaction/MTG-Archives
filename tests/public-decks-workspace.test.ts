import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicDecksPage = readFileSync("app/public/decks/page.tsx", "utf8");
const deckWorkspace = readFileSync("components/DeckWorkspace.tsx", "utf8");

test("public decks reuse the full deck workspace in read-only mode", () => {
  assert.match(publicDecksPage, /<DeckWorkspace/);
  assert.match(publicDecksPage, /readOnly/);
  assert.match(publicDecksPage, /showOwner/);
  assert.match(publicDecksPage, /bracketOptions=\{bracketSelectOptions\(\)\}/);
  assert.match(publicDecksPage, /tags=\{workspaceTags\}/);
  assert.match(publicDecksPage, /commanderImages:/);
  assert.match(publicDecksPage, /commanderNames:/);
  assert.doesNotMatch(publicDecksPage, /take:\s*50/);
});

test("read-only deck workspaces retain browsing controls without mutation UI", () => {
  assert.match(deckWorkspace, /readOnly = false/);
  assert.match(deckWorkspace, /!readOnly \? \([\s\S]*\+ New deck/);
  assert.match(
    deckWorkspace,
    /!readOnly \? \([\s\S]*setOrganizationUnlocked/,
  );
  assert.match(deckWorkspace, /!readOnly \? \([\s\S]*setEditingDeck\(deck\)/);
  assert.match(deckWorkspace, /!readOnly && editingDeck/);
  assert.match(deckWorkspace, /showOwner \? <th className="p-3">Owner/);
  assert.match(deckWorkspace, /deck\.ownerLabel \?\? ""/);
});

test("public deck filters cover owner, tags, brackets, and visible folders", () => {
  assert.match(publicDecksPage, /publicTagId/);
  assert.match(publicDecksPage, /tagStats/);
  assert.match(publicDecksPage, /visibleFolderIds/);
  assert.match(publicDecksPage, /rawFolderById\.get\(folderId\)\?\.parentId/);
  assert.match(publicDecksPage, /ownerLabel:/);
  assert.match(deckWorkspace, /deck\.ownerLabel \?\? ""/);
  assert.match(deckWorkspace, /includedTagIds/);
  assert.match(deckWorkspace, /includedBrackets/);
});
