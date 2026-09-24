import { spawnSync } from "node:child_process";
import {
  pricingSummarySchemaSql,
  pricingTierBackfillSql,
} from "./pricing-summary-sql";

const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required.");
const url = new URL(configured);
url.searchParams.delete("schema");

function run(sql: string, timeout: number) {
  const result = spawnSync(
    "psql",
    [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    { input: sql, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error("Pricing tier backfill failed or timed out; retry safely.");
  return result.stdout.trim();
}

run(pricingSummarySchemaSql, 120_000);
const [ready, rawMax, sourceMax] = run(
  `SELECT ready::text, (SELECT MAX(id) FROM price_snapshots)::text,
          source_max_id::text FROM price_summary_state WHERE singleton = TRUE;`,
  30_000,
).split("|");
if (ready !== "true" || rawMax !== sourceMax)
  throw new Error(
    "Daily pricing summaries must be current before tier backfill.",
  );

const started = Date.now();
run(pricingTierBackfillSql, 600_000);
run("ANALYZE price_weekly_summary; ANALYZE price_yearly_summary;", 120_000);
const counts = run(
  `SELECT (SELECT COUNT(*) FROM price_weekly_summary),
          (SELECT COUNT(*) FROM price_yearly_summary),
          (SELECT tiers_ready FROM price_summary_state WHERE singleton = TRUE);`,
  30_000,
);
console.log(
  `Pricing weekly/yearly tiers backfilled in ${Date.now() - started} ms: ${counts}`,
);
