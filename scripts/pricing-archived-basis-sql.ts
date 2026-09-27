const scopeKey = "mtgjson_uuid, provider, finish, price_type, currency";

function archivedTierRebuild(table: string, period: string, periodColumn: string) {
  const bucket = `date_trunc('${period}', b.observed_date)::date`;
  return `DELETE FROM price_archived_${table}_summary a USING touched_price_keys k
    WHERE (a.${scopeKey.replaceAll(", ", ", a.")}) =
          (k.${scopeKey.replaceAll(", ", ", k.")});
  INSERT INTO price_archived_${table}_summary (
    ${scopeKey}, ${periodColumn}, open_date, open_price, low_date, low_price,
    high_date, high_price, close_date, close_price, observation_count)
  SELECT b.mtgjson_uuid, b.provider, b.finish, b.price_type, b.currency,
    ${bucket},
    (array_agg(b.observed_date ORDER BY b.observed_date ASC))[1],
    (array_agg(b.price ORDER BY b.observed_date ASC))[1],
    (array_agg(b.observed_date ORDER BY b.price ASC, b.observed_date ASC))[1],
    MIN(b.price),
    (array_agg(b.observed_date ORDER BY b.price DESC, b.observed_date ASC))[1],
    MAX(b.price),
    (array_agg(b.observed_date ORDER BY b.observed_date DESC))[1],
    (array_agg(b.price ORDER BY b.observed_date DESC))[1],
    COUNT(*)::int
  FROM price_archived_daily_basis b JOIN touched_price_keys k
    ON (b.${scopeKey.replaceAll(", ", ", b.")}) =
       (k.${scopeKey.replaceAll(", ", ", k.")})
  GROUP BY b.mtgjson_uuid, b.provider, b.finish, b.price_type, b.currency,
    ${bucket};`;
}

/** Requires a transaction and touched_price_keys temp table in the caller. */
export const archivedBasisRebuildBodySql = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM price_archived_scope_summary a JOIN touched_price_keys k
    ON (a.${scopeKey.replaceAll(", ", ", a.")}) =
       (k.${scopeKey.replaceAll(", ", ", k.")})
    WHERE NOT EXISTS (SELECT 1 FROM price_archived_daily_basis b
      WHERE (b.${scopeKey.replaceAll(", ", ", b.")}) =
            (a.${scopeKey.replaceAll(", ", ", a.")})))
  THEN RAISE EXCEPTION 'Archived scope has no daily basis; restore its raw archive before rebuilding'; END IF;
END $$;
DELETE FROM price_archived_scope_summary a USING touched_price_keys k
WHERE (a.${scopeKey.replaceAll(", ", ", a.")}) =
      (k.${scopeKey.replaceAll(", ", ", k.")});
INSERT INTO price_archived_scope_summary (
  ${scopeKey}, snapshot_count, latest_observed_date, latest_ingested_at,
  current_price, current_snapshot_id, prior_observed_date, prior_price,
  prior_snapshot_id)
SELECT b.mtgjson_uuid, b.provider, b.finish, b.price_type, b.currency,
  SUM(b.raw_count)::int,
  MAX(b.observed_date), MAX(b.latest_ingested_at),
  (array_agg(b.price ORDER BY b.observed_date DESC))[1],
  (array_agg(b.source_snapshot_id ORDER BY b.observed_date DESC))[1],
  (array_agg(b.observed_date ORDER BY b.observed_date DESC))[2],
  (array_agg(b.price ORDER BY b.observed_date DESC))[2],
  (array_agg(b.source_snapshot_id ORDER BY b.observed_date DESC))[2]
FROM price_archived_daily_basis b JOIN touched_price_keys k
  ON (b.${scopeKey.replaceAll(", ", ", b.")}) =
     (k.${scopeKey.replaceAll(", ", ", k.")})
GROUP BY b.mtgjson_uuid, b.provider, b.finish, b.price_type, b.currency;
${archivedTierRebuild("monthly", "month", "month_start")}
${archivedTierRebuild("weekly", "week", "week_start")}
${archivedTierRebuild("yearly", "year", "year_start")}
`;

export function rebuildArchivedSummariesSql(keysJson: string) {
  return `BEGIN;
CREATE TEMP TABLE touched_price_keys ON COMMIT DROP AS
SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
FROM jsonb_to_recordset('${keysJson.replace(/'/g, "''")}'::jsonb)
  AS k(mtgjson_uuid text, provider text, finish text, price_type text, currency text);
${archivedBasisRebuildBodySql}
COMMIT;`;
}
