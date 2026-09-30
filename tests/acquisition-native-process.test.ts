import test from "node:test";
import assert from "node:assert/strict";
import { runAcquisitionNativeProcess } from "../lib/acquisition-native-process";
import { AcquisitionNativeStream } from "../lib/acquisition-native-stream";
import { acquisitionNativeEnvironment } from "../lib/acquisition-native-environment";

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

test("native progress respects the aggregate output limit across separately delivered frames", async () => {
  const program = `process.stdin.once('data',()=>{
    const value=JSON.stringify({progress:true,text:'x'.repeat(23000)})+String.fromCharCode(10);
    process.stdout.write(value.slice(0,10));
    setTimeout(()=>process.stdout.write(value.slice(10)),10);
    setTimeout(()=>process.stdout.write(value),40);
    setTimeout(()=>process.stdout.write(value),70);
    setTimeout(()=>process.stdout.write(JSON.stringify({done:true})+String.fromCharCode(10)),100);
  });`;
  const native = new AcquisitionNativeStream(process.execPath, ["-e", program]);
  const seen: unknown[] = [];
  try {
    await assert.rejects(native.request(Buffer.from("photo"), AbortSignal.timeout(5000),
      value => seen.push(value)), /stopped/);
    assert.equal(seen.length, 2, "split frames parse, but the third exceeds the aggregate bound");
  } finally {
    await native.shutdown();
  }
});
