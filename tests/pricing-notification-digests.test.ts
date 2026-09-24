import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dailyPricingMovementSql,
  priorUtcDay,
} from "../lib/pricing-notification-digests";

test("Pricing digest uses the previous UTC observation day at date boundaries", () => {
  assert.equal(priorUtcDay(new Date("2026-01-01T02:00:00Z")), "2025-12-31");
  assert.equal(priorUtcDay(new Date("2026-03-01T23:59:59Z")), "2026-02-28");
});

test("Pricing digest query scopes exact owned printings, source and per-card thresholds", () => {
  const sql = dailyPricingMovementSql({
    owned: [
      { mtgjsonUuid: "owned-1", quantity: 3 },
      { mtgjsonUuid: "empty", quantity: 0 },
    ],
    observedDate: "2026-09-23",
    enabledAt: new Date("2026-09-22T02:00:00Z"),
    provider: "tcgplayer",
    finish: "foil",
    priceType: "retail",
    currency: "USD",
    thresholdMode: "either",
    minAbsolute: 2,
    minPercent: 25,
    minPriorPrice: 1,
  });
  assert.ok(sql);
  assert.match(sql, /\('owned-1', 3::int\)/);
  assert.doesNotMatch(sql, /empty/);
  assert.match(sql, /d\.provider = 'tcgplayer'/);
  assert.match(sql, /d\.finish = 'foil'/);
  assert.match(sql, /d\.price_type = 'retail'/);
  assert.match(sql, /d\.currency = 'USD'/);
  assert.match(sql, /d\.created_at >= '2026-09-23'::date/);
  assert.match(sql, /ABS\("absoluteChange"\) >= 2 OR/);
  assert.match(sql, /"startPrice" >= 1 AND ABS\("percentChange"\) >= 25/);
  assert.match(sql, /p\.observed_date < d\.observed_date/);
  assert.match(sql, /d\.source_revision_count > 0/);
  assert.match(sql, /'2026-09-23'::date - INTERVAL '90 days'/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int/);
});

test("Pricing digest does not query without owned matches", () => {
  const sql = dailyPricingMovementSql({
    owned: [],
    observedDate: "2026-09-23",
    enabledAt: new Date("2026-09-22T02:00:00Z"),
    provider: "tcgplayer",
    finish: "normal",
    priceType: "retail",
    currency: "USD",
    thresholdMode: "absolute",
    minAbsolute: 2,
    minPercent: 25,
    minPriorPrice: 1,
  });
  assert.equal(sql, null);
});
