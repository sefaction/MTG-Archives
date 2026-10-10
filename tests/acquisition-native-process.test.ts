import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { acquisitionNativeEnvironment } from "../lib/acquisition-native-environment";
import { acquisitionNativeFailure, type NativeFailure } from "../lib/acquisition-native-failure";

test("native environment excludes app credentials", () => {
  const prior = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "fixture-secret-not-for-native";
    assert.equal(acquisitionNativeEnvironment().env.DATABASE_URL, undefined);
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});

test("warm native protocol reuses one process and restarts only after an aborted child exits", async () => {
  const program = `let buffer=Buffer.alloc(0),count=0;process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const n=buffer.readUInt32BE();if(buffer.length<4+n)return;const text=buffer.subarray(4,4+n).toString();buffer=buffer.subarray(4+n);if(text==='hang')continue;process.stdout.write(JSON.stringify({count:++count,pid:process.pid})+'\\n');}});`;
  const native = new AcquisitionNativeStream(process.execPath, ["-e", program]);
  try {
    const first = (await native.request(
      Buffer.from("one"),
      AbortSignal.timeout(5000),
    )) as any;
    const second = (await native.request(
      Buffer.from("two"),
      AbortSignal.timeout(5000),
    )) as any;
    assert.equal(second.pid, first.pid);
    assert.equal(second.count, 2);
    await assert.rejects(
      native.request(Buffer.from("hang"), AbortSignal.timeout(100)),
      /stopped/,
    );
    const restarted = (await native.request(
      Buffer.from("three"),
      AbortSignal.timeout(5000),
    )) as any;
    assert.notEqual(restarted.pid, first.pid);
    assert.equal(restarted.count, 1);
    await native.shutdown();
    const next = (await native.request(Buffer.from("four"), AbortSignal.timeout(5000))) as any;
    assert.notEqual(next.pid, restarted.pid, "generation retirement waits before reopening");
    assert.equal(next.count, 1);
  } finally {
    native.close();
  }
});

test("native protocol is bounded and waits for abort to terminate the child", async () => {
  const ok = await runAcquisitionNativeProcess(
    process.execPath,
    [
      "-e",
      "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true})))",
    ],
    Buffer.from("private"),
    AbortSignal.timeout(5000),
  );
  assert.deepEqual(ok, { ok: true });
  await assert.rejects(
    runAcquisitionNativeProcess(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      Buffer.alloc(0),
      AbortSignal.timeout(100),
    ),
    /failed/,
  );
  await assert.rejects(
    runAcquisitionNativeProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)",
      ],
      Buffer.alloc(0),
      AbortSignal.timeout(5000),
    ),
    /failed/,
  );
  await assert.rejects(
    runAcquisitionNativeProcess(
      process.execPath,
      ["-e", "console.log('not json')"],
      Buffer.alloc(0),
      AbortSignal.timeout(5000),
    ),
    /invalid/,
  );
});

test("native stream delivers bounded coalesced progress and waits for an aborted child before reuse", async () => {
  const program=`const send=v=>process.stdout.write(JSON.stringify(v)+String.fromCharCode(10));let b=Buffer.alloc(0);process.stdin.on('data',chunk=>{b=Buffer.concat([b,chunk]);while(b.length>=4){const n=b.readUInt32BE();if(b.length<4+n)return;const mode=b.subarray(4,4+n).toString();b=b.subarray(4+n);for(let i=0;i<(mode==='five'?5:1);i++)send({progress:true,index:i});if(mode!=='hang')send({done:true});}});`;
  const native=new AcquisitionNativeStream(process.execPath,["-e",program]);
  try{
    const seen:unknown[]=[];
    assert.deepEqual(await native.request(Buffer.from("one"),AbortSignal.timeout(5000),value=>seen.push(value)),{done:true});
    assert.deepEqual(seen,[{progress:true,index:0}]);
    await assert.rejects(native.request(Buffer.from("five"),AbortSignal.timeout(5000),()=>{}),/stopped/);
    const controller=new AbortController();
    await assert.rejects(native.request(Buffer.from("hang"),AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),()=>controller.abort()),/stopped/);
    assert.deepEqual(await native.request(Buffer.from("one"),AbortSignal.timeout(5000),()=>{}),{done:true});
    await assert.rejects(native.request(Buffer.from("one"),AbortSignal.timeout(5000)),/stopped/);
  }finally{await native.shutdown();}
});

for (const delay of [0, 120]) test(`native progress respects the aggregate output limit across acknowledged frames (${delay}ms consumer delay)`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "mtg-native-progress-handshake-"));
  const acknowledgement = join(directory, "accepted");
  // Linux root workers drop the child to nobody. Only this synthetic marker
  // needs to be readable; do not change native identity or app permissions.
  chmodSync(directory, 0o755);
  writeFileSync(acknowledgement, "0", { mode: 0o644 });
  chmodSync(acknowledgement, 0o644);
  const program = `const fs=require('fs'),ack=process.argv[1];
    const frame=index=>JSON.stringify({progress:true,index,text:'x'.repeat(23000)})+String.fromCharCode(10);
    const accepted=(count,next)=>{
      let value='';try{value=fs.readFileSync(ack,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(value===String(count))next();else setTimeout(()=>accepted(count,next),5);
    };
    process.stdin.once('data',()=>{
      const first=frame(0);
      process.stdout.write(first.slice(0,10),()=>process.stdout.write(first.slice(10)));
      accepted(1,()=>{
        process.stdout.write(frame(1));
        accepted(2,()=>process.stdout.write(frame(2)+JSON.stringify({done:true})+String.fromCharCode(10)));
      });
    });`;
  const failures: NativeFailure[] = [];
  const native = new AcquisitionNativeStream(process.execPath, ["-e", program, acknowledgement], undefined,
    failure => failures.push(failure));
  const seen: Array<{ index: number; text: string }> = [];
  try {
    await assert.rejects(native.request(Buffer.from("photo"), AbortSignal.timeout(5000), value => {
      seen.push(value as { index: number; text: string });
      // A blocked consumer must not let a timer release unacknowledged frames.
      if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      writeFileSync(acknowledgement, String(seen.length));
    }), error => {
      assert.equal(acquisitionNativeFailure(error)?.reason, "OUTPUT_LIMIT");
      return true;
    });
    assert.deepEqual(seen.map(value => value.index), [0, 1], "two frames parse before the aggregate third-frame rejection");
    assert.ok(seen.every(value => value.text.length === 23000));
    assert.equal(failures.length, 1, "failure is observed when the native child closes");
    assert.equal(failures[0].reason, "OUTPUT_LIMIT");
  } finally {
    try { await native.shutdown(); }
    finally { rmSync(acknowledgement, { force: true }); rmdirSync(directory); }
  }
});
