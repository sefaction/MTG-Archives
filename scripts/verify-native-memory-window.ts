// Run explicitly inside a disposable Linux cgroup-v2 container. No inference,
// database, photo, credential, primary service or deliberate OOM is involved.
import assert from "node:assert/strict";
import { captureNativeMemory } from "../lib/acquisition-native-memory";
import { acquisitionNativeFailure, type NativeFailureObservation } from "../lib/acquisition-native-failure";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";

async function main() {
  assert.equal(process.platform, "linux", "Linux qualification required; unavailable is not a passing Linux case");
  assert.equal(captureNativeMemory().status, "available", "A readable, namespaced cgroup-v2 root is required");
  const observed: NativeFailureObservation[] = [];
  const observe = (value: NativeFailureObservation) => observed.push(value);
  await assert.rejects(runAcquisitionNativeProcess(process.execPath,
    ["-e", `process.stdin.resume();setTimeout(()=>process.kill(process.pid,'SIGKILL'),50)`],
    Buffer.from("non-private-control"), AbortSignal.timeout(5000), observe), error => {
      assert.equal(acquisitionNativeFailure(error)?.reason, "EXIT");
      assert.equal(acquisitionNativeFailure(error)?.signal, "SIGKILL");
      assert.equal("memory" in acquisitionNativeFailure(error)!, false);
      return true;
    });
  const native = new AcquisitionNativeStream(process.execPath, ["-e", `let b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);if(b.length<4+b.readUInt32BE())return;const mode=b.subarray(4).toString();b=Buffer.alloc(0);if(mode==='kill')setTimeout(()=>process.kill(process.pid,'SIGKILL'),10);else process.stdout.write(JSON.stringify({pid:process.pid})+'\\n');});`], undefined, observe);
  try {
    const first = await native.request(Buffer.from("ok"), AbortSignal.timeout(5000)) as {pid: number};
    await assert.rejects(native.request(Buffer.from("kill"), AbortSignal.timeout(5000)), error => {
      assert.equal(acquisitionNativeFailure(error)?.signal, "SIGKILL");
      assert.equal("memory" in acquisitionNativeFailure(error)!, false);
      return true;
    });
    assert.throws(() => process.kill(first.pid, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
    const next = await native.request(Buffer.from("ok"), AbortSignal.timeout(5000)) as {pid: number};
    assert.notEqual(first.pid, next.pid);
  } finally { await native.shutdown(); }
  assert.equal(observed.length, 2, "Intentional shutdown must remain quiet");
  for (const failure of observed) {
    assert.equal(failure.reason, "EXIT");
    assert.equal(failure.signal, "SIGKILL");
    assert.equal(failure.memory?.status, "available");
    assert.equal(failure.memory?.eventsDelta?.oom, 0);
    assert.equal(failure.memory?.eventsDelta?.oom_kill, 0);
    assert.equal(failure.memory?.eventsDelta?.oom_group_kill, 0);
  }
  console.log(JSON.stringify({status: "PASS", scope: "isolated-non-OOM-SIGKILL-controls",
    oneShotFailure: true, warmFailure: true, retiredBeforeRecovery: true, publicProjectionUnchanged: true,
    intentionalShutdownQuiet: true, observations: observed}));
}
main().catch(() => { console.error("Native memory Linux qualification failed; inspect retained private control evidence"); process.exitCode = 1; });
