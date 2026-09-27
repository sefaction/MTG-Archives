import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";

const configured = process.env.PRICING_DATABASE_URL;
const backupRoot = process.env.BACKUP_DIR;
if (!configured || !backupRoot)
  throw new Error("PRICING_DATABASE_URL and BACKUP_DIR are required");
const database = new URL(configured);
database.searchParams.delete("schema");
const root = realpathSync(resolve(backupRoot, "pricing"));

function query(statement: string) {
  const result = spawnSync("psql", [database.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement, encoding: "utf8",
    timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Pricing archive audit query failed: ${result.stderr.trim().slice(0, 500)}`);
  return result.stdout.trim();
}
type Segment = { date: string; generation: number; archive: string;
  archiveSha: string; csvSha: string; backup: string; backupSha: string };
type Feed = { date: string; fingerprint: string; spool: string; spoolSha: string };
const segments = JSON.parse(query(`SELECT COALESCE(json_agg(json_build_object(
  'date', observed_date::text, 'generation', generation,
  'archive', archive_path, 'archiveSha', archive_sha256,
  'csvSha', csv_sha256, 'backup', backup_path,
  'backupSha', backup_sha256) ORDER BY observed_date), '[]'::json)::text
  FROM price_raw_archive_segment;`)) as Segment[];
const feeds = JSON.parse(query(`SELECT COALESCE(json_agg(json_build_object(
  'date', observed_date::text, 'fingerprint', identity_fingerprint,
  'spool', spool_path, 'spoolSha', spool_sha256)
  ORDER BY observed_date, queued_at), '[]'::json)::text
  FROM price_archive_feed_queue WHERE status = 'PENDING';`)) as Feed[];

function safePath(value: string) {
  const path = resolve(value);
  if (!path.startsWith(`${root}${sep}`))
    throw new Error("file path is outside BACKUP_DIR/pricing");
  const actual = realpathSync(path);
  if (!actual.startsWith(`${root}${sep}`) || !statSync(actual).isFile())
    throw new Error("file is not a regular file inside BACKUP_DIR/pricing");
  return actual;
}
async function hash(path: string, unzip = false) {
  const digest = createHash("sha256");
  const stream = unzip ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  for await (const piece of stream) digest.update(piece);
  return digest.digest("hex");
}
const failures: Array<{ kind: string; date: string; generation?: number; reason: string }> = [];
let bytes = 0;
async function verify(kind: string, date: string, generation: number | undefined,
  path: string, expected: string, unzip = false) {
  try {
    const actual = safePath(path);
    const got = await hash(actual, unzip);
    if (got !== expected) throw new Error("SHA-256 differs from Pricing metadata");
    if (!unzip) bytes += statSync(actual).size;
  } catch (error) {
    failures.push({ kind, date, generation,
      reason: error instanceof Error ? error.message : String(error) });
  }
}

async function main() {
  for (const segment of segments) {
    await verify("active_archive", segment.date, segment.generation,
      segment.archive, segment.archiveSha);
    await verify("active_archive_csv", segment.date, segment.generation,
      segment.archive, segment.csvSha, true);
    await verify("pricing_backup", segment.date, segment.generation,
      segment.backup, segment.backupSha);
  }
  for (const feed of feeds)
    await verify("pending_feed", feed.date, undefined, feed.spool, feed.spoolSha);
  const result = { mode: "read-only", activeSegments: segments.length,
    pendingFeeds: feeds.length, verifiedStoredBytes: bytes,
    failures: failures.slice(0, 30), failureCount: failures.length,
    healthy: failures.length === 0,
    independentCopyVerified: false, restoreVerified: false };
  console.log(JSON.stringify(result, null, 2));
  if (!result.healthy) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
