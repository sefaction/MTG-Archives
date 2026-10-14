import test from "node:test";
import assert from "node:assert/strict";
import {Prisma,type PrismaClient} from "@prisma/client";
import {loadAcquisitionRecognitionSnapshot} from "../lib/acquisition-recognition-snapshot";
import {recognitionSnapshotFailure,recordRecognitionSnapshotFailure,type RecognitionSnapshotFailure} from "../lib/acquisition-recognition-snapshot-diagnostics";
import {recognitionWorkerFailure} from "../lib/acquisition-worker-diagnostics";

const secret = "private-card-cursor-query-auth-data";
const failure = () => new Prisma.PrismaClientKnownRequestError(secret,{code:"P2028",clientVersion:secret,meta:{error:secret}});
const db = (transaction: unknown) => ({$transaction:transaction}) as PrismaClient;
const page = (findMany: unknown) => ({card:{findMany}});
const defaults = {phase:"READ_PAGE",elapsedMs:4,phaseElapsedMs:3,transactionMs:4,completedReadMs:0,maxCompletedReadMs:0,completedHashMs:0,pagesRead:0,rowsRead:0,callbackEntered:true,transactionCompleted:false} as const;

test("failed transaction admission keeps the exact error and has no entered transaction",async()=>{
 const error=failure();
 await assert.rejects(loadAcquisitionRecognitionSnapshot(db(async()=>{throw error})), e=>e===error);
 const report=recognitionSnapshotFailure(error)!;
 assert.equal(report.phase,"BEGIN_TRANSACTION");assert.equal(report.callbackEntered,false);assert.equal(report.transactionMs,null);
 assert.equal(report.pagesRead,0);assert.equal(report.transactionTimeoutMs,60000);assert.equal(report.maxWaitMs,10000);
});

test("actual failing page retains public P2028, phase and counts without private data",async()=>{
 const error=failure();
 await assert.rejects(loadAcquisitionRecognitionSnapshot(db(async(work:any,options:any)=>{
  assert.deepEqual(options,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:60000});
  return work(page(async(args:any)=>{assert.equal(args.take,512);throw error}));
 })),e=>e===error);
 const report=recognitionSnapshotFailure(error)!;assert.equal(report.phase,"READ_PAGE");assert.equal(report.pagesRead,0);assert.equal(report.rowsRead,0);
 const stop=recognitionWorkerFailure("REFRESH_CATALOG",error);
 assert.equal(stop.errorCode,"P2028");assert.deepEqual(stop.catalogSnapshotFailure,report);
 assert.ok(!JSON.stringify(stop).includes(secret));
});

test("commit failure is distinguished from page failure without replacing its cause",async()=>{
 const error=failure();
 await assert.rejects(loadAcquisitionRecognitionSnapshot(db(async(work:any)=>{await work(page(async()=>[]));throw error})),e=>e===error);
 const report=recognitionSnapshotFailure(error)!;assert.equal(report.phase,"COMMIT_TRANSACTION");assert.equal(report.pagesRead,1);assert.equal(report.rowsRead,0);
 assert.equal(report.transactionCompleted,false);
});

test("row hashing failure records completed read counts and preserves error identity",async()=>{
 const error=new Error(secret), face=Object.defineProperty({},"name",{get(){throw error}});
 await assert.rejects(loadAcquisitionRecognitionSnapshot(db(async(work:any)=>work(page(async()=>[{cardFaces:[face]}])))),e=>e===error);
 const report=recognitionSnapshotFailure(error)!;assert.equal(report.phase,"HASH_ROWS");assert.equal(report.pagesRead,1);assert.equal(report.rowsRead,1);
 assert.equal(report.transactionCompleted,false);assert.ok(!JSON.stringify(report).includes(secret));
});

test("index failure is outside the completed transaction",async()=>{
 let caught:unknown;
 try{await loadAcquisitionRecognitionSnapshot(db(async(work:any)=>work(page(async()=>[{id:"owned",scryfallId:"owned",name:123,printedName:null,cardFaces:[],setCode:"tst",collectorNumber:"1",lang:"en",digital:false}]))));}catch(error){caught=error}
 assert.ok(caught instanceof TypeError);
 const report=recognitionSnapshotFailure(caught)!;assert.equal(report.phase,"BUILD_INDEX");assert.equal(report.transactionCompleted,true);assert.equal(report.rowsRead,1);
});

test("unchanged snapshots keep the same immutable index/maps and original digest",async()=>{
 const empty=db(async(work:any)=>work(page(async()=>[])));
 const first=await loadAcquisitionRecognitionSnapshot(empty);
 const second=await loadAcquisitionRecognitionSnapshot(empty,first);
 assert.equal(second,first);assert.equal(second.index,first.index);assert.equal(second.byScryfallId,first.byScryfallId);
 assert.equal(first.digest,"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
});

test("forged/serialized diagnostic shapes are untrusted and cannot enter stop records",()=>{
 for(const error of [{...defaults,catalogSnapshotFailure:defaults},JSON.parse(JSON.stringify({...defaults})),null,undefined,secret]){
  assert.equal(recognitionSnapshotFailure(error),undefined);assert.ok(!("catalogSnapshotFailure" in recognitionWorkerFailure("REFRESH_CATALOG",error)));
 }
 const hostile=new Proxy({},{get(){throw Error(secret)}});assert.equal(recognitionSnapshotFailure(hostile),undefined);
});

test("locally recorded values are frozen, bounded and project only fixed public fields",()=>{
 const error=new Error(secret), input={...defaults,phase:secret,elapsedMs:Infinity,phaseElapsedMs:-1,transactionMs:86400001,pagesRead:1000001,rowsRead:NaN,privateData:secret};
 recordRecognitionSnapshotFailure(error,input as unknown as Omit<RecognitionSnapshotFailure,"pageSize"|"maxWaitMs"|"transactionTimeoutMs">);
 const report=recognitionSnapshotFailure(error)!;assert.ok(Object.isFrozen(report));assert.equal(report.phase,"UNKNOWN");
 for(const field of ["elapsedMs","phaseElapsedMs","transactionMs","pagesRead","rowsRead"] as const)assert.equal(report[field],null);
 assert.ok(!JSON.stringify(report).includes(secret));assert.ok(!("privateData" in report));
});

test("hostile diagnostic input cannot mask the original workflow failure",()=>{
 const error=new Error(secret),input=new Proxy({},{get(){throw Error(secret)}});
 assert.doesNotThrow(()=>recordRecognitionSnapshotFailure(error,input as never));assert.equal(recognitionSnapshotFailure(error),undefined);
 for(const cause of [undefined,null,false,0,secret]){assert.doesNotThrow(()=>recordRecognitionSnapshotFailure(cause,defaults));assert.equal(recognitionSnapshotFailure(cause),undefined)}
});
