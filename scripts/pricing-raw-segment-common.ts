export const rawSegmentColumns = [
  "id", "scryfall_id", "mtgjson_uuid", "card_name", "set_code",
  "collector_number", "provider", "finish", "price_type", "currency",
  "observed_date", "price", "raw_json", "revision_count", "created_at",
].join(", ");

// A bounded segment fingerprint that can be checked inside the final SQL lock.
export function rawSegmentFingerprintSql(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid segment date");
  return `SELECT COALESCE(md5(string_agg(
    md5(to_jsonb(x)::text), '' ORDER BY x.id)), md5('')) FROM (
    SELECT ${rawSegmentColumns} FROM price_snapshots WHERE observed_date = '${date}'
  ) x`;
}
