import assert from "node:assert/strict";
import test from "node:test";
import { inPricingMaintenanceWindow,
  pricingMaintenanceMinutesRemaining } from "../scripts/pricing-archive-maintenance-window";

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
