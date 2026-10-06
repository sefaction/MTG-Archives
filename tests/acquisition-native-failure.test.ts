import assert from "node:assert/strict";
import test from "node:test";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { acquisitionNativeFailure, nativeFailureError, type NativeFailure } from "../lib/acquisition-native-failure";

const secret = "fixture-private-photo-path-query-token";
const newline = "String.fromCharCode(10)";

test("native failure projection rejects fabricated and hostile exceptions", () => {
  const hostile = new Proxy({}, {get() {throw Error(secret);}});
  for (const value of [undefined, null, secret, hostile, {reason: "EXIT", exitCode: 7, stderr: secret}])
    assert.equal(acquisitionNativeFailure(value), undefined);
  const error = nativeFailureError("Processing native attempt failed", "EXIT", -1, secret, secret);
  assert.deepEqual(acquisitionNativeFailure(error), {reason: "EXIT", exitCode: null, signal: null, systemCode: null});
  assert.equal(JSON.stringify(error).includes(secret), false);
  assert.equal(Object.isFrozen(acquisitionNativeFailure(error)), true);
});

test("one-shot child failures retain bounded facts while draining private stderr", async () => {
  const cases = [
    {program: `process.stderr.write('${secret}'.repeat(3000));process.exit(7)`, reason: "EXIT", code: 7},
    {program: `console.log('${secret}')`, reason: "INVALID_JSON", code: 0},
    {program: `process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)`, reason: "OUTPUT_LIMIT"},
    {program: "setInterval(()=>{},1000)", reason: "TIMEOUT", timeout: 150},
  ];
  for (const item of cases) {
    const seen: NativeFailure[] = [];
    await assert.rejects(runAcquisitionNativeProcess(process.execPath, ["-e", item.program],
      Buffer.from(secret), AbortSignal.timeout(item.timeout ?? 5000), value => seen.push(value)), error => {
        assert.equal(acquisitionNativeFailure(error)?.reason, item.reason);
        if (item.code !== undefined) assert.equal(acquisitionNativeFailure(error)?.exitCode, item.code);
        assert.equal(String(error).includes(secret), false);
        return true;
      });
    assert.equal(seen.length, 1, "failure is observed once after the actual child closes");
    assert.equal(JSON.stringify(seen).includes(secret), false);
  }
});

test("spawn and explicit cancellation remain distinct from child exit and timeout", async () => {
  const seen: NativeFailure[] = [];
  await assert.rejects(runAcquisitionNativeProcess("mtg-absent-native-fixture-executable", [], Buffer.alloc(0),
    AbortSignal.timeout(5000), value => seen.push(value)), error => {
      assert.equal(acquisitionNativeFailure(error)?.reason, "SPAWN");
      assert.equal(acquisitionNativeFailure(error)?.systemCode, "ENOENT");
      return true;
    });
  const controller = new AbortController();
  controller.abort(Error(secret));
  await assert.rejects(runAcquisitionNativeProcess(process.execPath, [], Buffer.alloc(0), controller.signal), error => {
    assert.equal(acquisitionNativeFailure(error)?.reason, "ABORTED");
    assert.equal(String(error).includes(secret), false);
    return true;
  });
  assert.equal(seen.length, 1);
});

test("warm native failures preserve first cause, retire the child and admit the next request", async () => {
  const program = `const send=v=>process.stdout.write(JSON.stringify(v)+${newline});let b=Buffer.alloc(0);process.stdin.on('data',chunk=>{b=Buffer.concat([b,chunk]);while(b.length>=4){const n=b.readUInt32BE();if(b.length<4+n)return;const mode=b.subarray(4,4+n).toString();b=b.subarray(4+n);process.stderr.write('${secret}');
    if(mode==='exit')return process.exit(9);
    if(mode==='json')return process.stdout.write('${secret}'+${newline});
    if(mode==='oversize')return process.stdout.write('x'.repeat(100000));
    if(mode==='hang')continue;
    if(mode==='progress')for(let i=0;i<5;i++)send({progress:true});
    if(mode==='callback')send({progress:true});
    send({ok:true,pid:process.pid});}});`;
  const seen: NativeFailure[] = [];
  const native = new AcquisitionNativeStream(process.execPath, ["-e", program], undefined, value => seen.push(value));
  try {
    let previous = (await native.request(Buffer.from("ok"), AbortSignal.timeout(5000))) as {pid: number};
    for (const [mode, reason] of [["exit", "EXIT"], ["json", "INVALID_JSON"], ["oversize", "OUTPUT_LIMIT"],
      ["hang", "TIMEOUT"], ["progress", "PROTOCOL"], ["callback", "PROGRESS_CALLBACK"]] as const) {
      await assert.rejects(native.request(Buffer.from(mode), AbortSignal.timeout(mode === "hang" ? 150 : 5000),
        mode === "callback" ? () => {throw Error(secret);} : () => {}), error => {
          assert.equal(acquisitionNativeFailure(error)?.reason, reason);
          return true;
        });
      const current = (await native.request(Buffer.from("ok"), AbortSignal.timeout(5000))) as {pid: number};
      assert.notEqual(current.pid, previous.pid, "rejection waits for process retirement before reuse");
      previous = current;
    }
    assert.equal(seen.length, 6);
    assert.equal(JSON.stringify(seen).includes(secret), false);
    await native.shutdown();
    assert.equal(seen.length, 6, "intentional shutdown is not logged as an inference failure");
  } finally { await native.shutdown(); }
});

test("observer failures cannot replace native outcome or prevent warm recovery", async () => {
  await assert.rejects(runAcquisitionNativeProcess(process.execPath, ["-e", "process.exit(3)"], Buffer.alloc(0),
    AbortSignal.timeout(5000), () => {throw Error(secret);}), error => {
      assert.equal(acquisitionNativeFailure(error)?.exitCode, 3);
      return true;
    });
  const native = new AcquisitionNativeStream(process.execPath, ["-e", "process.stdin.once('data',()=>process.exit(4))"],
    undefined, () => {throw Error(secret);});
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(native.request(Buffer.from("photo"), AbortSignal.timeout(5000)), error => {
      assert.equal(acquisitionNativeFailure(error)?.exitCode, 4);
      return true;
    });
  } finally {await native.shutdown();}
});

test("unsolicited warm output is retired without revising a completed result", async () => {
  const program = `let b=Buffer.alloc(0);process.stdin.on('data',chunk=>{b=Buffer.concat([b,chunk]);if(b.length<4+b.readUInt32BE())return;const mode=b.subarray(4).toString();b=Buffer.alloc(0);process.stdout.write(JSON.stringify({ok:true,pid:process.pid})+${newline});if(mode==='unsolicited')setTimeout(()=>process.stdout.write('${secret}'+${newline}),20);});`;
  let notify!: (value: NativeFailure) => void;
  const stopped = new Promise<NativeFailure>(resolve => {notify = resolve;});
  const native = new AcquisitionNativeStream(process.execPath, ["-e", program], undefined, notify);
  try {
    const completed = await native.request(Buffer.from("unsolicited"), AbortSignal.timeout(5000)) as {ok: boolean; pid: number};
    const failure = await Promise.race([stopped, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(Error("idle output was not retired")), 5000);
      timer.unref();
    })]);
    assert.equal(failure.reason, "UNSOLICITED_OUTPUT");
    assert.equal(completed.ok, true);
    const next = await native.request(Buffer.from("ok"), AbortSignal.timeout(5000)) as {pid: number};
    assert.notEqual(next.pid, completed.pid);
    assert.equal(JSON.stringify(failure).includes(secret), false);
  } finally {await native.shutdown();}
});
