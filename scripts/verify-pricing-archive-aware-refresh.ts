import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  pricingSummarySchemaSql,
  pricingTierBackfillSql,
  refreshPricingSummariesSql,
} from "./pricing-summary-sql";

assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1", "Local/CI database opt-in required");
const configured = process.env.PRICING_DATABASE_URL;
assert.ok(configured, "PRICING_DATABASE_URL is required");
const source = new URL(configured);
assert.ok(
  ["pricing-postgres", "localhost", "127.0.0.1"].includes(source.hostname),
  "Archive refresh verification requires a local/CI PostgreSQL host",
);
source.searchParams.delete("schema");
const admin = new URL(source);
admin.pathname = "/postgres";
const name = `pricing_archive_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const testDatabase = new URL(source);
testDatabase.pathname = `/${name}`;

function sql(database: URL, statement: string, expectFailure = false) {
  const result = spawnSync(
    "psql",
    [database.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    { input: statement, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (expectFailure) {
    assert.notEqual(result.status, 0, "Expected archive overlap or backfill rejection");
    return "";
  }
  if (result.status !== 0)
    throw new Error(`Archive refresh SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const card = `archive-fixture-${randomUUID()}`;
const sparse = `archive-sparse-${randomUUID()}`;
const keys = [card, sparse].map((mtgjson_uuid) => ({
  mtgjson_uuid,
  provider: "tcgplayer",
  finish: "normal",
  price_type: "retail",
  currency: "USD",
}));
const refresh = refreshPricingSummariesSql(JSON.stringify(keys));
let created = false;
try {
  sql(admin, `CREATE DATABASE "${name}";`);
  created = true;
  sql(testDatabase, `CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY,
    mtgjson_uuid TEXT NOT NULL, provider TEXT NOT NULL, finish TEXT NOT NULL,
    price_type TEXT NOT NULL, currency TEXT NOT NULL, observed_date DATE NOT NULL,
    price NUMERIC(12, 4) NOT NULL, card_name TEXT, set_code TEXT,
    collector_number TEXT, revision_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`);
  sql(testDatabase, pricingSummarySchemaSql);
  sql(testDatabase, `INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-10', 7),
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-11', 9),
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-08-01', 8),
    ('${sparse}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-05', 4);`);
  sql(testDatabase, refresh);

  // Stage complete archive-only scope metadata and per-period partial tiers.
  sql(testDatabase, `INSERT INTO price_archived_scope_summary
    (mtgjson_uuid, provider, finish, price_type, currency, snapshot_count,
     latest_observed_date, latest_ingested_at, current_price, current_snapshot_id)
    SELECT mtgjson_uuid, provider, finish, price_type, currency, 1,
           observed_date, created_at, price, id
    FROM price_snapshots WHERE observed_date IN ('2026-01-05', '2026-01-10');
  ${["month", "week", "year"]
    .map(
      (period) => `INSERT INTO price_archived_${period === "month" ? "monthly" : period === "week" ? "weekly" : "yearly"}_summary
      (mtgjson_uuid, provider, finish, price_type, currency, ${period}_start,
       open_date, open_price, low_date, low_price, high_date, high_price,
       close_date, close_price, observation_count)
      SELECT mtgjson_uuid, provider, finish, price_type, currency,
             date_trunc('${period}', observed_date)::date,
             observed_date, price, observed_date, price, observed_date, price,
             observed_date, price, 1
      FROM price_snapshots WHERE observed_date IN ('2026-01-05', '2026-01-10');`,
    )
    .join("\n")}
  UPDATE price_summary_state SET raw_archived_through = '2026-01-10',
    daily_compacted_through = '2026-01-10' WHERE singleton = TRUE;`);
  sql(testDatabase, refresh, true); // Prevent counting live and archived Jan rows twice.
  sql(testDatabase, `DELETE FROM price_snapshots
    WHERE observed_date <= '2026-01-10';`);
  sql(testDatabase, refresh);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' || prior_price
      FROM price_scope_summary WHERE mtgjson_uuid = '${card}'`),
    "3:8.0000:9.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' ||
      COALESCE(prior_price::text, 'none') FROM price_scope_summary
      WHERE mtgjson_uuid = '${sparse}'`),
    "1:4.0000:none",
  );
  for (const [table, periodStart, expected] of [
    ["price_monthly_summary", "2026-01-01", "7.0000:9.0000:7.0000:9.0000:2"],
    ["price_weekly_summary", "2026-01-05", "7.0000:9.0000:7.0000:9.0000:2"],
    ["price_yearly_summary", "2026-01-01", "7.0000:8.0000:7.0000:9.0000:3"],
  ]) {
    assert.equal(
      sql(testDatabase, `SELECT open_price || ':' || close_price || ':' ||
        low_price || ':' || high_price || ':' || observation_count
        FROM ${table} WHERE mtgjson_uuid = '${card}' AND
        ${table === "price_monthly_summary" ? "month_start" : table === "price_weekly_summary" ? "week_start" : "year_start"} = '${periodStart}'`),
      expected,
    );
  }
  assert.equal(
    sql(testDatabase, `SELECT COUNT(*) FROM price_daily_summary WHERE mtgjson_uuid = '${sparse}'`),
    "0",
  );
  sql(testDatabase, pricingTierBackfillSql, true);

  // A later ordinary import must keep the archived prefix intact.
  sql(testDatabase, `INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-09-01', 11);`);
  sql(testDatabase, refresh);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' || prior_price
      FROM price_scope_summary WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000:8.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT observation_count || ':' || high_price FROM price_yearly_summary
      WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000",
  );

  // Full rebuild must enumerate an archive-only sparse scope.
  sql(testDatabase, `TRUNCATE price_daily_summary, price_scope_summary,
    price_monthly_summary, price_weekly_summary, price_yearly_summary;`);
  const rebuilt = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-summary-rebuild.ts"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString() },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (rebuilt.status !== 0)
    throw new Error(`Archive-aware full rebuild failed: ${rebuilt.stderr.trim()}`);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price FROM price_scope_summary
      WHERE mtgjson_uuid = '${sparse}'`),
    "1:4.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT observation_count || ':' || high_price FROM price_yearly_summary
      WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000",
  );
  console.log("Archive-aware refresh, sparse scope and full rebuild passed.");
} finally {
  if (created) sql(admin, `DROP DATABASE "${name}" WITH (FORCE);`);
}
