import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  pricingSummarySchemaSql,
  pricingTierBackfillSql,
  refreshPricingSummariesSql,
} from "./pricing-summary-sql";
import { archivedFeedFingerprint, splitArchivedFeed,
  writeArchivedFeedFile } from "./pricing-archived-feed";
import { pricingSnapshotUpsertSql } from "./pricing-snapshot-upsert-sql";

assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1", "Local/CI database opt-in required");
const configured = process.env.PRICING_DATABASE_URL;
assert.ok(configured, "PRICING_DATABASE_URL is required");
const source = new URL(configured);
assert.ok(
  ["pricing-postgres", "localhost", "127.0.0.1"].includes(source.hostname),
  "Archive refresh verification requires a local/CI PostgreSQL host",
);
source.searchParams.delete("schema");
const admin = new URL(source);
admin.pathname = "/postgres";
const name = `pricing_archive_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const testDatabase = new URL(source);
testDatabase.pathname = `/${name}`;

function sql(database: URL, statement: string, expectFailure = false) {
  const result = spawnSync(
    "psql",
    [database.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
    { input: statement, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (expectFailure) {
    assert.notEqual(result.status, 0, "Expected archive overlap or backfill rejection");
    return "";
  }
  if (result.status !== 0)
    throw new Error(`Archive refresh SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const card = `archive-fixture-${randomUUID()}`;
const sparse = `archive-sparse-${randomUUID()}`;
const keys = [card, sparse].map((mtgjson_uuid) => ({
  mtgjson_uuid,
  provider: "tcgplayer",
  finish: "normal",
  price_type: "retail",
  currency: "USD",
}));
const refresh = refreshPricingSummariesSql(JSON.stringify(keys));
let created = false;
const archiveTestDirectory = mkdtempSync(join(tmpdir(), "pricing-archive-verify-"));
try {
  sql(admin, `CREATE DATABASE "${name}";`);
  created = true;
  sql(testDatabase, `CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY, scryfall_id TEXT,
    mtgjson_uuid TEXT NOT NULL, provider TEXT NOT NULL, finish TEXT NOT NULL,
    price_type TEXT NOT NULL, currency TEXT NOT NULL, observed_date DATE NOT NULL,
    price NUMERIC(12, 4) NOT NULL, raw_json JSONB, card_name TEXT, set_code TEXT,
    collector_number TEXT, revision_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX price_snapshots_identity_key ON price_snapshots (
    (COALESCE(mtgjson_uuid, '')), (COALESCE(scryfall_id, '')),
    provider, finish, price_type, currency, observed_date);`);
  sql(testDatabase, pricingSummarySchemaSql);
  sql(testDatabase, `INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-10', 7),
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-11', 9),
    ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-08-01', 8),
    ('${sparse}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-01-05', 4);`);
  sql(testDatabase, refresh);
  sql(testDatabase, `UPDATE price_summary_state SET ready = TRUE, tiers_ready = TRUE,
    source_max_id = (SELECT MAX(id) FROM price_snapshots),
    summary_revision = source_revision WHERE singleton = TRUE;`);

  const staged = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", "2026-01-10"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (staged.status !== 0)
    throw new Error(`Raw segment staging failed: ${staged.stderr.trim()}`);
  const stagedResult = JSON.parse(staged.stdout.trim());
  assert.equal(stagedResult.mode, "verified-staged");
  assert.equal(stagedResult.rows, 1);
  assert.equal(stagedResult.activated, false);
  const manifest = JSON.parse(readFileSync(stagedResult.manifestPath, "utf8"));
  assert.equal(manifest.restoreVerified, true);
  assert.equal(manifest.rows, 1);
  assert.match(manifest.sourceFingerprint, /^[a-f0-9]{32}$/);
  const oldInput = { mtgjsonUuid: card, provider: "tcgplayer", finish: "normal",
    priceType: "retail", currency: "USD", observedDate: "2026-01-10",
    price: 7, rawJson: { path: ["paper"] } };
  assert.equal(archivedFeedFingerprint([oldInput]), manifest.identityFingerprint);
  assert.equal(archivedFeedFingerprint([{ ...oldInput, price: 6 }, oldInput]),
    manifest.identityFingerprint);
  const split = splitArchivedFeed([oldInput, { ...oldInput,
    observedDate: "2026-08-01", price: 8 }], "2026-01-10",
    new Map([["2026-01-10", manifest.identityFingerprint]]));
  assert.equal(split.live.length, 1);
  assert.equal(split.changed.length, 0);
  assert.equal(splitArchivedFeed([{ ...oldInput, price: 8 }], "2026-01-10",
    new Map([["2026-01-10", manifest.identityFingerprint]])).changed.length, 1);
  const feedFile = writeArchivedFeedFile(archiveTestDirectory, "2026-01-10",
    archivedFeedFingerprint([{ ...oldInput, price: 8 }]), [{ ...oldInput, price: 8 }]);
  assert.equal(writeArchivedFeedFile(archiveTestDirectory, "2026-01-10",
    archivedFeedFingerprint([{ ...oldInput, price: 8 }]),
    [{ ...oldInput, price: 8 }]).fileSha256, feedFile.fileSha256);
  assert.equal(readdirSync(join(archiveTestDirectory, "pricing", "raw", "2026-01-10")).length, 2);
  const empty = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", "2020-01-01"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout.trim()),
    { mode: "no-candidates", observedDate: "2020-01-01", rows: 0 });
  const currentDate = sql(testDatabase, "SELECT CURRENT_DATE::text;");
  const premature = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", currentDate],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  assert.notEqual(premature.status, 0, "The live raw window must refuse staging");

  const earlyStage = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", "2026-01-05"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory }, encoding: "utf8", timeout: 120_000 });
  if (earlyStage.status !== 0)
    throw new Error(`Sparse segment staging failed: ${earlyStage.stderr.trim()}`);
  const earlyManifest = JSON.parse(earlyStage.stdout.trim()).manifestPath as string;
  const activate = (path: string, apply: boolean) => spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-activate.ts", "--manifest", path,
      ...(apply ? ["--apply"] : [])],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory, MTG_LOCAL_PILOT_TEST: "1" },
      encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
  assert.notEqual(activate(stagedResult.manifestPath, false).status, 0,
    "Activation must refuse a date that is not the oldest raw segment");
  sql(testDatabase, `DELETE FROM price_daily_summary WHERE observed_date <= '2026-01-10';
    UPDATE price_summary_state SET daily_compacted_through = '2026-01-10' WHERE singleton;`);
  const interrupted = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-activate.ts", "--manifest",
      earlyManifest, "--apply"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory, MTG_LOCAL_PILOT_TEST: "1",
        MTG_RAW_ARCHIVE_TEST_FAIL_AFTER_RESTORE: "1" },
      encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /Injected interruption/);
  assert.equal(sql(testDatabase,
    `SELECT COUNT(*) FROM price_snapshots WHERE observed_date = '2026-01-05'`), "1");
  assert.equal(sql(testDatabase,
    `SELECT raw_archived_through IS NULL FROM price_summary_state WHERE singleton`), "t");
  for (const path of [earlyManifest]) {
    const preview = activate(path, false);
    if (preview.status !== 0) throw new Error(`Archive dry run failed: ${preview.stderr.trim()}`);
    const applied = activate(path, true);
    if (applied.status !== 0) throw new Error(`Archive activation failed: ${applied.stderr.trim()}`);
    assert.equal(JSON.parse(applied.stdout.trim().split(/\r?\n/).at(-1)!).mode, "activated");
  }
  const restaged = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/pricing-raw-segment-stage.ts", "--date", "2026-01-10"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString(),
        BACKUP_DIR: archiveTestDirectory }, encoding: "utf8", timeout: 120_000 });
  if (restaged.status !== 0)
    throw new Error(`Post-boundary segment staging failed: ${restaged.stderr.trim()}`);
  const nextManifest = JSON.parse(restaged.stdout.trim()).manifestPath as string;
  const nextPreview = activate(nextManifest, false);
  if (nextPreview.status !== 0)
    throw new Error(`Next archive dry run failed: ${nextPreview.stderr.trim()}`);
  const nextApplied = activate(nextManifest, true);
  if (nextApplied.status !== 0)
    throw new Error(`Next archive activation failed: ${nextApplied.stderr.trim()}`);
  assert.equal(sql(testDatabase,
    `SELECT raw_archived_through FROM price_summary_state WHERE singleton`), "2026-01-10");
  assert.equal(sql(testDatabase, `SELECT COUNT(*) FROM price_raw_archive_segment`), "2");
  sql(testDatabase, pricingSnapshotUpsertSql([oldInput]), true);
  assert.equal(sql(testDatabase, pricingSnapshotUpsertSql([oldInput], "2026-01-10")),
    "0|0|0");
  assert.equal(sql(testDatabase,
    `SELECT COUNT(*) FROM price_snapshots WHERE observed_date <= '2026-01-10'`), "0");
  sql(testDatabase, refresh);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' || prior_price
      FROM price_scope_summary WHERE mtgjson_uuid = '${card}'`),
    "3:8.0000:9.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' ||
      COALESCE(prior_price::text, 'none') FROM price_scope_summary
      WHERE mtgjson_uuid = '${sparse}'`),
    "1:4.0000:none",
  );
  for (const [table, periodStart, expected] of [
    ["price_monthly_summary", "2026-01-01", "7.0000:9.0000:7.0000:9.0000:2"],
    ["price_weekly_summary", "2026-01-05", "7.0000:9.0000:7.0000:9.0000:2"],
    ["price_yearly_summary", "2026-01-01", "7.0000:8.0000:7.0000:9.0000:3"],
  ]) {
    assert.equal(
      sql(testDatabase, `SELECT open_price || ':' || close_price || ':' ||
        low_price || ':' || high_price || ':' || observation_count
        FROM ${table} WHERE mtgjson_uuid = '${card}' AND
        ${table === "price_monthly_summary" ? "month_start" : table === "price_weekly_summary" ? "week_start" : "year_start"} = '${periodStart}'`),
      expected,
    );
  }
  assert.equal(
    sql(testDatabase, `SELECT COUNT(*) FROM price_daily_summary WHERE mtgjson_uuid = '${sparse}'`),
    "0",
  );
  sql(testDatabase, pricingTierBackfillSql, true);

  // A later ordinary import must keep the archived prefix intact.
  sql(testDatabase, `INSERT INTO price_snapshots
    (mtgjson_uuid, provider, finish, price_type, currency, observed_date, price)
    VALUES ('${card}', 'tcgplayer', 'normal', 'retail', 'USD', '2026-09-01', 11);`);
  sql(testDatabase, refresh);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price || ':' || prior_price
      FROM price_scope_summary WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000:8.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT observation_count || ':' || high_price FROM price_yearly_summary
      WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000",
  );

  // Full rebuild must enumerate an archive-only sparse scope.
  sql(testDatabase, `TRUNCATE price_daily_summary, price_scope_summary,
    price_monthly_summary, price_weekly_summary, price_yearly_summary;`);
  const rebuilt = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-summary-rebuild.ts"],
    { env: { ...process.env, PRICING_DATABASE_URL: testDatabase.toString() },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  if (rebuilt.status !== 0)
    throw new Error(`Archive-aware full rebuild failed: ${rebuilt.stderr.trim()}`);
  assert.equal(
    sql(testDatabase, `SELECT snapshot_count || ':' || current_price FROM price_scope_summary
      WHERE mtgjson_uuid = '${sparse}'`),
    "1:4.0000",
  );
  assert.equal(
    sql(testDatabase, `SELECT observation_count || ':' || high_price FROM price_yearly_summary
      WHERE mtgjson_uuid = '${card}'`),
    "4:11.0000",
  );
  console.log("Archive-aware refresh, sparse scope and full rebuild passed.");
} finally {
  if (created) sql(admin, `DROP DATABASE "${name}" WITH (FORCE);`);
  const resolvedTestDirectory = resolve(archiveTestDirectory);
  assert.ok(resolvedTestDirectory.startsWith(`${resolve(tmpdir())}${sep}`));
  rmSync(resolvedTestDirectory, { recursive: true, force: true });
}
