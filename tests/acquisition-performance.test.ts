import {isPairedProfile} from "../lib/paired-scan-profile";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import test from "node:test";
import ts from "typescript";
import {z} from "zod";
import {acquisitionPreviewFrame} from "../lib/acquisition-preview";
import {createVisiblePoller} from "../lib/visible-poller";

function actual(file: string, name: string, context: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.ok(declaration);
  const result: Record<string, any> = {};
  const compiled = ts.transpileModule(declaration.getText(source) + `\nexports.actual=${name};`, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText;
  new Script(compiled).runInNewContext({...context, exports: result});
  return result.actual;
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("preview source frame preserves portrait, landscape, EXIF swaps and resize rounding", () => {
  for (const [width,height,pw,ph,expected] of [
    [1620,2160,1200,1600,{width:1620,height:2160}],
    [2160,1620,1600,1200,{width:2160,height:1620}],
    [2160,1620,1200,1600,{width:1620,height:2160}],
    [80,120,120,80,{width:120,height:80}],
    [2449,3437,1140,1600,{width:2449,height:3437}],
    [120,120,120,120,{width:120,height:120}],
  ] as const) assert.deepEqual(acquisitionPreviewFrame(width,height,pw,ph),expected);
  for (const bad of [0,-1,NaN,Infinity,1.5]) assert.throws(() => acquisitionPreviewFrame(bad,100,80,60));
});

test("slow polling never overlaps; manual refresh after a mutation queues a fresh read", async () => {
  let calls=0, live=0, peak=0;
  const releases: (()=>void)[]=[];
  const poller=createVisiblePoller(async()=>{
    calls++; live++; peak=Math.max(peak,live);
    await new Promise<void>(resolve=>releases.push(resolve)); live--;
  },()=>null);
  try {
    const first=poller.refresh();
    const afterMutation=poller.refresh(); void poller.refresh();
    assert.equal(calls,1);
    releases.shift()!(); await tick();
    assert.equal(calls,2); assert.equal(peak,1);
    releases.shift()!(); await Promise.all([first,afterMutation]);
    assert.equal(calls,2);
  } finally {poller.stop();}
});

test("hidden and unmounted tabs abort work and visibility restores exactly one fresh read", async () => {
  let changed: (()=>void)|undefined, aborted=0,calls=0;
  const visibility={hidden:false,
    addEventListener: (_name:string, callback:any)=>{changed=callback;},
    removeEventListener: ()=>{changed=undefined;}};
  const poller=createVisiblePoller(async signal=>{
    calls++;
    await new Promise<void>(resolve=>signal.addEventListener("abort",()=>{aborted++;resolve();},{once:true}));
  },()=>null,visibility as any);
  const first=poller.refresh();
  visibility.hidden=true; changed!(); await first;
  await poller.refresh(); assert.equal(calls,1); assert.equal(aborted,1);
  visibility.hidden=false; changed!(); assert.equal(calls,2);
  poller.stop(); await tick();
  assert.equal(aborted,2); assert.equal(changed,undefined);
  await poller.refresh(); assert.equal(calls,2);
});

test("ordinary display signing reads an existing immutable key without the upload-owner lock", async () => {
  for (const existing of [true,false]) {
    let reads=0,initializations=0,authorizations=0;
    const display=actual("lib/acquisition-correction-library.ts","correctionDisplayToken",{
      ensureCorrectionAccount:async()=>{initializations++;return {displayKey:"key"};},
      authorizeCorrectionLibrary:async()=>{authorizations++;},
      signCorrectionDisplay:(payload:any,key:string)=>{assert.equal(key,"key");assert.equal(payload.ownerPlayerId,"owner");return "signed";},
      correctionHash:()=>"output-hash",
    });
    const tx={correctionLibraryAccount:{findUnique:async()=>{reads++;return existing?{displayKey:"key"}:null;}}};
    assert.equal(await display(tx,"owner",{userId:"user"},{id:"photo",digest:"digest",generation:1},
      {id:"candidate",revision:2},[],[],"PENDING"),"signed");
    assert.equal(reads,1);assert.equal(initializations,existing?0:1);assert.equal(authorizations,1);
  }
});

test("private preview GET returns the correctly oriented source frame and unchanged original delivery",async()=>{
  for(const preview of [false,true]){
    const reads:any[]=[];
    const get=actual("app/api/acquisition/[sessionId]/photos/[photoId]/route.ts","GET",{
      z,URL,Response,Uint8Array,acquisitionPreviewFrame,
      acquisitionActor:async()=>({userId:"owner"}),
      acquisitionError:(error:Error)=>{throw error;},
      getAcquisitionPhoto:async()=>({id:"photo",runId:"run",width:2160,height:1620,digest:"original",mediaType:"image/png"}),
      prisma:{acquisitionProcessingJob:{findFirst:async(args:any)=>{
        assert.deepEqual(JSON.parse(JSON.stringify(args.select)),{output:true});
        return {output:{previewDigest:"a".repeat(64),width:1200,height:1600}};
      }}},
      readAcquisitionPhotoBytes:async(...args:any[])=>{reads.push(args);return Buffer.from("unchanged");},
    });
    const response=await get({url:`https://example.test/photo${preview?"?preview=1":""}`},
      {params:Promise.resolve({sessionId:"batch",photoId:"photo"})});
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.equal(response.headers.get("content-type"),preview?"image/jpeg":"image/png");
    assert.equal(response.headers.get("x-photo-source-width"),preview?"1620":null);
    assert.equal(response.headers.get("x-photo-source-height"),preview?"2160":null);
    assert.equal(await response.text(),"unchanged");
    assert.deepEqual(reads,[["photo",preview?"preview":"raw",preview?"a".repeat(64):"original"]]);
  }
});

test("scanner image admission is independent of earlier cards and retains replay/sequence fences",async()=>{
  for(const replay of [false,true]) for(const earlierCards of [0,2000,100000]){
    let fullReads=0,writes=0,finalized=0;
    const run={id:"scanner",epoch:"epoch",executionId:"execution",status:"STARTED",sequenceOffset:0,
      acquisitionRun:{sessionId:"batch"},device:{backend:"fixture"},settings:{}};
    const actor={userId:"owner"};
    const slot={id:"slot",position:1};
    const receive=actual("lib/scanner-runs.ts","receiveScannerImage",{
      isPairedProfile,scannerTransferSchema:z.any(),authorizeScannerTransfer:async()=>{},inspectAcquisitionPhoto:async()=>({}),
      scannerTransaction:async(db:any,work:any)=>work(db),agentRun:async()=>({run,actor}),
      readAcquisitionRow:async(_tx:any,_actor:any,_id:any,scope:any)=>{
        if(!scope)fullReads+=earlierCards;
        assert.deepEqual(JSON.parse(JSON.stringify(scope)),{});
        return {id:"batch",phase:"CAPTURING",scanProfile:"STANDARD",run:{id:"acquisition",candidates:[]}};
      },hydrateAcquisitionRow:()=>({destinationCurrent:true}),
      beginAcquisitionPhoto:async()=>({id:"photo",digest:"digest",ready:replay}),
      writeAcquisitionPhotoBytes:async()=>{writes++;},finalizeAcquisitionPhoto:async()=>{finalized++;},
      ScannerRunConflict:Error,denied:()=>new Error("denied"),Prisma:{DbNull:null},
    });
    const db={$queryRaw:async()=>[],acquisitionCaptureSlot:{findUnique:async()=>replay?slot:null,create:async()=>slot},
      acquisitionSession:{update:async()=>{}},scannerRun:{updateMany:async()=>{}}};
    const input={executionId:"execution",artifactId:"artifact",sequence:2,side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
    const result=await receive(db,"auth",input,"epoch",Buffer.from("photo"),"image/png");
    assert.equal(result.ready,true);assert.equal(fullReads,0);assert.equal(writes,replay?0:1);assert.equal(finalized,replay?0:1);
    if(replay)await assert.rejects(receive(db,"auth",{...input,sequence:3},"epoch",Buffer.from("photo"),"image/png"),/sequence identity/);
    run.executionId="changed";
    await assert.rejects(receive(db,"auth",input,"epoch",Buffer.from("photo"),"image/png"),/denied/);
  }
});
