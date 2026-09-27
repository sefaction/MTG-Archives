import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";
import { rawSegmentColumns, rawSegmentFingerprintSql,
  rawSegmentIdentityFingerprintSql } from "./pricing-raw-segment-common";
import { pricingVerificationServer } from "./pricing-verification-server";

const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required.");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname) &&
    !(process.env.MTG_LOCAL_PILOT_TEST === "1" &&
      database.hostname === "pricing-retention-clone-postgres"))
  throw new Error("Raw segment staging currently supports only local Pricing databases.");
database.searchParams.delete("schema");
const backupRoot = process.env.BACKUP_DIR;
if (!backupRoot) throw new Error("BACKUP_DIR is required.");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--date" || !/^\d{4}-\d{2}-\d{2}$/.test(args[1]))
  throw new Error("Use --date YYYY-MM-DD; staging never deletes or activates raw rows.");
const observedDate = args[1];
if (new Date(`${observedDate}T00:00:00Z`).toISOString().slice(0, 10) !== observedDate)
  throw new Error("Invalid observed date.");
const liveDays = getPricingRetentionPolicy().dailyDays;
const columns = rawSegmentColumns;
const copySql = `COPY (SELECT ${columns} FROM price_snapshots
  WHERE observed_date = '${observedDate}' ORDER BY id)
  TO STDOUT WITH (FORMAT csv, HEADER true)`;
const maximumCsvBytes = 64 * 1024 * 1024;

function command(db: URL, statement: string, input?: Buffer, outputPath?: string) {
  const fd = outputPath ? openSync(outputPath, "wx") : undefined;
  try {
    const result = spawnSync(
      "psql",
      [db.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement],
      { input, encoding: outputPath ? undefined : "utf8", timeout: 300_000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["pipe", fd ?? "pipe", "pipe"] },
    );
    if (result.status !== 0)
      throw new Error("Pricing segment database command failed or timed out.");
    return typeof result.stdout === "string" ? result.stdout.trim() : "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

const directory = resolve(backupRoot, "pricing", "raw", observedDate);
mkdirSync(directory, { recursive: true });
const id = `segment-${observedDate}-${randomUUID()}`;
const sourceCsv = resolve(directory, `${id}.source.csv`);
const restoredCsv = resolve(directory, `${id}.restored.csv`);
const currentCsv = resolve(directory, `${id}.current.csv`);
const archive = resolve(directory, `${id}.csv.gz`);
const manifestPath = resolve(directory, `${id}.json`);
const admin = pricingVerificationServer(database);
admin.pathname = "/postgres";
const restoreName = `mtg_pricing_segment_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const restore = new URL(admin);
restore.pathname = `/${restoreName}`;
let restoreCreated = false;
let verified = false;
try {
  const cutoff = command(database,
    `SELECT (CURRENT_DATE - ${liveDays + 1})::text;`);
  if (observedDate > cutoff)
    throw new Error("The requested date is still in the live raw window.");
  const state = JSON.parse(command(database, `SELECT json_build_object(
    'ready', ready AND tiers_ready AND source_revision = summary_revision,
    'sourceMaxId', source_max_id,
    'rawMaxId', (SELECT MAX(id) FROM price_snapshots),
    'sourceRevision', source_revision,
    'rawArchivedThrough', raw_archived_through::text)::text
    FROM price_summary_state WHERE singleton = TRUE;`)) as {
      ready: boolean; sourceMaxId: number | null; rawMaxId: number | null;
      sourceRevision: number; rawArchivedThrough: string | null;
    };
  if (!state.ready || state.sourceMaxId !== state.rawMaxId)
    throw new Error("Pricing projections must be fresh before raw segment staging.");
  if (state.rawArchivedThrough && observedDate <= state.rawArchivedThrough)
    throw new Error("The requested date is already inside the activated archive boundary.");
  command(database, copySql, undefined, sourceCsv);
  if (statSync(sourceCsv).size > maximumCsvBytes)
    throw new Error("Raw segment exceeds the 64 MiB staging budget; split the segment first.");
  const csv = readFileSync(sourceCsv);
  // COPY with HEADER emits a header even when there are no observations.
  const stats = JSON.parse(command(database, `SELECT json_build_object(
    'rows', COUNT(*), 'priceSum', COALESCE(SUM(price), 0)::text,
    'minId', MIN(id), 'maxId', MAX(id))::text
    FROM price_snapshots WHERE observed_date = '${observedDate}';`)) as {
      rows: number; priceSum: string; minId: number | null; maxId: number | null;
    };
  const sourceFingerprint = command(database, `${rawSegmentFingerprintSql(observedDate)};`);
  const identityFingerprint = command(database,
    `${rawSegmentIdentityFingerprintSql(observedDate)};`);
  if (stats.rows === 0) {
    console.log(JSON.stringify({ mode: "no-candidates", observedDate, rows: 0 }));
    verified = true;
    process.exitCode = 0;
  } else {
    const compressed = gzipSync(csv, { level: 6 });
    writeFileSync(archive, compressed, { flag: "wx" });
    const storedArchive = readFileSync(archive);
    if (sha256(storedArchive) !== sha256(compressed))
      throw new Error("The written raw segment differs from the staged archive.");
    const restoreInput = gunzipSync(storedArchive);
    if (sha256(restoreInput) !== sha256(csv))
      throw new Error("The written raw segment does not decompress to the source.");
    command(admin, `CREATE DATABASE "${restoreName}";`);
    restoreCreated = true;
    command(restore, `CREATE TABLE price_snapshots (
      id BIGINT PRIMARY KEY, scryfall_id TEXT, mtgjson_uuid TEXT,
      card_name TEXT, set_code TEXT, collector_number TEXT,
      provider TEXT NOT NULL, finish TEXT NOT NULL, price_type TEXT NOT NULL,
      currency TEXT NOT NULL, observed_date DATE NOT NULL,
      price NUMERIC(12, 4) NOT NULL, raw_json JSONB,
      revision_count INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL
    );`);
    command(restore,
      `COPY price_snapshots (${columns}) FROM STDIN WITH (FORMAT csv, HEADER true)`, restoreInput);
    command(restore, copySql, undefined, restoredCsv);
    if (sha256(readFileSync(restoredCsv)) !== sha256(csv))
      throw new Error("Isolated segment restore changed the serialized raw observations.");
    const restoredStats = JSON.parse(command(restore, `SELECT json_build_object(
      'rows', COUNT(*), 'priceSum', COALESCE(SUM(price), 0)::text,
      'minId', MIN(id), 'maxId', MAX(id))::text FROM price_snapshots;`));
    if (JSON.stringify(restoredStats) !== JSON.stringify(stats))
      throw new Error("Isolated segment restore counts or prices differ from the source.");
    command(database, copySql, undefined, currentCsv);
    if (sha256(readFileSync(currentCsv)) !== sha256(csv))
      throw new Error("The live raw segment changed while staging; retry with a new archive.");
    if (command(database, `${rawSegmentFingerprintSql(observedDate)};`) !== sourceFingerprint)
      throw new Error("The live raw segment fingerprint changed while staging.");
    if (command(database, `${rawSegmentIdentityFingerprintSql(observedDate)};`) !== identityFingerprint)
      throw new Error("The live raw segment identities changed while staging.");
    const manifest = {
      status: "verified_staged", schemaVersion: 1,
      createdAt: new Date().toISOString(), observedDate, liveDays,
      sourceRevision: state.sourceRevision, sourceMaxId: state.sourceMaxId,
      rows: stats.rows, priceSum: stats.priceSum,
      minId: stats.minId, maxId: stats.maxId,
      columns, archive, archiveBytes: storedArchive.length,
      archiveSha256: sha256(storedArchive), csvSha256: sha256(csv),
      sourceFingerprint,
      identityFingerprint,
      restoreVerified: true, activated: false,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    verified = true;
    console.log(JSON.stringify({ mode: "verified-staged", observedDate,
      rows: stats.rows, archive, manifestPath, archiveSha256: manifest.archiveSha256,
      activated: false }));
  }
} finally {
  if (restoreCreated)
    command(admin, `DROP DATABASE "${restoreName}" WITH (FORCE);`);
  for (const path of [sourceCsv, restoredCsv, currentCsv])
    rmSync(path, { force: true });
  if (!verified) {
    rmSync(archive, { force: true });
    rmSync(manifestPath, { force: true });
  }
}
