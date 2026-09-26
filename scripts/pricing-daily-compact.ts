import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";
import { pricingVerificationServer } from "./pricing-verification-server";

const configured = process.env.PRICING_DATABASE_URL;
if (!configured) throw new Error("PRICING_DATABASE_URL is required.");
const url = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Daily compaction currently supports only the local pricing database.");
url.searchParams.delete("schema");
const apply = process.argv.includes("--apply");
if (apply && process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Set MTG_LOCAL_PILOT_TEST=1 for a local compaction apply.");
if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--apply"))
  throw new Error("Only --apply is supported; without it this command is a dry run.");

function command(name: string, args: string[], timeoutMs: number) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${name} failed or timed out; no deletion was requested by this step.`);
  return result.stdout.trim();
}

function query(database: URL, sql: string, timeoutMs = 120_000) {
  const result = spawnSync(
    "psql",
    [database.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    { input: sql, encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error("Pricing compaction query failed or timed out; inspect the database before retrying.");
  return result.stdout.trim();
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

type Stats = {
  rawCount: number;
  rawSum: string;
  rawMin: string | null;
  rawMax: string | null;
  sourceMaxId: number | null;
  dailyCount: number;
  dailySum: string;
  monthlyCount: number;
  monthlyExtrema: string;
  weeklyCount: number;
  weeklyExtrema: string;
  yearlyCount: number;
  yearlyExtrema: string;
  sourceRevision: number;
  summaryRevision: number;
};

function stats(database: URL) {
  return JSON.parse(query(database, statsSql, 240_000)) as Stats;
}

function sha256(path: string) {
  return new Promise<string>((done, fail) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", fail);
    stream.on("end", () => done(hash.digest("hex")));
  });
}

async function main() {
  const policy = getPricingRetentionPolicy();
  const [state] = JSON.parse(query(url, `SELECT json_agg(row_to_json(s))::text FROM (
    SELECT ready, tiers_ready AS "tiersReady",
           daily_compacted_through::text AS "priorCutoff",
           (CURRENT_DATE - ${policy.dailyDays + 1})::text AS cutoff,
           source_max_id AS "sourceMaxId", source_revision AS "sourceRevision",
           summary_revision AS "summaryRevision"
    FROM price_summary_state WHERE singleton = TRUE
  ) s;`)) as Array<{
    ready: boolean;
    tiersReady: boolean;
    priorCutoff: string | null;
    cutoff: string;
    sourceMaxId: number | null;
    sourceRevision: number;
    summaryRevision: number;
  }>;
  if (!state?.ready || !state.tiersReady || state.sourceRevision !== state.summaryRevision)
    throw new Error("Current and tiered Pricing summaries are required before daily compaction.");
  if (state.priorCutoff && state.cutoff <= state.priorCutoff)
    throw new Error("The configured daily window would not advance the existing compaction boundary.");
  const before = stats(url);
  if (state.sourceMaxId !== before.sourceMaxId)
    throw new Error("Pricing summaries are behind the raw source; retry after refresh.");
  const candidates = Number(query(url,
    `SELECT COUNT(*) FROM price_daily_summary WHERE observed_date <= '${state.cutoff}'::date;`,
    240_000,
  ));
  if (candidates > 0 && query(url, `SELECT EXISTS (
    SELECT 1 FROM price_daily_summary d
    LEFT JOIN price_snapshots s ON s.id = d.source_snapshot_id
    WHERE d.observed_date <= '${state.cutoff}'::date
      AND (s.id IS NULL OR s.mtgjson_uuid <> d.mtgjson_uuid
        OR s.provider <> d.provider OR s.finish <> d.finish
        OR s.price_type <> d.price_type OR s.currency <> d.currency
        OR s.observed_date <> d.observed_date OR s.price <> d.price
        OR s.revision_count <> d.source_revision_count)
    LIMIT 1
  );`, 240_000) !== "f")
    throw new Error("An eligible daily point differs from its raw snapshot; rebuild summaries before compaction.");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", cutoff: state.cutoff,
    priorCutoff: state.priorCutoff, dailyCandidates: candidates,
    rawCount: before.rawCount, dailyCount: before.dailyCount }));
  if (!apply || candidates === 0) process.exit(0);

  const backupRoot = process.env.BACKUP_DIR;
  if (!backupRoot) throw new Error("BACKUP_DIR is required for an archived apply.");
  const directory = resolve(backupRoot, "pricing");
  mkdirSync(directory, { recursive: true });
  const id = `daily-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const archive = resolve(directory, `${id}.dump`);
  const manifestPath = resolve(directory, `${id}.json`);
  const receiptPath = resolve(directory, `${id}.applied.json`);
  const admin = pricingVerificationServer(url);
  admin.pathname = "/postgres";
  const verifyName = `mtg_pricing_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const verify = new URL(admin);
  verify.pathname = `/${verifyName}`;
  let created = false;
  try {
    command("pg_dump", [url.toString(), "--format=custom", "--no-owner", "--no-acl", `--file=${archive}`], 900_000);
    const archiveHash = await sha256(archive);
    query(admin, `CREATE DATABASE "${verifyName}";`);
    created = true;
    command("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--jobs=2",
      `--dbname=${verify.toString()}`, archive], 900_000);
    const restored = stats(verify);
    if (JSON.stringify(restored) !== JSON.stringify(before))
      throw new Error("Isolated archive restore does not match the live Pricing snapshot.");
    const stillLive = stats(url);
    if (JSON.stringify(stillLive) !== JSON.stringify(before))
      throw new Error("Pricing source changed during archive verification; retry with a fresh archive.");
    const manifest = {
      status: "verified_before_delete", createdAt: new Date().toISOString(), cutoff: state.cutoff,
      previousCutoff: state.priorCutoff, dailyCandidates: candidates,
      archive, sha256: archiveHash, before, restored,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    const deleted = Number(query(url, `BEGIN;
    LOCK TABLE price_snapshots IN SHARE MODE;
    LOCK TABLE price_daily_summary IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE price_summary_state IN SHARE ROW EXCLUSIVE MODE;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM price_summary_state WHERE singleton = TRUE
          AND ready AND tiers_ready AND source_revision = summary_revision
          AND source_max_id IS NOT DISTINCT FROM ${before.sourceMaxId ?? "NULL"}
          AND daily_compacted_through IS NOT DISTINCT FROM ${state.priorCutoff ? `'${state.priorCutoff}'::date` : "NULL"})
          OR (SELECT COUNT(*) FROM price_snapshots) <> ${before.rawCount}
          OR (SELECT COALESCE(SUM(price), 0) FROM price_snapshots) <> ${before.rawSum}
          OR (SELECT COUNT(*) FROM price_daily_summary) <> ${before.dailyCount}
          OR (SELECT COALESCE(SUM(price), 0) FROM price_daily_summary) <> ${before.dailySum}
          OR (SELECT COUNT(*) FROM price_daily_summary WHERE observed_date <= '${state.cutoff}'::date) <> ${candidates}
        THEN RAISE EXCEPTION 'Pricing source changed since verified archive'; END IF;
      END $$;
      WITH removed AS (DELETE FROM price_daily_summary
        WHERE observed_date <= '${state.cutoff}'::date RETURNING 1)
      SELECT COUNT(*) FROM removed;
      UPDATE price_summary_state SET daily_compacted_through = '${state.cutoff}'::date
        WHERE singleton = TRUE;
      COMMIT;`, 900_000).split(/\r?\n/).find((line) => /^\d+$/.test(line)) ?? "NaN");
    if (deleted !== candidates)
      throw new Error("Daily compaction count differed from the verified archive; inspect the database.");
    writeFileSync(receiptPath, `${JSON.stringify({
      status: "applied", appliedAt: new Date().toISOString(),
      cutoff: state.cutoff, deleted, archive, manifestPath, sha256: archiveHash,
    }, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ mode: "complete", cutoff: state.cutoff,
      deleted, archive, manifestPath, receiptPath, sha256: archiveHash }));
  } finally {
    if (created) query(admin, `DROP DATABASE "${verifyName}" WITH (FORCE);`, 120_000);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
