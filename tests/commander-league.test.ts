import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueCardStats,
  buildLeagueStandings,
  finishScore,
  pointsForResult,
} from "../lib/commander-league";

test("scores win, loss, and draw results from league settings", () => {
  const scoring = { winPoints: 5, drawPoints: 2, lossPoints: 1 };
  assert.equal(pointsForResult("WIN", scoring), 5);
  assert.equal(pointsForResult("DRAW", scoring), 2);
  assert.equal(pointsForResult("LOSS", scoring), 1);
});

test("uses elimination finish as the first standings tiebreaker", () => {
  assert.equal(finishScore(4, 1), 4);
  assert.equal(finishScore(4, 4), 1);
  const standings = buildLeagueStandings([
    {
      memberId: "a",
      displayName: "Alice",
      result: "LOSS",
      pointsAwarded: 0,
      finishPosition: 2,
      participantCount: 4,
    },
    {
      memberId: "b",
      displayName: "Bob",
      result: "LOSS",
      pointsAwarded: 0,
      finishPosition: 3,
      participantCount: 4,
    },
  ]);
  assert.deepEqual(
    standings.map((row) => row.memberId),
    ["a", "b"],
  );
});

test("aggregates immutable snapshot cards by oracle identity", () => {
  const stats = buildLeagueCardStats([
    { cardName: "Sol Ring", oracleId: "sol", quantity: 1, isCommander: false },
    { cardName: "Sol Ring", oracleId: "sol", quantity: 1, isCommander: false },
    { cardName: "Muldrotha", oracleId: "cmd", quantity: 1, isCommander: true },
  ]);
  assert.equal(stats.uniqueCards, 2);
  assert.equal(stats.totalCopies, 3);
  assert.equal(stats.topCards[0].cardName, "Sol Ring");
  assert.equal(stats.commanders[0].cardName, "Muldrotha");
});
