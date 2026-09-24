import assert from "node:assert/strict";
import test from "node:test";
import { getPricingRetentionPolicy } from "../lib/pricing-retention-policy";

test("pricing history tiers use bounded, ordered cutoffs", () => {
  assert.deepEqual(getPricingRetentionPolicy({}), {
    dailyDays: 90,
    weeklyYears: 2,
    monthlyYears: 10,
  });
  assert.deepEqual(
    getPricingRetentionPolicy({
      PRICING_DAILY_HISTORY_DAYS: "120",
      PRICING_WEEKLY_HISTORY_YEARS: "3",
      PRICING_MONTHLY_HISTORY_YEARS: "12",
    }),
    { dailyDays: 120, weeklyYears: 3, monthlyYears: 12 },
  );
  assert.deepEqual(
    getPricingRetentionPolicy({
      PRICING_DAILY_HISTORY_DAYS: "365",
      PRICING_WEEKLY_HISTORY_YEARS: "1",
    }),
    { dailyDays: 90, weeklyYears: 2, monthlyYears: 10 },
  );
  assert.equal(
    getPricingRetentionPolicy({ PRICING_DAILY_HISTORY_DAYS: "0;DROP TABLE" })
      .dailyDays,
    90,
  );
});
