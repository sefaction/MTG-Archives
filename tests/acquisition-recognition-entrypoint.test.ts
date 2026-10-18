import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {recognitionWorkerFailure} from '../lib/acquisition-worker-diagnostics';
import {nativeFailureError} from '../lib/acquisition-native-failure';
const source=fs.readFileSync(new URL('../scripts/acquisition-recognition-worker.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function exercise(fault?:string,options:{refinement?:boolean,shutdown?:string[],continuous?:boolean,native?:boolean,snapshotAgeMs?:number}={}){
 const calls:string[]=[],errors:Record<string,unknown>[]=[],logs:Record<string,unknown>[]=[],handlers:Record<string,()=>void>={};let snapshotCalls=0,preparations=0,ticks=0;
 const injected=options.native?nativeFailureError('Processing native worker stopped','PROTOCOL'):Object.assign(Error('private source query/token/image'),{code:'P1001'});
 const step=(phase:string)=>{calls.push(phase);if(phase===fault||options.shutdown?.includes(phase))throw injected;};
 const model='a'.repeat(64),snapshot={digest:'b'.repeat(64),index:{cards:1}};
 const processState={platform:fault==='PRIVILEGES'?'win32':'linux',getuid:()=>0,on:(name:string,handler:()=>void)=>handlers[name]=handler,env:options.refinement?{ACQUISITION_REFERENCE_REFINEMENT_ENABLED:'1'}:{},argv:options.continuous?[]:['--once'],exitCode:undefined as number|undefined};
 const dependencies:Record<string,unknown>={
  '../lib/acquisition-worker-diagnostics':{recognitionWorkerFailure},'@prisma/client':{PrismaClient:class{$disconnect=async()=>step('SHUTDOWN_DATABASE')}},'node:crypto':{randomUUID:()=> 'fixed-private-worker'},'node:timers/promises':{setTimeout:async()=>{step('IDLE_WAIT');handlers.SIGTERM?.()}},'zod':{z},
  '../lib/acquisition-native-process':{runAcquisitionNativeProcess:async()=>{step('DESCRIBE_MODEL');return {digest:model}}},
  '../lib/acquisition-native-stream':{AcquisitionNativeStream:class{prepare=async()=>{step(preparations++===0?'PREPARE_STARTUP':'PREPARE_LOOP')};close=()=>step('SHUTDOWN_NATIVE')}},
  '../lib/acquisition-native-failure':{observeNativeFailure:()=>()=>{}},
  '../lib/acquisition-recognition-worker':{enqueueReadyRecognition:async()=>step('ADMISSION'),loadAcquisitionRecognitionSnapshot:async(_db:unknown,previous?:unknown)=>{if(snapshotCalls)assert.equal(previous,snapshot);step(snapshotCalls++===0?'LOAD_CATALOG':'REFRESH_CATALOG');return snapshot},recognizeAcquisitionPhoto:async()=>{},RECOGNITION_STAGE:'primary'},
  '../lib/acquisition-jobs':{runAcquisitionJobsOnce:async(_db:unknown,_handlers:unknown,_id:unknown,options:unknown)=>{assert.deepEqual(JSON.parse(JSON.stringify(options)),{timeoutMs:45000,leaseMs:90000});step('PROCESSING');return {claimed:0}}},
  '../lib/acquisition-reference-lineage':{REFERENCE_REFINEMENT_STAGE:'reference'},'../lib/acquisition-reference-jobs':{enqueueReadyReferenceRefinement:async()=>step('REFERENCE_ADMISSION')},'../lib/acquisition-reference-worker':{currentAcquisitionReferenceInput:()=>{},recognizeAcquisitionReferenceRefinement:async()=>{}},'../lib/acquisition-catalog-status':{CATALOG_RESOLVER_VERSION:'fixture'},
 };
 const context=vm.createContext({exports:{},require:(name:string)=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name]},process:processState,Buffer,AbortSignal,Date:{now:()=>ticks++===0?0:(options.snapshotAgeMs??31001)},console:{log:(line:string)=>logs.push(JSON.parse(line)),error:(line:string)=>errors.push(JSON.parse(line))}});
 await vm.runInContext(code,context);return {calls,errors,logs,exitCode:processState.exitCode};
}
for(const [fault,phase] of [['PRIVILEGES','PRIVILEGES'],['DESCRIBE_MODEL','DESCRIBE_MODEL'],['LOAD_CATALOG','LOAD_CATALOG'],['PREPARE_STARTUP','PREPARE_NATIVE'],['PREPARE_LOOP','PREPARE_NATIVE'],['REFRESH_CATALOG','REFRESH_CATALOG'],['ADMISSION','ADMISSION'],['REFERENCE_ADMISSION','REFERENCE_ADMISSION'],['PROCESSING','PROCESSING'],['IDLE_WAIT','IDLE_WAIT']])test('actual OCR entrypoint safely reports '+fault,async()=>{
 const row=await exercise(fault,{refinement:true,continuous:fault==='IDLE_WAIT'});assert.equal(row.exitCode,1);assert.equal(row.errors.length,1);assert.equal(row.errors[0].phase,phase);assert.ok(row.calls.includes('SHUTDOWN_NATIVE'));assert.ok(row.calls.includes('SHUTDOWN_DATABASE'));assert.equal(row.calls.filter(c=>c===fault).length,fault==='PRIVILEGES'?0:1);assert.ok(!JSON.stringify(row.errors).includes('private'));assert.equal(row.errors[0].errorKind,fault==='PRIVILEGES'?'UNKNOWN':'DATABASE');
});
test('actual OCR entrypoint retains trusted native failure and never retries fatal work',async()=>{const row=await exercise('PREPARE_LOOP',{native:true});assert.equal(row.exitCode,1);assert.equal(row.errors[0].errorKind,'NATIVE');assert.equal((row.errors[0].nativeFailure as {reason:string}).reason,'PROTOCOL');assert.equal(row.calls.filter(c=>c==='PREPARE_LOOP').length,1)});
test('both actual shutdown errors are safely reported and database disconnect is still attempted',async()=>{const row=await exercise('ADMISSION',{shutdown:['SHUTDOWN_NATIVE','SHUTDOWN_DATABASE']});assert.equal(row.exitCode,1);assert.deepEqual(row.errors.map(r=>r.phase),['ADMISSION','SHUTDOWN_NATIVE','SHUTDOWN_DATABASE']);assert.ok(!JSON.stringify(row.errors).includes('private'))});
test('normal once and signal shutdown keep exit behavior and queue lease bounds',async()=>{for(const continuous of [false,true]){const row=await exercise(undefined,{continuous});assert.equal(row.exitCode,undefined);assert.equal(row.errors.length,0);assert.deepEqual(row.calls.slice(-2),['SHUTDOWN_NATIVE','SHUTDOWN_DATABASE']);assert.equal(row.logs[0].event,'recognition-ready')}});

for(const refinement of [false,true])for(const age of [29999,30000,30001])test('primary catalog freshness at '+age+'ms; refinement='+refinement,async()=>{
 const row=await exercise(undefined,{refinement,snapshotAgeMs:age});
 assert.equal(row.exitCode,undefined);assert.equal(row.errors.length,0);
 assert.equal(row.calls.filter(c=>c==='REFRESH_CATALOG').length,age>30000?1:0);
 assert.equal(row.calls.includes('REFERENCE_ADMISSION'),refinement,'freshness must not enable optional refinement');
 if(age>30000)assert(row.calls.indexOf('REFRESH_CATALOG')<row.calls.indexOf('ADMISSION'),'refresh precedes new recognition admission');
});
test('disabled-refinement catalog refresh failure stops before admission without hiding its phase',async()=>{
 const row=await exercise('REFRESH_CATALOG',{refinement:false});assert.equal(row.exitCode,1);assert.equal(row.errors[0].phase,'REFRESH_CATALOG');
 assert(!row.calls.includes('ADMISSION'));assert(!row.calls.includes('REFERENCE_ADMISSION'));assert.deepEqual(row.calls.slice(-2),['SHUTDOWN_NATIVE','SHUTDOWN_DATABASE']);
});
