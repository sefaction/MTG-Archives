import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getCachedPricingCollectionTrend, getPricingDashboard } from
  "../lib/pricing-worker-store";

const ownedCards = [{ mtgjsonUuid: "known-printing", quantity: 2 }];

test("collection trend cache shares identical reads but refreshes after holdings or summary changes", async () => {
  const sql = `holdings-${randomUUID()}`;
  let calls = 0;
  const load = async () => { calls++; return [{ observedDate: "2026-09-25", value: calls }]; };
  const [first, repeated] = await Promise.all([
    getCachedPricingCollectionTrend(sql, "revision-1", load),
    getCachedPricingCollectionTrend(sql, "revision-1", load),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, repeated);
  await getCachedPricingCollectionTrend(`${sql}-new-quantity`, "revision-1", load);
  await getCachedPricingCollectionTrend(sql, "revision-2", load);
  assert.equal(calls, 3);
  const failedSql = `${sql}-failed`;
  await assert.rejects(getCachedPricingCollectionTrend(failedSql, "revision-1",
    async () => { throw new Error("temporary query error"); }));
  const recovered = await getCachedPricingCollectionTrend(failedSql, "revision-1", load);
  assert.equal(recovered[0].value, 4);
});

for (const [view, expectedQueries] of [
  ["collection", 3],
  ["market", 3],
  ["data", 3],
] as const) {
  test(`${view} loads only its pricing queries`, async () => {
    const queries: string[] = [];
    const dashboard = await getPricingDashboard(
      { view, ownedCards },
      async <T>(sql: string): Promise<T[]> => {
        queries.push(sql);
        if (sql.includes("FROM price_summary_state"))
          return [{ ready: true, sourceMaxId: 1, rawMaxId: 1 }] as T[];
        return [];
      },
    );

    assert.equal(dashboard.available, true);
    assert.equal(queries.length, expectedQueries);
    assert(
      queries.slice(1).every((sql) => !sql.includes("FROM price_snapshots")),
    );
    if (view === "collection") {
      assert(queries.some((sql) => sql.includes('AS "snapshotCount"')));
      assert(queries.some((sql) => sql.includes("AS value")));
      assert(queries.every((sql) => !sql.includes("movement_rows")));
    } else if (view === "market") {
      assert(queries.some((sql) => sql.includes("movement_rows")));
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

test("new raw observations invalidate a stale summary", async () => {
  let queries = 0;
  const dashboard = await getPricingDashboard(
    { view: "market", ownedCards },
    async <T>(): Promise<T[]> => {
      queries++;
      return [{ ready: true, sourceMaxId: 1, rawMaxId: 2 }] as T[];
    },
  );
  assert.equal(queries, 1);
  assert.equal(dashboard.available, false);
  assert.match(dashboard.error ?? "", /behind new observations/);
});

test("Market returns three bounded rankings from one summary query", async () => {
  const sample = {
    mtgjsonUuid: "known-printing",
    cardName: null,
    setCode: null,
    collectorNumber: null,
    startPrice: 1,
    currentPrice: 2,
    absoluteChange: 1,
    percentChange: 100,
    startObservedDate: "2026-09-22",
    currentObservedDate: "2026-09-23",
  };
  const dashboard = await getPricingDashboard(
    { view: "market", ownedCards },
    async <T>(sql: string): Promise<T[]> =>
      sql.includes("FROM price_summary_state")
        ? ([{ ready: true, sourceMaxId: 1, rawMaxId: 1 }] as T[])
        : sql.includes("movement_rows")
          ? ([
              { ...sample, category: "gainer" },
              { ...sample, category: "percent" },
            ] as T[])
          : ([] as T[]),
  );
  assert.equal(dashboard.topGainers.length, 1);
  assert.equal(dashboard.topLosers.length, 0);
  assert.equal(dashboard.topPercentMoves.length, 1);
});

test("set filter scopes owned printings before the summary query", async () => {
  const queries: string[] = [];
  await getPricingDashboard(
    {
      view: "data",
      setCode: "MH3",
      ownedCards: [
        { mtgjsonUuid: "included", quantity: 2, setCode: "mh3" },
        { mtgjsonUuid: "excluded", quantity: 1, setCode: "woe" },
      ],
    },
    async <T>(sql: string): Promise<T[]> => {
      queries.push(sql);
      if (sql.includes("FROM price_summary_state"))
        return [{ ready: true, sourceMaxId: 1, rawMaxId: 1 }] as T[];
      return [];
    },
  );
  assert(queries.slice(1).every((sql) => sql.includes("included")));
  assert(queries.slice(1).every((sql) => !sql.includes("excluded")));
});

test("finish filter excludes differently finished copies of one printing", async () => {
  const queries: string[] = [];
  await getPricingDashboard(
    {
      view: "data",
      finish: "foil",
      ownedCards: [
        { mtgjsonUuid: "normal-only", finish: "normal", quantity: 9 },
        { mtgjsonUuid: "foil-owned", finish: "foil", quantity: 2 },
      ],
    },
    async <T>(sql: string): Promise<T[]> => {
      queries.push(sql);
      if (sql.includes("FROM price_summary_state"))
        return [{ ready: true, sourceMaxId: 1, rawMaxId: 1 }] as T[];
      return [];
    },
  );
  assert(queries.slice(1).every((sql) => sql.includes("foil-owned")));
  assert(queries.slice(1).every((sql) => !sql.includes("normal-only")));
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
