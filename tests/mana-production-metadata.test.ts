import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260730110000_card_produced_mana/migration.sql",
  "utf8",
);
const cardImport = readFileSync("lib/card-import.ts", "utf8");
const scryfall = readFileSync("lib/scryfall.ts", "utf8");
const snapshot = readFileSync("lib/deck-snapshot.ts", "utf8");
const component = readFileSync("components/ManaProductionAnalysis.tsx", "utf8");

test("produced mana is typed, persisted, and mapped from Scryfall", () => {
  assert.match(schema, /producedMana\s+Json\?/);
  assert.match(scryfall, /produced_mana\?: string\[\]/);
  assert.match(cardImport, /producedMana: cardData\.produced_mana \?\? \[\]/);
  assert.match(
    cardImport,
    /produced_mana: Array\.isArray\(card\.producedMana\)/,
  );
  assert.match(snapshot, /producedMana: string\[\] \| null/);
  assert.match(snapshot, /producedMana: true/);
});

test("produced mana migration backfills local raw Scryfall data first", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "producedMana" JSONB/);
  assert.match(migration, /"rawScryfallJson"->'produced_mana'/);
  assert.match(migration, /jsonb_typeof/);
});

test("mana production UI explains scope, alternatives, and incomplete data", () => {
  assert.match(component, /Mana demand and land production/);
  assert.match(component, /Hybrid, Phyrexian, two-brid/);
  assert.match(component, /Generic mana is/);
  assert.match(component, /percentages\s+may not add to 100%/);
  assert.match(component, /Land-production data is incomplete/);
  assert.match(component, /Mana rocks, creatures, Treasures/);
  assert.match(component, /aria-pressed=/);
});
