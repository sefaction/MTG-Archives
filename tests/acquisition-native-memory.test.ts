import assert from "node:assert/strict";
import test from "node:test";
import { captureNativeMemory, nativeMemoryWindow, parseNativeMemoryEvents, type NativeMemoryCapture, type NativeMemorySample } from "../lib/acquisition-native-memory";
import { acquisitionNativeFailure, observeNativeFailure, type NativeFailureObservation } from "../lib/acquisition-native-failure";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";

const events = "low 0\nhigh 0\nmax 12\noom 6\noom_kill 6\noom_group_kill 0\n";
const secret = "private-argv-photo-query-secret";
const sample = (text = events): NativeMemorySample => Object.freeze({
  events: parseNativeMemoryEvents(text), currentBytes: 1234, maxBytes: "max", peakBytes: 2345,
  swapCurrentBytes: 0, swapMaxBytes: 1024, swapPeakBytes: 0,
});
const capture = (text = events, identity = "same-private-identity"): NativeMemoryCapture => ({status: "available", sample: sample(text), identity});

test("cgroup event parser admits only bounded safe counters and a fixed projection", () => {
  assert.deepEqual(parseNativeMemoryEvents(events + secret + " 23\n"), {
    low: 0, high: 0, max: 12, oom: 6, oom_kill: 6, oom_group_kill: 0,
  });
  assert.equal(parseNativeMemoryEvents(events.replace("oom_group_kill 0\n", "")).oom_group_kill, null);
  assert.equal(Object.isFrozen(parseNativeMemoryEvents(events)), true);
  for (const invalid of [events.replace("oom 6", "oom -1"), events.replace("oom 6", "oom 1.5"),
    events.replace("oom 6", "oom 9007199254740992"), events.replace("oom 6", "oom 06"),
    events.replace("oom 6", "oom 1e2"), events + "oom 6\n", events.replace("oom 6\n", ""),
    events.replace("oom 6", `oom ${secret}`), events + "x".repeat(4096)]) {
    assert.throws(() => parseNativeMemoryEvents(invalid), error => {
      assert.equal(String(error).includes(secret), false);
      return true;
    });
  }
});

test("windows compare scoped event counters without inferring child kill causality", () => {
  const before = capture(), after = capture(events.replace("max 12", "max 15").replace("oom 6", "oom 7"));
  const window = nativeMemoryWindow(before, after);
  assert.equal(window.status, "available");
  assert.deepEqual(window.eventsDelta, {low: 0, high: 0, max: 3, oom: 1, oom_kill: 0, oom_group_kill: 0});
  assert.equal(window.scope, "self-cgroup-native-child-lifetime");
  assert.equal(JSON.stringify(window).includes("private-identity"), false);
  assert.equal(Object.isFrozen(window), true);
  assert.equal(Object.isFrozen(window.eventsDelta), true);
  assert.equal(nativeMemoryWindow(before, capture(events.replace("oom 6", "oom 5"))).status, "counter-reset");
  assert.equal(nativeMemoryWindow(before, capture(events.replace("oom 6", "oom 5"))).eventsDelta, null);
  assert.equal(nativeMemoryWindow(before, capture(events, "other-private-identity")).status, "scope-changed");
  assert.equal(nativeMemoryWindow(before, capture(events.replace("oom_group_kill 0\n", ""))).status, "scope-changed");
  for (const unavailable of [{status: "unavailable", reason: "PLATFORM"}, {status: "unavailable", reason: "READ_OR_FORMAT"},
    {status: "unavailable", reason: "CGROUP_SCOPE"}] as const) {
    for (const window of [nativeMemoryWindow(unavailable, after), nativeMemoryWindow(before, unavailable)]) {
      assert.equal(window.status, "unavailable");
      assert.equal(window.eventsDelta, null);
      assert.equal(window.unavailableReason, unavailable.reason);
    }
  }
});

function checkObservation(observed: NativeFailureObservation, error: unknown) {
  assert.ok(observed.memory);
  assert.equal(observed.memory.scope, "self-cgroup-native-child-lifetime");
  assert.equal(JSON.stringify(observed).includes(secret), false);
  assert.equal(Object.isFrozen(observed), true);
  const projected = acquisitionNativeFailure(error);
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected).sort(), ["exitCode", "reason", "signal", "systemCode"]);
  assert.equal("memory" in projected, false, "public trusted failure stays separate from private observation");
}

test("actual one-shot failures carry memory only in the private observer, including observer throws", async () => {
  const observed: NativeFailureObservation[] = [];
  await assert.rejects(runAcquisitionNativeProcess(process.execPath,
    ["-e", `process.stderr.write('${secret}');process.exit(7)`], Buffer.from(secret), AbortSignal.timeout(5000), value => {
      observed.push(value); throw Error(secret);
    }), error => {
      assert.equal(acquisitionNativeFailure(error)?.exitCode, 7);
      assert.equal(observed.length, 1);
      checkObservation(observed[0], error);
      return true;
    });
  const capture = captureNativeMemory();
  if (process.platform !== "linux") assert.deepEqual(capture, {status: "unavailable", reason: "PLATFORM"});
});

test("warm generations reset observations after retired child, keep intentional shutdown quiet", async () => {
  const observed: NativeFailureObservation[] = [];
  const native = new AcquisitionNativeStream(process.execPath, ["-e", `let b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);if(b.length<4+b.readUInt32BE())return;const mode=b.subarray(4).toString();b=Buffer.alloc(0);if(mode==='fail')process.exit(8);else process.stdout.write(JSON.stringify({pid:process.pid})+'\\n');});`], undefined, value => observed.push(value));
  try {
    let pid = (await native.request(Buffer.from("ok"), AbortSignal.timeout(5000)) as {pid: number}).pid;
    for (let i = 0; i < 2; i++) {
      await assert.rejects(native.request(Buffer.from("fail"), AbortSignal.timeout(5000)), error => {
        assert.equal(observed.length, i + 1);
        assert.equal(acquisitionNativeFailure(error)?.exitCode, 8);
        checkObservation(observed[i], error);
        return true;
      });
      const next = (await native.request(Buffer.from("ok"), AbortSignal.timeout(5000)) as {pid: number}).pid;
      assert.notEqual(next, pid);
      pid = next;
    }
    await native.shutdown();
    assert.equal(observed.length, 2);
    assert.notEqual(observed[0].memory, observed[1].memory);
  } finally { await native.shutdown(); }
});

test("default worker logging includes only projected memory, never the error or child output", () => {
  const original = console.error;
  const records: string[] = [];
  try {
    console.error = value => records.push(String(value));
    observeNativeFailure("printing")({reason: "EXIT", exitCode: 7, signal: null, systemCode: null,
      memory: nativeMemoryWindow(capture(), capture())});
  } finally { console.error = original; }
  const record = JSON.parse(records[0]);
  assert.equal(record.event, "native-attempt-failed");
  assert.equal(record.stage, "printing");
  assert.equal(record.memory.eventsDelta.oom_kill, 0);
  assert.equal(records[0].includes("private-identity"), false);
  assert.ok(records[0].length < 1400);
});
