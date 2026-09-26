/** Compact, rebuildable projections. Raw observations remain authoritative. */
function rollupSchema(table: string, periodColumn: string) {
  return `CREATE TABLE IF NOT EXISTS ${table} (
  mtgjson_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  ${periodColumn} DATE NOT NULL,
  open_date DATE NOT NULL,
  open_price NUMERIC(12, 4) NOT NULL,
  low_date DATE NOT NULL,
  low_price NUMERIC(12, 4) NOT NULL,
  high_date DATE NOT NULL,
  high_price NUMERIC(12, 4) NOT NULL,
  close_date DATE NOT NULL,
  close_price NUMERIC(12, 4) NOT NULL,
  observation_count INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mtgjson_uuid, provider, finish, price_type, currency, ${periodColumn})
);
CREATE INDEX IF NOT EXISTS ${table}_scope_period_idx
  ON ${table} (provider, finish, price_type, currency, ${periodColumn} DESC, mtgjson_uuid);`;
}

function refreshRollupSql(table: string, periodColumn: string, period: string) {
  const bucket = `date_trunc('${period}', d.observed_date)::date`;
  const archivedTable = table.replace("price_", "price_archived_");
  return `DELETE FROM ${table} r USING touched_price_keys k
WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency);
INSERT INTO ${table} (
  mtgjson_uuid, provider, finish, price_type, currency, ${periodColumn},
  open_date, open_price, low_date, low_price, high_date, high_price,
  close_date, close_price, observation_count
)
WITH live AS (
  SELECT d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency,
         ${bucket} AS ${periodColumn},
         (array_agg(d.observed_date ORDER BY d.observed_date ASC))[1] AS open_date,
         (array_agg(d.price ORDER BY d.observed_date ASC))[1] AS open_price,
         (array_agg(d.observed_date ORDER BY d.price ASC, d.observed_date ASC))[1] AS low_date,
         MIN(d.price) AS low_price,
         (array_agg(d.observed_date ORDER BY d.price DESC, d.observed_date ASC))[1] AS high_date,
         MAX(d.price) AS high_price,
         (array_agg(d.observed_date ORDER BY d.observed_date DESC))[1] AS close_date,
         (array_agg(d.price ORDER BY d.observed_date DESC))[1] AS close_price,
         COUNT(*)::int AS observation_count
  FROM price_daily_summary d JOIN touched_price_keys k
    ON (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
       (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
  GROUP BY d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency,
           ${bucket}
), archived AS (
  SELECT a.* FROM ${archivedTable} a JOIN touched_price_keys k
    ON (a.mtgjson_uuid, a.provider, a.finish, a.price_type, a.currency) =
       (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
)
SELECT COALESCE(l.mtgjson_uuid, a.mtgjson_uuid),
       COALESCE(l.provider, a.provider), COALESCE(l.finish, a.finish),
       COALESCE(l.price_type, a.price_type), COALESCE(l.currency, a.currency),
       COALESCE(l.${periodColumn}, a.${periodColumn}),
       CASE WHEN a.open_date IS NULL OR
                 (l.open_date IS NOT NULL AND l.open_date < a.open_date)
            THEN l.open_date ELSE a.open_date END,
       CASE WHEN a.open_date IS NULL OR
                 (l.open_date IS NOT NULL AND l.open_date < a.open_date)
            THEN l.open_price ELSE a.open_price END,
       CASE WHEN a.low_price IS NULL OR
                 (l.low_price IS NOT NULL AND (l.low_price < a.low_price OR
                   (l.low_price = a.low_price AND l.low_date < a.low_date)))
            THEN l.low_date ELSE a.low_date END,
       LEAST(l.low_price, a.low_price),
       CASE WHEN a.high_price IS NULL OR
                 (l.high_price IS NOT NULL AND (l.high_price > a.high_price OR
                   (l.high_price = a.high_price AND l.high_date < a.high_date)))
            THEN l.high_date ELSE a.high_date END,
       GREATEST(l.high_price, a.high_price),
       CASE WHEN a.close_date IS NULL OR
                 (l.close_date IS NOT NULL AND l.close_date > a.close_date)
            THEN l.close_date ELSE a.close_date END,
       CASE WHEN a.close_date IS NULL OR
                 (l.close_date IS NOT NULL AND l.close_date > a.close_date)
            THEN l.close_price ELSE a.close_price END,
       COALESCE(l.observation_count, 0) + COALESCE(a.observation_count, 0)
FROM live l FULL JOIN archived a
  ON (l.mtgjson_uuid, l.provider, l.finish, l.price_type, l.currency, l.${periodColumn}) =
     (a.mtgjson_uuid, a.provider, a.finish, a.price_type, a.currency, a.${periodColumn});`;
}

export const pricingSummarySchemaSql = `
CREATE TABLE IF NOT EXISTS price_daily_summary (
  mtgjson_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  observed_date DATE NOT NULL,
  price NUMERIC(12, 4) NOT NULL,
  card_name TEXT,
  set_code TEXT,
  collector_number TEXT,
  source_snapshot_id BIGINT NOT NULL,
  source_revision_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (mtgjson_uuid, provider, finish, price_type, currency, observed_date)
);

CREATE TABLE IF NOT EXISTS price_scope_summary (
  mtgjson_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL,
  latest_observed_date DATE NOT NULL,
  latest_ingested_at TIMESTAMPTZ NOT NULL,
  current_price NUMERIC(12, 4) NOT NULL,
  current_snapshot_id BIGINT NOT NULL,
  prior_observed_date DATE,
  prior_price NUMERIC(12, 4),
  prior_snapshot_id BIGINT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mtgjson_uuid, provider, finish, price_type, currency)
);

ALTER TABLE price_daily_summary ADD COLUMN IF NOT EXISTS card_name TEXT;
ALTER TABLE price_daily_summary ADD COLUMN IF NOT EXISTS set_code TEXT;
ALTER TABLE price_daily_summary ADD COLUMN IF NOT EXISTS collector_number TEXT;
ALTER TABLE price_daily_summary ADD COLUMN IF NOT EXISTS source_revision_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS price_monthly_summary (
  mtgjson_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  month_start DATE NOT NULL,
  open_date DATE NOT NULL,
  open_price NUMERIC(12, 4) NOT NULL,
  low_date DATE NOT NULL,
  low_price NUMERIC(12, 4) NOT NULL,
  high_date DATE NOT NULL,
  high_price NUMERIC(12, 4) NOT NULL,
  close_date DATE NOT NULL,
  close_price NUMERIC(12, 4) NOT NULL,
  observation_count INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mtgjson_uuid, provider, finish, price_type, currency, month_start)
);

${rollupSchema("price_weekly_summary", "week_start")}
${rollupSchema("price_yearly_summary", "year_start")}

-- Activated archive summaries are an immutable basis for ordinary refreshes.
-- They remain empty until a separately verified raw archive activates them.
CREATE TABLE IF NOT EXISTS price_archived_scope_summary
  (LIKE price_scope_summary INCLUDING ALL);
${rollupSchema("price_archived_monthly_summary", "month_start")}
${rollupSchema("price_archived_weekly_summary", "week_start")}
${rollupSchema("price_archived_yearly_summary", "year_start")}
CREATE TABLE IF NOT EXISTS price_archived_daily_basis (
  mtgjson_uuid TEXT NOT NULL,
  provider TEXT NOT NULL,
  finish TEXT NOT NULL,
  price_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  observed_date DATE NOT NULL,
  price NUMERIC(12, 4) NOT NULL,
  source_snapshot_id BIGINT NOT NULL,
  source_revision_count INTEGER NOT NULL,
  current_ingested_at TIMESTAMPTZ NOT NULL,
  raw_count INTEGER NOT NULL,
  latest_ingested_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (mtgjson_uuid, provider, finish, price_type, currency, observed_date)
);
CREATE INDEX IF NOT EXISTS price_archived_daily_basis_scope_date_idx
  ON price_archived_daily_basis (provider, finish, price_type, currency,
    observed_date DESC, mtgjson_uuid);
CREATE TABLE IF NOT EXISTS price_raw_archive_segment (
  observed_date DATE PRIMARY KEY,
  archive_path TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  csv_sha256 TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  identity_fingerprint TEXT,
  raw_rows INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  backup_path TEXT NOT NULL,
  backup_sha256 TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE price_raw_archive_segment ADD COLUMN IF NOT EXISTS identity_fingerprint TEXT;
CREATE TABLE IF NOT EXISTS price_archive_feed_queue (
  observed_date DATE NOT NULL,
  identity_fingerprint TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  spool_path TEXT NOT NULL,
  spool_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  applied_count INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error TEXT,
  PRIMARY KEY (observed_date, identity_fingerprint)
);
ALTER TABLE price_archive_feed_queue ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS price_archive_feed_queue_pending_idx
  ON price_archive_feed_queue (status, observed_date, queued_at);

CREATE TABLE IF NOT EXISTS price_summary_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  tiers_ready BOOLEAN NOT NULL DEFAULT FALSE,
  source_max_id BIGINT,
  source_revision BIGINT NOT NULL DEFAULT 0,
  summary_revision BIGINT NOT NULL DEFAULT 0,
  daily_compacted_through DATE,
  raw_archived_through DATE,
  refreshed_at TIMESTAMPTZ,
  rebuild_started_at TIMESTAMPTZ
);
ALTER TABLE price_summary_state ADD COLUMN IF NOT EXISTS source_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE price_summary_state ADD COLUMN IF NOT EXISTS summary_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE price_summary_state ADD COLUMN IF NOT EXISTS tiers_ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE price_summary_state ADD COLUMN IF NOT EXISTS daily_compacted_through DATE;
ALTER TABLE price_summary_state ADD COLUMN IF NOT EXISTS raw_archived_through DATE;
INSERT INTO price_summary_state (singleton, ready)
VALUES (TRUE, FALSE) ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS price_daily_summary_scope_date_idx
  ON price_daily_summary (provider, finish, price_type, currency, observed_date DESC, mtgjson_uuid);
CREATE INDEX IF NOT EXISTS price_daily_summary_ingested_scope_idx
  ON price_daily_summary (created_at, provider, finish, price_type, currency, mtgjson_uuid);
CREATE INDEX IF NOT EXISTS price_scope_summary_scope_idx
  ON price_scope_summary (provider, finish, price_type, currency, mtgjson_uuid);
CREATE INDEX IF NOT EXISTS price_monthly_summary_scope_month_idx
  ON price_monthly_summary (provider, finish, price_type, currency, month_start DESC, mtgjson_uuid);
`;

/**
 * Rebuild only affected printing/provider/finish/type/currency keys. Re-running
 * this statement after an interrupted import or a corrected raw observation
 * produces the same projections. The source snapshot ID keeps provenance.
 */
export const pricingSummaryRefreshBodySql = `DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM touched_price_keys k JOIN price_snapshots s
      ON (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency) =
         (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
    WHERE s.observed_date <=
      (SELECT raw_archived_through FROM price_summary_state WHERE singleton = TRUE)
  ) THEN
    RAISE EXCEPTION 'Live raw history overlaps the activated archive boundary';
  END IF;
  IF (SELECT raw_archived_through IS NULL FROM price_summary_state WHERE singleton = TRUE)
     AND EXISTS (
       SELECT 1 FROM touched_price_keys k JOIN price_archived_scope_summary a
         ON (a.mtgjson_uuid, a.provider, a.finish, a.price_type, a.currency) =
            (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
     ) THEN
    RAISE EXCEPTION 'Archived Pricing scope has no activated raw boundary';
  END IF;
END $$;

DELETE FROM price_daily_summary d USING touched_price_keys k
WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency);
INSERT INTO price_daily_summary (
  mtgjson_uuid, provider, finish, price_type, currency,
  observed_date, price, card_name, set_code, collector_number,
  source_snapshot_id, source_revision_count, created_at
)
SELECT DISTINCT ON (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency, s.observed_date)
  s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency,
  s.observed_date, s.price, s.card_name, s.set_code, s.collector_number,
  s.id, s.revision_count, s.created_at
FROM touched_price_keys k JOIN price_snapshots s
  ON (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency) =
     (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
ORDER BY s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency,
         s.observed_date, s.created_at DESC, s.id DESC;

DELETE FROM price_scope_summary c USING touched_price_keys k
WHERE (c.mtgjson_uuid, c.provider, c.finish, c.price_type, c.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency);
INSERT INTO price_scope_summary (
  mtgjson_uuid, provider, finish, price_type, currency,
  snapshot_count, latest_observed_date, latest_ingested_at,
  current_price, current_snapshot_id, prior_observed_date, prior_price, prior_snapshot_id
)
SELECT k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency,
       COALESCE(raw_stats.snapshot_count, 0) + COALESCE(a.snapshot_count, 0),
       COALESCE(current_point.observed_date, a.latest_observed_date),
       GREATEST(raw_stats.latest_ingested_at, a.latest_ingested_at),
       COALESCE(current_point.price, a.current_price),
       COALESCE(current_point.source_snapshot_id, a.current_snapshot_id),
       CASE WHEN current_point.observed_date IS NULL THEN a.prior_observed_date
            WHEN prior_point.observed_date IS NULL THEN a.latest_observed_date
            ELSE prior_point.observed_date END,
       CASE WHEN current_point.observed_date IS NULL THEN a.prior_price
            WHEN prior_point.observed_date IS NULL THEN a.current_price
            ELSE prior_point.price END,
       CASE WHEN current_point.observed_date IS NULL THEN a.prior_snapshot_id
            WHEN prior_point.observed_date IS NULL THEN a.current_snapshot_id
            ELSE prior_point.source_snapshot_id END
FROM touched_price_keys k
LEFT JOIN price_archived_scope_summary a
  ON (a.mtgjson_uuid, a.provider, a.finish, a.price_type, a.currency) =
     (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS snapshot_count, MAX(s.created_at) AS latest_ingested_at
  FROM price_snapshots s
  WHERE (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency) =
        (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
) raw_stats ON TRUE
LEFT JOIN LATERAL (
  SELECT d.* FROM price_daily_summary d
  WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
        (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
  ORDER BY d.observed_date DESC LIMIT 1
) current_point ON TRUE
LEFT JOIN LATERAL (
  SELECT d.observed_date, d.price, d.source_snapshot_id
  FROM price_daily_summary d
  WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
        (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
    AND d.observed_date < current_point.observed_date
  ORDER BY d.observed_date DESC LIMIT 1
) prior_point ON TRUE
WHERE raw_stats.snapshot_count > 0 OR a.mtgjson_uuid IS NOT NULL;

${refreshRollupSql("price_monthly_summary", "month_start", "month")}
${refreshRollupSql("price_weekly_summary", "week_start", "week")}
${refreshRollupSql("price_yearly_summary", "year_start", "year")}
-- Build every long-range tier from the complete raw-backed daily projection
-- before removing previously compacted daily dates for the touched keys.
DELETE FROM price_daily_summary d USING touched_price_keys k
WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
  AND d.observed_date <= (SELECT daily_compacted_through FROM price_summary_state WHERE singleton = TRUE);
`;

export function refreshPricingSummariesSql(keysJson: string) {
  return `BEGIN;
CREATE TEMP TABLE touched_price_keys ON COMMIT DROP AS
SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
FROM jsonb_to_recordset('${keysJson.replace(/'/g, "''")}'::jsonb)
  AS k(mtgjson_uuid text, provider text, finish text, price_type text, currency text);
${pricingSummaryRefreshBodySql}
COMMIT;`;
}

/** Fill newly introduced long-range tiers from the verified daily projection. */
export const pricingTierBackfillSql = `
BEGIN;
DO $$ BEGIN
  IF (SELECT daily_compacted_through IS NOT NULL FROM price_summary_state WHERE singleton = TRUE) THEN
    RAISE EXCEPTION 'Tier backfill requires full raw-backed summary rebuild after daily compaction';
  END IF;
END $$;
UPDATE price_summary_state SET tiers_ready = FALSE WHERE singleton = TRUE;
TRUNCATE price_weekly_summary, price_yearly_summary;
CREATE TEMP TABLE touched_price_keys ON COMMIT DROP AS
SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
FROM price_daily_summary;
${refreshRollupSql("price_weekly_summary", "week_start", "week")}
${refreshRollupSql("price_yearly_summary", "year_start", "year")}
UPDATE price_summary_state SET tiers_ready = TRUE, refreshed_at = now()
WHERE singleton = TRUE;
COMMIT;
`;
