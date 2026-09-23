import assert from "node:assert/strict";
import { queryPricingJson } from "../lib/pricing-db-query";

async function main() {
  assert.equal(
    process.env.MTG_LOCAL_PILOT_TEST,
    "1",
    "Opt in to database verification",
  );
  assert.ok(
    process.env.PRICING_DATABASE_URL,
    "A test pricing connection is required",
  );
  assert.deepEqual(
    await queryPricingJson("SELECT 0 AS count, '雪'::text AS label"),
    [{ count: 0, label: "雪" }],
  );
  assert.deepEqual(await queryPricingJson("SELECT 1 AS count WHERE false"), []);
  // A real slow PostgreSQL query must leave the Node event loop available.
  let completed = false;
  const slow = queryPricingJson("SELECT 1 AS count FROM pg_sleep(0.6)").then(
    (rows) => {
      completed = true;
      return rows;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    completed,
    false,
    "Database work must not block the timer/event loop",
  );
  assert.deepEqual(await slow, [{ count: 1 }]);
  const started = Date.now();
  await assert.rejects(
    queryPricingJson("SELECT * FROM pg_sleep(10)", { timeoutMs: 100 }),
    /time limit|timed out/,
  );
  assert.ok(
    Date.now() - started < 5000,
    "Statement timeout must terminate the query promptly",
  );
  await assert.rejects(
    queryPricingJson("SELECT secret_marker FROM nonexistent_secret_table"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(
        error.message,
        /secret_marker|nonexistent_secret_table|postgresql:|password/i,
      );
      return true;
    },
  );
  // Verify the connection is read-only without attempting to alter any application data.
  assert.deepEqual(
    await queryPricingJson(
      "SELECT current_setting('transaction_read_only') AS readonly",
    ),
    [{ readonly: "on" }],
  );
  console.log(
    "Pricing PostgreSQL checks passed: Unicode/zero/empty results, nonblocking query, bounded timeout, sanitized failure, read-only connection.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
