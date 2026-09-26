import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { verifyCopiedPricingRecoveryPackage } from "./pricing-recovery-copy";
import { pricingVerificationServer } from "./pricing-verification-server";

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--package" || args[2] !== "--run" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Use --package COPIED_PACKAGE --run with MTG_LOCAL_PILOT_TEST=1");
const configured = process.env.PRICING_DATABASE_URL;
const destination = process.env.PRICING_RECOVERY_COPY_DIR;
if (!configured || !destination)
  throw new Error("PRICING_DATABASE_URL and PRICING_RECOVERY_COPY_DIR are required");
const live = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(live.hostname))
  throw new Error("Daily recovery drill supports only local Pricing databases");
live.searchParams.delete("schema");
const admin = pricingVerificationServer(live);
admin.pathname = "/postgres";
const name = `mtg_pricing_daily_copy_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const restored = new URL(admin);
restored.pathname = `/${name}`;

function command(program: string, args: string[], input?: string, timeout = 900_000) {
  const result = spawnSync(program, args, { input, encoding: "utf8", timeout,
    maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Daily recovery ${program} failed or timed out`);
  return result.stdout.trim();
}
function sql(db: URL, statement: string) {
  return command("psql", [db.toString(), "-v", "ON_ERROR_STOP=1", "-q",
    "-t", "-A", "-f", "-"], statement);
}
async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const statsSql = `SELECT json_build_object(
  'rawCount', (SELECT COUNT(*) FROM price_snapshots),
  'rawSum', (SELECT COALESCE(SUM(price), 0)::text FROM price_snapshots),
  'rawMin', (SELECT MIN(observed_date)::text FROM price_snapshots),
  'rawMax', (SELECT MAX(observed_date)::text FROM price_snapshots),
  'sourceMaxId', (SELECT MAX(id) FROM price_snapshots),
  'dailyCount', (SELECT COUNT(*) FROM price_daily_summary),
  'dailySum', (SELECT COALESCE(SUM(price), 0)::text FROM price_daily_summary),
  'monthlyCount', (SELECT COUNT(*) FROM price_monthly_summary),
  'monthlyExtrema', (SELECT (COALESCE(SUM(low_price), 0) + COALESCE(SUM(high_price), 0))::text FROM price_monthly_summary),
  'weeklyCount', (SELECT COUNT(*) FROM price_weekly_summary),
  'weeklyExtrema', (SELECT (COALESCE(SUM(low_price), 0) + COALESCE(SUM(high_price), 0))::text FROM price_weekly_summary),
  'yearlyCount', (SELECT COUNT(*) FROM price_yearly_summary),
  'yearlyExtrema', (SELECT (COALESCE(SUM(low_price), 0) + COALESCE(SUM(high_price), 0))::text FROM price_yearly_summary),
  'sourceRevision', (SELECT source_revision FROM price_summary_state WHERE singleton),
  'summaryRevision', (SELECT summary_revision FROM price_summary_state WHERE singleton)
)::text;`;

async function main() {
  const { document, files } = await verifyCopiedPricingRecoveryPackage(destination!,
    resolve(args[1]));
  if (document.operation !== "daily_compaction")
    throw new Error("Copied package is not a daily compaction recovery package");
  const dump = files.find((file) => file.relativePath.endsWith(".dump"));
  const manifestFile = files.find((file) => file.relativePath.endsWith(".json"));
  if (!dump || !manifestFile)
    throw new Error("Daily recovery package lacks its dump or manifest");
  const manifest = JSON.parse(readFileSync(manifestFile.destination, "utf8"));
  if (manifest.status !== "verified_before_delete" ||
      manifest.cutoff !== document.observedDate ||
      manifest.sha256 !== dump.sha256 ||
      basename(manifest.archive) !== basename(dump.destination) ||
      JSON.stringify(manifest.before) !== JSON.stringify(manifest.restored))
    throw new Error("Daily recovery manifest disagrees with copied package");
  let created = false;
  try {
    sql(admin, `CREATE DATABASE "${name}";`);
    created = true;
    const started = Date.now();
    command("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl",
      "--jobs=2", `--dbname=${restored.toString()}`, dump.destination]);
    const stats = JSON.parse(sql(restored, statsSql));
    if (JSON.stringify(stats) !== JSON.stringify(manifest.before) ||
        await sha256(dump.destination) !== dump.sha256)
      throw new Error("Restored daily recovery dump differs from verified pre-delete state");
    console.log(JSON.stringify({ mode: "daily-recovery-copy-restore-drill",
      verified: true, cutoff: document.observedDate,
      rawRows: stats.rawCount, dailyRows: stats.dailyCount,
      restoreMs: Date.now() - started, liveDatabaseReplaced: false }));
  } finally {
    if (created) sql(admin, `DROP DATABASE "${name}" WITH (FORCE);`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
