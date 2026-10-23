import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {cancelAndCleanCorrectionFixture} from './ui/correction-fixture';

const source=ts.createSourceFile('native',readFileSync('tests/ui/scanner-native.spec.ts','utf8'),ts.ScriptTarget.Latest,true);
let target:ts.TryStatement|undefined;
function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(source).includes('const cleanupErrors'))target=n;ts.forEachChild(n,visit);}visit(source);assert.ok(target?.catchClause);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const args=['database','cancelAndCleanCorrectionFixture','tag','child','writeFileSync','helper','agentId','log','path','process','rmSync','setTimeout'];
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const block=target!.finallyBlock!.getText(source),run=new AsyncFunction(...args,'primaryFailed','primaryError',compile(block));
const workflow=new AsyncFunction(...args,'injected',compile('let primaryFailed=false;let primaryError;try { throw injected; }'+target!.catchClause!.getText(source)+' finally '+block));
const tag='ui-scanner-native-11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const order=['early','stop','log','forget','spool','legacy','late'];
function fixture(fail:Record<string,unknown>={},alive=false){
 const seen:string[]=[];let sweeps=0;
 const action=(kind:string)=>{seen.push(kind);if(kind in fail)throw fail[kind];};
 const child={exitCode:null as number|null,signalCode:null as string|null,kill(){action('stop');if(!alive)this.exitCode=0;},once(_event:string,callback:()=>void){if(!alive)callback();}};
 const database=(sql:string)=>{assert.ok(sql.includes(JSON.stringify(tag)));action(sql.includes('correctionLibraryAccount')?(sweeps++===0?'early':'late'):'legacy');return '{}';};
 const params=[database,cancelAndCleanCorrectionFixture,tag,child,()=>action('log'),(a:string[])=>{assert.deepEqual(a,['forget',agent]);action('forget');},agent,'private-log',path,{env:{LOCALAPPDATA:path.resolve('.local-data','synthetic-native')}},(p:string,opts:unknown)=>{assert.ok(p.endsWith(agent));assert.deepEqual(opts,{recursive:true,force:true});action('spool');},(callback:()=>void,ms:number)=>{assert.equal(ms,5000);callback();}];
 return {seen,params,child};
}
for(const step of order)test('actual native finally attempts later independent actions after '+step+' failure',async()=>{
 const cause=Error(step),f=fixture({[step]:cause});
 await assert.rejects(run(...f.params,false,undefined),(e:unknown)=>e instanceof AggregateError&&e.errors.length===1&&e.errors[0]===cause);
 const expected=step==='stop'?order.filter(x=>!['forget','spool','legacy'].includes(x)):step==='forget'?order.filter(x=>x!=='spool'):order;
 assert.deepEqual(f.seen,expected);
});
test('actual native finally retains healthy action order',async()=>{const f=fixture();await run(...f.params,false,undefined);assert.deepEqual(f.seen,order);});
test('all original and cleanup causes survive in action order',async()=>{const primary=Error('primary'),causes=Object.fromEntries(['early','log','forget','legacy','late'].map(k=>[k,Error(k)])),f=fixture(causes);await assert.rejects(workflow(...f.params,primary),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[primary,...Object.values(causes)])===undefined);assert.deepEqual(f.seen,['early','stop','log','forget','legacy','late']);});
test('successful cleanup keeps the original workflow failure unchanged',async()=>{const primary=Error('primary'),f=fixture();await assert.rejects(workflow(...f.params,primary),(e:unknown)=>e===primary);});
test('falsy original errors remain first when cleanup fails',async()=>{for(const primary of [undefined,null,false,0,'']){const cause=Error('early'),f=fixture({early:cause});await assert.rejects(workflow(...f.params,primary),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[primary,cause])===undefined);}});
test('invalid owner refuses before every database, helper or filesystem action',async()=>{const f=fixture();f.params[2]='real-owner';await assert.rejects(run(...f.params,false,undefined),AggregateError);assert.deepEqual(f.seen,[]);});
test('unconfirmed helper stop preserves its spool and legacy data while final cancellation still runs',async()=>{const f=fixture({},true);await assert.rejects(run(...f.params,false,undefined),(e:unknown)=>e instanceof AggregateError&&e.errors.length===1&&String(e.errors[0]).includes('retain its spool'));assert.deepEqual(f.seen,['early','stop','log','late']);});
test('invalid agent path refuses before forget or recursive removal',async()=>{const f=fixture();f.params[6]='../peer';await assert.rejects(run(...f.params,false,undefined),AggregateError);assert.deepEqual(f.seen,['early','stop','log','legacy','late']);});
