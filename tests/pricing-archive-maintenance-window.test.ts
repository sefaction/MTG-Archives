import assert from "node:assert/strict";
import test from "node:test";
import { inPricingMaintenanceWindow,
  pricingMaintenanceMinutesRemaining, pricingMaintenanceMillisecondsRemaining,
  PRICING_RAW_STAGE_BUDGET_MS, PRICING_RAW_ACTIVATION_BUDGET_MS } from "../scripts/pricing-archive-maintenance-window";

test("Central maintenance window honors winter, summer and DST changes", () => {
  for (const time of ["2026-01-15T07:59:59Z", "2026-07-15T06:59:59Z",
    "2026-03-08T07:59:59Z", "2026-11-01T06:59:59Z"])
    assert.equal(inPricingMaintenanceWindow(new Date(time)), false, time);
  for (const time of ["2026-01-15T08:00:00Z", "2026-07-15T07:00:00Z",
    "2026-03-08T08:00:00Z", "2026-11-01T08:00:00Z"])
    assert.equal(inPricingMaintenanceWindow(new Date(time)), true, time);
  assert.equal(inPricingMaintenanceWindow(new Date("2026-01-15T11:00:00Z")), false);
  assert.equal(inPricingMaintenanceWindow(new Date("2026-07-15T10:00:00Z")), false);
  assert.equal(pricingMaintenanceMinutesRemaining(new Date("2026-01-15T10:40:00Z")), 20);
  assert.equal(pricingMaintenanceMinutesRemaining(new Date("2026-07-15T09:39:00Z")), 21);
});

test("raw retention budgets leave room for stage and activation deadlines", () => {
  const stageCanStart = new Date("2026-01-15T09:47:59Z"); // 03:47:59 Central.
  const stageTooLate = new Date("2026-01-15T09:48:00Z");
  assert.ok(pricingMaintenanceMillisecondsRemaining(stageCanStart) > PRICING_RAW_STAGE_BUDGET_MS);
  assert.ok(pricingMaintenanceMillisecondsRemaining(stageTooLate) <= PRICING_RAW_STAGE_BUDGET_MS);
  const activationCanStart = new Date("2026-07-15T08:53:59Z"); // 03:53:59 Central.
  const activationTooLate = new Date("2026-07-15T08:54:00Z");
  assert.ok(pricingMaintenanceMillisecondsRemaining(activationCanStart) > PRICING_RAW_ACTIVATION_BUDGET_MS);
  assert.ok(pricingMaintenanceMillisecondsRemaining(activationTooLate) <= PRICING_RAW_ACTIVATION_BUDGET_MS);
  assert.equal(pricingMaintenanceMillisecondsRemaining(new Date("2026-03-08T08:00:00Z")), 120 * 60_000);
  assert.equal(pricingMaintenanceMillisecondsRemaining(new Date("2026-11-01T08:00:00Z")), 180 * 60_000);
});
