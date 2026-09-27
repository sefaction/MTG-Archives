import { spawnSync } from "node:child_process";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";

if (process.argv.length > 2)
  throw new Error("Raw retention planning is read-only and accepts no arguments.");
const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required.");
const url = new URL(configured);
url.searchParams.delete("schema");

const days = getPricingRetentionPolicy().dailyDays;
// Match daily compaction: retain the day exactly `days` before today.
const sql = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH stats AS (
  SELECT COUNT(*) AS raw_count,
         MIN(observed_date) AS raw_min,
         MAX(observed_date) AS raw_max,
         COUNT(*) FILTER (WHERE observed_date <= CURRENT_DATE - ${days + 1}) AS candidate_count,
         COUNT(DISTINCT observed_date) FILTER
           (WHERE observed_date <= CURRENT_DATE - ${days + 1}) AS candidate_days,
         MIN(observed_date) FILTER
           (WHERE observed_date <= CURRENT_DATE - ${days + 1}) AS candidate_min,
         MAX(observed_date) FILTER
           (WHERE observed_date <= CURRENT_DATE - ${days + 1}) AS candidate_max
  FROM price_snapshots
), oldest_days AS (
  SELECT observed_date::text AS date, COUNT(*) AS rows
  FROM price_snapshots
  WHERE observed_date <= CURRENT_DATE - ${days + 1}
  GROUP BY observed_date ORDER BY observed_date LIMIT 30
)
SELECT json_build_object(
  'mode', 'read-only',
  'liveDays', ${days},
  'proposedCutoff', (CURRENT_DATE - ${days + 1})::text,
  'rawCount', stats.raw_count,
  'rawMin', stats.raw_min::text,
  'rawMax', stats.raw_max::text,
  'candidateCount', stats.candidate_count,
  'candidateDays', stats.candidate_days,
  'candidateMin', stats.candidate_min::text,
  'candidateMax', stats.candidate_max::text,
  'oldestCandidateDays', (SELECT COALESCE(json_agg(row_to_json(day)), '[]'::json)
                          FROM oldest_days day),
  'rawRelationBytes', pg_total_relation_size('price_snapshots'),
  'summaryReady', (SELECT ready AND tiers_ready
                   AND source_revision = summary_revision
                   AND source_max_id IS NOT DISTINCT FROM
                       (SELECT MAX(id) FROM price_snapshots)
                   FROM price_summary_state WHERE singleton = TRUE),
  'rawDeletionEnabled', false
)::text FROM stats;
COMMIT;`;

const result = spawnSync(
  "psql",
  [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
  { input: sql, encoding: "utf8", timeout: 240_000, maxBuffer: 1024 * 1024 },
);
if (result.status !== 0)
  throw new Error("Pricing raw retention planning failed or timed out; no data changed.");
const report = JSON.parse(result.stdout.trim());
console.log(JSON.stringify(report, null, 2));
