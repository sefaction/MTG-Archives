
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {Prisma} from "@prisma/client";
import {printingWorkerFailure} from "../lib/acquisition-printing-stop-diagnostics";
import {nativeFailureError} from "../lib/acquisition-native-failure";

const secret="private-image-query-auth-data";
const source=readFileSync("scripts/acquisition-printing-worker.ts","utf8");
const code=ts.transpileModule(source.replace("main().catch(reportFailure)","globalThis.completion = main().catch(reportFailure)"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
type Options={fail?:string;error?:unknown;once?:boolean;privileged?:boolean;unavailable?:boolean;cleanupFailures?:boolean};
async function run(options:Options={}) {
 const events:string[]=[],logs:string[]=[],calls:any[]=[];let tick=0;
 const error=options.error ?? new Prisma.PrismaClientKnownRequestError(secret,{code:"P2028",clientVersion:secret,meta:{query:secret}});
 const check=(phase:string)=>{events.push(phase);if(options.fail===phase)throw error;};
 const processMock={platform:options.privileged===false ? "win32":"linux",getuid:()=>0,argv:options.once===false ? []:["--once"],exitCode:undefined,on:()=>{}};
 const modules:Record<string,unknown>={
  "@prisma/client":{PrismaClient:class{async $disconnect(){events.push("disconnect");if(options.cleanupFailures || options.fail==="SHUTDOWN_DATABASE")throw error;}}},
  "node:crypto":{randomUUID:()=>"owned-test"},"node:perf_hooks":{performance:{now:()=>tick+=10}},
  "node:timers/promises":{setTimeout:async(ms:number)=>{calls.push({wait:ms});check(options.unavailable?"WAIT_GENERATION":"IDLE_WAIT");}},
  "zod":{z:{object:()=>({parse:(v:unknown)=>v}),string:()=>({regex:()=>({})})}},
  "../lib/acquisition-native-process":{runAcquisitionNativeProcess:()=>{throw Error("unused native describe")}},
  "../lib/acquisition-native-stream":{AcquisitionNativeStream:class{}},
  "../lib/acquisition-native-generation":{AcquisitionNativeGeneration:class{
   current=options.unavailable?null:{descriptor:{digest:"a".repeat(64)},native:{request:async()=>({})}};
   async refresh(){check("REFRESH_GENERATION");}
   async shutdown(){events.push("shutdown");if(options.cleanupFailures || options.fail==="SHUTDOWN_NATIVE")throw error;}
  }},
  "../lib/acquisition-native-failure":{observeNativeFailure:()=>()=>{}},
  "../lib/acquisition-printing":{PRINTING_STAGE:"PRINTING"},
  "../lib/acquisition-printing-worker":{enqueueReadyPrinting:async(_db:unknown,digest:string)=>{calls.push({digest});check("ADMISSION");},observeAcquisitionPrinting:async()=>({printingExecution:{reused:true}})},
  "../lib/acquisition-jobs":{runAcquisitionJobsOnce:async(_db:unknown,handlers:any,workerId:string,policy:unknown)=>{calls.push({workerId,policy,handlerNames:Object.keys(handlers)});check("PROCESSING");await handlers.PRINTING({},new AbortController().signal);return {claimed:0};}},
  "../lib/acquisition-printing-stop-diagnostics":{printingWorkerFailure},
 };
 const context=vm.createContext({require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},exports:{},process:processMock,Buffer,AbortSignal,AbortController,console:{log:(s:string)=>logs.push(s),error:(s:string)=>logs.push(s)}});
 vm.runInContext(code,context);await context.completion;
 assert.ok(!logs.some(line=>line.includes(secret)));
 return {events,logs:logs.map(line=>JSON.parse(line)),calls,exitCode:processMock.exitCode};
}
for(const phase of ["REFRESH_GENERATION","ADMISSION","PROCESSING","IDLE_WAIT"]){
 test("actual printing entrypoint records "+phase+" and completes teardown",async()=>{
  const result=await run({fail:phase,once:phase!=="IDLE_WAIT"});assert.equal(result.exitCode,1);assert.equal(result.logs.length,1);
  assert.equal(result.logs[0].phase,phase);assert.equal(result.logs[0].errorCode,"P2028");assert.equal(result.logs[0].errorKind,"DATABASE");
  assert.ok(result.logs[0].elapsedMs>=result.logs[0].phaseElapsedMs);assert.deepEqual(result.events.slice(-2),["shutdown","disconnect"]);
 });
}
test("privilege refusal and once-unavailable retain fatal behavior with private fixed phases",async()=>{
 for(const [options,phase] of [[{privileged:false},"PRIVILEGES"],[{unavailable:true},"WAIT_GENERATION"]] as const){const result=await run(options);assert.equal(result.exitCode,1);assert.equal(result.logs[0].phase,phase);assert.deepEqual(result.events.slice(-2),["shutdown","disconnect"]);}
});
test("continuous unavailable generation keeps its existing one-second fallback",async()=>{
 const result=await run({unavailable:true,once:false,fail:"WAIT_GENERATION"});assert.equal(result.logs[0].phase,"WAIT_GENERATION");assert.deepEqual(result.calls,[{wait:1000}]);
});
test("normal once preserves admission, handlers, job policy and quiet successful shutdown",async()=>{
 const result=await run();assert.equal(result.exitCode,undefined);assert.deepEqual(result.logs,[]);assert.deepEqual(result.events,["REFRESH_GENERATION","ADMISSION","PROCESSING","shutdown","disconnect"]);
 assert.deepEqual(JSON.parse(JSON.stringify(result.calls)),[{digest:"a".repeat(64)},{workerId:"printing-owned-test",policy:{timeoutMs:120000,leaseMs:180000},handlerNames:["PRINTING"]}]);
});
for(const phase of ["SHUTDOWN_NATIVE","SHUTDOWN_DATABASE"]){test("actual teardown records "+phase+" without an unhandled private exception",async()=>{
 const result=await run({fail:phase});assert.equal(result.exitCode,1);assert.equal(result.logs[0].phase,phase);assert.deepEqual(result.events.slice(-2),["shutdown","disconnect"]);
});}
test("main plus both shutdown failures keep all public causes and attempt database teardown",async()=>{
 const result=await run({fail:"ADMISSION",cleanupFailures:true});assert.equal(result.exitCode,1);assert.deepEqual(result.logs.map(row=>row.phase),["ADMISSION","SHUTDOWN_NATIVE","SHUTDOWN_DATABASE"]);assert.equal(result.events.at(-1),"disconnect");
});
test("actual fatal boundary retains only trusted native termination detail",async()=>{
 const error=nativeFailureError("Processing native worker stopped","EXIT",137,"SIGKILL","ENOMEM");const result=await run({fail:"PROCESSING",error});assert.equal(result.logs[0].errorKind,"NATIVE");assert.deepEqual(result.logs[0].nativeFailure,{reason:"EXIT",exitCode:137,signal:"SIGKILL",systemCode:"ENOMEM"});
});
test("privacy projection bounds phase/timing/classification and ignores forged native evidence",()=>{
 for(const error of [null,secret,{name:secret,code:secret,stack:secret,cause:secret,nativeFailure:{exitCode:137}},new Proxy({},{get(){throw Error(secret)}})]){
  const row=printingWorkerFailure(secret as never,error,Infinity,-1);assert.equal(row.phase,"UNKNOWN");assert.equal(row.elapsedMs,null);assert.equal(row.phaseElapsedMs,null);assert.equal(row.nativeFailure,null);assert.ok(!JSON.stringify(row).includes(secret));
 }
 assert.equal(printingWorkerFailure("ADMISSION",{name:"PrismaClientUnknownRequestError"},1,1).errorKind,"DATABASE");
 assert.equal(printingWorkerFailure("PROCESSING",new TypeError(secret),1.2,0.4).errorKind,"PROGRAMMING");
 assert.equal(printingWorkerFailure("IDLE_WAIT",{name:"TimeoutError"},1,1).errorKind,"TIMEOUT");
});
