import assert from "node:assert/strict";
import test from "node:test";
import { waitForPricingDatabase } from "../lib/pricing-database-readiness";

test("recovery rejection and no-response wait before a single ready admission without exposing connection data", async () => {
  let clock = 0, probes = 0; const sleeps: number[] = [], events: unknown[] = [];
  await waitForPricingDatabase("postgresql://private:secret@fixture/db?schema=public&sslmode=disable", {
    now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; },
    probe: (url, remaining) => { assert(!url.includes("schema=")); assert(url.includes("sslmode=disable")); assert(remaining <= 2000); return ["REJECTING", "NO_RESPONSE", "REJECTING", "READY"][probes++] as "READY"; },
    report: event => events.push(event), timeoutMs: 20000,
  });
  assert.equal(probes, 4); assert.deepEqual(sleeps, [1000,2000,4000]);
  assert.equal(events.length, 2); assert(!JSON.stringify(events).includes("secret")); assert(!JSON.stringify(events).includes("private"));
});
test("readiness waits are bounded and terminal failure admits no SQL work", async () => {
  let clock = 0, probes = 0;
  await assert.rejects(waitForPricingDatabase("postgresql://fixture/db", {
    now: () => clock, sleep: async ms => { clock += ms; }, probe: () => { probes++; return "REJECTING"; }, report: () => {}, timeoutMs: 3500,
  }), /startup budget/);
  assert.equal(clock, 3500); assert.equal(probes, 3);
});
test("ready server passes immediately while fatal probe errors and invalid configuration propagate", async () => {
  let probes = 0;
  await waitForPricingDatabase("postgresql://fixture/db", { probe: () => { probes++; return "READY"; }, sleep: async () => { assert.fail("Ready server must not sleep"); }, report: () => { assert.fail("Ready server must not log a wait"); } });
  assert.equal(probes,1);
  const error = new Error("fatal probe configuration");
  await assert.rejects(waitForPricingDatabase("postgresql://fixture/db", { probe: () => { throw error; } }), e => e === error);
  await assert.rejects(waitForPricingDatabase("not a URL"), /Invalid URL/);
  await assert.rejects(waitForPricingDatabase("postgresql://fixture/db", { timeoutMs: Infinity }), /budget/);
});
