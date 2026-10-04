import assert from "node:assert/strict";

export type NativeWorkerSnapshot = {
  name: string; id: string; image: string; restarts: number; oom: number; oomKills: number;
  state: {Running: boolean; OOMKilled: boolean; StartedAt: string};
};

/** Lifetime counters may predate a qualification. Identity and start-time checks
 * also catch replacement/manual restart when the restart counter does not rise. */
export function assertNativeWorkerContinuity(before: NativeWorkerSnapshot, after: NativeWorkerSnapshot) {
  for (const snapshot of [before, after]) {
    assert.equal(snapshot.state.Running, true, `${snapshot.name}: worker must be running`);
    assert.equal(snapshot.state.OOMKilled, false, `${snapshot.name}: worker reports an OOM kill`);
    for (const count of [snapshot.restarts, snapshot.oom, snapshot.oomKills])
      assert.ok(Number.isSafeInteger(count) && count >= 0, "Worker lifetime evidence unavailable");
    assert.ok(snapshot.id && snapshot.image && snapshot.state.StartedAt, "Worker identity unavailable");
  }
  assert.equal(after.name, before.name, "Worker changed");
  assert.equal(after.id, before.id, `${before.name}: container replaced during qualification`);
  assert.equal(after.image, before.image, `${before.name}: image changed during qualification`);
  assert.equal(after.state.StartedAt, before.state.StartedAt, `${before.name}: worker restarted during qualification`);
  assert.equal(after.restarts, before.restarts, `${before.name}: restart count changed during qualification`);
  assert.equal(after.oom, before.oom, `${before.name}: new OOM event during qualification`);
  assert.equal(after.oomKills, before.oomKills, `${before.name}: new OOM kill during qualification`);
}
