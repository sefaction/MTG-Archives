import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  pricingSummarySchemaSql,
  refreshPricingSummariesSql,
} from "./pricing-summary-sql";

assert.equal(
  process.env.MTG_LOCAL_PILOT_TEST,
  "1",
  "Local database opt-in required",
);
const configured = process.env.PRICING_DATABASE_URL;
assert.ok(configured, "Test pricing database connection required");
const url = new URL(configured);
assert.ok(
  ["pricing-postgres", "localhost", "127.0.0.1"].includes(url.hostname),
  "Summary verification requires the local pricing database",
);
url.searchParams.delete("schema");

function sql(source: string) {
  const result = spawnSync(
    "psql",
    [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    { input: source, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(`Local summary SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const uuid = `summary-fixture-${randomUUID()}`;
const key = [
  {
    mtgjson_uuid: uuid,
    provider: "tcgplayer",
    finish: "normal",
    price_type: "retail",
    currency: "USD",
  },
];
const refresh = refreshPricingSummariesSql(JSON.stringify(key));
let previousCutoff: string | null = null;
try {
  sql(pricingSummarySchemaSql);
  previousCutoff = sql("SELECT COALESCE(daily_compacted_through::text, '') FROM price_summary_state WHERE singleton = TRUE;");
  sql(`INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES
    ('${uuid}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-07-04', 10),
    ('${uuid}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-07-05', 12),
    ('${uuid}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-08-01', 8);`);
  sql(refresh);
  assert.equal(
    sql(`SELECT snapshot_count || ':' || current_price || ':' || prior_price
         FROM price_scope_summary WHERE mtgjson_uuid = '${uuid}'`),
    "3:8.0000:12.0000",
  );
  assert.equal(
    sql(`SELECT open_price || ':' || close_price || ':' || low_price || ':' || high_price
         FROM price_monthly_summary WHERE mtgjson_uuid = '${uuid}' AND month_start = '2026-07-01'`),
    "10.0000:12.0000:10.0000:12.0000",
  );
  sql(`UPDATE price_snapshots SET price = 15, created_at = now()
       WHERE mtgjson_uuid = '${uuid}' AND observed_date = '2026-07-05'`);
  sql(refresh);
  sql(refresh);
  assert.equal(
    sql(`SELECT COUNT(*) || ':' || MAX(prior_price)
         FROM price_scope_summary WHERE mtgjson_uuid = '${uuid}'`),
    "1:15.0000",
  );
  assert.equal(
    sql(`SELECT close_price || ':' || high_price || ':' || observation_count
         FROM price_monthly_summary WHERE mtgjson_uuid = '${uuid}' AND month_start = '2026-07-01'`),
    "15.0000:15.0000:2",
  );
  assert.equal(
    sql(`SELECT open_price || ':' || close_price || ':' || high_price || ':' || observation_count
         FROM price_weekly_summary WHERE mtgjson_uuid = '${uuid}' AND week_start = '2026-06-29'`),
    "10.0000:15.0000:15.0000:2",
  );
  assert.equal(
    sql(`SELECT open_price || ':' || close_price || ':' || high_price || ':' || observation_count
         FROM price_yearly_summary WHERE mtgjson_uuid = '${uuid}' AND year_start = '2026-01-01'`),
    "10.0000:8.0000:15.0000:3",
  );
  // A past point is compacted from daily only after all longer tiers refresh.
  // A subsequent correction of that raw-backed point must rebuild the tiers.
  assert.equal(previousCutoff, "", "Preservation fixture requires an uncompacted local database");
  sql(`INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES ('${uuid}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-10', 5);
    UPDATE price_summary_state SET daily_compacted_through = '2026-06-29' WHERE singleton = TRUE;`);
  sql(refresh);
  assert.equal(sql(`SELECT COUNT(*) FROM price_daily_summary WHERE mtgjson_uuid = '${uuid}'`), "3");
  assert.equal(sql(`SELECT close_price || ':' || observation_count FROM price_monthly_summary
    WHERE mtgjson_uuid = '${uuid}' AND month_start = '2026-01-01'`), "5.0000:1");
  assert.equal(sql(`SELECT open_price || ':' || observation_count FROM price_yearly_summary
    WHERE mtgjson_uuid = '${uuid}' AND year_start = '2026-01-01'`), "5.0000:4");
  sql(`UPDATE price_snapshots SET price = 7, created_at = now()
    WHERE mtgjson_uuid = '${uuid}' AND observed_date = '2026-01-10'`);
  sql(refresh);
  assert.equal(sql(`SELECT COUNT(*) FROM price_daily_summary WHERE mtgjson_uuid = '${uuid}'`), "3");
  assert.equal(sql(`SELECT close_price || ':' || observation_count FROM price_monthly_summary
    WHERE mtgjson_uuid = '${uuid}' AND month_start = '2026-01-01'`), "7.0000:1");
  assert.equal(sql(`SELECT open_price || ':' || observation_count FROM price_yearly_summary
    WHERE mtgjson_uuid = '${uuid}' AND year_start = '2026-01-01'`), "7.0000:4");
  console.log("Pricing summaries: correction and repeated rebuild passed.");
} finally {
  if (previousCutoff !== null)
    sql(`UPDATE price_summary_state SET daily_compacted_through = ${previousCutoff ? `'${previousCutoff}'::date` : "NULL"} WHERE singleton = TRUE;`);
  sql(`DELETE FROM price_monthly_summary WHERE mtgjson_uuid = '${uuid}';
       DELETE FROM price_weekly_summary WHERE mtgjson_uuid = '${uuid}';
       DELETE FROM price_yearly_summary WHERE mtgjson_uuid = '${uuid}';
       DELETE FROM price_scope_summary WHERE mtgjson_uuid = '${uuid}';
       DELETE FROM price_daily_summary WHERE mtgjson_uuid = '${uuid}';
       DELETE FROM price_snapshots WHERE mtgjson_uuid = '${uuid}';`);
}
