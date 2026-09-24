import { spawnSync } from "node:child_process";
import {
  pricingSummarySchemaSql,
  refreshPricingSummariesSql,
} from "./pricing-summary-sql";

const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required.");
const url = new URL(configured);
url.searchParams.delete("schema");

function query(sql: string) {
  const result = spawnSync(
    "psql",
    [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    // psql diagnostics can contain connection details; keep CLI output safe.
    throw new Error("Pricing summary rebuild query failed or timed out.");
  }
  return result.stdout.trim();
}

query(pricingSummarySchemaSql);
query(`UPDATE price_summary_state
       SET ready = FALSE, rebuild_started_at = now()
       WHERE singleton = TRUE;`);
const uuids = JSON.parse(
  query(`SELECT COALESCE(json_agg(mtgjson_uuid), '[]'::json)
         FROM (SELECT DISTINCT mtgjson_uuid FROM price_snapshots
               WHERE mtgjson_uuid IS NOT NULL ORDER BY mtgjson_uuid) keys`),
) as string[];
const started = Date.now();
for (let start = 0; start < uuids.length; start += 50) {
  const slice = uuids.slice(start, start + 50);
  const values = slice.map((uuid) => `'${uuid.replace(/'/g, "''")}'`).join(",");
  const keys = JSON.parse(
    query(`SELECT COALESCE(json_agg(row_to_json(keys)), '[]'::json)
           FROM (SELECT DISTINCT mtgjson_uuid, provider, finish,
                                price_type, currency
                 FROM price_snapshots WHERE mtgjson_uuid IN (${values})) keys`),
  );
  if (keys.length) query(refreshPricingSummariesSql(JSON.stringify(keys)));
  console.log(
    `Rebuilt ${Math.min(start + 50, uuids.length)}/${uuids.length} printings`,
  );
}
query(`ANALYZE price_daily_summary;
       ANALYZE price_scope_summary;
       ANALYZE price_monthly_summary;
       ANALYZE price_weekly_summary;
       ANALYZE price_yearly_summary;`);
query(`UPDATE price_summary_state
       SET ready = TRUE,
           tiers_ready = TRUE,
           source_max_id = (SELECT MAX(id) FROM price_snapshots),
           refreshed_at = now(), rebuild_started_at = NULL
       WHERE singleton = TRUE;`);
console.log(`Pricing summaries rebuilt in ${Date.now() - started} ms.`);
