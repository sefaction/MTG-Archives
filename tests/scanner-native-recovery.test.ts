import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Run the verifier's actual restore and retry blocks. This tests the boundary
// between a failed filesystem recovery and destructive relational retry.
const source=ts.createSourceFile('verifier',readFileSync('scripts/verify-scanner-native-cleanup.ts','utf8'),ts.ScriptTarget.Latest,true);
let restore:ts.TryStatement|undefined,retry:ts.TryStatement|undefined;
function visit(n:ts.Node){if(ts.isTryStatement(n)){
 if(n.tryBlock.getText(source).includes("'No source recovery before actual helper termination'"))restore=n;
 if(n.tryBlock.getText(source).includes("'No retry before actual helper termination'"))retry=n;
}ts.forEachChild(n,visit);}visit(source);assert.ok(restore&&retry);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=new AsyncFunction('child','lstat','held','blocked','assert','path','uploads','rmdir','rename','readFile','originalBytes','recoveryErrors','database','legacy','tag',
 ts.transpileModule('let recoveryPending=true;'+restore!.getText(source)+retry!.getText(source)+';return {recoveryPending};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);

async function recovery(options:{renameError?:Error;wrongBytes?:boolean;liveChild?:boolean}={}){
 const uploads=path.resolve('.local-data','owned-recovery'),blocked=path.join(uploads,'acquisition-v1','11111111-1111-4111-8111-111111111111.original'),held=path.join(uploads,'held-original');
 const original=Buffer.from('exact original'),errors:unknown[]=[],sql:string[]=[],actions:string[]=[];
 let heldExists=true,blockedDirectory=true,blockedFile=false;
 const child={exitCode:options.liveChild?null:0,signalCode:null};
 const stat=async(file:string)=>{actions.push('stat:'+path.basename(file));if(file===held){assert.equal(heldExists,true);return {isDirectory:()=>false};}assert.equal(file,blocked);return {isDirectory:()=>blockedDirectory};};
 const result=await execute(child,stat,held,blocked,assert,path,uploads,async(file:string)=>{assert.equal(file,blocked);actions.push('rmdir');blockedDirectory=false;},
 async(from:string,to:string)=>{assert.equal(from,held);assert.equal(to,blocked);actions.push('restore');if(options.renameError)throw options.renameError;heldExists=false;blockedFile=true;},
 async(file:string)=>{assert.equal(file,blocked);return options.wrongBytes?Buffer.from('wrong source'):original;},original,errors,(query:string)=>sql.push(query),(tag:string)=>'legacy:'+tag,'owned-fixture');
 return {result,errors,sql,actions,heldExists,blockedDirectory,blockedFile};
}

test('failed restore after removing the obstruction retains held bytes and blocks relational retry',async()=>{
 const error=Object.assign(Error('restore denied'),{code:'EPERM'}),r=await recovery({renameError:error});
 assert.deepEqual(r.actions.slice(-2),['rmdir','restore']);assert.equal(r.heldExists,true);assert.equal(r.blockedDirectory,false);
 assert.equal(r.result.recoveryPending,true);assert.deepEqual(r.sql,[]);assert.equal(r.errors[0],error);assert.match(String(r.errors[1]),/retain relational graph/);
});
test('restored bytes failing identity verification cannot authorize relational retry',async()=>{
 const r=await recovery({wrongBytes:true});assert.equal(r.blockedFile,true);assert.equal(r.result.recoveryPending,true);assert.equal(r.errors.length,2);assert.deepEqual(r.sql,[]);
});
test('uncertain child cannot restore files or run relational retry',async()=>{
 const r=await recovery({liveChild:true});assert.deepEqual(r.actions,[]);assert.equal(r.heldExists,true);assert.equal(r.result.recoveryPending,true);assert.deepEqual(r.sql,[]);
});
test('verified source restoration and terminal child permit explicit cleanup and replay',async()=>{
 const r=await recovery();assert.equal(r.heldExists,false);assert.equal(r.blockedFile,true);assert.equal(r.result.recoveryPending,false);assert.deepEqual(r.errors,[]);assert.deepEqual(r.sql,['legacy:owned-fixture','legacy:owned-fixture']);
});
