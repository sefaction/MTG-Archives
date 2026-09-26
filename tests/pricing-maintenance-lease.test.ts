import assert from "node:assert/strict";
import { test } from "node:test";
import { withPricingMaintenanceLease } from "../scripts/pricing-maintenance-lease";

test("Pricing cleanup renews its lease while asynchronous work continues", { timeout: 2_000 }, async () => {
  let heartbeats = 0;
  let finish: (value: string) => void = () => {};
  const result = await withPricingMaintenanceLease(
    () => new Promise<string>((resolve) => { finish = resolve; }),
    () => { heartbeats += 1; if (heartbeats === 2) finish("done"); return true; }, 10);
  assert.equal(result.value, "done");
  assert.equal(result.leaseLost, false);
  assert.ok(heartbeats >= 2);
  const completedCount = heartbeats;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(heartbeats, completedCount);
});

test("Pricing cleanup reports a lost lease after its work finishes", { timeout: 2_000 }, async () => {
  let finish: (value: string) => void = () => {};
  const result = await withPricingMaintenanceLease(
    () => new Promise<string>((resolve) => { finish = resolve; }),
    () => { finish("done"); return false; }, 10);
  assert.equal(result.value, "done");
  assert.equal(result.leaseLost, true);
});
