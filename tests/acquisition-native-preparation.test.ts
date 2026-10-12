import test from "node:test";
import assert from "node:assert/strict";
import {AcquisitionNativeStream} from "../lib/acquisition-native-stream";
import {acquisitionNativeFailure} from "../lib/acquisition-native-failure";

const descriptor="a".repeat(64);
const provider=(ack:string)=>`let b=Buffer.alloc(0),prepares=0,photos=0;const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');process.stdin.on('data',c=>{b=Buffer.concat([b,c]);while(b.length>=4){const n=b.readUInt32BE();if(b.length<4+n)return;const text=b.subarray(4,4+n).toString();b=b.subarray(4+n);if(n===0){prepares++;${ack};continue;}if(text==='hang')continue;send({pid:process.pid,prepares,photos:++photos});}});`;
const stream=(program:string)=>new AcquisitionNativeStream(process.execPath,["-e",program,"--","--prepare"]);

test("prepared stream binds model identity before photo input and repeats preparation after abort",async()=>{
 const native=stream(provider(`send({prepared:true,descriptor:'${descriptor}'})`));
 try{
  await assert.rejects(native.request(Buffer.from("private photo"),AbortSignal.timeout(5000)),/not prepared/);
  await native.prepare(descriptor,AbortSignal.timeout(5000));
  await native.prepare(descriptor,AbortSignal.timeout(5000));
  const first:any=await native.request(Buffer.from("one"),AbortSignal.timeout(5000));
  assert.equal(first.prepares,1);assert.equal(first.photos,1);
  const second:any=await native.request(Buffer.from("two"),AbortSignal.timeout(5000));
  assert.equal(second.pid,first.pid);assert.equal(second.prepares,1);assert.equal(second.photos,2);
  await assert.rejects(native.request(Buffer.from("hang"),AbortSignal.timeout(100)),/stopped/);
  await assert.rejects(native.request(Buffer.from("three"),AbortSignal.timeout(5000)),/not prepared/);
  await native.prepare(descriptor,AbortSignal.timeout(5000));
  const third:any=await native.request(Buffer.from("three"),AbortSignal.timeout(5000));
  assert.notEqual(third.pid,first.pid);assert.equal(third.prepares,1);assert.equal(third.photos,1);
 }finally{await native.shutdown();}
});

for(const [name,ack,reason] of [
 ["wrong model",`send({prepared:true,descriptor:'${"b".repeat(64)}'})`,"PROTOCOL"],
 ["extra evidence",`send({prepared:true,descriptor:'${descriptor}',photoDigest:'invented'})`,"PROTOCOL"],
 ["progress",`send({progress:true,descriptor:'${descriptor}'})`,"PROTOCOL"],
 ["malformed JSON",`process.stdout.write('invalid\\n')`,"INVALID_JSON"],
 ["oversized reply",`process.stdout.write('x'.repeat(70000))`,"OUTPUT_LIMIT"],
] as const)test(`native preparation rejects ${name} before admitting photos`,async()=>{
 const native=stream(provider(ack));
 try{
  await assert.rejects(native.prepare(descriptor,AbortSignal.timeout(5000)),error=>{assert.equal(acquisitionNativeFailure(error)?.reason,reason);return true;});
  await assert.rejects(native.request(Buffer.from("private photo"),AbortSignal.timeout(5000)),/not prepared/);
 }finally{await native.shutdown();}
});

test("preparation timeout settles on child exit without admitting photos",async()=>{
 const native=stream(provider(""));
 try{
  await assert.rejects(native.prepare(descriptor,AbortSignal.timeout(100)),error=>{assert.equal(acquisitionNativeFailure(error)?.reason,"TIMEOUT");return true;});
  await assert.rejects(native.request(Buffer.from("private photo"),AbortSignal.timeout(5000)),/not prepared/);
  await native.shutdown();
 }finally{await native.shutdown();}
});

test("changed expected model retires the prepared process and verifies fresh identity",async()=>{
 const native=stream(provider(`send({prepared:true,descriptor:'${descriptor}'})`));
 try{
  await native.prepare(descriptor,AbortSignal.timeout(5000));
  const first:any=await native.request(Buffer.from("one"),AbortSignal.timeout(5000));
  await assert.rejects(native.prepare("b".repeat(64),AbortSignal.timeout(5000)),error=>{
   assert.equal(acquisitionNativeFailure(error)?.reason,"PROTOCOL");return true;
  });
  await assert.rejects(native.request(Buffer.from("two"),AbortSignal.timeout(5000)),/not prepared/);
  await native.prepare(descriptor,AbortSignal.timeout(5000));
  const second:any=await native.request(Buffer.from("two"),AbortSignal.timeout(5000));
  assert.notEqual(first.pid,second.pid);assert.equal(second.prepares,1);assert.equal(second.photos,1);
 }finally{await native.shutdown();}
});

test("preparation requires explicit opt-in and a valid model identity",async()=>{
 const legacy=new AcquisitionNativeStream(process.execPath,["-e","process.stdin.resume()"]);
 const opted=stream(provider(""));
 try{
  await assert.rejects(legacy.prepare(descriptor,AbortSignal.timeout(5000)),/preparation invalid/);
  await assert.rejects(opted.prepare("invalid",AbortSignal.timeout(5000)),/preparation invalid/);
 }finally{await legacy.shutdown();await opted.shutdown();}
});
