import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync,
  writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Papa from "papaparse";
import { archivedBasisRebuildBodySql } from "./pricing-archived-basis-sql";
import { planArchivedCorrection, type ArchiveSegmentRecord,
  type ArchivedFeedQueueRecord } from "./pricing-archived-correction-plan";
import { rawSegmentColumns, rawSegmentFingerprintSql,
  rawSegmentIdentityFingerprintSql } from "./pricing-raw-segment-common";
import { pricingSummaryRefreshBodySql } from "./pricing-summary-sql";

const configured = process.env.PRICING_DATABASE_URL;
const root = process.env.BACKUP_DIR;
if (!configured || !root) throw new Error("PRICING_DATABASE_URL and BACKUP_DIR are required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Archived correction apply supports only local Pricing databases");
database.searchParams.delete("schema");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const selection = args.filter((value) => value !== "--apply");
if (selection.length !== 2 || selection[0] !== "--date" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(selection[1]) ||
    args.length !== selection.length + Number(apply))
  throw new Error("Use --date YYYY-MM-DD [--apply]; default is read-only");
if (apply && process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("MTG_LOCAL_PILOT_TEST=1 is required for local correction apply");
const date = selection[1];
const sqlDate = `'${date}'::date`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const makeDb = (name: string) => { const url = new URL(database); url.pathname = `/${name}`; return url; };

function command(db: URL, statement: string, input?: Buffer, outputPath?: string) {
  const fd = outputPath ? openSync(outputPath, "wx") : undefined;
  try {
    const args = [db.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
    // SQL may contain hundreds of keys. COPY FROM STDIN needs CSV on stdin;
    // every other statement is sent as a script to avoid argv size limits.
    args.push(...(input ? ["-c", statement] : ["-f", "-"]));
    const result = spawnSync("psql", args, {
      input: input ?? Buffer.from(statement), timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["pipe", fd ?? "pipe", "pipe"],
    });
    if (result.status !== 0)
      throw new Error(`Pricing correction SQL failed: ${result.stderr?.toString().trim().slice(0, 500) ?? ""}`);
    return fd === undefined ? result.stdout.toString().trim() : "";
  } finally { if (fd !== undefined) closeSync(fd); }
}
function program(name: string, args: string[]) {
  const result = spawnSync(name, args, { encoding: "utf8", timeout: 900_000,
    maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${name} failed: ${result.stderr?.trim().slice(0, 500) ?? ""}`);
}
async function fileSha(path: string) {
  const digest = createHash("sha256");
  for await (const piece of createReadStream(path)) digest.update(piece);
  return digest.digest("hex");
}

type State = { ready: boolean; sourceRevision: number; summaryRevision: number;
  sourceMaxId: number | null; rawMaxId: number | null; rawBoundary: string | null;
  rawCount: number; rawSum: string };
function state(db: URL): State {
  return JSON.parse(command(db, `SELECT json_build_object(
    'ready', ready AND tiers_ready, 'sourceRevision', source_revision,
    'summaryRevision', summary_revision, 'sourceMaxId', source_max_id,
    'rawMaxId', (SELECT MAX(id) FROM price_snapshots),
    'rawBoundary', raw_archived_through::text,
    'rawCount', (SELECT COUNT(*) FROM price_snapshots),
    'rawSum', (SELECT COALESCE(SUM(price), 0)::text FROM price_snapshots)
  )::text FROM price_summary_state WHERE singleton = TRUE;`)) as State;
}
type Segment = ArchiveSegmentRecord;
type Queue = ArchivedFeedQueueRecord & { status: string; sourceJobId: string;
  queuedAt: string; appliedCount: number };
function records(db: URL) {
  const output = command(db, `SELECT json_build_object(
    'segment', (SELECT json_build_object(
      'observedDate', observed_date::text, 'archivePath', archive_path,
      'archiveSha256', archive_sha256, 'csvSha256', csv_sha256,
      'identityFingerprint', identity_fingerprint, 'rawRows', raw_rows,
      'generation', generation) FROM price_raw_archive_segment
      WHERE observed_date = ${sqlDate}),
    'queue', (SELECT json_build_object(
      'observedDate', observed_date::text,
      'identityFingerprint', identity_fingerprint,
      'spoolPath', spool_path, 'spoolSha256', spool_sha256,
      'rowCount', row_count, 'status', status, 'sourceJobId', source_job_id,
      'queuedAt', queued_at::text, 'appliedCount', applied_count)
      FROM price_archive_feed_queue WHERE observed_date = ${sqlDate}
        AND status = 'PENDING' ORDER BY queued_at DESC, identity_fingerprint DESC LIMIT 1)
  )::text;`);
  return JSON.parse(output) as { segment: Segment; queue: Queue | null };
}
function signature(db: URL, keys: Array<Record<string, string>>) {
  const encoded = literal(JSON.stringify(keys));
  return command(db, `WITH k AS (SELECT * FROM jsonb_to_recordset(${encoded}::jsonb)
    AS x(mtgjson_uuid text, provider text, finish text, price_type text, currency text)),
  rows AS (
    ${["scope", "monthly", "weekly", "yearly"].map((tier) => `SELECT '${tier}' AS tier,
      (to_jsonb(s)-'refreshed_at')::text AS value FROM price_${tier}_summary s JOIN k
      USING (mtgjson_uuid, provider, finish, price_type, currency)`).join(" UNION ALL ")}
  ) SELECT COALESCE(md5(string_agg(md5(tier || value), '' ORDER BY tier, value)), md5('')) FROM rows;`);
}

function identitySql(table: string) {
  return rawSegmentIdentityFingerprintSql(date).replaceAll("price_snapshots", table);
}
function sourceSql(table: string) {
  return rawSegmentFingerprintSql(date).replaceAll("price_snapshots", table);
}
function archiveInput(segment: Segment) {
  if (!segment) return Buffer.from(`${rawSegmentColumns.replaceAll(", ", ",")}\n`);
  const stored = readFileSync(segment.archivePath);
  if (sha(stored) !== segment.archiveSha256)
    throw new Error("Active raw archive changed before isolated restore");
  const csv = gunzipSync(stored);
  if (sha(csv) !== segment.csvSha256)
    throw new Error("Active raw archive CSV changed before isolated restore");
  return csv;
}

function correctionSql(expected: State, segment: Segment, queue: Queue,
  replacement: { archive: string; archiveSha: string; csvSha: string;
    identityFingerprint: string; sourceFingerprint: string; rows: number },
  backup: string, backupSha: string, remaining: number, effects: Array<{
    mtgjson_uuid: string; provider: string; finish: string; price_type: string;
    currency: string; observed_date: string; price: string; id: number;
    revision_count: number; created_at: string }>) {
  const oldHash = segment ? literal(segment.archiveSha256) : "NULL";
  const generation = (segment?.generation ?? 0) + 1;
  const effectsJson = literal(JSON.stringify(effects));
  const keysJson = literal(JSON.stringify(effects.map((row) => ({
    mtgjson_uuid: row.mtgjson_uuid, provider: row.provider, finish: row.finish,
    price_type: row.price_type, currency: row.currency }))));
  return `BEGIN;
SET LOCAL lock_timeout = '30s';
LOCK TABLE price_snapshots, price_summary_state, price_raw_archive_segment,
  price_archive_feed_queue, price_archived_daily_basis,
  price_archived_scope_summary, price_archived_weekly_summary,
  price_archived_monthly_summary, price_archived_yearly_summary,
  price_daily_summary, price_scope_summary, price_weekly_summary,
  price_monthly_summary, price_yearly_summary IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM price_summary_state WHERE singleton AND ready AND tiers_ready
    AND source_revision = summary_revision
    AND source_revision = ${expected.sourceRevision}
    AND source_max_id IS NOT DISTINCT FROM ${expected.sourceMaxId ?? "NULL"}
    AND raw_archived_through = ${literal(expected.rawBoundary!)}::date)
    OR (SELECT MAX(id) FROM price_snapshots) IS DISTINCT FROM ${expected.rawMaxId ?? "NULL"}
    OR (SELECT COUNT(*) FROM price_snapshots) <> ${expected.rawCount}
    OR (SELECT COALESCE(SUM(price), 0) FROM price_snapshots) <> ${expected.rawSum}
    OR (SELECT archive_sha256 FROM price_raw_archive_segment WHERE observed_date = ${sqlDate})
       IS DISTINCT FROM ${oldHash}
    OR NOT EXISTS (SELECT 1 FROM price_archive_feed_queue WHERE observed_date = ${sqlDate}
      AND identity_fingerprint = ${literal(queue.identityFingerprint)}
      AND spool_sha256 = ${literal(queue.spoolSha256)} AND status = 'PENDING'
      AND applied_count = ${queue.appliedCount})
    OR EXISTS (SELECT 1 FROM price_archive_feed_queue WHERE observed_date = ${sqlDate}
      AND status = 'PENDING' AND (queued_at, identity_fingerprint) >
        (${literal(queue.queuedAt)}::timestamptz, ${literal(queue.identityFingerprint)}))
  THEN RAISE EXCEPTION 'Pricing correction source or queue changed before activation'; END IF;
END $$;
CREATE TEMP TABLE touched_price_keys ON COMMIT DROP AS
SELECT DISTINCT mtgjson_uuid, provider, finish, price_type, currency
FROM jsonb_to_recordset(${keysJson}::jsonb)
  AS k(mtgjson_uuid text, provider text, finish text, price_type text, currency text);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM touched_price_keys k JOIN price_archived_scope_summary a
    USING (mtgjson_uuid, provider, finish, price_type, currency)
    WHERE a.snapshot_count <> COALESCE((SELECT SUM(b.raw_count)
      FROM price_archived_daily_basis b WHERE (b.mtgjson_uuid, b.provider, b.finish,
        b.price_type, b.currency) = (k.mtgjson_uuid, k.provider, k.finish,
        k.price_type, k.currency)), 0))
  THEN RAISE EXCEPTION 'Archived daily basis is incomplete for a corrected scope'; END IF;
END $$;
INSERT INTO price_archived_daily_basis
  (mtgjson_uuid, provider, finish, price_type, currency, observed_date,
   price, source_snapshot_id, source_revision_count, current_ingested_at,
   raw_count, latest_ingested_at)
SELECT mtgjson_uuid, provider, finish, price_type, currency, observed_date::date,
  price::numeric, id, revision_count, created_at::timestamptz, 1,
  created_at::timestamptz
FROM jsonb_to_recordset(${effectsJson}::jsonb) AS x(
  mtgjson_uuid text, provider text, finish text, price_type text, currency text,
  observed_date text, price text, id bigint, revision_count int, created_at text)
ON CONFLICT (mtgjson_uuid, provider, finish, price_type, currency, observed_date)
DO UPDATE SET price = EXCLUDED.price,
  source_snapshot_id = EXCLUDED.source_snapshot_id,
  source_revision_count = EXCLUDED.source_revision_count,
  current_ingested_at = EXCLUDED.current_ingested_at,
  latest_ingested_at = GREATEST(price_archived_daily_basis.latest_ingested_at,
    EXCLUDED.latest_ingested_at);
${archivedBasisRebuildBodySql}
${pricingSummaryRefreshBodySql}
INSERT INTO price_raw_archive_segment
  (observed_date, archive_path, archive_sha256, csv_sha256,
   source_fingerprint, identity_fingerprint, raw_rows, generation,
   backup_path, backup_sha256)
VALUES (${sqlDate}, ${literal(replacement.archive)}, '${replacement.archiveSha}',
  '${replacement.csvSha}', '${replacement.sourceFingerprint}',
  '${replacement.identityFingerprint}', ${replacement.rows}, ${generation},
  ${literal(backup)}, '${backupSha}')
ON CONFLICT (observed_date) DO UPDATE SET
  archive_path = EXCLUDED.archive_path, archive_sha256 = EXCLUDED.archive_sha256,
  csv_sha256 = EXCLUDED.csv_sha256,
  source_fingerprint = EXCLUDED.source_fingerprint,
  identity_fingerprint = EXCLUDED.identity_fingerprint,
  raw_rows = EXCLUDED.raw_rows, generation = EXCLUDED.generation,
  backup_path = EXCLUDED.backup_path, backup_sha256 = EXCLUDED.backup_sha256,
  activated_at = now();
UPDATE price_archive_feed_queue SET status = ${remaining ? "'PENDING'" : "'APPLIED'"},
  applied_count = applied_count + ${effects.length},
  processed_at = ${remaining ? "NULL" : "now()"}, error = NULL
  WHERE observed_date = ${sqlDate} AND identity_fingerprint = ${literal(queue.identityFingerprint)};
UPDATE price_archive_feed_queue SET status = 'SUPERSEDED', processed_at = now()
  WHERE observed_date = ${sqlDate} AND status = 'PENDING'
    AND identity_fingerprint <> ${literal(queue.identityFingerprint)}
    AND (queued_at, identity_fingerprint) <
      (${literal(queue.queuedAt)}::timestamptz, ${literal(queue.identityFingerprint)})
    AND ${remaining} = 0;
UPDATE price_summary_state SET source_revision = source_revision + ${effects.length},
  summary_revision = summary_revision + ${effects.length}, refreshed_at = now()
  WHERE singleton;
COMMIT;`;
}

async function main() {
  const before = state(database);
  const { segment, queue } = records(database);
  if (!queue) throw new Error("No pending archived feed for that UTC date");
  if (!before.ready || before.sourceRevision !== before.summaryRevision ||
      before.rawMaxId !== before.sourceMaxId || !before.rawBoundary ||
      date > before.rawBoundary)
    throw new Error("Pricing summaries must be fresh and date must be archived");
  const plan = planArchivedCorrection(root!, date, segment, queue);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", observedDate: date,
    generation: plan.priorGeneration, archivedRows: plan.archivedRows,
    feedRows: plan.feedRows, corrected: plan.corrected, added: plan.added,
    unchanged: plan.unchanged, missingPreserved: plan.missing }));
  if (!apply || plan.changedRows.length === 0) return;
  const batch = plan.changedRows.slice(0, 500);
  const remaining = plan.changedRows.length - batch.length;
  const plannedKeys = batch.map((row) => ({ mtgjson_uuid: row.mtgjsonUuid,
    provider: row.provider, finish: row.finish, price_type: row.priceType,
    currency: row.currency }));
  const visibleBefore = signature(database, plannedKeys);

  const id = `correction-${date}-${randomUUID()}`;
  const directory = resolve(root!, "pricing", "raw", date);
  mkdirSync(directory, { recursive: true });
  const backup = resolve(root!, "pricing", `${id}.dump`);
  const backupManifest = resolve(root!, "pricing", `${id}.backup.json`);
  const csvPath = resolve(directory, `${id}.csv`);
  const archive = resolve(directory, `${id}.csv.gz`);
  const manifestPath = resolve(directory, `${id}.json`);
  const receiptPath = resolve(directory, `${id}.applied.json`);
  const cloneName = `mtg_pricing_correction_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = makeDb("postgres");
  const clone = makeDb(cloneName);
  let created = false;
  try {
    program("pg_dump", [database.toString(), "--format=custom", "--no-owner",
      "--no-acl", `--file=${backup}`]);
    const backupSha = await fileSha(backup);
    command(admin, `CREATE DATABASE "${cloneName}";`);
    created = true;
    program("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl",
      "--jobs=2", `--dbname=${clone.toString()}`, backup]);
    if (JSON.stringify(state(clone)) !== JSON.stringify(before) ||
        JSON.stringify(records(clone)) !== JSON.stringify({ segment, queue }) ||
        signature(clone, plannedKeys) !== visibleBefore)
      throw new Error("Isolated database restore differs from queued correction source");
    command(clone, `CREATE TABLE archive_rows (LIKE price_snapshots INCLUDING ALL);
      CREATE TABLE replacement_rows (LIKE price_snapshots INCLUDING ALL);
      CREATE TABLE feed_rows (mtgjson_uuid text, provider text, finish text,
        price_type text, currency text, observed_date date, price numeric(12,4),
        raw_json jsonb, candidate_id bigint);`);
    command(clone, `COPY archive_rows (${rawSegmentColumns}) FROM STDIN
      WITH (FORMAT csv, HEADER true)`, archiveInput(segment));
    if (segment && command(clone, identitySql("archive_rows")) !== segment.identityFingerprint)
      throw new Error("Restored raw archive identities differ from active segment metadata");
    const reserved = command(database, `SELECT nextval(pg_get_serial_sequence(
      'price_snapshots', 'id')) FROM generate_series(1, ${batch.length});`)
      .split(/\r?\n/).map(Number);
    if (reserved.length !== batch.length || reserved.some((value) => !Number.isSafeInteger(value)))
      throw new Error("Could not reserve archived identity provenance IDs");
    const feedCsv = Papa.unparse({ fields: ["mtgjson_uuid", "provider", "finish",
      "price_type", "currency", "observed_date", "price", "raw_json",
      "candidate_id"], data: batch.map((row, index) => [row.mtgjsonUuid,
        row.provider, row.finish, row.priceType, row.currency, row.observedDate,
        row.price.toFixed(4), JSON.stringify(row.rawJson), String(reserved[index])]) },
      { newline: "\n" });
    command(clone, `COPY feed_rows FROM STDIN WITH (FORMAT csv, HEADER true)`,
      Buffer.from(`${feedCsv}\n`));
    command(clone, `CREATE TABLE correction_effects AS WITH updated AS (
      UPDATE archive_rows a SET price = f.price, raw_json = f.raw_json,
        revision_count = a.revision_count + 1, created_at = now()
      FROM feed_rows f WHERE (a.mtgjson_uuid,a.provider,a.finish,a.price_type,
        a.currency,a.observed_date) = (f.mtgjson_uuid,f.provider,f.finish,
        f.price_type,f.currency,f.observed_date)
        AND a.price IS DISTINCT FROM f.price RETURNING a.*
    ), added AS (
      INSERT INTO archive_rows (id, mtgjson_uuid, provider, finish, price_type,
        currency, observed_date, price, raw_json)
      SELECT f.candidate_id, f.mtgjson_uuid, f.provider, f.finish, f.price_type,
        f.currency, f.observed_date, f.price, f.raw_json FROM feed_rows f
      WHERE NOT EXISTS (SELECT 1 FROM archive_rows a WHERE
        (a.mtgjson_uuid,a.provider,a.finish,a.price_type,a.currency,a.observed_date) =
        (f.mtgjson_uuid,f.provider,f.finish,f.price_type,f.currency,f.observed_date))
      RETURNING *
    ) SELECT * FROM updated UNION ALL SELECT * FROM added;`);
    const effects = JSON.parse(command(clone, `SELECT COALESCE(json_agg(json_build_object(
      'mtgjson_uuid', mtgjson_uuid, 'provider', provider, 'finish', finish,
      'price_type', price_type, 'currency', currency,
      'observed_date', observed_date::text, 'price', price::text,
      'id', id, 'revision_count', revision_count,
      'created_at', created_at::text)), '[]'::json)::text
      FROM correction_effects;`)) as Array<{
        mtgjson_uuid: string; provider: string; finish: string; price_type: string;
        currency: string; observed_date: string; price: string; id: number;
        revision_count: number; created_at: string }>;
    if (effects.length !== batch.length)
      throw new Error("Archived correction effects differ from verified feed reconciliation");
    command(clone, `COPY (SELECT ${rawSegmentColumns} FROM archive_rows ORDER BY id)
      TO STDOUT WITH (FORMAT csv, HEADER true)`, undefined, csvPath);
    const csv = readFileSync(csvPath);
    if (csv.length > 64 * 1024 * 1024)
      throw new Error("Replacement raw archive exceeds the 64 MiB segment budget");
    const compressed = gzipSync(csv, { level: 6 });
    writeFileSync(archive, compressed, { flag: "wx" });
    const stored = readFileSync(archive);
    if (sha(stored) !== sha(compressed) || sha(gunzipSync(stored)) !== sha(csv))
      throw new Error("Replacement raw archive changed on disk");
    command(clone, `COPY replacement_rows (${rawSegmentColumns}) FROM STDIN
      WITH (FORMAT csv, HEADER true)`, gunzipSync(stored));
    if (command(clone, `SELECT EXISTS (
      (SELECT ${rawSegmentColumns} FROM archive_rows EXCEPT ALL
       SELECT ${rawSegmentColumns} FROM replacement_rows)
      UNION ALL
      (SELECT ${rawSegmentColumns} FROM replacement_rows EXCEPT ALL
       SELECT ${rawSegmentColumns} FROM archive_rows));`) !== "f")
      throw new Error("Restored replacement archive differs from corrected raw rows");
    const replacement = { archive, archiveSha: sha(stored), csvSha: sha(csv),
      identityFingerprint: command(clone, identitySql("archive_rows")),
      sourceFingerprint: command(clone, sourceSql("archive_rows")),
      rows: Number(command(clone, `SELECT COUNT(*) FROM archive_rows;`)) };
    writeFileSync(manifestPath, `${JSON.stringify({ status: "verified_staged",
      schemaVersion: 1, observedDate: date, priorGeneration: segment?.generation ?? 0,
      generation: (segment?.generation ?? 0) + 1, replacement,
      effects: effects.length, remaining, missingPreserved: plan.missing,
      feedSha256: queue.spoolSha256, backup, backupSha256: backupSha,
      restoreVerified: true, activated: false }, null, 2)}\n`, { flag: "wx" });
    writeFileSync(backupManifest, `${JSON.stringify({ status: "verified_before_correction",
      observedDate: date, backup, backupSha256: backupSha,
      priorArchive: segment?.archivePath ?? null,
      priorArchiveSha256: segment?.archiveSha256 ?? null,
      replacementManifest: manifestPath, state: before }, null, 2)}\n`,
      { flag: "wx" });
    if (process.env.MTG_ARCHIVED_CORRECTION_TEST_FAIL_AFTER_RESTORE === "1")
      throw new Error("Injected correction interruption before activation");
    const statement = correctionSql(before, segment, queue, replacement,
      backup, backupSha, remaining, effects);
    command(clone, statement);
    const keys = effects.map((row) => ({ mtgjson_uuid: row.mtgjson_uuid,
      provider: row.provider, finish: row.finish, price_type: row.price_type,
      currency: row.currency }));
    const simulatedSignature = signature(clone, keys);
    if (state(clone).sourceRevision !== before.sourceRevision + effects.length ||
        records(clone).segment?.archiveSha256 !== replacement.archiveSha)
      throw new Error("Isolated correction activation failed its database postconditions");
    if (JSON.stringify(state(database)) !== JSON.stringify(before) ||
        JSON.stringify(records(database)) !== JSON.stringify({ segment, queue }) ||
        signature(database, plannedKeys) !== visibleBefore ||
        await fileSha(backup) !== backupSha || sha(readFileSync(archive)) !== replacement.archiveSha)
      throw new Error("Live Pricing source or verified files changed before correction activation");
    command(database, statement);
    if (signature(database, keys) !== simulatedSignature ||
        records(database).segment?.archiveSha256 !== replacement.archiveSha)
      throw new Error("Live corrected projections differ from isolated restore; use verified backup");
    writeFileSync(receiptPath, `${JSON.stringify({ status: "applied",
      appliedAt: new Date().toISOString(), observedDate: date,
      generation: (segment?.generation ?? 0) + 1, effects: effects.length,
      remaining,
      missingPreserved: plan.missing, archive, archiveSha256: replacement.archiveSha,
      backup, backupSha256: backupSha, manifestPath }, null, 2)}\n`,
      { flag: "wx" });
    console.log(JSON.stringify({ mode: "applied", observedDate: date,
      generation: (segment?.generation ?? 0) + 1, effects: effects.length,
      remaining,
      missingPreserved: plan.missing, receiptPath }));
  } finally {
    if (created) command(admin, `DROP DATABASE "${cloneName}" WITH (FORCE);`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
