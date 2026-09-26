import { spawnSync } from "node:child_process";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";
import { pricingMaintenanceMinutesRemaining } from "./pricing-archive-maintenance-window";
import { verifyPricingRecoveryCopyDestination } from "./pricing-recovery-copy";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply") || args.length > 1)
  throw new Error("Use [--apply]; the default is a read-only plan");
const apply = args.includes("--apply");
if (apply && (process.env.PRICING_RAW_ARCHIVE_RETENTION_ENABLED !== "1" ||
    process.env.PRICING_ARCHIVE_MAINTENANCE_ENABLED !== "1" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1"))
  throw new Error("Raw retention requires all three explicit local pilot opt-ins");
const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Raw retention supports only local Pricing databases");
database.searchParams.delete("schema");
const liveDays = getPricingRetentionPolicy().dailyDays;

function run(name: string, args: string[], timeout: number) {
  const result = spawnSync(name, args, { encoding: "utf8", timeout,
    maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${name} failed or timed out: ${result.stderr?.trim().slice(0, 500) ?? ""}`);
  return result.stdout.trim();
}
function query(statement: string) {
  const result = spawnSync("psql", [database.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement,
    encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Pricing retention query failed: ${result.stderr?.trim().slice(0, 500) ?? ""}`);
  return result.stdout.trim();
}
function finalJson(output: string) {
  const last = output.split(/\r?\n/).at(-1);
  return JSON.parse(last ?? "{}") as Record<string, unknown>;
}

async function main() {
  const plan = JSON.parse(query(`SELECT json_build_object(
    'oldest', (SELECT MIN(observed_date)::text FROM price_snapshots),
    'cutoff', (CURRENT_DATE - ${liveDays + 1})::text,
    'dailyBoundary', daily_compacted_through::text,
    'activeImports', (SELECT COUNT(*) FROM price_import_jobs WHERE status = 'RUNNING'),
    'ready', ready AND tiers_ready AND source_revision = summary_revision AND
      source_max_id IS NOT DISTINCT FROM (SELECT MAX(id) FROM price_snapshots))::text
    FROM price_summary_state WHERE singleton = TRUE;`)) as {
      oldest: string | null; cutoff: string; dailyBoundary: string | null;
      ready: boolean; activeImports: number;
    };
  const candidate = plan.oldest && plan.oldest <= plan.cutoff ? plan.oldest : null;
  if (!apply || !candidate) {
    console.log(JSON.stringify({ mode: "retention-plan", liveDays, ...plan,
      candidate, applyRequested: apply }));
    return;
  }
  if (!plan.ready)
    throw new Error("Pricing summaries must be fresh before automatic retention");
  if (plan.activeImports !== 0)
    throw new Error("Pricing imports are still running; retry retention after they finish");
  if (pricingMaintenanceMinutesRemaining(new Date()) < 85)
    throw new Error("Insufficient Central maintenance window for raw retention");
  const recoveryTarget = process.env.PRICING_RECOVERY_COPY_DIR;
  if (!recoveryTarget)
    throw new Error("PRICING_RECOVERY_COPY_DIR is required for raw retention");
  await verifyPricingRecoveryCopyDestination(process.env.BACKUP_DIR || "/app/backups",
    recoveryTarget);
  if (!plan.dailyBoundary || plan.dailyBoundary < candidate) {
    const compact = finalJson(run(process.execPath,
      ["--import", "tsx", "scripts/pricing-daily-compact.ts", "--apply"],
      25 * 60_000));
    if (compact.mode !== "complete")
      throw new Error("Daily compaction did not advance before raw retention");
  }
  if (pricingMaintenanceMinutesRemaining(new Date()) < 60)
    throw new Error("Insufficient Central maintenance window to start raw activation");
  const staged = finalJson(run(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", candidate],
    6 * 60_000));
  if (staged.mode !== "verified-staged" || typeof staged.manifestPath !== "string")
    throw new Error("Raw segment staging did not produce a verified manifest");
  if (pricingMaintenanceMinutesRemaining(new Date()) < 55)
    throw new Error("Verified stage retained for review; insufficient window to activate");
  const activated = finalJson(run(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-activate.ts",
      "--manifest", staged.manifestPath, "--apply"], 65 * 60_000));
  if (activated.mode !== "activated" || activated.observedDate !== candidate)
    throw new Error("Raw activation did not confirm the selected date");
  console.log(JSON.stringify({ mode: "retention-activated", observedDate: candidate,
    deleted: activated.deleted, receipt: activated.receipt }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
