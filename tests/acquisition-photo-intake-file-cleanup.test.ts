import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
const owner="ui-acquisition-44444444-4444-4444-8444-444444444444";
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const source=ts.createSourceFile("fixture",readFileSync("tests/ui/acquisition-photo-intake.spec.ts","utf8"),ts.ScriptTarget.Latest,true),expressions:string[]=[];
function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==="database"&&node.arguments[0]?.getText(source).includes("fs.unlink"))expressions.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);}visit(source);assert.equal(expressions.length,1);
const script=new Function("tag","return "+expressions[0])(owner),execute=new (Object.getPrototypeOf(async function(){}).constructor)("p","require","process",script);
const files=ids.flatMap(id=>["original","preview.jpg"].map(s=>path.join("acquisition-v1",id+"."+s)));
function fixture(options:{errors?:Record<string,unknown>;ids?:string[];root?:string;selectionError?:Error}={}){
 const root=options.root??path.resolve("synthetic-owned-uploads"),attempts:string[]=[],deletes:string[]=[],events:string[]=[];
 const p=new Proxy({},{get(_target,model:string){return {findMany:async(query:unknown)=>{
  if(model==="acquisitionSession"){assert.deepEqual(query,{where:{ownerPlayerId:owner},select:{id:true}});return [{id:"session"}];}
  if(model==="acquisitionRun"){assert.deepEqual(query,{where:{sessionId:{in:["session"]}},select:{id:true}});return [{id:"run"}];}
  assert.equal(model,"acquisitionPhoto");assert.deepEqual(query,{where:{runId:{in:["run"]}},select:{id:true},orderBy:{id:"asc"}});if(options.selectionError)throw options.selectionError;return (options.ids??ids).map(id=>({id}));
 },deleteMany:async()=>{deletes.push(model);events.push("delete:"+model);}};}});
 const modules=(name:string)=>{if(name==="path")return path;assert.equal(name,"fs/promises");return {unlink:async(file:string)=>{const relative=path.relative(root,file);attempts.push(relative);events.push("file:"+relative);if(options.errors&&Object.hasOwn(options.errors,relative))throw options.errors[relative];}};};
 return {attempts,deletes,events,run:()=>execute(p,modules,{env:{UPLOADS_DATA_PATH:root}})};
}
test("photo intake attempts every path and keeps relational rows after a first file failure",async()=>{
 const error=Error("first unlink"),f=fixture({errors:{[files[0]]:error}});await assert.rejects(f.run(),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[error])===undefined);assert.deepEqual(f.attempts,files);assert.deepEqual(f.deletes,[]);
});
test("photo intake retains multiple and falsy file causes in stable path order",async()=>{
 for(const first of [Error("first"),undefined,null,false,0,""]){const last=Error("last"),f=fixture({errors:{[files[0]]:first,[files[3]]:last}});await assert.rejects(f.run(),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[first,last])===undefined);assert.deepEqual(f.attempts,files);assert.deepEqual(f.deletes,[]);}
});
test("photo intake healthy and ENOENT replay remove all files before the original relational tail",async()=>{
 for(const errors of [undefined,Object.fromEntries(files.map(file=>[file,Object.assign(Error("gone"),{code:"ENOENT"})]))]){const f=fixture({errors});await f.run();assert.deepEqual(f.attempts,files);assert.equal(f.events.findIndex(e=>e.startsWith("delete:")),4);assert.equal(f.deletes.length,19);assert.equal(f.deletes[0],"acquisitionCommitMember");assert.equal(f.deletes.at(-1),"player");}
});
for(const options of [{ids:[ids[0],"../peer"]},{root:""},{root:"relative"}])test("photo intake validates every path before unlink or deleting rows "+JSON.stringify(options),async()=>{const f=fixture(options);await assert.rejects(f.run(),/Private fixture root unavailable|Invalid owned photo identity/);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);});
test("photo intake reference selection failure makes no partial file or relational mutation",async()=>{const error=Error("selection failed"),f=fixture({selectionError:error});await assert.rejects(f.run(),(e:unknown)=>e===error);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);});

const verifier=ts.createSourceFile("verifier",readFileSync("scripts/verify-photo-intake-file-cleanup.ts","utf8"),ts.ScriptTarget.Latest,true);let retry:ts.TryStatement|undefined;
function find(node:ts.Node){if(ts.isTryStatement(node)&&node.tryBlock.getText(verifier).includes("Original restoration unverified"))retry=node;ts.forEachChild(node,find);}find(verifier);assert.ok(retry);
const runRetry=new (Object.getPrototypeOf(async function(){}).constructor)("assert","sourceRestored","recoveryPending","execute","script","owner","errors",ts.transpileModule(retry!.getText(verifier),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
test("real verifier never retries relational deletion before verified original restoration",async()=>{for(const [restored,pending]of [[false,false],[false,true],[true,true]]){let calls=0;const errors:unknown[]=[];await runRetry(assert,restored,pending,async()=>{calls++},()=>"owned",owner,errors);assert.equal(calls,0);assert.equal(errors.length,1);}});
test("real verifier cleanup and replay run after verified restoration only",async()=>{let calls=0;const errors:unknown[]=[];await runRetry(assert,true,false,async()=>{calls++},()=>"owned",owner,errors);assert.equal(calls,2);assert.deepEqual(errors,[]);});
