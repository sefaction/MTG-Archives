import assert from "node:assert/strict";
import test from "node:test";
import { getPricingDashboard } from "../lib/pricing-worker-store";

const ownedCards = [{ mtgjsonUuid: "known-printing", quantity: 2 }];

for (const [view, expectedQueries] of [
  ["collection", 2],
  ["market", 3],
  ["data", 2],
] as const) {
  test(`${view} loads only its pricing queries`, async () => {
    const queries: string[] = [];
    const dashboard = await getPricingDashboard(
      { view, ownedCards },
      async <T>(sql: string): Promise<T[]> => {
        queries.push(sql);
        return [];
      },
    );

    assert.equal(dashboard.available, true);
    assert.equal(queries.length, expectedQueries);
    if (view === "collection") {
      assert(queries.some((sql) => sql.includes('AS "snapshotCount"')));
      assert(queries.some((sql) => sql.includes("AS value")));
      assert(queries.every((sql) => !sql.includes("movement_rows")));
    } else if (view === "market") {
      assert(queries.every((sql) => sql.includes("movement_rows")));
      assert(queries.every((sql) => !sql.includes('AS "snapshotCount"')));
    } else {
      assert(queries.some((sql) => sql.includes('AS "snapshotCount"')));
      assert(queries.some((sql) => sql.includes('AS "pricedCardCount"')));
      assert(queries.every((sql) => !sql.includes("movement_rows")));
    }
  });
}

test("timed-out pricing history reports a recoverable unavailable state", async () => {
  const dashboard = await getPricingDashboard(
    { view: "collection", ownedCards },
    async <T>(): Promise<T[]> => {
      throw new Error("Pricing database request timed out. Try again later.");
    },
  );
  assert.equal(dashboard.available, false);
  assert.match(dashboard.error ?? "", /timed out/);
  assert.deepEqual(dashboard.valueTrend, []);
});

test("an unpriced collection does not scan history", async () => {
  let queries = 0;
  const dashboard = await getPricingDashboard(
    { view: "collection", ownedCards: [] },
    async <T>(): Promise<T[]> => {
      queries++;
      return [];
    },
  );
  assert.equal(queries, 0);
  assert.equal(dashboard.available, true);
  assert.deepEqual(dashboard.valueTrend, []);
});
