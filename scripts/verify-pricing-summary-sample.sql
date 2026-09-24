-- Read-only comparison of 100 deterministic scope keys to authoritative raw rows.
WITH sample AS (
  SELECT * FROM price_scope_summary
  ORDER BY md5(mtgjson_uuid || provider || finish || price_type || currency)
  LIMIT 100
), comparison AS (
  SELECT s.*,
         raw_stats.raw_count, raw_stats.daily_count,
         latest.observed_date AS raw_latest_date,
         latest.price AS raw_current_price,
         latest.id AS raw_current_id,
         prior.observed_date AS raw_prior_date,
         prior.price AS raw_prior_price,
         prior.id AS raw_prior_id,
         daily.summary_daily_count
  FROM sample s
  JOIN LATERAL (
    SELECT COUNT(*)::int AS raw_count,
           COUNT(DISTINCT observed_date)::int AS daily_count
    FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
          (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
  ) raw_stats ON TRUE
  JOIN LATERAL (
    SELECT id, observed_date, price FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
          (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
    ORDER BY observed_date DESC, created_at DESC, id DESC LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, observed_date, price FROM price_snapshots r
    WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
          (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
      AND observed_date < latest.observed_date
    ORDER BY observed_date DESC, created_at DESC, id DESC LIMIT 1
  ) prior ON TRUE
  JOIN LATERAL (
    SELECT COUNT(*)::int AS summary_daily_count FROM price_daily_summary d
    WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
          (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
  ) daily ON TRUE
)
SELECT COUNT(*) AS sampled_scopes,
       COUNT(*) FILTER (WHERE snapshot_count IS DISTINCT FROM raw_count
           OR summary_daily_count IS DISTINCT FROM daily_count
           OR latest_observed_date IS DISTINCT FROM raw_latest_date
           OR current_price IS DISTINCT FROM raw_current_price
           OR current_snapshot_id IS DISTINCT FROM raw_current_id
           OR prior_observed_date IS DISTINCT FROM raw_prior_date
           OR prior_price IS DISTINCT FROM raw_prior_price
           OR prior_snapshot_id IS DISTINCT FROM raw_prior_id) AS mismatches
FROM comparison;

WITH sample AS (
  SELECT * FROM price_monthly_summary
  ORDER BY md5(mtgjson_uuid || provider || finish || price_type || currency || month_start::text)
  LIMIT 100
), comparison AS (
  SELECT m.*,
         raw.open_date AS raw_open_date, raw.open_price AS raw_open_price,
         raw.low_date AS raw_low_date, raw.low_price AS raw_low_price,
         raw.high_date AS raw_high_date, raw.high_price AS raw_high_price,
         raw.close_date AS raw_close_date, raw.close_price AS raw_close_price,
         raw.observation_count AS raw_observation_count
  FROM sample m
  JOIN LATERAL (
    SELECT (array_agg(d.observed_date ORDER BY d.observed_date ASC))[1] AS open_date,
           (array_agg(d.price ORDER BY d.observed_date ASC))[1] AS open_price,
           (array_agg(d.observed_date ORDER BY d.price ASC, d.observed_date ASC))[1] AS low_date,
           MIN(d.price) AS low_price,
           (array_agg(d.observed_date ORDER BY d.price DESC, d.observed_date ASC))[1] AS high_date,
           MAX(d.price) AS high_price,
           (array_agg(d.observed_date ORDER BY d.observed_date DESC))[1] AS close_date,
           (array_agg(d.price ORDER BY d.observed_date DESC))[1] AS close_price,
           COUNT(*)::int AS observation_count
    FROM (
      SELECT DISTINCT ON (r.observed_date) r.observed_date, r.price
      FROM price_snapshots r
      WHERE (r.mtgjson_uuid, r.provider, r.finish, r.price_type, r.currency) =
            (m.mtgjson_uuid, m.provider, m.finish, m.price_type, m.currency)
        AND date_trunc('month', r.observed_date)::date = m.month_start
      ORDER BY r.observed_date, r.created_at DESC, r.id DESC
    ) d
  ) raw ON TRUE
)
SELECT COUNT(*) AS sampled_months,
       COUNT(*) FILTER (WHERE open_date IS DISTINCT FROM raw_open_date
           OR open_price IS DISTINCT FROM raw_open_price
           OR low_date IS DISTINCT FROM raw_low_date
           OR low_price IS DISTINCT FROM raw_low_price
           OR high_date IS DISTINCT FROM raw_high_date
           OR high_price IS DISTINCT FROM raw_high_price
           OR close_date IS DISTINCT FROM raw_close_date
           OR close_price IS DISTINCT FROM raw_close_price
           OR observation_count IS DISTINCT FROM raw_observation_count) AS mismatches
FROM comparison;
