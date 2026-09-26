import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

if (process.argv.slice(2).join(" ") !== "--run" ||
    process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Use --run with MTG_LOCAL_PILOT_TEST=1 for the local restore drill");
const configured = process.env.PRICING_DATABASE_URL;
const root = process.env.BACKUP_DIR;
if (!configured || !root)
  throw new Error("PRICING_DATABASE_URL and BACKUP_DIR are required");
const database = new URL(configured);
if (!["pricing-postgres", "localhost", "127.0.0.1"].includes(database.hostname))
  throw new Error("Full restore drill supports only local Pricing databases");
database.searchParams.delete("schema");
const admin = new URL(database);
admin.pathname = "/postgres";
const name = `pricing_restore_drill_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const restored = new URL(database);
restored.pathname = `/${name}`;
const directory = resolve(root, "pricing", "drills");
const backup = resolve(directory, `${name}.dump`);
const tables = ["price_snapshots", "price_daily_summary", "price_scope_summary",
  "price_weekly_summary", "price_monthly_summary", "price_yearly_summary",
  "price_archived_daily_basis", "price_archived_scope_summary",
  "price_archived_weekly_summary", "price_archived_monthly_summary",
  "price_archived_yearly_summary", "price_raw_archive_segment",
  "price_archive_feed_queue"] as const;

function run(program: string, args: string[], timeout = 900_000) {
  const result = spawnSync(program, args, { encoding: "utf8", timeout,
    maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`${program} failed: ${result.stderr.trim().slice(0, 500)}`);
}
function query(db: URL, statement: string) {
  const result = spawnSync("psql", [db.toString(), "-v", "ON_ERROR_STOP=1",
    "-q", "-t", "-A", "-f", "-"], { input: statement, encoding: "utf8",
    timeout: 300_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Pricing restore drill query failed: ${result.stderr.trim().slice(0, 500)}`);
  return result.stdout.trim();
}
async function fileHash(path: string) {
  const digest = createHash("sha256");
  for await (const piece of createReadStream(path)) digest.update(piece);
  return digest.digest("hex");
}
function signature(db: URL) {
  const rows = tables.map((table) => {
    const price = ["price_snapshots", "price_daily_summary",
      "price_archived_daily_basis"].includes(table);
    const value = table === "price_scope_summary" ||
      table === "price_archived_scope_summary" ? "current_price" :
      ["price_weekly_summary", "price_monthly_summary", "price_yearly_summary",
        "price_archived_weekly_summary", "price_archived_monthly_summary",
        "price_archived_yearly_summary"].includes(table) ? "close_price" :
        price ? "price" : null;
    return `${table}:` + query(db, `SELECT COUNT(*)::text || ':' ||
      ${value ? `COALESCE(SUM(${value}), 0)::text` : "'n/a'"}
      FROM ${table};`);
  });
  rows.push(`state:${query(db, `SELECT to_jsonb(s)::text
    FROM price_summary_state s WHERE singleton = TRUE;`)}`);
  return rows.join("\n");
}

async function main() {
  const before = signature(database);
  mkdirSync(directory, { recursive: true });
  let created = false, verified = false;
  const started = Date.now();
  try {
    run("pg_dump", [database.toString(), "--format=custom", "--no-owner",
      "--no-acl", `--file=${backup}`]);
    const dumpMs = Date.now() - started;
    const bytes = statSync(backup).size;
    const sha256 = await fileHash(backup);
    query(admin, `CREATE DATABASE "${name}";`);
    created = true;
    const restoreStart = Date.now();
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl",
      "--jobs=2", `--dbname=${restored.toString()}`, backup]);
    const restoreMs = Date.now() - restoreStart;
    if (await fileHash(backup) !== sha256)
      throw new Error("Full Pricing dump changed during isolated restore");
    const after = signature(database);
    const recovered = signature(restored);
    if (before !== after)
      throw new Error("Live Pricing changed during drill; pause importer and retry");
    if (before !== recovered)
      throw new Error("Restored Pricing totals or state differ from live source");
    const restoredBytes = Number(query(restored,
      `SELECT pg_database_size(current_database());`));
    verified = true;
    console.log(JSON.stringify({ mode: "local-isolated-restore", verified,
      dumpBytes: bytes, dumpSha256: sha256, restoredDatabaseBytes: restoredBytes,
      dumpMs, restoreMs, tableCount: tables.length,
      independentCopyVerified: false, liveDatabaseReplaced: false }, null, 2));
  } finally {
    if (created) query(admin, `DROP DATABASE "${name}" WITH (FORCE);`);
    if (verified) unlinkSync(backup);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
