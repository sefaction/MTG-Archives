import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260814120000_commander_league_subapp/migration.sql",
  "utf8",
);
const deckMigration = readFileSync(
  "prisma/migrations/20260814160000_commander_league_decks/migration.sql",
  "utf8",
);
const deckMonthMigration = readFileSync(
  "prisma/migrations/20260814190000_commander_league_deck_month/migration.sql",
  "utf8",
);
const sharedDeckMigration = readFileSync(
  "prisma/migrations/20260814220000_commander_league_shared_decks/migration.sql",
  "utf8",
);
const actions = readFileSync("app/league/actions.ts", "utf8");
const archiveDeckActions = readFileSync("app/decks/actions.ts", "utf8");
const dashboard = readFileSync("app/league/[leagueId]/page.tsx", "utf8");
const deckLibrary = readFileSync(
  "app/league/[leagueId]/decks/page.tsx",
  "utf8",
);
const leagueNav = readFileSync("components/league/LeagueNav.tsx", "utf8");
const leagueDeckRoute = readFileSync(
  "app/league/[leagueId]/decks/[deckId]/page.tsx",
  "utf8",
);
const archiveDeckBuilder = readFileSync("app/decks/[deckId]/page.tsx", "utf8");
const deckListEditor = readFileSync("components/DeckListEditor.tsx", "utf8");
const deckCardPicker = readFileSync("components/DeckCardPicker.tsx", "utf8");
const deckImportPanel = readFileSync("components/DeckImportPanel.tsx", "utf8");
const deckIndex = readFileSync("app/decks/page.tsx", "utf8");
const archiveDashboard = readFileSync("app/dashboard/page.tsx", "utf8");

test("commander league uses an isolated modern domain model", () => {
  for (const model of [
    "CommanderLeague",
    "CommanderLeagueMember",
    "CommanderLeagueRound",
    "CommanderLeagueGame",
    "CommanderLeagueGameParticipant",
    "CommanderLeagueDeckSubmission",
    "CommanderLeagueDeckSnapshotCard",
    "CommanderLeagueLocation",
  ]) {
    assert.match(schema, new RegExp(`model ${model}\\b`));
    assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
  }
  assert.doesNotMatch(actions, /prisma\.(league|season|round|pointEvent)\b/);
});

test("game entry freezes decks without inventory commitment", () => {
  assert.match(actions, /deckSubmission:\s*\{/);
  assert.match(actions, /cards:\s*\{/);
  assert.doesNotMatch(actions, /moveInventory|commitDeck|InventoryAudit/);
  assert.match(dashboard, /immutable snapshot/i);
});

test("league metadata is isolated while deck contents use the Archive deck domain", () => {
  assert.match(schema, /model CommanderLeagueDeck\b/);
  assert.doesNotMatch(schema, /model CommanderLeagueDeckCard\b/);
  assert.match(deckMigration, /CREATE TABLE "CommanderLeagueDeck"/);
  assert.match(deckMigration, /CREATE TABLE "CommanderLeagueDeckCard"/);
  assert.match(actions, /tx\.commanderLeagueDeck\.create/);
  assert.match(actions, /tx\.deck\.create/);
  assert.match(actions, /archiveDeckId: archiveDeck\.id/);
  assert.match(actions, /sourceLeagueDeckId: deck\.id/);
  assert.match(actions, /deck\.archiveDeck\.cards/);
  assert.match(schema, /archiveDeckId\s+String\s+@unique/);
  assert.match(sharedDeckMigration, /INSERT INTO "Deck"/);
  assert.match(sharedDeckMigration, /'PUBLIC'::"Visibility"/);
  assert.match(sharedDeckMigration, /INSERT INTO "DeckCard"/);
  assert.match(sharedDeckMigration, /DROP TABLE "CommanderLeagueDeckCard"/);
  assert.match(deckLibrary, /Build decks exclusively for this league/);
  assert.match(leagueNav, /\/decks/);
});

test("league deck submissions capture player and monthly round at creation", () => {
  assert.match(schema, /roundId\s+String/);
  assert.match(schema, /@@unique\(\[memberId, roundId\]\)/);
  assert.match(deckMonthMigration, /CommanderLeagueDeck_memberId_roundId_key/);
  assert.match(deckLibrary, /name="memberId"/);
  assert.match(deckLibrary, /name="roundId"/);
  assert.match(actions, /deck\.roundId !== roundId/);
});

test("league decks open the exact Archive builder and retain its tools", () => {
  assert.match(
    leagueDeckRoute,
    /redirect\(`\/decks\/\$\{deck\.archiveDeckId\}`\)/,
  );
  assert.match(archiveDeckBuilder, /<DeckToolsNav/);
  assert.match(archiveDeckBuilder, /<DeckListEditor/);
  assert.match(archiveDeckBuilder, /<DeckCardPicker/);
  assert.match(archiveDeckBuilder, /commanderLeagueDeck/);
  assert.match(archiveDeckBuilder, /inventoryCommitmentEnabled/);
  assert.match(deckListEditor, /showPrivateInventory/);
  assert.match(deckCardPicker, /inventoryCommitmentEnabled/);
  assert.match(deckImportPanel, /inventoryCommitmentEnabled/);
});

test("league deck policy enforces public visibility, no commitment, and match locking", () => {
  assert.match(actions, /visibility: "PUBLIC"/);
  assert.match(actions, /format: "COMMANDER"/);
  assert.match(
    archiveDeckActions,
    /deck\.commanderLeagueDeck\?\.submissions\.length/,
  );
  assert.match(archiveDeckActions, /rejectLeagueInventoryCommitment/);
  assert.match(
    archiveDeckActions,
    /visibility: deck\.commanderLeagueDeck \? Visibility\.PUBLIC : visibility/,
  );
  assert.match(deckIndex, /commanderLeagueDeck: \{ is: null \}/);
});

test("league app exposes standings, card stats, public locations, and dashboard entry", () => {
  assert.match(dashboard, /Standings/);
  assert.match(dashboard, /Most-played cards/);
  assert.match(dashboard, /League inventory locations/);
  assert.match(archiveDashboard, /href="\/league"/);
  assert.match(archiveDashboard, /Commander League/);
});
