import test from "node:test";
import assert from "node:assert/strict";
import { AcquisitionNativeGeneration } from "../lib/acquisition-native-generation";

test("generation switch waits for retirement and rejects a changed or invalid publication", async () => {
  let fingerprint = "first", now = 0, describes = 0;
  let valid = true, race = false;
  const events: string[] = [], retired: string[] = [];
  const generation = new AcquisitionNativeGeneration(
    async () => {
      describes++;
      if (!valid) throw new Error("invalid publication");
      const digest = fingerprint;
      if (race) fingerprint = "raced";
      return {digest};
    },
    descriptor => ({
      request: async () => descriptor,
      shutdown: async () => { retired.push(descriptor.digest); },
    }),
    event => events.push(event),
    async () => fingerprint,
    () => now,
  );
  assert.equal(await generation.refresh(), true);
  assert.equal(generation.current?.descriptor.digest, "first");
  now = 30001;
  assert.equal(await generation.refresh(), false);
  assert.equal(describes, 1, "unchanged generations do not revalidate/load models");
  fingerprint = "second"; valid = false; now = 60002;
  assert.equal(await generation.refresh(), false);
  assert.equal(generation.current?.descriptor.digest, "first");
  assert.deepEqual(retired, [], "bad publications retain the working process");
  valid = true; race = true; now = 90003;
  assert.equal(await generation.refresh(), false);
  assert.equal(generation.current?.descriptor.digest, "first");
  race = false; now = 120004;
  assert.equal(await generation.refresh(), true);
  assert.deepEqual(retired, ["first"]);
  assert.equal(generation.current?.descriptor.digest, "raced");
  assert.deepEqual(events, ["ready", "unavailable", "unavailable", "ready"]);
  await generation.shutdown();
  assert.deepEqual(retired, ["first", "raced"]);
});
