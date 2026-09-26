import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pricingSummarySchemaSql, refreshPricingSummariesSql } from "./pricing-summary-sql";

assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
const source = new URL(process.env.PRICING_DATABASE_URL!);
assert.ok(["pricing-postgres", "localhost", "127.0.0.1"].includes(source.hostname));
source.searchParams.delete("schema");
if (process.env.PRICING_VERIFY_POSTGRES_DRILL === "1") {
  assert.equal(source.hostname, "pricing-postgres");
  const verifier = new URL(source);
  verifier.hostname = "pricing-verify-postgres";
  verifier.pathname = "/postgres";
  process.env.PRICING_VERIFY_DATABASE_URL = verifier.toString();
}
const admin = new URL(source);
admin.pathname = "/postgres";
const name = "pricing_retention_verify_" + randomUUID().replace(/-/g, "").slice(0, 16);
const database = new URL(source);
database.pathname = "/" + name;
const backup = mkdtempSync(join(tmpdir(), "pricing-retention-backup-"));
const recovery = mkdtempSync(join(tmpdir(), "pricing-retention-recovery-"));
mkdirSync(join(backup, "pricing"));
let created = false;

function sql(url: URL, statement: string) {
  const result = spawnSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement,
    encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error("Fixture SQL failed: " + result.stderr.trim());
  return result.stdout.trim();
}
function script(path: string, args: string[] = []) {
  return spawnSync(process.execPath, ["--import", "tsx", path, ...args],
    { env: { ...process.env, PRICING_DATABASE_URL: database.toString(),
      BACKUP_DIR: backup, PRICING_RECOVERY_COPY_DIR: recovery,
      PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1",
      PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1", MTG_LOCAL_PILOT_TEST: "1" },
      encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
}
function lastJson(output: string) {
  return JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? "{}");
}

try {
  sql(admin, 'CREATE DATABASE "' + name + '";');
  created = true;
  sql(database, "CREATE TABLE price_snapshots (id BIGSERIAL PRIMARY KEY, scryfall_id TEXT, " +
    "mtgjson_uuid TEXT NOT NULL, provider TEXT NOT NULL, finish TEXT NOT NULL, " +
    "price_type TEXT NOT NULL, currency TEXT NOT NULL, observed_date DATE NOT NULL, " +
    "price NUMERIC(12,4) NOT NULL, raw_json JSONB, card_name TEXT, set_code TEXT, " +
    "collector_number TEXT, revision_count INTEGER NOT NULL DEFAULT 0, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now()); " +
    "CREATE UNIQUE INDEX price_snapshots_identity_key ON price_snapshots " +
    "((COALESCE(mtgjson_uuid, '')), (COALESCE(scryfall_id, '')), provider, finish, " +
    "price_type, currency, observed_date); " +
    "CREATE TABLE price_import_jobs (status TEXT NOT NULL);");
  sql(database, pricingSummarySchemaSql);
  const oldDate = sql(database, "SELECT (CURRENT_DATE - interval '120 days')::date::text;");
  const recentDate = sql(database, "SELECT (CURRENT_DATE - interval '1 day')::date::text;");
  const card = "retention-fixture-" + randomUUID();
  sql(database, "INSERT INTO price_snapshots " +
    "(mtgjson_uuid, provider, finish, price_type, currency, observed_date, price) VALUES " +
    "('" + card + "', 'tcgplayer', 'normal', 'retail', 'USD', '" + oldDate + "', 4), " +
    "('" + card + "', 'tcgplayer', 'normal', 'retail', 'USD', '" + recentDate + "', 6);");
  sql(database, refreshPricingSummariesSql(JSON.stringify([{ mtgjson_uuid: card,
    provider: "tcgplayer", finish: "normal", price_type: "retail", currency: "USD" }])));
  sql(database, "UPDATE price_summary_state SET ready = TRUE, tiers_ready = TRUE, " +
    "source_max_id = (SELECT MAX(id) FROM price_snapshots), " +
    "summary_revision = source_revision WHERE singleton = TRUE;");
  const originalRevision = sql(database,
    "SELECT source_revision FROM price_summary_state WHERE singleton;");
  const preview = script("scripts/pricing-raw-retention-pass.ts");
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(lastJson(preview.stdout).candidate, oldDate);
  assert.equal(sql(database, "SELECT COUNT(*) FROM price_snapshots;"), "2");
  const direct = process.env.PRICING_DIRECT_VERIFICATION_DRILL === "1";
  let result;
  if (direct) {
    const compact = script("scripts/pricing-daily-compact.ts", ["--apply"]);
    assert.equal(compact.status, 0, compact.stderr + compact.stdout);
    assert.equal(lastJson(compact.stdout).mode, "complete");
    const staged = script("scripts/pricing-raw-segment-stage.ts", ["--date", oldDate]);
    assert.equal(staged.status, 0, staged.stderr + staged.stdout);
    const manifest = lastJson(staged.stdout).manifestPath;
    const activated = script("scripts/pricing-raw-segment-activate.ts",
      ["--manifest", manifest, "--apply"]);
    assert.equal(activated.status, 0, activated.stderr + activated.stdout);
    result = lastJson(activated.stdout);
    assert.equal(result.mode, "activated");
  } else {
    const applied = script("scripts/pricing-raw-retention-pass.ts", ["--apply"]);
    assert.equal(applied.status, 0, applied.stderr + applied.stdout);
    result = lastJson(applied.stdout);
    assert.equal(result.mode, "retention-activated");
  }
  assert.equal(result.observedDate, oldDate);
  assert.equal(result.deleted, 1);
  assert.equal(sql(database, "SELECT COUNT(*) FROM price_snapshots;"), "1");
  assert.equal(sql(database,
    "SELECT raw_archived_through::text FROM price_summary_state WHERE singleton;"), oldDate);
  const audit = script("scripts/pricing-recovery-package-audit.ts");
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(lastJson(audit.stdout).verified, 2);
  const dailyPackage = readdirSync(recovery)
    .filter((file) => file.endsWith(".package.json"))
    .map((file) => join(recovery, file))
    .find((path) => JSON.parse(readFileSync(path, "utf8")).operation === "daily_compaction");
  assert.ok(dailyPackage);
  const hiddenBackup = backup + "-hidden";
  renameSync(backup, hiddenBackup);
  try {
    const dailyDrill = script("scripts/pricing-daily-copy-restore-drill.ts",
      ["--package", dailyPackage, "--run"]);
    assert.equal(dailyDrill.status, 0, dailyDrill.stderr + dailyDrill.stdout);
    assert.equal(lastJson(dailyDrill.stdout).verified, true);
  } finally {
    renameSync(hiddenBackup, backup);
  }
  const repeat = script("scripts/pricing-raw-retention-pass.ts");
  assert.equal(lastJson(repeat.stdout).candidate, null);
  const rollback = process.env.PRICING_ROLLBACK_DRILL === "1";
  if (rollback) {
    const receipt = JSON.parse(readFileSync(result.receipt, "utf8"));
    const copies = receipt.recoveryCopies as Array<{
      path: string; destination: string; sha256: string }>;
    const dump = copies.find((copy) => copy.path === receipt.backup);
    const packageIndex = copies.find((copy) => copy.path === receipt.recoveryPackage);
    const backupManifest = copies.find((copy) => copy.path === receipt.backupManifest);
    assert.ok(dump && packageIndex && backupManifest);
    assert.ok(resolve(dump.destination).startsWith(resolve(recovery) + sep));
    assert.equal(createHash("sha256").update(readFileSync(dump.destination)).digest("hex"),
      receipt.backupSha256);
    const before = JSON.parse(readFileSync(backupManifest.destination, "utf8")).sourceState;
    const packageDrill = script("scripts/pricing-recovery-copy-restore-drill.ts",
      ["--package", packageIndex.destination, "--run"]);
    assert.equal(packageDrill.status, 0, packageDrill.stderr + packageDrill.stdout);
    sql(admin, 'DROP DATABASE "' + name + '" WITH (FORCE);');
    sql(admin, 'CREATE DATABASE "' + name + '";');
    const restored = spawnSync("pg_restore", ["--exit-on-error", "--no-owner",
      "--no-acl", "--dbname=" + database.toString(), dump.destination],
    { encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(sql(database, "SELECT COUNT(*) FROM price_snapshots;"), "2");
    assert.equal(sql(database, "SELECT COUNT(*) FROM price_snapshots WHERE observed_date = '" +
      oldDate + "'::date AND price = 4;"), "1");
    assert.equal(sql(database,
      "SELECT raw_archived_through IS NULL FROM price_summary_state WHERE singleton;"), "t");
    assert.equal(sql(database,
      "SELECT daily_compacted_through::text FROM price_summary_state WHERE singleton;"),
      before.dailyBoundary);
    assert.equal(Number(sql(database,
      "SELECT source_revision FROM price_summary_state WHERE singleton;")),
      before.sourceRevision);
    assert.equal(sql(database,
      "SELECT COUNT(*) FROM price_raw_archive_segment;"), "0");
  }
  const fullRollback = process.env.PRICING_FULL_PASS_ROLLBACK_DRILL === "1";
  if (fullRollback) {
    const dailyIndex = JSON.parse(readFileSync(dailyPackage, "utf8")) as {
      files: Array<{ relativePath: string; sha256: string }> };
    const dumpEntry = dailyIndex.files.find((file) => file.relativePath.endsWith(".dump"));
    assert.ok(dumpEntry);
    const copiedDump = resolve(recovery, dumpEntry.relativePath);
    assert.ok(copiedDump.startsWith(resolve(recovery) + sep));
    assert.equal(createHash("sha256").update(readFileSync(copiedDump)).digest("hex"),
      dumpEntry.sha256);
    renameSync(backup, hiddenBackup);
    try {
      sql(admin, 'DROP DATABASE "' + name + '" WITH (FORCE);');
      sql(admin, 'CREATE DATABASE "' + name + '";');
      const restored = spawnSync("pg_restore", ["--exit-on-error", "--no-owner",
        "--no-acl", "--dbname=" + database.toString(), copiedDump],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
      assert.equal(restored.status, 0, restored.stderr);
      assert.equal(sql(database, "SELECT COUNT(*) FROM price_snapshots;"), "2");
      assert.equal(sql(database, "SELECT COUNT(*) FROM price_daily_summary;"), "2");
      assert.equal(sql(database, "SELECT COUNT(*) FROM price_daily_summary WHERE observed_date = '" +
        oldDate + "'::date AND price = 4;"), "1");
      assert.equal(sql(database,
        "SELECT daily_compacted_through IS NULL AND raw_archived_through IS NULL " +
        "FROM price_summary_state WHERE singleton;"), "t");
      assert.equal(sql(database,
        "SELECT source_revision FROM price_summary_state WHERE singleton;"), originalRevision);
      assert.equal(sql(database, "SELECT COUNT(*) FROM price_raw_archive_segment;"), "0");
    } finally {
      renameSync(hiddenBackup, backup);
    }
  }
  console.log(JSON.stringify({ mode: "retention-fixture-passed", oldDate,
    copiedPackages: 2, liveRaw: rollback || fullRollback ? 2 : 1,
    direct, rollback, fullRollback,
    isolatedVerifier: process.env.PRICING_VERIFY_POSTGRES_DRILL === "1" }));
} finally {
  if (created) sql(admin, 'DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE);');
  for (const path of [backup, recovery]) {
    const target = resolve(path);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep));
    rmSync(target, { recursive: true, force: true });
  }
}
