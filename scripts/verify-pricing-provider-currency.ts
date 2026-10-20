import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1", "Local/CI opt-in required");
assert.ok(process.env.PRICING_DATABASE_URL, "Test pricing connection required");
const source = new URL(process.env.PRICING_DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(source.protocol));
assert.ok(["localhost", "127.0.0.1", "pricing-postgres"].includes(source.hostname), "Local/CI endpoint required");
for (const key of source.searchParams.keys())
  assert.equal(key, "schema", "Endpoint overrides forbidden");
source.search = "";
const env = { ...process.env };
for (const key of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE"])
  delete env[key];
const token = randomUUID().replaceAll("-", "").slice(0, 16);
const admin = new URL(source);
admin.pathname = "/postgres";
const pricing = new URL(source);
pricing.pathname = "/currency_prices_" + token;
const app = new URL(source);
app.pathname = "/currency_app_" + token;
function sql(connection: URL, statement: string) {
  const r = spawnSync("psql", [connection.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"], { env, input: "SET statement_timeout='10s';SET lock_timeout='2s';SET timezone='UTC';\n" + statement, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  if (r.status !== 0)
    throw Error("Currency fixture SQL failed or timed out");
  return r.stdout.trim();
}
const query = (s: string) => sql(pricing, s);
let revised = false, requests = 0, feed = "";
const payload = () => ({ data: { one: { paper: { cardmarket: { retail: { normal: { "2026-10-18": revised ? 4.75 : 4.25 } }, currency: "EUR" }, tcgplayer: { currency: "USD", retail: { foil: { "2026-10-18": 5 } } } }, mtgo: { cardhoarder: { currency: "USD", retail: { normal: { "2026-10-18": 0.06 } } } } }, two: { paper: { fallback: { retail: { normal: { "2026-10-18": 2.12 } } }, explicit: { currency: "EUR", retail: { USD: { foil: { "2026-10-18": 3 } } } } } } } });
const server = createServer((req, res) => { assert.equal(req.url, "/owned-prices"); requests++; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payload())); });
async function worker() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/pricing-worker.ts", "--once"], { env: { ...env, DATABASE_URL: app.toString(), APP_DATABASE_URL: app.toString(), PRICING_DATABASE_URL: pricing.toString(), MTGJSON_ALL_PRICES_URL: feed, PRICING_AUTO_SCHEDULE_ENABLED: "false", PRICING_DAILY_REFRESH_ENABLED: "false", PRICING_DAILY_IDENTIFIER_MAPPING_ENABLED: "false", PRICING_IMPORT_MAX_CARDS: "0", PRICING_IMPORT_BATCH_SIZE: "500", MTGJSON_PRICE_CURRENCY_DEFAULT: "GBP", PRICING_WORKER_ID: "currency-fixture-" + token, BACKUP_DIR: "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.resume();
    child.stderr.resume();
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("Currency worker deadline")); }, 45000);
    child.once("error", () => { clearTimeout(timer); reject(Error("Currency worker start failed")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error("Currency worker exit " + code)); });
  });
}
async function main() {
  const created: URL[] = [];
  let failure: unknown;
  try {
    for (const db of [pricing, app]) {
      sql(admin, 'CREATE DATABASE "' + db.pathname.slice(1) + '"');
      created.push(db);
    }
    sql(app, `CREATE TABLE "Card"(id text PRIMARY KEY,"mtgjsonUuid" text UNIQUE,prices jsonb,"priceLastFetchedAt" timestamptz);INSERT INTO "Card" SELECT id,id,'{"usd":"12.34","sentinel":true,"mtgjson":{"old":true}}'::jsonb,'2000-01-01' FROM unnest(ARRAY['one','two','outside'])id;`);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    feed = `http://127.0.0.1:${address.port}/owned-prices`;
    await worker();
    query(`INSERT INTO price_snapshots(mtgjson_uuid,provider,finish,price_type,currency,observed_date,price,raw_json,created_at)
      VALUES('one','cardmarket','normal','retail','EUR','2026-10-18',4.25,
      '{"path":["paper","cardmarket","retail","normal"],"value":4.25}', '2000-01-01');`);
    const legacy = query("SELECT to_jsonb(s) FROM price_snapshots s WHERE provider='cardmarket'");
    let beforeReplay = "";
    for (const id of ["first", "correction", "same-price-replay"]) {
      revised = id !== "first";
      if (id === "same-price-replay") beforeReplay = query("SELECT json_agg(to_jsonb(s) ORDER BY id) FROM price_snapshots s");
      query(`INSERT INTO price_import_jobs(id,type,status)VALUES('${id}','MTGJSON_REFRESH_ALL','QUEUED');`);
      await worker();
      const job = JSON.parse(query(`SELECT to_jsonb(j) FROM price_import_jobs j WHERE id='${id}'`));
      assert.equal(job.status, "SUCCEEDED");
      assert.equal(job.inserted_count, id === "first" ? 4 : 0);
      assert.equal(job.corrected_count, id === "correction" ? 1 : 0);
      if (id === "first") assert.equal(query("SELECT to_jsonb(s) FROM price_snapshots s WHERE provider='cardmarket'"), legacy);
      if (id === "same-price-replay") assert.equal(query("SELECT json_agg(to_jsonb(s) ORDER BY id) FROM price_snapshots s"), beforeReplay);
      const evidence = JSON.parse(query("SELECT json_object_agg(provider,raw_json->'currencyProvenance') FROM price_snapshots"));
      assert.deepEqual(evidence.cardmarket, id === "first" ? null : { resolved: "EUR", resolution: "declaration", declaration: { path: ["paper", "cardmarket", "currency"], value: "EUR" } });
      assert.deepEqual(evidence.cardhoarder, { resolved: "USD", resolution: "declaration", declaration: { path: ["mtgo", "cardhoarder", "currency"], value: "USD" } });
      assert.deepEqual(evidence.explicit, { resolved: "USD", resolution: "path", currencyPath: ["paper", "explicit", "retail", "USD"], declaration: { path: ["paper", "explicit", "currency"], value: "EUR" } });
      assert.deepEqual(evidence.fallback, { resolved: "GBP", resolution: "default", defaultCurrency: "GBP" });
      const rows = JSON.parse(query(`SELECT json_agg(json_build_object('provider',provider,'currency',currency,'price',price) ORDER BY provider) FROM price_snapshots`));
      assert.deepEqual(rows, [{ provider: "cardhoarder", currency: "USD", price: 0.06 }, { provider: "cardmarket", currency: "EUR", price: revised ? 4.75 : 4.25 }, { provider: "explicit", currency: "USD", price: 3 }, { provider: "fallback", currency: "GBP", price: 2.12 }, { provider: "tcgplayer", currency: "USD", price: 5 }]);
      for (const table of ["price_daily_summary", "price_scope_summary"]) {
        const values = JSON.parse(query(`SELECT json_agg(json_build_object('provider',provider,'currency',currency) ORDER BY provider) FROM ${table}`));
        assert.deepEqual(values, rows.map(({ provider, currency }: {
          provider: string;
          currency: string;
        }) => ({ provider, currency })));
      }
      const cards = JSON.parse(sql(app, `SELECT json_agg(to_jsonb(c) ORDER BY id) FROM "Card" c`));
      for (const c of cards) {
        assert.equal(c.prices.usd, "12.34");
        assert.equal(c.prices.sentinel, true);
        if (c.id === "outside") {
          assert.deepEqual(c.prices.mtgjson, { old: true });
          assert.equal(Date.parse(c.priceLastFetchedAt), Date.parse("2000-01-01"));
        }
        else
          assert.ok(Date.parse(c.priceLastFetchedAt) > Date.parse("2000-01-01"));
      }
      assert.deepEqual(cards.find((c: any) => c.id === "one").prices.mtgjson, { cardmarket: { normal: { retail: { EUR: { amount: revised ? 4.75 : 4.25, observedDate: "2026-10-18" } } } }, tcgplayer: { foil: { retail: { USD: { amount: 5, observedDate: "2026-10-18" } } } }, cardhoarder: { normal: { retail: { USD: { amount: 0.06, observedDate: "2026-10-18" } } } } });
      assert.deepEqual(cards.find((c: any) => c.id === "two").prices.mtgjson, { fallback: { normal: { retail: { GBP: { amount: 2.12, observedDate: "2026-10-18" } } } }, explicit: { foil: { retail: { USD: { amount: 3, observedDate: "2026-10-18" } } } } });
    }
    assert.equal(requests, 3);
  }
  catch (e) {
    failure = e;
  }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const db of created.reverse())
      try {
        sql(admin, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db.pathname.slice(1)}' AND pid<>pg_backend_pid();DROP DATABASE "${db.pathname.slice(1)}";`);
      }
      catch (e) {
        failure ||= e;
      }
  }
  if (failure)
    throw failure;
  console.log(JSON.stringify({ status: "PASS", feedRequests: requests, rawRows: 5, providerCurrencyPreserved: true, dailyAndScopePreserved: true, appProjectionPreserved: true, sameDayCorrection: true, currencyEvidencePersisted: true, legacySamePriceRowExact: true, identicalReplayAllRawFieldsExact: true, otherSourcesAndOutsideCardPreserved: true, ownedDatabasesRemoved: true }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Currency fixture failed"); process.exitCode = 1; });
