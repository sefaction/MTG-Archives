import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { refreshPricingSummariesSql } from "./pricing-summary-sql";

if (process.argv.slice(2).join(" ") !== "--run" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Use --run with MTG_LOCAL_PILOT_TEST=1 for the local load drill");
const source = new URL(process.env.PRICING_DATABASE_URL!);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(source.hostname))
  throw new Error("Full-size retention drill supports only a local Pricing database");
source.searchParams.delete("schema");
const separateClone = process.env.PRICING_CLONE_POSTGRES_DRILL === "1";
if (separateClone && (source.hostname !== "pricing-postgres" ||
    process.env.PRICING_VERIFY_POSTGRES_DRILL !== "1" ||
    process.env.PRICING_DIRECT_VERIFICATION_DRILL !== "1"))
  throw new Error("Named-volume clone requires the local source, isolated verifier and direct drill");
if (process.env.PRICING_VERIFY_POSTGRES_DRILL === "1") {
  if (source.hostname !== "pricing-postgres")
    throw new Error("Isolated verifier drill requires the local Compose Pricing service");
  const verifier = new URL(source);
  verifier.hostname = "pricing-verify-postgres";
  verifier.pathname = "/postgres";
  process.env.PRICING_VERIFY_DATABASE_URL = verifier.toString();
}
const admin = new URL(source);
if (separateClone) admin.hostname = "pricing-retention-clone-postgres";
admin.pathname = "/postgres";
const name = "pricing_retention_load_" + randomUUID().replace(/-/g, "").slice(0, 16);
const clone = new URL(admin);
clone.pathname = "/" + name;
const work = mkdtempSync(join(tmpdir(), "pricing-retention-load-"));
const backup = join(work, "backup");
const recovery = join(work, "recovery");
mkdirSync(join(backup, "pricing"), { recursive: true });
mkdirSync(recovery);
const dump = join(work, "source.dump");
let created = false;

function run(program: string, args: string[], timeout = 900_000,
  env = process.env) {
  const result = spawnSync(program, args, { env, encoding: "utf8", timeout,
    maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(program + " failed: " + result.stderr.trim().slice(0, 500));
  return result.stdout.trim();
}
function sql(url: URL, statement: string) {
  const result = spawnSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement, encoding: "utf8",
    timeout: 300_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error("Retention load SQL failed: " + result.stderr.trim().slice(0, 500));
  return result.stdout.trim();
}
function bytes(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(directory, entry.name);
    return total + (entry.isDirectory() ? bytes(path) : statSync(path).size);
  }, 0);
}
function lastJson(output: string): Record<string, any> {
  return JSON.parse(output.split(/\r?\n/).at(-1) ?? "{}");
}

try {
  if (separateClone && sql(source,
      "SELECT system_identifier FROM pg_control_system();") === sql(admin,
      "SELECT system_identifier FROM pg_control_system();"))
    throw new Error("Retention clone resolves to the live Pricing server");
  const started = Date.now();
  run("pg_dump", [source.toString(), "--format=custom", "--no-owner",
    "--no-acl", "--file=" + dump]);
  const dumpMs = Date.now() - started;
  sql(admin, 'CREATE DATABASE "' + name + '";');
  created = true;
  const restoring = Date.now();
  run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl",
    "--jobs=1", "--dbname=" + clone.toString(), dump], 1_800_000);
  const restoreMs = Date.now() - restoring;
  const clonedRaw = Number(sql(clone, "SELECT COUNT(*) FROM price_snapshots;"));
  const sourceRaw = Number(sql(source, "SELECT COUNT(*) FROM price_snapshots;"));
  assert.ok(clonedRaw > 1_000_000);
  assert.equal(sql(clone, "SELECT ready AND tiers_ready AND " +
    "source_revision = summary_revision AND source_max_id IS NOT DISTINCT FROM " +
    "(SELECT MAX(id) FROM price_snapshots) FROM price_summary_state WHERE singleton;"), "t");
  console.log(JSON.stringify({ mode: "clone-restored", clonedRaw, sourceRaw,
    dumpBytes: statSync(dump).size, dumpMs, restoreMs }));
  const oldDate = sql(clone, "SELECT (CURRENT_DATE - interval '120 days')::date::text;");
  const card = "retention-load-" + randomUUID();
  sql(clone, "UPDATE price_import_jobs SET status = 'FAILED' WHERE status = 'RUNNING';");
  sql(clone, "INSERT INTO price_snapshots " +
    "(mtgjson_uuid, provider, finish, price_type, currency, observed_date, price) " +
    "VALUES ('" + card + "', 'tcgplayer', 'normal', 'retail', 'USD', '" +
    oldDate + "', 4);");
  sql(clone, refreshPricingSummariesSql(JSON.stringify([{ mtgjson_uuid: card,
    provider: "tcgplayer", finish: "normal", price_type: "retail",
    currency: "USD" }])));
  sql(clone, "UPDATE price_summary_state SET ready = TRUE, tiers_ready = TRUE, " +
    "source_max_id = (SELECT MAX(id) FROM price_snapshots), " +
    "source_revision = source_revision + 1, " +
    "summary_revision = source_revision + 1 WHERE singleton = TRUE;");
  const passing = Date.now();
  const operationEnv = { ...process.env, PRICING_DATABASE_URL: clone.toString(),
    BACKUP_DIR: backup, PRICING_RECOVERY_COPY_DIR: recovery,
    PRICING_RAW_ARCHIVE_RETENTION_ENABLED: "1",
    PRICING_ARCHIVE_MAINTENANCE_ENABLED: "1", MTG_LOCAL_PILOT_TEST: "1" };
  const direct = process.env.PRICING_DIRECT_VERIFICATION_DRILL === "1";
  let result: Record<string, any>;
  if (direct) {
    const compactStarted = Date.now();
    assert.equal(lastJson(run(process.execPath,
      ["--import", "tsx", "scripts/pricing-daily-compact.ts", "--apply"],
      1_800_000, operationEnv)).mode, "complete");
    const compactMs = Date.now() - compactStarted;
    const stageStarted = Date.now();
    const staged = lastJson(run(process.execPath,
      ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", oldDate],
      600_000, operationEnv));
    assert.equal(staged.mode, "verified-staged");
    const stageMs = Date.now() - stageStarted;
    const activateStarted = Date.now();
    const activated = lastJson(run(process.execPath,
      ["--import", "tsx", "scripts/pricing-raw-segment-activate.ts",
        "--manifest", staged.manifestPath, "--apply"],
      3_900_000, operationEnv));
    const activateMs = Date.now() - activateStarted;
    result = { mode: "retention-activated", observedDate: activated.observedDate,
      deleted: activated.deleted, timings: { compactMs, stageMs, activateMs,
        totalMs: Date.now() - passing } };
  } else {
    result = lastJson(run(process.execPath,
      ["--import", "tsx", "scripts/pricing-raw-retention-pass.ts", "--apply"],
      5_400_000, operationEnv));
  }
  const passMs = Date.now() - passing;
  assert.equal(result.mode, "retention-activated");
  assert.equal(result.observedDate, oldDate);
  assert.equal(result.deleted, 1);
  assert.ok(result.timings.totalMs >=
    result.timings.compactMs + result.timings.stageMs + result.timings.activateMs);
  assert.equal(Number(sql(clone, "SELECT COUNT(*) FROM price_snapshots;")), clonedRaw);
  const copied = run(process.execPath,
    ["--import", "tsx", "scripts/pricing-recovery-package-audit.ts"],
    300_000, { ...process.env, PRICING_RECOVERY_COPY_DIR: recovery });
  assert.equal(JSON.parse(copied).verified, 2);
  console.log(JSON.stringify({ mode: "fullsize-retention-drill-passed",
    clonedRaw, oldDate, dumpBytes: statSync(dump).size,
    cloneBytes: Number(sql(clone, "SELECT pg_database_size(current_database());")),
    recoveryBytes: bytes(recovery), dumpMs, restoreMs, passMs,
    phases: result.timings, direct, separateClone,
    liveDatabaseReplaced: false, retentionEnabled: false }));
} finally {
  if (created) sql(admin, 'DROP DATABASE "' + name + '" WITH (FORCE);');
  const target = resolve(work);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep));
  rmSync(target, { recursive: true, force: true });
}
