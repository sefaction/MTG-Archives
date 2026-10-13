import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./ui/acquisition-large-batch.spec.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('large.ts',source,ts.ScriptTarget.Latest,true);let block;
function visit(n){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(tree).includes('Block new authenticated polling'))block=n.finallyBlock;ts.forEachChild(n,visit)}visit(tree);
assert.ok(block,'Exercise the actual finally block');
const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
async function exercise(faults=[]){
 const calls=[],failures=[],owners=[0,1,2,3].map(i=>({tag:String(i)}));let sweep=0;const report={};
 const step=name=>{calls.push(name);if(faults.includes(name)){const error=Error(name);failures.push(error);throw error}};
 const context={owners,contexts:owners.map(o=>({close:async()=>step('close-'+o.tag)})),AggregateError,timer:null,report,
 save:()=>step('report'),failedResponses:[],captureBrowserFailures:async()=>step('browser-report'),docker:()=>'',
 database:body=>{if(body.startsWith('feedback:')){const i=sweep++;step((i<4?'early-':'late-')+(i%4));return {}}
  if(body.startsWith('inventory:')){step(body);return 0}if(body.startsWith('fingerprint:'))return {};
  if(body.startsWith('const n=')){step('legacy-'+JSON.parse(body.match(/^const n=(.*?);/)[1]));return {}}
  return {users:0,sessions:0,locations:0,inventory:0}},
 cancelAndCleanCorrectionFixture:n=>'feedback:'+n,cleanupInventoryScalePageBody:n=>'inventory:'+n,inventoryFingerprintBody:()=> 'fingerprint:',
 spooled:['owned/a','owned/b'],spool:'owned',path:{resolve:x=>x,sep:'/'},unlinkSync:f=>step('unlink-'+f),rmdirSync:()=>step('spool'),
 expect:value=>({toEqual:expected=>{step('assert-cleanup');assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(expected)))}}),
 finalizeQualificationReport:(_w,r,q)=>{r.passed=q;step('final-report')},writeReport:()=>{},qualified:true};
 let error;try{await vm.runInNewContext('(async()=>'+code+')()',context)}catch(e){error=e}return {calls,failures,error,report};
}
const essential=[...Array.from({length:4},(_,i)=>'early-'+i),...Array.from({length:4},(_,i)=>'legacy-'+i),...Array.from({length:4},(_,i)=>'close-'+i),'unlink-owned/a','unlink-owned/b','spool',...Array.from({length:4},(_,i)=>'late-'+i),'final-report'];
for(const fault of [...essential,'report','browser-report','inventory:0','assert-cleanup'])test('large actual teardown continues after '+fault,async()=>{
 const result=await exercise([fault]);for(const name of essential)assert.ok(result.calls.includes(name),'missing '+name);
 assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
 if(fault!=='final-report')assert.equal(result.report.passed,false);
});
test('all actual teardown causes survive',async()=>{const result=await exercise(essential);assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);assert.equal(result.failures.length,essential.length);assert.equal(result.report.passed,false)});
test('normal actual four-owner teardown completes before qualification',async()=>{const result=await exercise();assert.equal(result.error,undefined);assert.equal(result.report.passed,true);assert.ok(result.calls.indexOf('late-3')<result.calls.indexOf('final-report'))});

