import assert from "node:assert/strict";
import { test } from "node:test";
import { runPricingMaintenanceChild } from "../scripts/pricing-maintenance-child";

test("a Pricing maintenance child that ignores termination is killed after its deadline", async () => {
  const started = Date.now();
  const result = await runPricingMaintenanceChild(process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    800, () => true, 200);
  assert.equal(result.code, -1);
  assert.match(result.error, /Operation timed out/);
  assert.ok(Date.now() - started < 3_000);
});

test("a successful Pricing maintenance child keeps its exit result", async () => {
  const result = await runPricingMaintenanceChild(process.execPath,
    ["-e", "console.log('complete')"], 2_000, () => true, 200);
  assert.equal(result.code, 0);
  assert.equal(result.output.trim(), "complete");
});
