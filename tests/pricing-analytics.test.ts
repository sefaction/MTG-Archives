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
  assert.match(adminPrices, /Open pricing analytics/);
  assert.match(pricingPage, /Pricing analytics/);
  assert.match(pricingPage, /Collection/);
  assert.match(pricingPage, /Location/);
  assert.match(pricingPage, /Card/);
  assert.match(pricingPage, /Top gainers/);
  assert.match(pricingPage, /Top losers/);
  assert.match(pricingPage, /Individual card price history/);
});

test("pricing analytics helpers expose collection, location, card, movers, and permission filters", () => {
  const helper = readFileSync("lib/pricing-analytics.ts", "utf8");
  assert.match(helper, /getPricingAnalytics/);
  assert.match(helper, /getLatestPriceSnapshotsForCards/);
  assert.match(helper, /scope === "location"/);
  assert.match(helper, /scope === "card"/);
  assert.match(helper, /topGainers/);
  assert.match(helper, /topLosers/);
  assert.match(helper, /currentOwnerId: accessScope\.playerId/);
  assert.match(helper, /valueChange/);
  assert.match(helper, /percentChange/);
  assert.equal(money(12.3), "$12.30");
});

test("inventory page uses latest price projection and avoids full history joins", () => {
  const inventory = readFileSync("app/inventory/page.tsx", "utf8");
  const apiList = readFileSync("app/api/inventory/list/route.ts", "utf8");
  for (const source of [inventory, apiList]) {
    assert.match(source, /getLatestPriceSnapshotsForCards/);
    assert.doesNotMatch(source, /priceSnapshots:\s*\{\s*orderBy:[\s\S]*take:\s*(16|24)/);
    assert.match(source, /priceHistory: \[\]/);
  }
  assert.match(inventory, /priceLookupMs/);
  assert.match(inventory, /latestPriceProjection/);
});
