import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { verifyPricingRecoveryCopyDestination } from "./pricing-recovery-copy";

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--receipt" || args[2] !== "--run" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Use --receipt PATH --run with MTG_LOCAL_PILOT_TEST=1");
const configured = process.env.PRICING_DATABASE_URL;
const sourceRoot = process.env.BACKUP_DIR;
const copyRoot = process.env.PRICING_RECOVERY_COPY_DIR;
if (!configured || !sourceRoot || !copyRoot)
  throw new Error("PRICING_DATABASE_URL, BACKUP_DIR and PRICING_RECOVERY_COPY_DIR are required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Recovery copy restore drill supports only local Pricing databases");
database.searchParams.delete("schema");
const admin = new URL(database);
admin.pathname = "/postgres";
const name = `pricing_copy_drill_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const restored = new URL(database);
restored.pathname = `/${name}`;

function inside(root: string, path: string) {
  return path.startsWith(`${root}${sep}`);
}
function run(program: string, args: string[], input?: string) {
  const result = spawnSync(program, args, { input, encoding: "utf8",
    timeout: 900_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${program} failed: ${result.stderr?.trim().slice(0, 500) ?? ""}`);
  return result.stdout.trim();
}
function query(db: URL, statement: string) {
  return run("psql", [db.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], statement);
}
async function fileSha(path: string) {
  const hash = createHash("sha256");
  for await (const piece of createReadStream(path)) hash.update(piece);
  return hash.digest("hex");
}
type RecoveryCopy = { path: string; destination: string; sha256: string };
type Receipt = { status: string; observedDate: string; archive: string;
  archiveSha256: string; backup: string; backupSha256: string;
  recoveryCopies: RecoveryCopy[] };

async function main() {
  const { source, destination } = await verifyPricingRecoveryCopyDestination(
    sourceRoot!, copyRoot!);
  const receiptPath = await realpath(resolve(args[1]));
  if (!inside(source, receiptPath) || !(await lstat(receiptPath)).isFile())
    throw new Error("Recovery receipt must be a regular file under BACKUP_DIR/pricing");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt;
  if (!["activated", "applied"].includes(receipt.status) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(receipt.observedDate) ||
      !Array.isArray(receipt.recoveryCopies) || receipt.recoveryCopies.length !== 4)
    throw new Error("Receipt does not contain a complete recovery copy package");
  const copies = new Map<string, RecoveryCopy>();
  for (const copy of receipt.recoveryCopies) {
    if (!/^[a-f0-9]{64}$/i.test(copy.sha256))
      throw new Error("Recovery copy hash is invalid");
    const original = resolve(copy.path);
    if (!inside(source, original) || copies.has(original))
      throw new Error("Recovery copy paths are incomplete or duplicated");
    const expected = resolve(destination, relative(source, original));
    const target = await realpath(resolve(copy.destination));
    if (!inside(destination, target) || target !== expected ||
        !(await lstat(copy.destination)).isFile() ||
        await fileSha(target) !== copy.sha256)
      throw new Error("Recovery copy is missing, outside its destination or changed");
    copies.set(original, copy);
  }
  const backup = copies.get(resolve(receipt.backup));
  const archive = copies.get(resolve(receipt.archive));
  const manifests = [...copies.values()].filter((copy) => copy.path.endsWith(".json"));
  if (!backup || !archive || backup.sha256 !== receipt.backupSha256 ||
      archive.sha256 !== receipt.archiveSha256 || manifests.length !== 2)
    throw new Error("Recovery package does not match the activated receipt");
  const documents = manifests.map((copy) =>
    JSON.parse(readFileSync(copy.destination, "utf8")) as Record<string, unknown>);
  const archiveManifest = documents.find((doc) => doc.status === "verified_staged");
  const backupManifest = documents.find((doc) =>
    doc.status === "verified_before_raw_delete" || doc.status === "verified_before_correction");
  if (!archiveManifest || !backupManifest)
    throw new Error("Recovery package lacks a stage or backup manifest");
  const replacement = archiveManifest.replacement as { csvSha?: string; archiveSha?: string } | undefined;
  const csvSha = String(archiveManifest.csvSha256 ?? replacement?.csvSha ?? "");
  const archiveSha = String(archiveManifest.archiveSha256 ?? replacement?.archiveSha ?? "");
  if (String(archiveManifest.observedDate) !== receipt.observedDate ||
      String(backupManifest.observedDate) !== receipt.observedDate ||
      !/^[a-f0-9]{64}$/i.test(csvSha) || archiveSha !== archive.sha256 ||
      String(backupManifest.backupSha256) !== backup.sha256 ||
      String(backupManifest.backup) !== receipt.backup)
    throw new Error("Recovery manifests disagree with copied files");
  const csv = gunzipSync(readFileSync(archive.destination));
  const restoredCsvSha = createHash("sha256").update(csv).digest("hex");
  if (restoredCsvSha !== csvSha)
    throw new Error("Copied raw archive CSV differs from its verified manifest");
  let created = false;
  try {
    query(admin, `CREATE DATABASE "${name}";`);
    created = true;
    const started = Date.now();
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl",
      "--jobs=2", `--dbname=${restored.toString()}`, backup.destination]);
    const restoreMs = Date.now() - started;
    const stats = JSON.parse(query(restored, `SELECT json_build_object(
      'rows', COUNT(*), 'priceSum', COALESCE(SUM(price), 0)::text,
      'maxId', MAX(id))::text FROM price_snapshots;`)) as {
      rows: number; priceSum: string; maxId: number | null };
    const sourceState = (backupManifest.sourceState ?? backupManifest.state) as
      { sourceRevision?: number; rawCount?: number; rawSum?: string } | undefined;
    const rawStats = backupManifest.rawStats as typeof stats | undefined;
    if (!sourceState ||
        (rawStats && (Number(rawStats.rows) !== Number(stats.rows) ||
          rawStats.priceSum !== stats.priceSum || rawStats.maxId !== stats.maxId)) ||
        (sourceState.rawCount !== undefined &&
          (Number(sourceState.rawCount) !== Number(stats.rows) ||
            sourceState.rawSum !== stats.priceSum)))
      throw new Error("Restored recovery dump differs from its pre-operation manifest");
    const revision = Number(query(restored,
      "SELECT source_revision FROM price_summary_state WHERE singleton = TRUE;"));
    if (revision !== sourceState.sourceRevision ||
        await fileSha(backup.destination) !== backup.sha256 ||
        await fileSha(archive.destination) !== archive.sha256)
      throw new Error("Recovery copy changed during isolated restore");
    console.log(JSON.stringify({ mode: "recovery-copy-restore-drill",
      verified: true, observedDate: receipt.observedDate,
      backupSha256: backup.sha256, archiveSha256: archive.sha256,
      rawRows: stats.rows, rawPriceSum: stats.priceSum,
      sourceRevision: revision, restoreMs, liveDatabaseReplaced: false }));
  } finally {
    if (created) query(admin, `DROP DATABASE "${name}" WITH (FORCE);`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
