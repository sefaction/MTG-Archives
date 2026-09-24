type PriceSnapshotInput = {
  mtgjsonUuid: string;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  observedDate: string;
  price: number;
  rawJson?: unknown;
};

/** Returns new/corrected counts. Identical source replays keep their ingest time. */
export function pricingSnapshotUpsertSql(batch: PriceSnapshotInput[]) {
  const json = `'${JSON.stringify(batch).replace(/'/g, "''")}'::jsonb`;
  return `WITH input AS (
  SELECT * FROM jsonb_to_recordset(${json}) AS row(
    "mtgjsonUuid" text, provider text, finish text, "priceType" text,
    currency text, "observedDate" text, price numeric, "rawJson" jsonb
  )
), changed AS (
  INSERT INTO price_snapshots (
    mtgjson_uuid, provider, finish, price_type, currency,
    observed_date, price, raw_json
  )
  SELECT "mtgjsonUuid", provider, finish, "priceType", currency,
         "observedDate"::date, price, "rawJson"
  FROM input
  ON CONFLICT (
    (COALESCE(mtgjson_uuid, '')),
    (COALESCE(scryfall_id, '')),
    provider, finish, price_type, currency, observed_date
  ) DO UPDATE SET
    price = EXCLUDED.price,
    raw_json = EXCLUDED.raw_json,
    created_at = now(),
    revision_count = price_snapshots.revision_count + 1
  WHERE price_snapshots.price IS DISTINCT FROM EXCLUDED.price
  RETURNING revision_count
)
SELECT count(*) FILTER (WHERE revision_count = 0) AS inserted,
       count(*) FILTER (WHERE revision_count > 0) AS corrected
FROM changed;`;
}
