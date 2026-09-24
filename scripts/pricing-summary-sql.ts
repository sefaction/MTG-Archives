/** Compact, rebuildable projections. Raw observations remain authoritative. */
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

CREATE TABLE IF NOT EXISTS price_summary_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  source_max_id BIGINT,
  refreshed_at TIMESTAMPTZ,
  rebuild_started_at TIMESTAMPTZ
);
INSERT INTO price_summary_state (singleton, ready)
VALUES (TRUE, FALSE) ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS price_daily_summary_scope_date_idx
  ON price_daily_summary (provider, finish, price_type, currency, observed_date DESC, mtgjson_uuid);
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
export function refreshPricingSummariesSql(keysJson: string) {
  return `
BEGIN;
CREATE TEMP TABLE touched_price_keys ON COMMIT DROP AS
SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
FROM jsonb_to_recordset('${keysJson.replace(/'/g, "''")}'::jsonb)
  AS k(mtgjson_uuid text, provider text, finish text, price_type text, currency text);

DELETE FROM price_daily_summary d USING touched_price_keys k
WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency);
INSERT INTO price_daily_summary (
  mtgjson_uuid, provider, finish, price_type, currency,
  observed_date, price, card_name, set_code, collector_number,
  source_snapshot_id, created_at
)
SELECT DISTINCT ON (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency, s.observed_date)
  s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency,
  s.observed_date, s.price, s.card_name, s.set_code, s.collector_number,
  s.id, s.created_at
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
       raw_stats.snapshot_count, current_point.observed_date, raw_stats.latest_ingested_at,
       current_point.price, current_point.source_snapshot_id,
       prior_point.observed_date, prior_point.price, prior_point.source_snapshot_id
FROM touched_price_keys k
JOIN LATERAL (
  SELECT COUNT(*)::int AS snapshot_count, MAX(s.created_at) AS latest_ingested_at
  FROM price_snapshots s
  WHERE (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency) =
        (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
) raw_stats ON raw_stats.snapshot_count > 0
JOIN LATERAL (
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
) prior_point ON TRUE;

DELETE FROM price_monthly_summary m USING touched_price_keys k
WHERE (m.mtgjson_uuid, m.provider, m.finish, m.price_type, m.currency) =
      (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency);
INSERT INTO price_monthly_summary (
  mtgjson_uuid, provider, finish, price_type, currency, month_start,
  open_date, open_price, low_date, low_price, high_date, high_price,
  close_date, close_price, observation_count
)
SELECT d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency,
       date_trunc('month', d.observed_date)::date,
       (array_agg(d.observed_date ORDER BY d.observed_date ASC))[1],
       (array_agg(d.price ORDER BY d.observed_date ASC))[1],
       (array_agg(d.observed_date ORDER BY d.price ASC, d.observed_date ASC))[1],
       MIN(d.price),
       (array_agg(d.observed_date ORDER BY d.price DESC, d.observed_date ASC))[1],
       MAX(d.price),
       (array_agg(d.observed_date ORDER BY d.observed_date DESC))[1],
       (array_agg(d.price ORDER BY d.observed_date DESC))[1],
       COUNT(*)::int
FROM price_daily_summary d JOIN touched_price_keys k
  ON (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
     (k.mtgjson_uuid, k.provider, k.finish, k.price_type, k.currency)
GROUP BY d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency,
         date_trunc('month', d.observed_date)::date;
COMMIT;
`;
}
