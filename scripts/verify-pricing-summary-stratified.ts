/** Read-only local parity sample across every observed Pricing scope shape. */
import { spawnSync } from "node:child_process";

if (process.argv.length > 2)
  throw new Error("Stratified Pricing verification is read-only and accepts no arguments");
const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Stratified Pricing verification supports only local databases");
database.searchParams.delete("schema");

const statement = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH ranked AS (
  SELECT s.*,
    row_number() OVER (PARTITION BY provider, currency, finish, price_type
      ORDER BY md5(mtgjson_uuid)) AS representative_rank,
    row_number() OVER (PARTITION BY provider, currency, finish, price_type
      ORDER BY snapshot_count, mtgjson_uuid) AS sparse_rank
  FROM price_scope_summary s
), sample AS (
  SELECT * FROM ranked WHERE representative_rank = 1 OR sparse_rank = 1
), compared AS (
  SELECT s.*, raw.raw_count, raw.raw_days,
    latest.observed_date AS raw_latest_date, latest.price AS raw_current_price,
    latest.id AS raw_current_id, prior.observed_date AS raw_prior_date,
    prior.price AS raw_prior_price, prior.id AS raw_prior_id,
    daily.summary_daily_count
  FROM sample s
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS raw_count,
      count(DISTINCT observed_date)::int AS raw_days
    FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
  ) raw
  LEFT JOIN LATERAL (
    SELECT id, observed_date, price FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
    ORDER BY observed_date DESC, created_at DESC, id DESC LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, observed_date, price FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
      AND r.observed_date < latest.observed_date
    ORDER BY observed_date DESC, created_at DESC, id DESC LIMIT 1
  ) prior ON TRUE
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS summary_daily_count FROM price_daily_summary d
    WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
  ) daily
), result AS (
  SELECT count(*)::int AS sampled_scopes,
    count(DISTINCT (provider, currency, finish, price_type))::int AS combinations,
    min(snapshot_count)::int AS sparsest_raw_count,
    count(*) FILTER (WHERE snapshot_count IS DISTINCT FROM raw_count
      OR summary_daily_count IS DISTINCT FROM raw_days
      OR latest_observed_date IS DISTINCT FROM raw_latest_date
      OR current_price IS DISTINCT FROM raw_current_price
      OR current_snapshot_id IS DISTINCT FROM raw_current_id
      OR prior_observed_date IS DISTINCT FROM raw_prior_date
      OR prior_price IS DISTINCT FROM raw_prior_price
      OR prior_snapshot_id IS DISTINCT FROM raw_prior_id)::int AS mismatches,
    array_agg(DISTINCT currency) AS currencies
  FROM compared
)
SELECT json_build_object('kind', 'scope', 'sampledScopes', sampled_scopes,
  'combinations', combinations, 'sparsestRawCount', sparsest_raw_count,
  'mismatches', mismatches, 'currencies', currencies)::text FROM result;

WITH ranked AS (
  SELECT m.*, row_number() OVER (
    PARTITION BY provider, currency, finish, price_type
    ORDER BY (high_price - low_price) DESC, mtgjson_uuid, month_start
  ) AS movement_rank FROM price_monthly_summary m
), sample AS (SELECT * FROM ranked WHERE movement_rank = 1), compared AS (
  SELECT m.*, raw.open_date AS raw_open_date,
    raw.open_price AS raw_open_price, raw.low_date AS raw_low_date,
    raw.low_price AS raw_low_price, raw.high_date AS raw_high_date,
    raw.high_price AS raw_high_price, raw.close_date AS raw_close_date,
    raw.close_price AS raw_close_price,
    raw.observation_count AS raw_observation_count
  FROM sample m
  CROSS JOIN LATERAL (
    SELECT (array_agg(d.observed_date ORDER BY d.observed_date ASC))[1] AS open_date,
      (array_agg(d.price ORDER BY d.observed_date ASC))[1] AS open_price,
      (array_agg(d.observed_date ORDER BY d.price ASC, d.observed_date ASC))[1] AS low_date,
      min(d.price) AS low_price,
      (array_agg(d.observed_date ORDER BY d.price DESC, d.observed_date ASC))[1] AS high_date,
      max(d.price) AS high_price,
      (array_agg(d.observed_date ORDER BY d.observed_date DESC))[1] AS close_date,
      (array_agg(d.price ORDER BY d.observed_date DESC))[1] AS close_price,
      count(*)::int AS observation_count
    FROM (
      SELECT DISTINCT ON (r.observed_date) r.observed_date, r.price
      FROM price_snapshots r
      WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
        (m.mtgjson_uuid, m.provider, m.finish, m.price_type, m.currency)
        AND date_trunc('month', r.observed_date)::date = m.month_start
      ORDER BY r.observed_date, r.created_at DESC, r.id DESC
    ) d
  ) raw
), result AS (
  SELECT count(*)::int AS sampled_months,
    count(DISTINCT (provider, currency, finish, price_type))::int AS combinations,
    max(high_price - low_price) AS max_absolute_movement,
    count(*) FILTER (WHERE open_date IS DISTINCT FROM raw_open_date
      OR open_price IS DISTINCT FROM raw_open_price
      OR low_date IS DISTINCT FROM raw_low_date
      OR low_price IS DISTINCT FROM raw_low_price
      OR high_date IS DISTINCT FROM raw_high_date
      OR high_price IS DISTINCT FROM raw_high_price
      OR close_date IS DISTINCT FROM raw_close_date
      OR close_price IS DISTINCT FROM raw_close_price
      OR observation_count IS DISTINCT FROM raw_observation_count)::int AS mismatches
  FROM compared
)
SELECT json_build_object('kind', 'monthlyMovement', 'sampledMonths', sampled_months,
  'combinations', combinations, 'maxAbsoluteMovement', max_absolute_movement,
  'mismatches', mismatches)::text FROM result;
COMMIT;`;

const result = spawnSync("psql", [database.toString(), "-X", "-v", "ON_ERROR_STOP=1",
  "-q", "-t", "-A", "-f", "-"],
{ input: statement, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
if (result.status !== 0)
  throw new Error(`Stratified Pricing verification failed: ${result.stderr.trim().slice(0, 500)}`);
const lines = result.stdout.trim().split(/\r?\n/);
if (lines.length !== 2) throw new Error("Expected scope and monthly parity reports");
const [scope, monthly] = lines.map((line) => JSON.parse(line)) as [
  { kind: string; sampledScopes: number; combinations: number;
    sparsestRawCount: number; mismatches: number; currencies: string[] },
  { kind: string; sampledMonths: number; combinations: number;
    maxAbsoluteMovement: number; mismatches: number },
];
if (scope.kind !== "scope" || monthly.kind !== "monthlyMovement" ||
    scope.combinations === 0 || scope.combinations !== monthly.combinations ||
    scope.sampledScopes < scope.combinations ||
    monthly.sampledMonths !== monthly.combinations ||
    scope.mismatches !== 0 || monthly.mismatches !== 0)
  throw new Error(`Stratified Pricing parity failed: ${JSON.stringify({ scope, monthly })}`);
console.log(JSON.stringify({ mode: "read-only-stratified-parity", scope, monthly }, null, 2));
