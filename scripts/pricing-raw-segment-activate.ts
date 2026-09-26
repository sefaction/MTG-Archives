import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";
import { rawSegmentFingerprintSql, rawSegmentIdentityFingerprintSql } from "./pricing-raw-segment-common";
import { refreshPricingSummariesSql } from "./pricing-summary-sql";
import { copyVerifiedPricingRecoveryFiles } from "./pricing-recovery-copy";

const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Raw archive activation supports only local Pricing databases");
database.searchParams.delete("schema");
const root = process.env.BACKUP_DIR;
if (!root) throw new Error("BACKUP_DIR is required");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const selection = args.filter((arg) => arg !== "--apply");
if (selection.length !== 2 || selection[0] !== "--manifest" || args.length !== selection.length + Number(apply))
  throw new Error("Use --manifest PATH [--apply]; default is a dry run");
if (apply && process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("MTG_LOCAL_PILOT_TEST=1 is required for local raw archive activation");
const manifestPath = resolve(selection[1]);
const rawRoot = resolve(root, "pricing", "raw");
if (!manifestPath.startsWith(`${rawRoot}${sep}`))
  throw new Error("Manifest must be inside BACKUP_DIR/pricing/raw");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  status: string; schemaVersion: number; observedDate: string; liveDays: number;
  sourceRevision: number; sourceMaxId: number | null; rows: number;
  priceSum: string; archive: string; archiveSha256: string;
  csvSha256: string; sourceFingerprint: string; identityFingerprint: string;
  restoreVerified: boolean;
  activated: boolean;
};
if (manifest.status !== "verified_staged" || manifest.schemaVersion !== 1 ||
    manifest.activated !== false || manifest.restoreVerified !== true ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.observedDate) ||
    !Number.isSafeInteger(manifest.rows) || manifest.rows < 1 ||
    !Number.isSafeInteger(manifest.sourceRevision) ||
    !/^-?\d+(\.\d+)?$/.test(manifest.priceSum) ||
    !/^[a-f0-9]{32}$/.test(manifest.sourceFingerprint) ||
    !/^[a-f0-9]{32}$/.test(manifest.identityFingerprint) ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.csvSha256))
  throw new Error("Incomplete or invalid verified stage manifest");
const archive = resolve(manifest.archive);
if (dirname(archive) !== dirname(manifestPath) || !archive.endsWith(".csv.gz"))
  throw new Error("Archive and manifest must share the same date directory");
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const stored = readFileSync(archive);
if (hash(stored) !== manifest.archiveSha256 ||
    hash(gunzipSync(stored)) !== manifest.csvSha256)
  throw new Error("Staged archive no longer matches its verified manifest");
if (manifest.liveDays !== getPricingRetentionPolicy().dailyDays)
  throw new Error("The retention window changed since segment staging");

function run(name: string, args: string[], input?: string, timeout = 900_000) {
  const result = spawnSync(name, args, { input, encoding: "utf8", timeout,
    maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${name} failed or timed out: ${result.stderr?.trim().slice(0, 500) ?? ""}`);
  return result.stdout.trim();
}
function query(db: URL, statement: string, timeout = 900_000) {
  return run("psql", [db.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"], statement, timeout);
}
async function fileHash(path: string) {
  const stream = createReadStream(path);
  const digest = createHash("sha256");
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

const date = manifest.observedDate;
const dateSql = `'${date}'::date`;
const fingerprint = rawSegmentFingerprintSql(date);
const identityFingerprint = rawSegmentIdentityFingerprintSql(date);
const stateSql = `SELECT json_build_object(
  'ready', ready AND tiers_ready AND source_revision = summary_revision,
  'sourceRevision', source_revision, 'sourceMaxId', source_max_id,
  'rawMaxId', (SELECT MAX(id) FROM price_snapshots),
  'rawBoundary', raw_archived_through::text,
  'dailyBoundary', daily_compacted_through::text,
  'firstRawDate', (SELECT MIN(observed_date)::text FROM price_snapshots),
  'rows', (SELECT COUNT(*) FROM price_snapshots WHERE observed_date = ${dateSql}),
  'priceSum', (SELECT COALESCE(SUM(price), 0)::text FROM price_snapshots WHERE observed_date = ${dateSql}),
  'fingerprint', (${fingerprint}),
  'identityFingerprint', (${identityFingerprint}),
  'cutoff', (CURRENT_DATE - ${getPricingRetentionPolicy().dailyDays + 1})::text
)::text FROM price_summary_state WHERE singleton = TRUE;`;
type State = { ready: boolean; sourceRevision: number; sourceMaxId: number | null;
  rawMaxId: number | null; rawBoundary: string | null; dailyBoundary: string | null;
  firstRawDate: string; rows: number; priceSum: string; fingerprint: string;
  identityFingerprint: string; cutoff: string };
function assertState(value: State) {
  if (!value.ready || value.sourceRevision !== manifest.sourceRevision ||
      value.sourceMaxId !== manifest.sourceMaxId || value.rawMaxId !== value.sourceMaxId ||
      value.rows !== manifest.rows || value.priceSum !== manifest.priceSum ||
      value.fingerprint !== manifest.sourceFingerprint || value.firstRawDate !== date ||
      value.identityFingerprint !== manifest.identityFingerprint ||
      !value.dailyBoundary || value.dailyBoundary < date || date > value.cutoff ||
      (value.rawBoundary && value.rawBoundary >= date))
    throw new Error("Staged date is not the oldest eligible fresh raw segment; restage after daily compaction");
}

// One latest-ingested point per scope/day contributes to time tiers; every raw
// snapshot contributes to scope snapshot_count and latest_ingested_at.
function tierUpsert(table: string, period: string, column: string) {
  return `INSERT INTO price_archived_${table}_summary (
    mtgjson_uuid, provider, finish, price_type, currency, ${column},
    open_date, open_price, low_date, low_price, high_date, high_price,
    close_date, close_price, observation_count)
  SELECT mtgjson_uuid, provider, finish, price_type, currency,
    date_trunc('${period}', observed_date)::date,
    observed_date, price, observed_date, price, observed_date, price,
    observed_date, price, 1 FROM archive_day_points
  ON CONFLICT (mtgjson_uuid, provider, finish, price_type, currency, ${column})
  DO UPDATE SET
    open_date = LEAST(price_archived_${table}_summary.open_date, EXCLUDED.open_date),
    open_price = CASE WHEN EXCLUDED.open_date < price_archived_${table}_summary.open_date
      THEN EXCLUDED.open_price ELSE price_archived_${table}_summary.open_price END,
    close_date = GREATEST(price_archived_${table}_summary.close_date, EXCLUDED.close_date),
    close_price = CASE WHEN EXCLUDED.close_date > price_archived_${table}_summary.close_date
      THEN EXCLUDED.close_price ELSE price_archived_${table}_summary.close_price END,
    low_date = CASE WHEN EXCLUDED.low_price < price_archived_${table}_summary.low_price OR
      (EXCLUDED.low_price = price_archived_${table}_summary.low_price AND
       EXCLUDED.low_date < price_archived_${table}_summary.low_date)
      THEN EXCLUDED.low_date ELSE price_archived_${table}_summary.low_date END,
    low_price = LEAST(price_archived_${table}_summary.low_price, EXCLUDED.low_price),
    high_date = CASE WHEN EXCLUDED.high_price > price_archived_${table}_summary.high_price OR
      (EXCLUDED.high_price = price_archived_${table}_summary.high_price AND
       EXCLUDED.high_date < price_archived_${table}_summary.high_date)
      THEN EXCLUDED.high_date ELSE price_archived_${table}_summary.high_date END,
    high_price = GREATEST(price_archived_${table}_summary.high_price, EXCLUDED.high_price),
    observation_count = price_archived_${table}_summary.observation_count + 1;`;
}

function activationSql(state: State, backup: string, backupSha: string,
  rawStats: { rows: number; priceSum: string; maxId: number | null }) {
  const previous = state.rawBoundary ? `'${state.rawBoundary}'::date` : "NULL";
  const priorDaily = state.dailyBoundary ? `'${state.dailyBoundary}'::date` : "NULL";
  // File paths are bound to this command's local backup directory, but SQL literals
  // still need quoting for a path containing an apostrophe.
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `BEGIN;
  SET LOCAL lock_timeout = '30s';
  LOCK TABLE price_snapshots IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE price_summary_state IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE price_archived_scope_summary, price_archived_monthly_summary,
    price_archived_weekly_summary, price_archived_yearly_summary,
    price_archived_daily_basis IN SHARE ROW EXCLUSIVE MODE;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM price_summary_state WHERE singleton AND ready AND tiers_ready
      AND source_revision = summary_revision AND source_revision = ${manifest.sourceRevision}
      AND source_max_id IS NOT DISTINCT FROM ${manifest.sourceMaxId ?? "NULL"}
      AND raw_archived_through IS NOT DISTINCT FROM ${previous}
      AND daily_compacted_through IS NOT DISTINCT FROM ${priorDaily}
      AND daily_compacted_through >= ${dateSql})
      OR (SELECT MIN(observed_date) FROM price_snapshots) <> ${dateSql}
      OR (SELECT MAX(id) FROM price_snapshots) IS DISTINCT FROM ${manifest.sourceMaxId ?? "NULL"}
      OR (SELECT COUNT(*) FROM price_snapshots) <> ${rawStats.rows}
      OR (SELECT COALESCE(SUM(price), 0) FROM price_snapshots) <> ${rawStats.priceSum}
      OR (SELECT COUNT(*) FROM price_snapshots WHERE observed_date = ${dateSql}) <> ${manifest.rows}
      OR (SELECT COALESCE(SUM(price), 0) FROM price_snapshots WHERE observed_date = ${dateSql}) <> ${manifest.priceSum}
      OR (${fingerprint}) <> '${manifest.sourceFingerprint}'
      OR (${identityFingerprint}) <> '${manifest.identityFingerprint}'
      OR ${dateSql} > (CURRENT_DATE - ${getPricingRetentionPolicy().dailyDays + 1})::date
    THEN RAISE EXCEPTION 'Pricing source or retention boundary changed since verified raw archive'; END IF;
  END $$;
  CREATE TEMP TABLE archive_day_points ON COMMIT DROP AS
    SELECT DISTINCT ON (mtgjson_uuid, provider, finish, price_type, currency)
      mtgjson_uuid, provider, finish, price_type, currency, observed_date,
      price, id, created_at
      , revision_count
    FROM price_snapshots WHERE observed_date = ${dateSql}
    ORDER BY mtgjson_uuid, provider, finish, price_type, currency, created_at DESC, id DESC;
  INSERT INTO price_archived_daily_basis (
    mtgjson_uuid, provider, finish, price_type, currency, observed_date,
    price, source_snapshot_id, source_revision_count, current_ingested_at,
    raw_count, latest_ingested_at)
  SELECT p.mtgjson_uuid, p.provider, p.finish, p.price_type, p.currency,
    p.observed_date, p.price, p.id, p.revision_count, p.created_at,
    r.snapshot_count, r.latest_ingested_at
  FROM archive_day_points p JOIN (
    SELECT mtgjson_uuid, provider, finish, price_type, currency,
      COUNT(*)::int AS snapshot_count, MAX(created_at) AS latest_ingested_at
    FROM price_snapshots WHERE observed_date = ${dateSql}
    GROUP BY mtgjson_uuid, provider, finish, price_type, currency
  ) r USING (mtgjson_uuid, provider, finish, price_type, currency);
  INSERT INTO price_archived_scope_summary (
    mtgjson_uuid, provider, finish, price_type, currency, snapshot_count,
    latest_observed_date, latest_ingested_at, current_price, current_snapshot_id,
    prior_observed_date, prior_price, prior_snapshot_id)
  SELECT p.mtgjson_uuid, p.provider, p.finish, p.price_type, p.currency,
    r.snapshot_count, p.observed_date, r.latest_ingested_at, p.price, p.id,
    NULL, NULL, NULL
  FROM archive_day_points p JOIN (
    SELECT mtgjson_uuid, provider, finish, price_type, currency,
      COUNT(*)::int AS snapshot_count, MAX(created_at) AS latest_ingested_at
    FROM price_snapshots WHERE observed_date = ${dateSql}
    GROUP BY mtgjson_uuid, provider, finish, price_type, currency
  ) r USING (mtgjson_uuid, provider, finish, price_type, currency)
  ON CONFLICT (mtgjson_uuid, provider, finish, price_type, currency)
  DO UPDATE SET
    snapshot_count = price_archived_scope_summary.snapshot_count + EXCLUDED.snapshot_count,
    latest_observed_date = EXCLUDED.latest_observed_date,
    latest_ingested_at = GREATEST(price_archived_scope_summary.latest_ingested_at, EXCLUDED.latest_ingested_at),
    prior_observed_date = price_archived_scope_summary.latest_observed_date,
    prior_price = price_archived_scope_summary.current_price,
    prior_snapshot_id = price_archived_scope_summary.current_snapshot_id,
    current_price = EXCLUDED.current_price,
    current_snapshot_id = EXCLUDED.current_snapshot_id;
  ${tierUpsert("monthly", "month", "month_start")}
  ${tierUpsert("weekly", "week", "week_start")}
  ${tierUpsert("yearly", "year", "year_start")}
  CREATE TABLE IF NOT EXISTS price_raw_archive_segment (
    observed_date DATE PRIMARY KEY, archive_path TEXT NOT NULL,
    archive_sha256 TEXT NOT NULL, csv_sha256 TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL, identity_fingerprint TEXT,
    raw_rows INTEGER NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1,
    backup_path TEXT NOT NULL, backup_sha256 TEXT NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE price_raw_archive_segment ADD COLUMN IF NOT EXISTS identity_fingerprint TEXT;
  INSERT INTO price_raw_archive_segment (observed_date, archive_path,
    archive_sha256, csv_sha256, source_fingerprint, identity_fingerprint,
    raw_rows, backup_path, backup_sha256)
  VALUES (${dateSql}, ${literal(archive)}, '${manifest.archiveSha256}',
    '${manifest.csvSha256}', '${manifest.sourceFingerprint}',
    '${manifest.identityFingerprint}', ${manifest.rows},
    ${literal(backup)}, '${backupSha}');
  WITH removed AS (DELETE FROM price_snapshots WHERE observed_date = ${dateSql} RETURNING 1)
    SELECT COUNT(*) AS deleted_raw_rows FROM removed;
  UPDATE price_summary_state SET raw_archived_through = ${dateSql},
    source_max_id = (SELECT MAX(id) FROM price_snapshots)
    WHERE singleton = TRUE;
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM price_snapshots WHERE observed_date <= ${dateSql})
      OR (SELECT raw_rows FROM price_raw_archive_segment WHERE observed_date = ${dateSql}) <> ${manifest.rows}
    THEN RAISE EXCEPTION 'Raw archive activation postcondition failed'; END IF;
  END $$;
  COMMIT;`;
}

const keysSql = `SELECT COALESCE(json_agg(row_to_json(k))::text, '[]') FROM (
  SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
  FROM price_snapshots WHERE observed_date = ${dateSql}
) k;`;
function visibleSignature(db: URL, keys: string) {
  const escaped = keys.replace(/'/g, "''");
  return query(db, `WITH k AS (SELECT * FROM jsonb_to_recordset('${escaped}'::jsonb)
    AS x(mtgjson_uuid text, provider text, finish text, price_type text, currency text)),
  rows AS (
    ${["scope", "monthly", "weekly", "yearly"].map((tier) => `SELECT '${tier}' AS tier,
      (to_jsonb(s) - 'refreshed_at')::text AS value FROM price_${tier}_summary s JOIN k
      USING (mtgjson_uuid, provider, finish, price_type, currency)`).join(" UNION ALL ")}
  ) SELECT COALESCE(md5(string_agg(md5(tier || value), '' ORDER BY tier, value)), md5('')) FROM rows;`);
}

async function main() {
  const before = JSON.parse(query(database, stateSql)) as State;
  assertState(before);
  const keys = query(database, keysSql);
  const signature = visibleSignature(database, keys);
  const rawStatsSql = `SELECT json_build_object('rows', COUNT(*),
    'priceSum', COALESCE(SUM(price), 0)::text, 'maxId', MAX(id))::text
    FROM price_snapshots;`;
  const rawBefore = query(database, rawStatsSql);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", observedDate: date,
    rows: before.rows, priorBoundary: before.rawBoundary,
    dailyBoundary: before.dailyBoundary }));
  if (!apply) return;

  const id = `raw-before-${date}-${randomUUID()}`;
  const backupDirectory = resolve(root!, "pricing");
  mkdirSync(backupDirectory, { recursive: true });
  const backup = resolve(backupDirectory, `${id}.dump`);
  const backupManifest = resolve(backupDirectory, `${id}.json`);
  const receipt = resolve(dirname(manifestPath), `${id}.activated.json`);
  const admin = new URL(database);
  admin.pathname = "/postgres";
  const verifyName = `mtg_pricing_raw_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const verify = new URL(database);
  verify.pathname = `/${verifyName}`;
  let created = false;
  try {
    run("pg_dump", [database.toString(), "--format=custom", "--no-owner", "--no-acl", `--file=${backup}`]);
    const backupSha = await fileHash(backup);
    query(admin, `CREATE DATABASE "${verifyName}";`);
    created = true;
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--jobs=2",
      `--dbname=${verify.toString()}`, backup]);
    const restoredState = JSON.parse(query(verify, stateSql)) as State;
    assertState(restoredState);
    if (JSON.stringify(restoredState) !== JSON.stringify(before) ||
        query(verify, rawStatsSql) !== rawBefore ||
        visibleSignature(verify, keys) !== signature ||
        query(database, rawStatsSql) !== rawBefore ||
        JSON.stringify(JSON.parse(query(database, stateSql))) !== JSON.stringify(before))
      throw new Error("Restored database or live source differs from the verified pre-delete state");
    writeFileSync(backupManifest, `${JSON.stringify({ status: "verified_before_raw_delete",
      observedDate: date, backup, backupSha256: backupSha,
      stageManifest: manifestPath, stageArchiveSha256: manifest.archiveSha256,
      sourceState: before, rawStats: JSON.parse(rawBefore), visibleSignature: signature,
      verifiedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" });
    const recoveryTarget = process.env.PRICING_RECOVERY_COPY_DIR;
    const recoveryFiles = [{ path: archive, sha256: manifest.archiveSha256 },
      { path: backup, sha256: backupSha },
      { path: manifestPath, sha256: await fileHash(manifestPath) },
      { path: backupManifest, sha256: await fileHash(backupManifest) }];
    const recoveryCopies = recoveryTarget ?
      await copyVerifiedPricingRecoveryFiles(root!, recoveryTarget, recoveryFiles) : null;

    if (process.env.MTG_LOCAL_PILOT_TEST === "1" &&
        process.env.MTG_RAW_ARCHIVE_TEST_FAIL_AFTER_RESTORE === "1")
      throw new Error("Injected interruption after isolated restore");

    const simulated = query(verify, activationSql(restoredState, backup, backupSha,
      JSON.parse(rawBefore)));
    if (!simulated.split(/\r?\n/).includes(String(manifest.rows)))
      throw new Error("Isolated activation deleted an unexpected raw row count");
    query(verify, refreshPricingSummariesSql(keys));
    if (visibleSignature(verify, keys) !== signature)
      throw new Error("Archived summary refresh did not preserve visible projections");
    const liveNow = JSON.parse(query(database, stateSql)) as State;
    assertState(liveNow);
    if (JSON.stringify(liveNow) !== JSON.stringify(before) ||
        query(database, rawStatsSql) !== rawBefore ||
        visibleSignature(database, keys) !== signature ||
        await fileHash(backup) !== backupSha)
      throw new Error("Source or backup changed before final archive activation");
    if (recoveryTarget)
      await copyVerifiedPricingRecoveryFiles(root!, recoveryTarget, recoveryFiles);
    const committed = query(database, activationSql(liveNow, backup, backupSha,
      JSON.parse(rawBefore)));
    if (!committed.split(/\r?\n/).includes(String(manifest.rows)))
      throw new Error("Live activation count differs; inspect the database and archive receipt");
    const liveAfter = JSON.parse(query(database, stateSql)) as State;
    if (liveAfter.rawBoundary !== date || liveAfter.firstRawDate === date ||
        visibleSignature(database, keys) !== signature)
      throw new Error("Live archive postcondition failed; restore from verified database backup");
    writeFileSync(receipt, `${JSON.stringify({ status: "activated", activatedAt: new Date().toISOString(),
      observedDate: date, deleted: manifest.rows, archive, archiveSha256: manifest.archiveSha256,
      backup, backupSha256: backupSha, backupManifest, stageManifest: manifestPath,
      recoveryCopies }, null, 2)}\n`,
      { flag: "wx" });
    console.log(JSON.stringify({ mode: "activated", observedDate: date, deleted: manifest.rows,
      archive, backup, receipt, rawBoundary: date }));
  } finally {
    if (created) query(admin, `DROP DATABASE "${verifyName}" WITH (FORCE);`);
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
