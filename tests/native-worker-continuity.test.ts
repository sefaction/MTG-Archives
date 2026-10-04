import assert from "node:assert/strict";
import {test} from "node:test";
import {assertNativeWorkerContinuity, type NativeWorkerSnapshot} from "./native-worker-continuity";

const before: NativeWorkerSnapshot = {name: "printing", id: "old-container", image: "qualified-image",
  restarts: 3, oom: 1, oomKills: 1, state: {Running: true, OOMKilled: false, StartedAt: "yesterday"}};
test("historical restart and OOM counters do not fail an uninterrupted qualification", () => {
  assertNativeWorkerContinuity(before, structuredClone(before));
});
test("automatic and manual restarts both fail even with a stable container identity", () => {
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, restarts: 4}), /restart count/);
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, state: {...before.state, StartedAt: "today"}}), /restarted/);
});
test("replacement and new OOM evidence fail rather than resetting the baseline", () => {
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, id: "replacement", restarts: 0}), /replaced/);
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, oom: 2}), /new OOM event/);
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, oomKills: 2}), /new OOM kill/);
});
test("stopped workers and missing lifetime evidence cannot pass", () => {
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, state: {...before.state, Running: false}}), /must be running/);
  assert.throws(() => assertNativeWorkerContinuity(before, {...before, restarts: Number.NaN}), /evidence unavailable/);
});
