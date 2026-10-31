import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, afterEach, mock, test } from "node:test";
import type { Card } from "@prisma/client";

// Substitute only database reads before loading the actual importer. Prisma's
// generated delegate proxies do not expose descriptors for node:test mocks.
const unexpectedRead = async (..._args: unknown[]): Promise<any> => { throw new Error("Unexpected database read"); };
const prisma = {card: {findMany: unexpectedRead}, inventoryItem: {findFirst: unexpectedRead, aggregate: unexpectedRead}};
const globals = globalThis as typeof globalThis & {prisma?: unknown};
const previousPrisma = globals.prisma;
globals.prisma = prisma;
const require = createRequire(process.env.DECK_IMPORT_SOURCE_ROOT
  ? resolve(process.env.DECK_IMPORT_SOURCE_ROOT, "tests/deck-import-exact-feedback.test.ts")
  : import.meta.url);
const { parseDecklistText, resolveParsedDecklist } = require("../lib/deck-import") as typeof import("../lib/deck-import");
const { __resetScryfallClientForTests } = require("../lib/scryfall") as typeof import("../lib/scryfall");
after(() => { if (previousPrisma === undefined) delete globals.prisma; else globals.prisma = previousPrisma; });

const reported = [
  ["Shadowheart, Dark Justiciar", "clb", "146", 1],
  ["Forest", "ust", "216", 8],
  ["Plains", "ust", "212", 4],
  ["Sol Ring", "slc", "19", 1],
  ["Swamp", "ust", "214", 4],
] as const;
const source = readFileSync(new URL("./fixtures/deck-paste-user-2026-10-31.txt", import.meta.url), "utf8");
const card = (name: string, setCode: string, collectorNumber: string) => ({
  id: `${setCode}-${collectorNumber}`, scryfallId: `${setCode}-${collectorNumber}`,
  name, setCode, collectorNumber, setName: setCode, rarity: "common", prices: {},
} as Card);

afterEach(() => { mock.restoreAll(); __resetScryfallClientForTests(); });

test("October 31 reporter list retains all 100 copies and exact failing identifiers", () => {
  const parsed = parseDecklistText(source);
  assert.equal(parsed.lines.length, 87);
  assert.equal(parsed.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0), 100);
  assert.ok(parsed.lines.every(line => !line.errors.length));
  assert.equal(parsed.lines.filter(line => line.foil).length, 1);
  for (const [name, set, number, quantity] of reported) {
    const line = parsed.lines.find(line => line.parsedName === name)!;
    assert.deepEqual([line.parsedSetCode, line.parsedCollectorNumber, line.quantity], [set, number, quantity]);
  }
});

for (const [name, set, number, quantity] of reported) {
  test(`${name}: recognized exact printing outside League pool requires actionable review`, async () => {
    mock.method(prisma.card, "findMany", async () => [card(name, set, number)]);
    mock.method(prisma.inventoryItem, "findFirst", async (query: unknown) => {
      assert.deepEqual(query, {where: {quantity: {gt: 0}, location: {commanderLeagueLinks: {some: {leagueId: "league"}}}, cardId: `${set}-${number}`}, select: {id: true}});
      return null;
    });
    mock.method(globalThis, "fetch", async () => { throw new Error("Local exact match must not use external lookup"); });
    const result = await resolveParsedDecklist(parseDecklistText(`${quantity} ${name} (${set}) ${number}`), "owner", "owned-then-cheapest", "league");
    const line = result.lines[0];
    assert.equal(line.resolutionStatus, "NEEDS_REVIEW");
    assert.match(line.resolutionMessage, /recognized.*not.*League.*linked inventory/i);
    assert.match(line.resolutionMessage, /choose.*League printing/i);
    assert.equal(line.selectedCardId, null);
    assert.equal(line.quantity, quantity);
    assert.equal(line.rawLine, `${quantity} ${name} (${set}) ${number}`);
    assert.equal(result.summary.notFound, 0);
    assert.equal(result.summary.readyToCommit, 0);
  });
}

test("available League printing still resolves with exact quantity and League-owned count", async () => {
  mock.method(prisma.card, "findMany", async () => [card("Forest", "ust", "216")]);
  mock.method(prisma.inventoryItem, "findFirst", async () => ({id: "stock"}));
  mock.method(prisma.inventoryItem, "aggregate", async () => ({_sum: {quantity: 8}}));
  const result = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"), "owner", "owned-then-cheapest", "league");
  assert.equal(result.lines[0].resolutionStatus, "RESOLVED_EXACT_PRINTING");
  assert.equal(result.lines[0].selectedCardId, "ust-216");
  assert.equal(result.lines[0].ownedQuantity, 8);
  assert.equal(result.lines[0].quantity, 8);
});

test("ordinary deck exact printing does not require League membership", async () => {
  mock.method(prisma.card, "findMany", async () => [card("Forest", "ust", "216")]);
  mock.method(prisma.inventoryItem, "findFirst", async () => { throw new Error("No League check expected"); });
  const result = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"));
  assert.equal(result.lines[0].resolutionStatus, "RESOLVED_EXACT_PRINTING");
  assert.equal(result.lines[0].selectedCardId, "ust-216");
});

test("retry after restoring pool membership replaces old restriction feedback", async () => {
  let available = false;
  mock.method(prisma.card, "findMany", async () => [card("Forest", "ust", "216")]);
  mock.method(prisma.inventoryItem, "findFirst", async () => available ? {id: "stock"} : null);
  mock.method(prisma.inventoryItem, "aggregate", async () => ({_sum: {quantity: 8}}));
  const rejected = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"), "owner", "owned-then-cheapest", "league");
  available = true;
  const retried = await resolveParsedDecklist(rejected.lines, "owner", "owned-then-cheapest", "league");
  assert.equal(retried.lines[0].resolutionStatus, "RESOLVED_EXACT_PRINTING");
  assert.deepEqual(retried.lines[0].errors, []);
  assert.equal(retried.summary.errors, 0);
  assert.equal(retried.lines[0].quantity, 8);
});

test("multiple local matches retain ambiguity and manual-selection guidance", async () => {
  const forest = card("Forest", "ust", "216");
  mock.method(prisma.card, "findMany", async () => [forest, {...forest, id: "other-language", scryfallId: "other-language"}]);
  const result = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"));
  assert.equal(result.lines[0].resolutionStatus, "AMBIGUOUS");
  assert.match(result.lines[0].resolutionMessage, /multiple.*manual selection/i);
  assert.equal(result.lines[0].selectedCardId, null);
  assert.equal(result.summary.notFound, 0);
  assert.equal(result.summary.ambiguous, 1);
});

test("temporary catalog failure preserves retry guidance rather than claiming not found", async () => {
  mock.method(prisma.card, "findMany", async () => []);
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({details: "Catalog temporarily unavailable."}), {status: 503}));
  const previous = process.env.SCRYFALL_MAX_RETRIES;
  process.env.SCRYFALL_MAX_RETRIES = "0";
  try {
    const result = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"));
    assert.equal(result.lines[0].resolutionStatus, "ERROR");
    assert.match(result.lines[0].resolutionMessage, /temporarily unavailable/i);
    assert.equal(result.lines[0].selectedCardId, null);
    assert.equal(result.summary.notFound, 0);
  } finally {
    if (previous === undefined) delete process.env.SCRYFALL_MAX_RETRIES;
    else process.env.SCRYFALL_MAX_RETRIES = previous;
  }
});

test("genuinely unknown exact printing keeps the catalog's not-found explanation", async () => {
  mock.method(prisma.card, "findMany", async () => []);
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({details: "Not found"}), {status: 404}));
  const result = await resolveParsedDecklist(parseDecklistText("1 Forest (UST) 99999"));
  assert.equal(result.lines[0].resolutionStatus, "NOT_FOUND");
  assert.match(result.lines[0].resolutionMessage, /ust.*99999/i);
  assert.equal(result.lines[0].selectedCardId, null);
  assert.equal(result.summary.notFound, 1);
});

test("nonretryable invalid catalog response is an error rather than a missing printing", async () => {
  mock.method(prisma.card, "findMany", async () => []);
  mock.method(globalThis, "fetch", async () => new Response("invalid JSON", {status: 200}));
  const result = await resolveParsedDecklist(parseDecklistText("8 Forest (UST) 216"));
  assert.equal(result.lines[0].resolutionStatus, "ERROR");
  assert.match(result.lines[0].resolutionMessage, /could not be parsed as JSON/i);
  assert.equal(result.lines[0].selectedCardId, null);
  assert.equal(result.summary.notFound, 0);
});
