import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync("lib/commander-brackets.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260627130000_commander_bracket_metadata/migration.sql",
  "utf8",
);
const route = readFileSync(
  "app/api/admin/commander-brackets/refresh/route.ts",
  "utf8",
);
const panel = readFileSync("components/AdminCommanderBracketPanel.tsx", "utf8");

test("commander bracket refresh can load from configured JSON or Scryfall", () => {
  assert.match(helper, /loadFromJsonSource/);
  assert.match(helper, /entriesFromSourceJson/);
  assert.match(helper, /loadFromScryfallSearch/);
  assert.match(helper, /COMMANDER_BRACKET_RULESET_URL/);
  assert.match(helper, /COMMANDER_BRACKET_SCRYFALL_QUERY/);
});

test("commander bracket refresh stores a new active version atomically", () => {
  assert.match(helper, /prisma\.\$transaction/);
  assert.match(helper, /commanderBracketRuleSet\.updateMany/);
  assert.match(helper, /isActive: false/);
  assert.match(helper, /commanderBracketRuleSet\.create/);
  assert.match(helper, /isActive: true/);
  assert.match(helper, /gameChangers: \{/);
});

test("commander bracket migration creates rulesets and game changer rows", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "CommanderBracketRuleSet"/,
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "CommanderGameChanger"/);
  assert.match(migration, /"rulesJson" JSONB NOT NULL/);
  assert.match(migration, /"oracleId" TEXT/);
  assert.match(migration, /ON DELETE CASCADE/);
});

test("commander bracket refresh API and panel are admin-facing", () => {
  assert.match(route, /Admin mode required/);
  assert.match(route, /refreshCommanderBracketMetadata/);
  assert.match(route, /revalidatePath\("\/decks"\)/);
  assert.match(panel, /Refresh bracket metadata/);
  assert.match(panel, /Game Changer/);
  assert.match(panel, /View source/);
});
