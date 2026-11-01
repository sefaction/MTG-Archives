import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getLeaguePoolAvailability } from "../lib/commander-league-inventory";
test("one linked-positive-stock query classifies exact, alternate and absent cards", async () => {
  const cards = [
    {id: "forest-ust", name: "Forest", oracleId: "forest"},
    {id: "shadow-146", name: "Shadowheart, Dark Justiciar", oracleId: "shadow"},
    {id: "sol", name: "Sol Ring", oracleId: "sol"},
    {id: "legacy", name: "Legacy Name", oracleId: null},
  ];
  let calls = 0;
  const client = {inventoryItem: {findMany: async (query: any) => {
    calls++;
    assert.deepEqual(query.where.quantity, {gt: 0});
    assert.deepEqual(query.where.location, {commanderLeagueLinks: {some: {leagueId: "league"}}});
    assert.deepEqual(query.where.OR[0], {cardId: {in: cards.map(card => card.id)}});
    return [
      {cardId: "forest-ust", quantity: 8, card: {name: "Forest", oracleId: "forest"}},
      {cardId: "shadow-392", quantity: 1, card: {name: "Shadowheart, Dark Justiciar", oracleId: "shadow"}},
      {cardId: "legacy-other", quantity: 1, card: {name: "LEGACY NAME", oracleId: null}},
      {cardId: "different-sol", quantity: 1, card: {name: "Sol Ring", oracleId: "different"}},
    ];
  }}} as unknown as Pick<Prisma.TransactionClient, "inventoryItem">;
  const result = await getLeaguePoolAvailability("league", cards, client);
  assert.equal(calls, 1);
  assert.deepEqual([...result.values()], [
    {status: "IN_POOL", exactQuantity: 8},
    {status: "OTHER_PRINTING", exactQuantity: 0},
    {status: "OUTSIDE_POOL", exactQuantity: 0},
    {status: "OTHER_PRINTING", exactQuantity: 0},
  ]);
});
test("empty deck avoids any inventory query", async () => {
  const client = {inventoryItem: {findMany: async () => {throw new Error("No query expected");}}} as unknown as Pick<Prisma.TransactionClient, "inventoryItem">;
  assert.equal((await getLeaguePoolAvailability("league", [], client)).size, 0);
});
