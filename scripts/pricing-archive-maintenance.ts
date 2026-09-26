import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pricingMaintenanceMinutesRemaining } from "./pricing-archive-maintenance-window";
import { pruneStalePricingRecoveryPartials,
  verifyPricingRecoveryCopyDestination } from "./pricing-recovery-copy";

const url = process.env.PRICING_DATABASE_URL;
if (!url) throw new Error("PRICING_DATABASE_URL is required");
const database = new URL(url);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Archived Pricing maintenance supports only local databases");
database.searchParams.delete("schema");
const once = process.argv.includes("--once");
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some((arg) => arg !== "--once" && arg !== "--apply"))
  throw new Error("Use [--once] [--apply]");
if (apply && (process.env.PRICING_ARCHIVE_MAINTENANCE_ENABLED !== "1" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1"))
  throw new Error("Local archived maintenance requires both explicit opt-ins");
const owner = randomUUID();
let partialCleanupCompleted = false;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

function sql(statement: string) {
  const result = spawnSync("psql", [database.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement, encoding: "utf8",
    timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Pricing maintenance SQL failed: ${result.stderr.trim().slice(0, 500)}`);
  return result.stdout.trim();
}

function acquire() {
  return sql(`INSERT INTO price_archive_maintenance_lease
    (singleton, owner, expires_at) VALUES (TRUE, ${literal(owner)}, now() + interval '90 seconds')
    ON CONFLICT (singleton) DO UPDATE SET owner = EXCLUDED.owner,
      expires_at = EXCLUDED.expires_at
    WHERE price_archive_maintenance_lease.expires_at < now()
    RETURNING owner;`) === owner;
}
function heartbeat() {
  return sql(`UPDATE price_archive_maintenance_lease
    SET expires_at = now() + interval '90 seconds'
    WHERE singleton AND owner = ${literal(owner)} AND expires_at > now()
    RETURNING owner;`) === owner;
}
function release() {
  sql(`DELETE FROM price_archive_maintenance_lease
    WHERE singleton AND owner = ${literal(owner)};`);
}

type Backlog = { total: number; oldest: string | null; failed: number;
  sourceAnomalies: number };
function backlog(): Backlog {
  return JSON.parse(sql(`SELECT json_build_object(
    'total', COUNT(*) FILTER (WHERE status = 'PENDING'),
    'oldest', MIN(queued_at) FILTER (WHERE status = 'PENDING'),
    'failed', COUNT(*) FILTER (WHERE status = 'PENDING' AND error IS NOT NULL),
    'sourceAnomalies', COUNT(*) FILTER (WHERE status IN
      ('SOURCE_ANOMALY', 'APPLIED_WITH_MISSING')))::text
    FROM price_archive_feed_queue;`)) as Backlog;
}
function nextDate() {
  return sql(`SELECT observed_date::text FROM price_archive_feed_queue
    WHERE status = 'PENDING' AND (retry_after IS NULL OR retry_after <= now())
    GROUP BY observed_date ORDER BY MIN(queued_at), observed_date LIMIT 1;`);
}
function retry(date: string, message: string) {
  sql(`UPDATE price_archive_feed_queue SET error = ${literal(message.slice(0, 1000))},
    retry_after = now() + interval '15 minutes'
    WHERE observed_date = ${literal(date)}::date AND status = 'PENDING';`);
}
function runCorrection(date: string) {
  return new Promise<{ code: number | null; output: string; error: string }>((resolve) => {
    const child = spawn(process.execPath,
      ["--import", "tsx", "scripts/pricing-archived-correction-apply.ts",
        "--date", date, "--apply"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", lost = false, renewing = false;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      try {
        if (!heartbeat()) { lost = true; child.kill("SIGTERM"); }
      } catch (reason) {
        lost = true;
        error += ` Lease heartbeat failed: ${String(reason)}`;
        child.kill("SIGTERM");
      } finally { renewing = false; }
    }, 20_000);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
    child.stdout.on("data", (piece: Buffer) => { output += piece.toString(); });
    child.stderr.on("data", (piece: Buffer) => { error += piece.toString(); });
    child.on("error", (reason) => { error += String(reason); });
    child.on("close", (code) => {
      clearInterval(timer); clearTimeout(timeout);
      resolve({ code: lost ? -1 : code, output, error });
    });
  });
}

async function tick() {
  const current = backlog();
  console.info("[pricing-archive-maintenance] backlog", current);
  // A child can run for 20 minutes. Do not begin one that can cross 05:00.
  if (!apply || pricingMaintenanceMinutesRemaining(new Date()) <= 20) return;
  if (!acquire()) {
    console.info("[pricing-archive-maintenance] another owner holds the lease");
    return;
  }
  try {
    if (!partialCleanupCompleted) {
      const cleanup = await pruneStalePricingRecoveryPartials(
        process.env.PRICING_RECOVERY_COPY_DIR!, Date.now(), true);
      console.info("[pricing-archive-maintenance] recovery partial cleanup", cleanup);
      partialCleanupCompleted = true;
      if (!heartbeat()) {
        console.error("[pricing-archive-maintenance] lease lost during recovery cleanup");
        return;
      }
    }
    const date = nextDate();
    if (!date) return;
    sql(`UPDATE price_archive_feed_queue SET attempt_count = attempt_count + 1,
      last_attempt_at = now(), retry_after = NULL
      WHERE observed_date = ${literal(date)}::date AND status = 'PENDING';`);
    const result = await runCorrection(date);
    if (!heartbeat()) {
      console.error("[pricing-archive-maintenance] lease lost after correction", { date });
      return;
    }
    const last = result.output.trim().split(/\r?\n/).at(-1);
    let finished: { mode?: string; status?: string; effects?: number; remaining?: number } = {};
    try { finished = JSON.parse(last ?? "{}"); } catch { /* Report the child output below. */ }
    if (result.code !== 0 || !["applied", "settled"].includes(finished.mode ?? "")) {
      const message = result.error.trim() ||
        (result.code === 0 ? "No changed identities; review source completeness" :
          `Correction exited ${result.code}`);
      retry(date, message);
      console.error("[pricing-archive-maintenance] retry queued", { date, message });
      return;
    }
    console.info("[pricing-archive-maintenance] feed processed", { date,
      status: finished.status, effects: finished.effects,
      remaining: finished.remaining });
  } finally { release(); }
}

async function main() {
  if (apply) {
    const recoveryTarget = process.env.PRICING_RECOVERY_COPY_DIR;
    if (!recoveryTarget)
      throw new Error("PRICING_RECOVERY_COPY_DIR is required for archive maintenance");
    await verifyPricingRecoveryCopyDestination(process.env.BACKUP_DIR || "/app/backups",
      recoveryTarget);
  }
  do {
    try { await tick(); }
    catch (error) { console.error("[pricing-archive-maintenance]", error); }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  } while (true);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
