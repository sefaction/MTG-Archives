import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1", "Local/CI opt-in required");
const source = new URL(process.env.PRICING_DATABASE_URL || "");
assert(["postgres:", "postgresql:"].includes(source.protocol));
assert(["localhost", "127.0.0.1", "pricing-postgres"].includes(source.hostname));
for (const key of source.searchParams.keys()) assert.equal(key, "schema");
source.search = "";
const env = { ...process.env };
for (const key of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE"]) delete env[key];
const token = randomUUID().replaceAll("-", "").slice(0, 16), admin = new URL(source), pricing = new URL(source), app = new URL(source);
admin.pathname = "/postgres"; pricing.pathname = "/identifier_prices_" + token; app.pathname = "/identifier_app_" + token;
function sql(connection: URL, statement: string) {
  const r = spawnSync("psql", [connection.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-f", "-"], { env, input: "SET statement_timeout='10s';SET lock_timeout='2s';SET timezone='UTC';\n" + statement, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  if (r.status !== 0) throw Error("Identifier fixture SQL failed or timed out");
  return r.stdout.trim();
}
const query = (s: string) => sql(pricing, s);
let mode = "valid", requests = 0, feed = "";
const payload = { data: { first: { uuid: "u1", identifiers: { scryfallId: "s1" } }, duplicate: { uuid: "wrong-duplicate", scryfallId: "s1" }, existing: { uuid: "u2", scryfallId: "s2" }, overwrite: { uuid: "forbidden", scryfallId: "s3" }, conflict: { uuid: "held", scryfallId: "s4" }, missing: { uuid: "missing", scryfallId: "s5" } } };
const server = createServer((req, res) => {
  assert.equal(req.url, "/owned-identifiers"); requests++;
  res.statusCode = mode === "http" ? 503 : 200; res.setHeader("Content-Type", "application/json");
  const body = mode === "http" ? "unavailable" : JSON.stringify(payload) + (mode === "malformed" ? "trailing-error" : "");
  for (let i = 0; i < body.length; i += 13) res.write(body.slice(i, i + 13));
  res.end();
});
async function worker() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/pricing-worker.ts", "--once"], { env: { ...env, DATABASE_URL: app.toString(), APP_DATABASE_URL: app.toString(), PRICING_DATABASE_URL: pricing.toString(), MTGJSON_ALL_IDENTIFIERS_URL: feed, PRICING_AUTO_SCHEDULE_ENABLED: "false", PRICING_DAILY_REFRESH_ENABLED: "false", PRICING_DAILY_IDENTIFIER_MAPPING_ENABLED: "false", PRICING_IMPORT_BATCH_SIZE: "2", PRICING_WORKER_ID: "identifier-fixture-" + token, BACKUP_DIR: "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("Identifier worker deadline")); }, 45000);
    child.once("error", () => { clearTimeout(timer); reject(Error("Identifier worker start failed")); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error("Identifier worker exit " + code)); });
  });
}
async function main() {
  const created: URL[] = []; let failure: unknown;
  const appRows = () => JSON.parse(sql(app, 'SELECT json_agg(to_jsonb(c) ORDER BY id) FROM "Card" c'));
  const jobFingerprint = (except: string) => query("SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) FROM price_import_jobs t WHERE id<> '" + except + "'");
  try {
    for (const db of [pricing, app]) { sql(admin, 'CREATE DATABASE "' + db.pathname.slice(1) + '"'); created.push(db); }
    sql(app, `CREATE TABLE "Card"(id text PRIMARY KEY,"scryfallId" text UNIQUE,"mtgjsonUuid" text UNIQUE,prices jsonb,"priceLastFetchedAt" timestamptz);INSERT INTO "Card" VALUES('one','s1',NULL,'{"usd":"1"}','2000-01-01'),('same','s2','u2','{"sentinel":true}','2000-01-01'),('different','s3','owned','{}','2000-01-01'),('blocked','s4',NULL,'{}','2000-01-01'),('holder','other','held','{}','2000-01-01');`);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string"); feed = `http://127.0.0.1:${address.port}/owned-identifiers`;
    await worker(); query("INSERT INTO price_import_jobs(id,type,status,error)VALUES('old-running','MTGJSON_REFRESH_ALL','RUNNING',NULL),('old-failed','MTGJSON_MAP_IDENTIFIERS','FAILED','preserved');");
    const original = appRows(); let goodRows: unknown;
    for (const [id, nextMode] of [["first", "valid"], ["bad-tail", "malformed"], ["http-failure", "http"], ["identical", "valid"]]) {
      mode = nextMode; const before = appRows(), priorJobs = jobFingerprint(id);
      query(`INSERT INTO price_import_jobs(id,type,status)VALUES('${id}','MTGJSON_MAP_IDENTIFIERS','QUEUED')`); await worker();
      const job = JSON.parse(query(`SELECT to_jsonb(j) FROM price_import_jobs j WHERE id='${id}'`));
      assert.equal(jobFingerprint(id), priorJobs);
      if (mode === "valid") {
        assert.equal(job.status, "SUCCEEDED"); assert.equal(job.processed_count, 5); assert.equal(job.inserted_count, 2); assert.equal(job.skipped_count, 3);
        const expected = structuredClone(original); expected.find((c: any) => c.id === "one").mtgjsonUuid = "u1"; assert.deepEqual(appRows(), expected);
        if (id === "first") goodRows = appRows(); else assert.deepEqual(appRows(), goodRows);
      } else { assert.equal(job.status, "FAILED"); assert.equal(job.processed_count, 0); assert.equal(job.inserted_count, 0); assert.deepEqual(appRows(), before); }
    }
    assert.equal(requests, 4);
  } catch (error) { failure = error; }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const db of created.reverse()) try { sql(admin, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db.pathname.slice(1)}' AND pid<>pg_backend_pid();DROP DATABASE "${db.pathname.slice(1)}";`); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  console.log(JSON.stringify({status:"PASS",feedRequests:requests,firstDuplicateAndFallbackPreserved:true,existingAndConflictingMappingsPreserved:true,allSiblingCardFieldsExact:true,malformedTailNoWrites:true,httpFailureNoWrites:true,identicalReplayExact:true,oldJobRowsExact:true,ownedDatabasesRemoved:true}));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Identifier fixture failed"); process.exitCode = 1; });
