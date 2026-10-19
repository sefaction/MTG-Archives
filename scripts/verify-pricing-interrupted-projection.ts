import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

assert.equal(
  process.env.MTG_LOCAL_PILOT_TEST,
  "1",
  "Local/CI database opt-in required",
);
assert.ok(process.env.PRICING_DATABASE_URL, "Test pricing connection required");
const source = new URL(process.env.PRICING_DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(source.protocol));
assert.ok(
  ["localhost", "127.0.0.1", "pricing-postgres"].includes(source.hostname),
  "Projection verification requires a local/CI PostgreSQL host",
);
for (const key of source.searchParams.keys())
  assert.equal(
    key,
    "schema",
    "Test connection cannot override the local endpoint",
  );
source.search = "";
const environment = { ...process.env };
for (const key of [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
])
  delete environment[key];
const token = randomUUID().replaceAll("-", "").slice(0, 16);
const admin = new URL(source);
admin.pathname = "/postgres";
const pricing = new URL(source);
pricing.pathname = "/projection_prices_" + token;
const app = new URL(source);
app.pathname = "/projection_app_" + token;
const literal = (value: unknown) =>
  "'" + String(value).replaceAll("'", "''") + "'";
function sql(connection: URL, statement: string) {
  const result = spawnSync(
    "psql",
    [connection.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"],
    {
      env: environment,
      input:
        "SET statement_timeout='10s';SET lock_timeout='2s';SET timezone='UTC';\n" +
        statement,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error("Projection fixture SQL failed or timed out");
  return result.stdout.trim();
}
const query = (statement: string) => sql(pricing, statement);
const json = (statement: string) => JSON.parse(query(statement));
const appJson = (statement: string) => JSON.parse(sql(app, statement));
const ids = Array.from(
  { length: 51 },
  (_, index) => "projection-" + String(index).padStart(3, "0"),
);
let revised = false;
function payload() {
  return {
    data: Object.fromEntries(
      ids.map((id, index) => [
        id,
        {
          paper: {
            tcgplayer: {
              retail: {
                normal: {
                  "2026-01-01": revised && index === 0 ? 1.987654 : 1.123456,
                  "2026-01-02": 2.345678,
                  ...(revised ? { "2026-01-03": 5 + index / 10 } : {}),
                },
              },
            },
          },
        },
      ]),
    ),
  };
}
let requests = 0;
const server = createServer((request, response) => {
  assert.equal(request.url, "/owned-prices");
  requests++;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload()));
});
let feedUrl = "";
async function worker(command = "scripts/pricing-worker.ts") {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        command,
        ...(command.endsWith("pricing-worker.ts") ? ["--once"] : []),
      ],
      {
        env: {
          ...environment,
          DATABASE_URL: app.toString(),
          PRICING_DATABASE_URL: pricing.toString(),
          APP_DATABASE_URL: app.toString(),
          MTGJSON_ALL_PRICES_URL: feedUrl,
          MTGJSON_ALL_IDENTIFIERS_URL: feedUrl,
          PRICING_AUTO_SCHEDULE_ENABLED: "false",
          PRICING_DAILY_REFRESH_ENABLED: "false",
          PRICING_DAILY_IDENTIFIER_MAPPING_ENABLED: "false",
          PRICING_IMPORT_BATCH_SIZE: "500",
          PRICING_IMPORT_MAX_CARDS: "0",
          MTGJSON_PRICE_CURRENCY_DEFAULT: "USD",
          BACKUP_DIR: "",
          PRICING_WORKER_ID: "projection-fixture-" + token,
          PRICING_DATABASE_READY_TIMEOUT_MS: "5000",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let diagnostic = "";
    for (const output of [child.stdout, child.stderr])
      output.on("data", (chunk) => {
        diagnostic = (diagnostic + chunk).slice(-2048);
      });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Projection fixture worker deadline"));
    }, 45_000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Projection fixture worker could not start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            "Projection fixture worker failed: " +
              diagnostic
                .replaceAll(pricing.toString(), "[owned pricing]")
                .replaceAll(app.toString(), "[owned app]"),
          ),
        );
    });
  });
}
const job = (id: string) =>
  json(
    `SELECT json_build_object('status',status,'processed',processed_count,'inserted',inserted_count,'corrected',corrected_count,'finished',finished_at IS NOT NULL) FROM price_import_jobs WHERE id=${literal(id)}`,
  );
async function enqueue(id: string) {
  query(
    `INSERT INTO price_import_jobs(id,type,status) VALUES(${literal(id)},'MTGJSON_REFRESH_ALL','QUEUED')`,
  );
  await worker();
  return job(id);
}
function fingerprint(table: string, where = "TRUE") {
  assert.ok(
    [
      "price_snapshots",
      "price_import_jobs",
      "price_worker_runs",
      "price_worker_logs",
    ].includes(table),
  );
  return query(
    `SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) FROM ${table} t WHERE ${where}`,
  );
}
function projection() {
  return appJson(
    `SELECT json_agg(json_build_object('id',id,'prices',prices,'fetched',"priceLastFetchedAt") ORDER BY id) FROM "Card"`,
  );
}
function verifyCurrent() {
  const cards = projection();
  for (const card of cards) {
    assert.deepEqual(
      card.prices.scryfall,
      { usd: "7.77" },
      "Other price sources must survive publication",
    );
    assert.equal(card.prices.sentinel, "preserve");
    if (card.id === "outside-feed") {
      assert.equal(card.fetched, "2000-01-01T00:00:00+00:00");
      assert.deepEqual(card.prices.mtgjson, { untouched: true });
      continue;
    }
    const index = ids.indexOf(card.id);
    assert.deepEqual(card.prices.mtgjson, {
      tcgplayer: {
        normal: {
          retail: {
            USD: { amount: 5 + index / 10, observedDate: "2026-01-03" },
          },
        },
      },
    });
    assert.ok(Date.parse(card.fetched) > Date.parse("2000-01-01"));
  }
}
async function main() {
  let failure: unknown;
  const created: URL[] = [];
  try {
    for (const database of [pricing, app]) {
      sql(admin, 'CREATE DATABASE "' + database.pathname.slice(1) + '"');
      created.push(database);
    }
    sql(
      app,
      `CREATE TABLE "Card"(id text PRIMARY KEY,"mtgjsonUuid" text UNIQUE,prices jsonb,"priceLastFetchedAt" timestamptz);
    INSERT INTO "Card" SELECT id,id,'{"scryfall":{"usd":"7.77"},"sentinel":"preserve","mtgjson":{"untouched":true}}'::jsonb,'2000-01-01' FROM unnest(ARRAY[${[...ids, "outside-feed"].map(literal).join(",")}]) id;`,
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    feedUrl = `http://127.0.0.1:${address.port}/owned-prices`;
    await worker(); // The real worker creates its own pricing schema, without a queued import.
    const baseline = await enqueue("baseline");
    assert.equal(baseline.status, "SUCCEEDED");
    assert.equal(baseline.inserted, 102);
    await worker("scripts/pricing-summary-rebuild.ts"); // Establish an already initialized summary boundary, as in the affected installation.
    const baselineCards = projection();
    for (const card of baselineCards.filter(
      (row: any) => row.id !== "outside-feed",
    ))
      assert.deepEqual(
        card.prices.mtgjson,
        {
          tcgplayer: {
            normal: {
              retail: { USD: { amount: 2.345678, observedDate: "2026-01-02" } },
            },
          },
        },
        "Feed precision must survive app projection despite numeric raw-column rounding",
      );
    query(
      `INSERT INTO price_import_jobs(id,type,status,started_at) SELECT 'historical-'||n,'MTGJSON_REFRESH_ALL','RUNNING','2025-01-01' FROM generate_series(1,3)n;`,
    );
    const historical = fingerprint(
      "price_import_jobs",
      "id LIKE 'historical-%'",
    );
    sql(
      app,
      `CREATE FUNCTION reject_projection_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id >= 'projection-025' AND NEW.id <= 'projection-049' AND NEW.prices->'mtgjson'->'tcgplayer'->'normal'->'retail'->'USD'->>'observedDate'='2026-01-03' THEN RAISE EXCEPTION 'owned projection batch rejection'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_projection_batch BEFORE UPDATE ON "Card" FOR EACH ROW EXECUTE FUNCTION reject_projection_batch();`,
    );
    revised = true;
    const rejected = await enqueue("projection-rejected");
    assert.equal(
      rejected.status,
      "FAILED",
      "Successful worker process/cycle must not be mistaken for a completed import",
    );
    assert.equal(rejected.finished, true);
    assert.equal(rejected.processed, 0);
    assert.equal(rejected.inserted, 0);
    assert.equal(rejected.corrected, 0);
    assert.equal(
      query(
        "SELECT source_max_id=(SELECT max(id) FROM price_snapshots) AND source_revision=summary_revision AND ready AND tiers_ready FROM price_summary_state WHERE singleton",
      ),
      "t",
      "Fresh summaries do not establish app publication",
    );
    assert.equal(query("SELECT count(*) FROM price_snapshots"), "153");
    assert.equal(
      query(
        "SELECT price::text FROM price_snapshots WHERE mtgjson_uuid='projection-000' AND observed_date='2026-01-01'",
      ),
      "1.9877",
    );
    const partial = appJson(
      `SELECT json_build_object('current',count(*) FILTER(WHERE prices->'mtgjson'->'tcgplayer'->'normal'->'retail'->'USD'->>'observedDate'='2026-01-03'),'stale',count(*) FILTER(WHERE prices->'mtgjson'->'tcgplayer'->'normal'->'retail'->'USD'->>'observedDate'='2026-01-02')) FROM "Card"`,
    );
    assert.deepEqual(
      partial,
      { current: 25, stale: 26 },
      "First 25-card publication commits, rejected second batch and untouched third batch remain stale",
    );
    const originalJobs = fingerprint("price_import_jobs"),
      raw = fingerprint("price_snapshots");
    const runIds = query(
        "SELECT string_agg(quote_literal(id),',') FROM price_worker_runs",
      ),
      logMax = Number(query("SELECT max(id) FROM price_worker_logs"));
    const priorRuns = fingerprint("price_worker_runs", `id IN (${runIds})`),
      priorLogs = fingerprint("price_worker_logs", "id<=" + logMax);
    sql(
      app,
      'DROP TRIGGER reject_projection_batch ON "Card"; DROP FUNCTION reject_projection_batch()',
    );
    const recovered = await enqueue("explicit-catchup");
    assert.equal(recovered.status, "SUCCEEDED");
    assert.equal(recovered.inserted, 0);
    assert.equal(recovered.corrected, 0);
    assert.equal(recovered.processed, 153);
    verifyCurrent();
    assert.equal(
      fingerprint("price_snapshots"),
      raw,
      "Catch-up must not rewrite persisted raw observations or corrections",
    );
    assert.equal(
      fingerprint("price_import_jobs", "id<>'explicit-catchup'"),
      originalJobs,
      "Historical and failed import rows must not be reset or relabelled",
    );
    assert.equal(
      fingerprint("price_worker_runs", `id IN (${runIds})`),
      priorRuns,
    );
    assert.equal(fingerprint("price_worker_logs", "id<=" + logMax), priorLogs);
    const semantic = projection().map(({ id, prices }: any) => ({
      id,
      prices,
    }));
    const repeated = await enqueue("repeated-catchup");
    assert.equal(repeated.status, "SUCCEEDED");
    assert.equal(repeated.inserted, 0);
    assert.equal(repeated.corrected, 0);
    verifyCurrent();
    assert.deepEqual(
      projection().map(({ id, prices }: any) => ({ id, prices })),
      semantic,
      "Repeated full feed preserves semantic app prices; fetch timestamps may advance",
    );
    assert.equal(fingerprint("price_snapshots"), raw);
    assert.equal(
      fingerprint("price_import_jobs", "id LIKE 'historical-%'"),
      historical,
    );
    assert.equal(
      query(
        "SELECT count(*) FROM price_import_jobs WHERE status='RUNNING' AND finished_at IS NULL",
      ),
      "3",
    );
    assert.equal(
      fingerprint(
        "price_import_jobs",
        "id NOT IN ('explicit-catchup','repeated-catchup')",
      ),
      originalJobs,
    );
    assert.equal(
      fingerprint("price_worker_runs", `id IN (${runIds})`),
      priorRuns,
    );
    assert.equal(fingerprint("price_worker_logs", "id<=" + logMax), priorLogs);
    assert.equal(requests, 4);
    console.log(
      JSON.stringify({
        status: "PASS",
        printings: 51,
        outsideFeedCards: 1,
        rawRows: 153,
        persistedCorrection: true,
        partiallyPublished: partial,
        replayInserted: 0,
        replayCorrected: 0,
        finalCurrentCards: 51,
        originalHistoryPreserved: true,
        historicalJobsStillRunning: 3,
        siblingPricesPreserved: true,
        semanticReplayIdempotent: true,
        fetchTimestampMayAdvance: true,
        ownedFeedRequests: requests,
        scope:
          "Synthetic rejected app batch and explicit separate queued catch-up only; no actual ENOMEM/crash, original full-feed completion or shared-data replay",
      }),
    );
  } catch (error) {
    failure = error;
  } finally {
    await new Promise<void>((resolve) => {
      if (!server.listening) resolve();
      else server.close(() => resolve());
    });
    for (const database of created.reverse())
      try {
        sql(
          admin,
          'DROP DATABASE "' + database.pathname.slice(1) + '" WITH (FORCE)',
        );
      } catch (error) {
        failure = new AggregateError(
          failure ? [failure, error] : [error],
          "Projection fixture cleanup failed",
        );
      }
  }
  if (failure) throw failure;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
