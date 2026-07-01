import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { money } from "../lib/pricing-analytics";

test("pricing analytics page and navigation are wired", () => {
  assert.equal(existsSync("app/pricing/page.tsx"), true);
  const pricingPage = readFileSync("app/pricing/page.tsx", "utf8");
  const nav = readFileSync("components/Nav.tsx", "utf8");
  const inventory = readFileSync("app/inventory/page.tsx", "utf8");
  const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
  assert.match(nav, /href: "\/pricing"/);
  assert.match(inventory, /View value trends/);
  assert.match(adminPrices, /Pricing worker/);
  assert.match(pricingPage, /Pricing analytics disabled/);
  assert.match(pricingPage, /separate service/);
  assert.doesNotMatch(pricingPage, /Top gainers|Top losers/);
});

test("pricing analytics helpers remain lightweight during worker scaffold phase", () => {
  const helper = readFileSync("lib/pricing-analytics.ts", "utf8");
  assert.match(helper, /getPricingAnalytics/);
  assert.match(helper, /topGainers/);
  assert.match(helper, /topLosers/);
  assert.match(helper, /valueChange/);
  assert.match(helper, /percentChange/);
  assert.doesNotMatch(
    helper,
    /CardPriceSnapshot|priceSnapshots|PRICING_DATABASE_URL/,
  );
  assert.equal(money(12.3), "$12.30");
});

test("inventory page avoids pricing history database joins", () => {
  const inventory = readFileSync("app/inventory/page.tsx", "utf8");
  const apiList = readFileSync("app/api/inventory/list/route.ts", "utf8");
  for (const source of [inventory, apiList]) {
    assert.doesNotMatch(source, /getLatestPriceSnapshotsForCards/);
    assert.doesNotMatch(
      source,
      /priceSnapshots:\s*\{\s*orderBy:[\s\S]*take:\s*(16|24)/,
    );
    assert.match(source, /priceHistory: \[\]/);
  }
  assert.doesNotMatch(inventory, /ENABLE_INVENTORY_MTGJSON_PRICES/);
});

test("admin pricing page remains operational without heavy history analytics", () => {
  const adminPrices = readFileSync("app/admin/prices/page.tsx", "utf8");
  assert.match(adminPrices, /Queue refresh job/);
  assert.match(adminPrices, /listPricingWorkerStatus/);
  assert.doesNotMatch(adminPrices, /PriceImportJobsPanel/);
  assert.doesNotMatch(
    adminPrices,
    /inventoryItem\.findMany\(\{[\s\S]*priceSnapshots/,
  );
  assert.doesNotMatch(
    adminPrices,
    /collectionValueHistory|inventoryValueByProvider|providerValueRows|historyRows/,
  );
});

test("pricing worker platform exposes snapshot indexes outside the main app schema", () => {
  const pricingPage = readFileSync("app/pricing/page.tsx", "utf8");
  const worker = readFileSync("scripts/pricing-worker.ts", "utf8");
  assert.doesNotMatch(pricingPage, /ENABLE_PRICING_ANALYTICS/);
  assert.match(worker, /price_snapshots_identity_key/);
  assert.match(worker, /price_snapshots_provider_currency_observed_idx/);
  assert.match(worker, /jsonb_to_recordset/);
});
