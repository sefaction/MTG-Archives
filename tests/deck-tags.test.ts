import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deckTagsText,
  MAX_DECK_TAG_LENGTH,
  MAX_DECK_TAGS,
  normalizeDeckTagName,
  parseDeckTags,
} from "../lib/deck-tags";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260727090000_deck_tags/migration.sql",
  "utf8",
);
const actions = readFileSync("app/decks/actions.ts", "utf8");
const decksPage = readFileSync("app/decks/page.tsx", "utf8");
const deckPage = readFileSync("app/decks/[deckId]/page.tsx", "utf8");

test("deck tags normalize whitespace and dedupe case-insensitively", () => {
  assert.equal(normalizeDeckTagName("  Upgraded   Precon "), "upgraded precon");
  assert.deepEqual(parseDeckTags("cEDH, upgraded   precon; CEDH\nLoaner"), [
    { name: "cEDH", normalizedName: "cedh" },
    { name: "upgraded precon", normalizedName: "upgraded precon" },
    { name: "Loaner", normalizedName: "loaner" },
  ]);
});

test("deck tag limits keep names and assignment counts bounded", () => {
  assert.throws(
    () => parseDeckTags("x".repeat(MAX_DECK_TAG_LENGTH + 1)),
    /characters or fewer/,
  );
  assert.throws(
    () =>
      parseDeckTags(
        Array.from(
          { length: MAX_DECK_TAGS + 1 },
          (_, index) => `tag-${index}`,
        ).join(","),
      ),
    /at most/,
  );
});

test("deck tag text is stable and alphabetized for edit forms", () => {
  assert.equal(
    deckTagsText([
      { tag: { name: "Loaner" } },
      { tag: { name: "cEDH" } },
      { tag: { name: "Upgraded" } },
    ]),
    "cEDH, Loaner, Upgraded",
  );
});

test("deck tags use an owner-scoped catalog and indexed assignments", () => {
  assert.match(schema, /model DeckTag \{/);
  assert.match(schema, /@@unique\(\[ownerUserId, normalizedName\]\)/);
  assert.match(schema, /model DeckTagAssignment \{/);
  assert.match(schema, /@@id\(\[deckId, tagId\]\)/);
  assert.match(migration, /CREATE TABLE "DeckTag"/);
  assert.match(migration, /CREATE TABLE "DeckTagAssignment"/);
  assert.match(migration, /ON DELETE CASCADE/);
});

test("deck create and settings updates synchronize tags transactionally", () => {
  assert.match(actions, /import \{ parseDeckTags, replaceDeckTags \}/);
  assert.match(
    actions,
    /export async function createDeck[\s\S]*prisma\.\$transaction[\s\S]*replaceDeckTags/,
  );
  assert.match(
    actions,
    /export async function updateDeck[\s\S]*prisma\.\$transaction[\s\S]*replaceDeckTags/,
  );
});

test("deck pages edit, display, preserve, and filter tags", () => {
  assert.match(decksPage, /searchParams\?: Promise<\{[\s\S]*tag\?: string/);
  assert.match(decksPage, /tags: \{ some: \{ tagId: selectedTag\.id \} \}/);
  assert.match(decksPage, /aria-label="Deck tags"/);
  assert.match(decksPage, /href=\{decksHref\(\{ tag: tag\.id \}\)\}/);
  assert.match(decksPage, /value=\{deckTagsText\(deck\.tags\)\}/);
  assert.match(deckPage, /defaultValue=\{deckTagsText\(deck\.tags\)\}/);
  assert.match(deckPage, /Separate tags with commas/);
  assert.match(deckPage, /\/decks\?tag=/);
});
