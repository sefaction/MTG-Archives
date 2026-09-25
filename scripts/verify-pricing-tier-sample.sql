-- Read-only sampled parity against the verified daily projection.
WITH sample AS (
  SELECT * FROM price_weekly_summary
  ORDER BY md5(mtgjson_uuid || provider || finish || price_type || currency || week_start::text)
  LIMIT 100
), compared AS (
  SELECT s.*, d.open_date AS source_open_date, d.open_price AS source_open_price,
    d.low_date AS source_low_date, d.low_price AS source_low_price,
    d.high_date AS source_high_date, d.high_price AS source_high_price,
    d.close_date AS source_close_date, d.close_price AS source_close_price,
    d.observation_count AS source_count
  FROM sample s CROSS JOIN LATERAL (
    SELECT (array_agg(observed_date ORDER BY observed_date ASC))[1] AS open_date,
      (array_agg(price ORDER BY observed_date ASC))[1] AS open_price,
      (array_agg(observed_date ORDER BY price ASC, observed_date ASC))[1] AS low_date,
      MIN(price) AS low_price,
      (array_agg(observed_date ORDER BY price DESC, observed_date ASC))[1] AS high_date,
      MAX(price) AS high_price,
      (array_agg(observed_date ORDER BY observed_date DESC))[1] AS close_date,
      (array_agg(price ORDER BY observed_date DESC))[1] AS close_price,
      COUNT(*)::int AS observation_count
    FROM price_daily_summary d
    WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
      AND date_trunc('week', d.observed_date)::date = s.week_start
  ) d
)
SELECT 'weekly' AS tier, COUNT(*) AS sampled,
  COUNT(*) FILTER (WHERE open_date IS DISTINCT FROM source_open_date
    OR open_price IS DISTINCT FROM source_open_price
    OR low_date IS DISTINCT FROM source_low_date
    OR low_price IS DISTINCT FROM source_low_price
    OR high_date IS DISTINCT FROM source_high_date
    OR high_price IS DISTINCT FROM source_high_price
    OR close_date IS DISTINCT FROM source_close_date
    OR close_price IS DISTINCT FROM source_close_price
    OR observation_count IS DISTINCT FROM source_count) AS mismatches
FROM compared;

WITH sample AS (
  SELECT * FROM price_yearly_summary
  ORDER BY md5(mtgjson_uuid || provider || finish || price_type || currency || year_start::text)
  LIMIT 100
), compared AS (
  SELECT s.*, d.open_date AS source_open_date, d.open_price AS source_open_price,
    d.low_date AS source_low_date, d.low_price AS source_low_price,
    d.high_date AS source_high_date, d.high_price AS source_high_price,
    d.close_date AS source_close_date, d.close_price AS source_close_price,
    d.observation_count AS source_count
  FROM sample s CROSS JOIN LATERAL (
    SELECT (array_agg(observed_date ORDER BY observed_date ASC))[1] AS open_date,
      (array_agg(price ORDER BY observed_date ASC))[1] AS open_price,
      (array_agg(observed_date ORDER BY price ASC, observed_date ASC))[1] AS low_date,
      MIN(price) AS low_price,
      (array_agg(observed_date ORDER BY price DESC, observed_date ASC))[1] AS high_date,
      MAX(price) AS high_price,
      (array_agg(observed_date ORDER BY observed_date DESC))[1] AS close_date,
      (array_agg(price ORDER BY observed_date DESC))[1] AS close_price,
      COUNT(*)::int AS observation_count
    FROM price_daily_summary d
    WHERE (d.mtgjson_uuid, d.provider, d.finish, d.price_type, d.currency) =
      (s.mtgjson_uuid, s.provider, s.finish, s.price_type, s.currency)
      AND date_trunc('year', d.observed_date)::date = s.year_start
  ) d
)
SELECT 'yearly' AS tier, COUNT(*) AS sampled,
  COUNT(*) FILTER (WHERE open_date IS DISTINCT FROM source_open_date
    OR open_price IS DISTINCT FROM source_open_price
    OR low_date IS DISTINCT FROM source_low_date
    OR low_price IS DISTINCT FROM source_low_price
    OR high_date IS DISTINCT FROM source_high_date
    OR high_price IS DISTINCT FROM source_high_price
    OR close_date IS DISTINCT FROM source_close_date
    OR close_price IS DISTINCT FROM source_close_price
    OR observation_count IS DISTINCT FROM source_count) AS mismatches
FROM compared;
