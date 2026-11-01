import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { areAllPrintingsInLeague, isPrintingInLeague } from "../lib/commander-league-inventory";

type Stock = { cardId: string; quantity: number; leagues: string[] };
function fixture(stock: Stock[]) {
  const calls: Array<Record<string, any>> = [];
  const matching = (query: Record<string, any>) => {
    const where = query.where;
    assert.deepEqual(where.quantity, {gt: 0});
    const league = where.location.commanderLeagueLinks.some.leagueId;
    const requested = typeof where.cardId === "string" ? [where.cardId] : where.cardId.in;
    return stock.filter(item => item.quantity > 0 && item.leagues.includes(league) && requested.includes(item.cardId));
  };
  const client = {inventoryItem: {
    groupBy: async (query: Record<string, any>) => {
      calls.push(query);assert.deepEqual(query.by, ["cardId"]);
      return [...new Set(matching(query).map(item => item.cardId))].map(cardId => ({cardId}));
    },
    findFirst: async (query: Record<string, any>) => matching(query)[0] ? {id: "stock"} : null,
  }} as unknown as Pick<Prisma.TransactionClient, "inventoryItem">;
  return {client, calls};
}

test("100-card League validation uses one database query with the original linked-positive-stock rule", async () => {
  const ids = Array.from({length: 100}, (_, i) => `printing-${i}`);
  const f = fixture(ids.map(cardId => ({cardId, quantity: 1, leagues: ["league"]})));
  assert.equal(await areAllPrintingsInLeague("league", ids, f.client), true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].where.cardId, {in: ids});
});

test("one unavailable printing rejects the entire list", async () => {
  const f = fixture([{cardId: "present", quantity: 1, leagues: ["league"]}]);
  assert.equal(await areAllPrintingsInLeague("league", ["present", "absent"], f.client), false);
  assert.equal(f.calls.length, 1);
});

test("duplicate deck entries and multiple pool locations do not change availability", async () => {
  const f = fixture([{cardId: "same", quantity: 1, leagues: ["league"]}, {cardId: "same", quantity: 8, leagues: ["league"]}]);
  assert.equal(await areAllPrintingsInLeague("league", ["same", "same"], f.client), true);
  assert.deepEqual(f.calls[0].where.cardId, {in: ["same"]});
});

test("empty input does not consume a database connection", async () => {
  const f = fixture([]);assert.equal(await areAllPrintingsInLeague("league", [], f.client), true);assert.equal(f.calls.length, 0);
});

for (const [name, stock] of [
  ["zero stock", [{cardId: "forest-ust216", quantity: 0, leagues: ["league"]}]],
  ["unlinked inventory", [{cardId: "forest-ust216", quantity: 8, leagues: []}]],
  ["another League", [{cardId: "forest-ust216", quantity: 8, leagues: ["other"]}]],
  ["another printing of the same basic land", [{cardId: "forest-other", quantity: 8, leagues: ["league"]}]],
] as Array<[string, Stock[]]>) test(`${name} cannot satisfy the requested exact printing`, async () => {
  const f = fixture(stock);assert.equal(await areAllPrintingsInLeague("league", ["forest-ust216"], f.client), false);
});

test("batch and existing single-printing checks agree across mixed League stock", async () => {
  const f = fixture(Array.from({length: 40}, (_, i) => ({cardId: `p${i}`, quantity: i % 3, leagues: i % 2 ? ["a"] : ["b", "a"]})));
  for (const league of ["a", "b", "unlinked"]) for (const ids of [["p1"], ["p2", "p4"], ["p1", "p3"], ["p2", "missing"], ["p1", "p1"], []]) {
    const expected = (await Promise.all(ids.map(id => isPrintingInLeague(league, id, f.client)))).every(Boolean);
    assert.equal(await areAllPrintingsInLeague(league, ids, f.client), expected, `${league}:${ids}`);
  }
});

test("database errors propagate instead of bypassing League validation", async () => {
  const error = Object.assign(new Error("Too many clients already"), {code: "P2037"});
  const client = {inventoryItem: {groupBy: async () => {throw error;}}} as unknown as Pick<Prisma.TransactionClient, "inventoryItem">;
  await assert.rejects(areAllPrintingsInLeague("league", ["card"], client), caught => caught === error);
});
