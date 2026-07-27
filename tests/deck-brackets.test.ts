import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260627140000_deck_brackets/migration.sql",
  "utf8",
);
const helper = readFileSync("lib/deck-brackets.ts", "utf8");
const actions = readFileSync("app/decks/actions.ts", "utf8");
const decksPage = readFileSync("app/decks/page.tsx", "utf8");
const deckWorkspace = readFileSync("components/DeckWorkspace.tsx", "utf8");
const deckDetailPage = readFileSync("app/decks/[deckId]/page.tsx", "utf8");

test("deck bracket fields are persisted for manual and suggested values", () => {
  assert.match(schema, /bracket\s+Int\?/);
  assert.match(schema, /bracketSuggested\s+Int\?/);
  assert.match(schema, /bracketConfidence\s+String\?/);
  assert.match(schema, /bracketAnalysisJson\s+Json\?/);
  assert.match(schema, /bracketUpdatedAt\s+DateTime\?/);
  assert.match(schema, /bracketAnalyzedAt\s+DateTime\?/);
  assert.match(schema, /@@index\(\[bracket\]\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "bracket" INTEGER/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Deck_bracket_idx"/);
});

test("deck bracket helper limits values to brackets one through five", () => {
  assert.match(helper, /DECK_BRACKETS = \[1, 2, 3, 4, 5\]/);
  assert.match(helper, /parseDeckBracket/);
  assert.match(helper, /formatDeckBracket/);
  assert.match(helper, /bracketSelectOptions/);
  assert.match(helper, /Bracket unset/);
});

test("deck create and update actions persist manual bracket choice", () => {
  assert.match(actions, /parseDeckBracket/);
  assert.match(actions, /bracket: parseDeckBracket\(fd\.get\("bracket"\)\)/);
  assert.match(actions, /bracketUpdatedAt/);
});

test("deck index exposes bracket filtering, sorting, and quick editing", () => {
  assert.match(decksPage, /selectedBracket/);
  assert.match(deckWorkspace, /label="Brackets"/);
  assert.match(deckWorkspace, /includedBrackets/);
  assert.match(deckWorkspace, /excludedBrackets/);
  assert.match(deckWorkspace, /includeMode="any"/);
  assert.match(deckWorkspace, /field="bracket"/);
  assert.match(deckWorkspace, /name="bracket"/);
  assert.match(deckWorkspace, /updateDeckFromIndex/);
});

test("deck detail header and settings expose bracket", () => {
  assert.match(deckDetailPage, /formatDeckBracket\(deck\.bracket\)/);
  assert.match(deckDetailPage, /bracketSelectOptions/);
  assert.match(deckDetailPage, /name="bracket"/);
  assert.match(deckDetailPage, /Save deck settings/);
});
