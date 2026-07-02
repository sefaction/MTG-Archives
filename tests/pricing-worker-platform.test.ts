import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync("scripts/pricing-worker.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const inventoryPage = readFileSync("app/inventory/page.tsx", "utf8");
const inventoryApi = readFileSync("app/api/inventory/list/route.ts", "utf8");
const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
const workerStore = readFileSync("lib/pricing-worker-store.ts", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");
const localCompose = readFileSync("docker-compose.local.yml", "utf8");

test("pricing worker initializes a separate pricing database schema", () => {
  assert.match(worker, /PRICING_DATABASE_URL/);
  assert.match(worker, /price_worker_heartbeats/);
  assert.match(worker, /price_worker_runs/);
  assert.match(worker, /price_worker_logs/);
  assert.match(worker, /price_import_jobs/);
  assert.match(worker, /price_snapshots/);
  assert.match(worker, /redactDatabaseUrl/);
  assert.match(worker, /claimQueuedJobs/);
  assert.match(worker, /extractMtgjsonPriceSnapshots/);
  assert.match(worker, /loadAppMtgjsonUuids/);
  assert.match(worker, /targetMtgjsonUuids/);
  assert.match(worker, /insertSnapshots/);
  assert.match(worker, /publishCurrentPrices/);
  assert.match(worker, /APP_DATABASE_URL/);
  assert.match(worker, /MTGJSON price fetch failed/);
});

test("pricing worker scripts are available without changing page rendering", () => {
  assert.match(packageJson, /worker:prices/);
  assert.match(packageJson, /worker:prices:once/);
  assert.doesNotMatch(
    inventoryPage,
    /CardPriceSnapshot|price_snapshots|PRICING_DATABASE_URL/,
  );
  assert.doesNotMatch(
    inventoryApi,
    /CardPriceSnapshot|price_snapshots|PRICING_DATABASE_URL/,
  );
});

test("admin pricing page exposes worker health, logs, and manual queueing", () => {
  assert.match(adminPrices, /Pricing worker/);
  assert.match(adminPrices, /Queue refresh job/);
  assert.match(adminPrices, /Pricing refresh queued/);
  assert.match(adminPrices, /Pricing refresh could not be queued/);
  assert.match(adminPrices, /Current price coverage/);
  assert.match(adminPrices, /Historical snapshots/);
  assert.match(adminPrices, /Latest observed price/);
  assert.match(adminPrices, /Job queue/);
  assert.match(adminPrices, /Worker heartbeat/);
  assert.match(adminPrices, /Recent jobs/);
  assert.match(adminPrices, /Progress/);
  assert.match(adminPrices, /Worker error log/);
  assert.match(adminPrices, /Worker logs/);
  assert.match(adminPrices, /enqueuePricingRefreshJob/);
  assert.doesNotMatch(adminPrices, /inventoryItem\.findMany|price_snapshots/);
});

test("web service can queue pricing jobs through the pricing database", () => {
  assert.match(compose, /web:[\s\S]*PRICING_DATABASE_URL/);
  assert.match(compose, /web:[\s\S]*depends_on:[\s\S]*pricing-postgres/);
});

test("local pricing refreshes are not capped by default", () => {
  assert.match(
    localCompose,
    /PRICING_IMPORT_MAX_CARDS: \$\{PRICING_IMPORT_MAX_CARDS:-0\}/,
  );
});

test("pricing worker store uses the separate pricing database and does not expose secrets", () => {
  assert.match(workerStore, /PRICING_DATABASE_URL/);
  assert.match(workerStore, /price_worker_heartbeats/);
  assert.match(workerStore, /price_import_jobs/);
  assert.match(workerStore, /snapshotCount/);
  assert.match(workerStore, /activeJobCount/);
  assert.match(workerStore, /MTGJSON_REFRESH_ALL/);
  assert.doesNotMatch(workerStore, /process\.env\.DATABASE_URL/);
});
