import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pricingSummarySchemaSql } from "./pricing-summary-sql";
import { pricingSnapshotUpsertSql } from "./pricing-snapshot-upsert-sql";

assert.equal(
  process.env.MTG_LOCAL_PILOT_TEST,
  "1",
  "Local/CI database opt-in required",
);
assert.ok(process.env.PRICING_DATABASE_URL, "Test pricing connection required");
let source: URL;
try {
  source = new URL(process.env.PRICING_DATABASE_URL);
} catch {
  throw new Error("Invalid test pricing connection");
}
assert.ok(
  ["postgresql:", "postgres:"].includes(source.protocol),
  "PostgreSQL test connection required",
);
for (const key of source.searchParams.keys())
  assert.ok(
    !["host", "hostaddr", "port", "dbname", "service", "servicefile"].includes(
      key.toLowerCase(),
    ),
    "Test connection query must not override the local endpoint",
  );
// libpq may otherwise combine an explicit URI host with inherited PGHOSTADDR.
const databaseEnvironment = { ...process.env };
for (const key of [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
])
  delete databaseEnvironment[key];
assert.ok(
  ["localhost", "127.0.0.1", "pricing-postgres"].includes(source.hostname),
  "Interrupted import verification requires a local/CI PostgreSQL host",
);
source.searchParams.delete("schema");
const admin = new URL(source);
admin.pathname = "/postgres";
const name =
  "pricing_interrupted_verify_" + randomUUID().replaceAll("-", "").slice(0, 16);
const database = new URL(source);
database.pathname = "/" + name;

function sql(connection: URL, statement: string) {
  const result = spawnSync(
    "psql",
    [connection.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"],
    {
      env: databaseEnvironment,
      input:
        "SET statement_timeout='10s'; SET lock_timeout='2s'; SET timezone='UTC';\n" +
        statement,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  // Connection diagnostics may contain credentials. Retain only the failing phase.
  if (result.status !== 0)
    throw new Error("Interrupted import fixture SQL failed or timed out");
  return result.stdout.trim();
}
const query = (statement: string) => sql(database, statement);
const json = (statement: string) => JSON.parse(query(statement));
function rebuild(expectFailure = false) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/pricing-summary-rebuild.ts"],
    {
      env: {
        ...databaseEnvironment,
        PRICING_DATABASE_URL: database.toString(),
      },
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (expectFailure) {
    assert.notEqual(
      result.status,
      0,
      "Injected summary write rejection must fail the real rebuild CLI",
    );
    assert.match(
      result.stderr,
      /Pricing summary rebuild query failed or timed out/,
    );
  } else
    assert.equal(result.status, 0, "Real summary rebuild CLI must succeed");
}
function conserved() {
  return json(
    "SELECT json_build_object(" +
      [
        "price_snapshots",
        "price_import_jobs",
        "price_worker_runs",
        "price_worker_logs",
      ]
        .map(
          (table) =>
            "'" +
            table +
            "',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM " +
            table +
            " t)",
        )
        .join(",") +
      ")",
  );
}
function freshness() {
  return json(
    "SELECT json_build_object('ready',ready,'tiersReady',tiers_ready,'fresh',ready AND tiers_ready AND source_max_id IS NOT DISTINCT FROM (SELECT MAX(id) FROM price_snapshots) AND source_revision=summary_revision,'sourceMaxId',source_max_id,'rawMaxId',(SELECT MAX(id) FROM price_snapshots),'sourceRevision',source_revision,'summaryRevision',summary_revision) FROM price_summary_state WHERE singleton",
  );
}
const cards = Array.from(
  { length: 51 },
  (_, i) => "interrupted-fixture-" + String(i).padStart(2, "0"),
);
const observation = (
  mtgjsonUuid: string,
  observedDate: string,
  price: number,
) => ({
  mtgjsonUuid,
  provider: "tcgplayer",
  finish: "normal",
  priceType: "retail",
  currency: "USD",
  observedDate,
  price,
  rawJson: { fixture: "interrupted-prefix" },
});
const baseline = cards.flatMap((card, i) => [
  observation(card, "2025-12-31", i + 8),
  observation(card, "2026-01-10", i + 10),
  observation(card, "2026-02-11", i + 14),
]);
const prefix = cards
  .slice(0, 50)
  .map((card, i) => observation(card, "2026-03-12", i + 9));
// These planned rows never committed. Rebuilding must not invent them or finish the job.
const uncommitted = [
  observation(cards[50], "2026-03-12", 59),
  observation(cards[0], "2026-03-13", 2000),
];
const correction = observation(cards[0], "2026-01-10", 1010);
let created = false;
let failure: unknown;
try {
  sql(admin, 'CREATE DATABASE "' + name + '";');
  created = true;
  query(
    "CREATE TABLE price_snapshots (id BIGSERIAL PRIMARY KEY, scryfall_id TEXT, mtgjson_uuid TEXT NOT NULL, provider TEXT NOT NULL, finish TEXT NOT NULL, price_type TEXT NOT NULL, currency TEXT NOT NULL, observed_date DATE NOT NULL, price NUMERIC(12,4) NOT NULL, raw_json JSONB, card_name TEXT, set_code TEXT, collector_number TEXT, revision_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE UNIQUE INDEX price_snapshots_identity_key ON price_snapshots ((COALESCE(mtgjson_uuid,'')),(COALESCE(scryfall_id,'')),provider,finish,price_type,currency,observed_date);",
  );
  query(pricingSummarySchemaSql);
  query(
    "CREATE TABLE price_import_jobs(id TEXT PRIMARY KEY,type TEXT,status TEXT,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,processed_count INTEGER,inserted_count INTEGER,corrected_count INTEGER,skipped_count INTEGER,error TEXT); CREATE TABLE price_worker_runs(id TEXT PRIMARY KEY,status TEXT,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ); CREATE TABLE price_worker_logs(id BIGSERIAL PRIMARY KEY,run_id TEXT,message TEXT,metadata_json JSONB); INSERT INTO price_import_jobs VALUES ('old-running','MTGJSON_REFRESH_ALL','RUNNING','2026-09-25',NULL,0,0,0,0,NULL),('other-running','MTGJSON_REFRESH_ALL','RUNNING','2026-10-02',NULL,0,0,0,0,NULL),('prefix-running','MTGJSON_REFRESH_ALL','RUNNING','2026-10-19',NULL,0,0,0,0,NULL),('completed','MTGJSON_REFRESH_ALL','SUCCEEDED','2026-10-17','2026-10-17',153,153,0,0,NULL),('failed','MTGJSON_REFRESH_ALL','FAILED','2026-10-16','2026-10-16',0,0,0,0,'fixture prior failure'); INSERT INTO price_worker_runs SELECT id,status,started_at,finished_at FROM price_import_jobs; INSERT INTO price_worker_logs(run_id,message,metadata_json) VALUES ('prefix-running','Fetching MTGJSON prices.',jsonb_build_object('jobId','prefix-running'));",
  );
  query(pricingSnapshotUpsertSql(baseline));
  const seededHistory = conserved();
  rebuild();
  assert.deepEqual(
    conserved(),
    seededHistory,
    "Initial rebuild must also conserve all seeded source and history",
  );
  assert.equal(freshness().fresh, true);
  const initialMax = freshness().rawMaxId;
  query(pricingSnapshotUpsertSql([correction]));
  assert.equal(
    freshness().rawMaxId,
    initialMax,
    "An existing-ID correction must not increase raw maximum ID",
  );
  assert.equal(
    freshness().fresh,
    false,
    "Revision mismatch alone must invalidate freshness",
  );
  assert.equal(freshness().sourceRevision, 1);
  query(pricingSnapshotUpsertSql(prefix));
  assert.equal(
    freshness().ready,
    true,
    "Stored ready is not evidence of fresh source coverage",
  );
  assert.equal(
    freshness().fresh,
    false,
    "Committed prefix must leave summaries behind",
  );
  assert.equal(query("SELECT count(*) FROM price_daily_summary"), "153");
  assert.equal(query("SELECT count(*) FROM price_snapshots"), "203");
  const preserved = conserved();

  // Both a fully absent UUID and an unsupported scope on an active UUID can
  // survive a partial cleanup. A full rebuild must remove these current views
  // without deleting raw observations, archive basis or historical jobs.
  for (const [uuid, provider] of [
    ["unbacked-fixture", "tcgplayer"],
    [cards[0], "unbacked-provider"],
  ]) {
    for (const table of [
      "price_daily_summary",
      "price_scope_summary",
      "price_weekly_summary",
      "price_monthly_summary",
      "price_yearly_summary",
    ]) {
      query(
        "INSERT INTO " +
          table +
          " SELECT (jsonb_populate_record(NULL::" +
          table +
          ",to_jsonb(t)||jsonb_build_object('mtgjson_uuid','" +
          uuid +
          "','provider','" +
          provider +
          "'))).* FROM " +
          table +
          " t WHERE mtgjson_uuid='" +
          cards[0] +
          "' AND provider='tcgplayer'",
      );
    }
  }
  assert.deepEqual(
    conserved(),
    preserved,
    "Unbacked-view fixture must not change source or history",
  );

  query(
    "CREATE FUNCTION reject_fixture_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture summary refresh interrupted'; END $$; CREATE TRIGGER reject_fixture_summary BEFORE INSERT ON price_daily_summary FOR EACH ROW EXECUTE FUNCTION reject_fixture_summary();",
  );
  rebuild(true);
  assert.equal(
    freshness().ready,
    false,
    "Failed rebuild must leave readiness false",
  );
  assert.equal(freshness().fresh, false);
  assert.deepEqual(
    conserved(),
    preserved,
    "Failed rebuild must conserve all source and job history",
  );
  query(
    "DROP TRIGGER reject_fixture_summary ON price_daily_summary; DROP FUNCTION reject_fixture_summary();",
  );
  rebuild();
  assert.equal(freshness().fresh, true);
  assert.deepEqual(
    conserved(),
    preserved,
    "Recovery must conserve source IDs, prices, revisions, ingest times, raw JSON and all job/run/log rows",
  );

  const expectedInputs = [
    ...baseline.map((row) =>
      row.mtgjsonUuid === correction.mtgjsonUuid &&
      row.observedDate === correction.observedDate
        ? correction
        : row,
    ),
    ...prefix,
  ];
  const raw = json(
    "SELECT json_agg(json_build_object('card',mtgjson_uuid,'date',observed_date,'price',price,'id',id,'revision',revision_count) ORDER BY mtgjson_uuid,observed_date) FROM price_snapshots",
  ) as Array<{
    card: string;
    date: string;
    price: number;
    id: number;
    revision: number;
  }>;
  const sorted = <T>(rows: T[]) =>
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(
    sorted(raw.map((r) => ({ card: r.card, date: r.date, price: r.price }))),
    sorted(
      expectedInputs.map((r) => ({
        card: r.mtgjsonUuid,
        date: r.observedDate,
        price: r.price,
      })),
    ),
  );
  for (const row of uncommitted)
    assert(
      !raw.some(
        (r) => r.card === row.mtgjsonUuid && r.date === row.observedDate,
      ),
      "No planned-but-uncommitted observation may appear",
    );
  const daily = json(
    "SELECT json_agg(json_build_object('card',mtgjson_uuid,'date',observed_date,'price',price,'id',source_snapshot_id,'revision',source_revision_count) ORDER BY mtgjson_uuid,observed_date) FROM price_daily_summary",
  );
  assert.deepEqual(
    daily,
    raw,
    "All 203 daily observations must bind to exact source IDs/revisions",
  );
  const scope = json(
    "SELECT json_agg(json_build_object('card',mtgjson_uuid,'count',snapshot_count,'date',latest_observed_date,'price',current_price,'id',current_snapshot_id,'priorDate',prior_observed_date,'priorPrice',prior_price,'priorId',prior_snapshot_id) ORDER BY mtgjson_uuid) FROM price_scope_summary",
  );
  const expectedScope = cards.map((card) => {
    const rows = raw
      .filter((r) => r.card === card)
      .sort((a, b) => a.date.localeCompare(b.date));
    const current = rows.at(-1)!,
      prior = rows.at(-2)!;
    return {
      card,
      count: rows.length,
      date: current.date,
      price: current.price,
      id: current.id,
      priorDate: prior.date,
      priorPrice: prior.price,
      priorId: prior.id,
    };
  });
  assert.deepEqual(scope, expectedScope);

  const tierCounts: Record<string, number> = {};
  for (const [tier, column] of [
    ["monthly", "month_start"],
    ["weekly", "week_start"],
    ["yearly", "year_start"],
  ]) {
    const bucket = (date: string) => {
      const d = new Date(date + "T00:00:00Z");
      if (tier === "yearly") return date.slice(0, 4) + "-01-01";
      if (tier === "monthly") return date.slice(0, 7) + "-01";
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    const groups = new Map<string, typeof raw>();
    for (const row of raw) {
      const key = row.card + "/" + bucket(row.date);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    const expected = [...groups.values()].map((rows) => {
      rows.sort((a, b) => a.date.localeCompare(b.date));
      const first = rows[0],
        last = rows.at(-1)!,
        low = [...rows].sort(
          (a, b) => a.price - b.price || a.date.localeCompare(b.date),
        )[0],
        high = [...rows].sort(
          (a, b) => b.price - a.price || a.date.localeCompare(b.date),
        )[0];
      return {
        card: first.card,
        bucket: bucket(first.date),
        openDate: first.date,
        openPrice: first.price,
        closeDate: last.date,
        closePrice: last.price,
        lowDate: low.date,
        lowPrice: low.price,
        highDate: high.date,
        highPrice: high.price,
        count: rows.length,
      };
    });
    const actual = json(
      "SELECT json_agg(json_build_object('card',mtgjson_uuid,'bucket'," +
        column +
        ",'openDate',open_date,'openPrice',open_price,'closeDate',close_date,'closePrice',close_price,'lowDate',low_date,'lowPrice',low_price,'highDate',high_date,'highPrice',high_price,'count',observation_count)) FROM price_" +
        tier +
        "_summary",
    );
    assert.deepEqual(
      sorted(actual),
      sorted(expected),
      tier + " recovery must preserve every observation's OHLC/count effect",
    );
    tierCounts[tier] = actual.length;
  }
  const projection = () =>
    json(
      "SELECT json_build_object(" +
        ["daily", "scope", "weekly", "monthly", "yearly"]
          .map(
            (t) =>
              "'" +
              t +
              "',(SELECT md5(coalesce(string_agg((to_jsonb(r)-'refreshed_at')::text,'' ORDER BY (to_jsonb(r)-'refreshed_at')::text),'')) FROM price_" +
              t +
              "_summary r)",
          )
          .join(",") +
        ")",
    );
  const firstProjection = projection();
  rebuild();
  assert.deepEqual(
    projection(),
    firstProjection,
    "A second recovery must not change semantic projection content",
  );
  assert.deepEqual(conserved(), preserved);
  assert.equal(freshness().fresh, true);
  assert.equal(
    query(
      "SELECT count(*) FROM price_import_jobs WHERE status='RUNNING' AND finished_at IS NULL AND processed_count=0",
    ),
    "3",
    "Source recovery cannot claim the interrupted imports completed",
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      printings: 51,
      baselineRows: 153,
      committedRows: 203,
      uncommittedRows: 2,
      existingIdCorrections: 1,
      unbackedUuidsRemoved: 1,
      unbackedScopesOnActiveUuidsRemoved: 1,
      daily: 203,
      summarizedScopes: 51,
      tiers: tierCounts,
      failedRebuildLeavesNotReady: true,
      repeatedRecoveryIdempotent: true,
      sourceAndAllJobHistoryConserved: true,
      interruptedJobsStillRunning: 3,
      evidenceScope:
        "seeded committed-prefix fixture; no actual ENOMEM, process crash, concurrent writer or shared-database recovery",
    }),
  );
} catch (error) {
  failure = error;
} finally {
  if (created)
    try {
      sql(admin, 'DROP DATABASE "' + name + '" WITH (FORCE);');
    } catch (cleanup) {
      failure = new AggregateError(
        failure ? [failure, cleanup] : [cleanup],
        "Interrupted import fixture cleanup failed",
      );
    }
}
if (failure) throw failure;
