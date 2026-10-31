import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, afterEach, mock, test } from "node:test";
import type { Card } from "@prisma/client";

// Load the actual lookup, parser and cache writer with an instrumented Prisma
// transaction boundary. One request must not need a slot for every printing.
const unexpected = async (..._args: unknown[]): Promise<any> => {
  throw new Error("Unexpected database operation");
};
const prisma = {
  card: { findMany: unexpected },
  $queryRaw: unexpected,
  $transaction: unexpected,
};
const globals = globalThis as typeof globalThis & { prisma?: unknown };
const previous = globals.prisma;
globals.prisma = prisma;
const require = createRequire(process.env.CARD_SEARCH_SOURCE_ROOT
  ? resolve(process.env.CARD_SEARCH_SOURCE_ROOT, "tests/card-search-query-budget.test.ts")
  : import.meta.url);
const { searchLocalThenScryfallCards } = require("../lib/card-import") as typeof import("../lib/card-import");
const { parseDecklistText, resolveParsedDecklist } = require("../lib/deck-import") as typeof import("../lib/deck-import");
const { searchDeckCardPrintings } = require("../lib/deck-search") as typeof import("../lib/deck-search");
const { __resetScryfallClientForTests } = require("../lib/scryfall") as typeof import("../lib/scryfall");
after(() => { if (previous === undefined) delete globals.prisma; else globals.prisma = previous; });
afterEach(() => { mock.restoreAll(); __resetScryfallClientForTests(); });

function fixture(count: number, options: { capacity?: number; failAt?: number } = {}) {
  const cards = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: "Forest", set: "tst", set_name: "Synthetic test printings",
    collector_number: String(i), rarity: "common", type_line: "Basic Land — Forest",
    lang: "en", games: ["paper"],
  }));
  let active = 0, peak = 0;
  const started: string[] = [];
  const completed: string[] = [];
  const pending: Promise<unknown>[] = [];
  const sentinel = new Error("Synthetic cache write failed");
  mock.method(prisma, "$queryRaw", async () => []);
  mock.method(prisma.card, "findMany", async () => []);
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    object: "list", data: cards, has_more: false, total_cards: cards.length,
  }), { status: 200 }));
  mock.method(prisma, "$transaction", (fn: (tx: unknown) => Promise<unknown>) => {
    const run = (async () => {
      active++; peak = Math.max(peak, active);
      try {
        if (active > (options.capacity ?? 1)) {
          throw Object.assign(new Error("Too many clients already"), { code: "P2037" });
        }
        await new Promise<void>(resolve => setImmediate(resolve));
        return await fn({ card: {
          findUnique: async () => null,
          upsert: async ({ create }: { create: Card }) => {
            started.push(create.scryfallId);
            if (started.length === options.failAt) throw sentinel;
            completed.push(create.scryfallId);
            return { ...create, id: create.scryfallId };
          },
        }});
      } finally { active--; }
    })();
    pending.push(run);
    return run;
  });
  return { cards, started, completed, sentinel, peak: () => peak,
    settle: () => Promise.allSettled(pending) };
}

test("manual card search caches at most20 printings using one transaction slot", async () => {
  const f = fixture(25);
  try {
    const result = await searchLocalThenScryfallCards("Forest");
    assert.equal(result.cards.length, 25, "Keep all returned search choices");
    assert.match(result.message, /^25 Scryfall printings found/);
    assert.deepEqual(f.completed, f.cards.slice(0, 20).map(c => c.id));
    assert.equal(f.peak(), 1);
  } finally { await f.settle(); }
});

test("name-only deck resolution caches at most75 printings using one transaction slot", async () => {
  const f = fixture(80);
  try {
    const result = await resolveParsedDecklist(parseDecklistText("8 Forest"), undefined, "cheapest-only");
    assert.equal(result.lines[0].resolutionStatus, "RESOLVED_CHEAPEST_PRINTING");
    assert.equal(result.lines[0].quantity, 8);
    assert.equal(result.lines[0].selectedCardId, f.cards[0].id);
    assert.deepEqual(f.completed, f.cards.slice(0, 75).map(c => c.id));
    assert.equal(f.peak(), 1);
  } finally { await f.settle(); }
});

test("deck printing picker caches its requested limit using one transaction slot", async () => {
  const f = fixture(40);
  try {
    const result = await searchDeckCardPrintings({ query: "Forest", limit: 30 });
    assert.equal(result.results.length, 30);
    assert.equal(result.counts.scryfall, 30);
    assert.deepEqual(f.completed, f.cards.slice(0, 30).map(c => c.id));
    assert.equal(f.peak(), 1);
  } finally { await f.settle(); }
});

test("deck printing picker stops starting cache writes after a failed transaction", async () => {
  const f = fixture(30, { capacity: 100, failAt: 3 });
  try {
    await assert.rejects(searchDeckCardPrintings({ query: "Forest" }), error => error === f.sentinel);
  } finally { await f.settle(); }
  assert.deepEqual(f.started, f.cards.slice(0, 3).map(c => c.id));
  assert.deepEqual(f.completed, f.cards.slice(0, 2).map(c => c.id));
});

test("manual lookup stops starting cache writes after a failed transaction", async () => {
  const f = fixture(20, { capacity: 100, failAt: 3 });
  try {
    await assert.rejects(searchLocalThenScryfallCards("Forest"), error => error === f.sentinel);
  } finally { await f.settle(); }
  assert.deepEqual(f.started, f.cards.slice(0, 3).map(c => c.id));
  assert.deepEqual(f.completed, f.cards.slice(0, 2).map(c => c.id));
});

test("deck lookup reports failed caching and stops starting more transactions", async () => {
  const f = fixture(75, { capacity: 100, failAt: 3 });
  try {
    const result = await resolveParsedDecklist(parseDecklistText("8 Forest"), undefined, "cheapest-only");
    assert.equal(result.lines[0].resolutionStatus, "ERROR");
    assert.equal(result.lines[0].selectedCardId, null);
    assert.match(result.lines[0].resolutionMessage, /Synthetic cache write failed/);
  } finally { await f.settle(); }
  assert.deepEqual(f.started, f.cards.slice(0, 3).map(c => c.id));
  assert.deepEqual(f.completed, f.cards.slice(0, 2).map(c => c.id));
});

test("empty search response does not start cache transactions", async () => {
  const f = fixture(0);
  const result = await searchLocalThenScryfallCards("Forest");
  assert.deepEqual(result.cards, []);
  assert.equal(f.peak(), 0);
});

test("League name-only lookup never fetches outside its linked inventory", async () => {
  const f = fixture(75);
  mock.method(globalThis, "fetch", async () => { throw new Error("League lookup must stay local"); });
  const result = await resolveParsedDecklist(parseDecklistText("8 Forest"), undefined, "cheapest-only", "league");
  assert.equal(result.lines[0].resolutionStatus, "NOT_FOUND");
  assert.equal(f.peak(), 0);
});
