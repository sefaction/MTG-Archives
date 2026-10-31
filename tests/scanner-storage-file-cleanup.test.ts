import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const tag="ui-scanner-audit-44444444-4444-4444-8444-444444444444";
const photoIds=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],runId="33333333-3333-4333-8333-333333333333";
const files=[...photoIds.flatMap(id=>[".original",".preview.jpg"].map(s=>path.join("acquisition-v1",id+s))),path.join("scanner-control-v1",runId+".start.json")];
for(const name of ["scanner-counted","scanner-photo-storage","scanner-section-series"]){
 const source=ts.createSourceFile(name,readFileSync("tests/ui/"+name+".spec.ts","utf8"),ts.ScriptTarget.Latest,true);
 const expressions:string[]=[];
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(source)==="database"&&node.arguments[0]?.getText(source).includes(".preview.jpg"))expressions.push(node.arguments[0].getText(source));ts.forEachChild(node,visit);}visit(source);assert.equal(expressions.length,1);
 const script=new Function("tag","return "+expressions[0])(tag),execute=new AsyncFunction("p","require","process",script);
 function fixture(options:{fail?:Record<string,unknown>;photos?:string[];runs?:string[];root?:string;readFailure?:unknown}={}){
  const root=options.root??path.resolve(".local-data","synthetic-scanner-files"),attempts:string[]=[],deletes:string[]=[];
  const p=new Proxy({},{get(_target,model:string){return {
   updateMany:async()=>{},
   findMany:async(query:unknown)=>{
    if(model==="acquisitionPhoto"){assert.deepEqual(query,{where:{run:{session:{createdByUserId:tag}}},select:{id:true},orderBy:{id:"asc"}});return (options.photos??photoIds).map(id=>({id}));}
    assert.equal(model,"scannerRun");assert.deepEqual(query,{where:{agent:{userId:tag}},select:{id:true},orderBy:{id:"asc"}});
    if(Object.hasOwn(options,"readFailure"))throw options.readFailure;
    return (options.runs??[runId]).map(id=>({id}));
   },
   deleteMany:async()=>{deletes.push(model)},
  };}});
  const requireModule=(name:string)=>{if(name==="path")return path;assert.equal(name,"fs/promises");return {unlink:async(file:string)=>{const relative=path.relative(root,file);attempts.push(relative);if(options.fail&&Object.hasOwn(options.fail,relative))throw options.fail[relative];}};};
  return {attempts,deletes,execute:()=>execute(p,requireModule,{env:{UPLOADS_DATA_PATH:root}})};
 }
 test(name+" attempts every independent path after first removal failure and retains graph",async()=>{
  const error=Error("controlled first unlink failure"),f=fixture({fail:{[files[0]]:error}});
  await assert.rejects(f.execute(),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[error])===undefined);
  assert.deepEqual(f.attempts,files);assert.deepEqual(f.deletes,[]);
 });
 test(name+" retains multiple removal causes in path order",async()=>{
  const errors=[Error("first original"),Error("second preview"),Error("start marker")],f=fixture({fail:{[files[0]]:errors[0],[files[3]]:errors[1],[files[4]]:errors[2]}});
  await assert.rejects(f.execute(),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,errors)===undefined);
  assert.deepEqual(f.attempts,files);assert.deepEqual(f.deletes,[]);
 });
 test(name+" healthy and missing-file replay keep successful relational cleanup",async()=>{
  for(const fail of [undefined,Object.fromEntries(files.map(file=>[file,Object.assign(Error("already removed"),{code:"ENOENT"})]))]){
   const f=fixture({fail});await f.execute();assert.deepEqual(f.attempts,files);assert.ok(f.deletes.includes("scannerRun"));assert.ok(f.deletes.includes("acquisitionPhoto"));assert.equal(f.deletes.at(-1),"player");
  }
 });
 test(name+" retains falsy thrown causes while still attempting every file",async()=>{
  for(const error of [undefined,null,false,0,""]){const f=fixture({fail:{[files[0]]:error}});await assert.rejects(f.execute(),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[error])===undefined);assert.deepEqual(f.attempts,files);assert.deepEqual(f.deletes,[]);}
 });
 for(const invalid of [{photos:["../peer"]},{runs:["../peer"]},{root:""},{root:"relative-private-root"}])test(name+" validates all paths before unlink "+JSON.stringify(invalid),async()=>{
  const f=fixture(invalid);await assert.rejects(f.execute(),/Invalid owned fixture identity|Private fixture root unavailable/);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);
 });
 test(name+" refuses partial file mutation when run-reference selection fails",async()=>{
  const error=Error("controlled query failure"),f=fixture({readFailure:error});await assert.rejects(f.execute(),(e:unknown)=>e===error);assert.deepEqual(f.attempts,[]);assert.deepEqual(f.deletes,[]);
 });
}
// Execute the verifier's actual relational-retry guard, including its catch.
const verifier=ts.createSourceFile("verifier",readFileSync("scripts/verify-scanner-storage-file-cleanup.ts","utf8"),ts.ScriptTarget.Latest,true);
let retry:ts.TryStatement|undefined;
function findRetry(node:ts.Node){if(ts.isTryStatement(node)&&node.tryBlock.getText(verifier).includes("Unverified original restoration preserves"))retry=node;ts.forEachChild(node,findRetry);}findRetry(verifier);assert.ok(retry);
const runRetry=new AsyncFunction("assert","sourceRestored","recoveryPending","execute","record","owner","recoveryErrors",ts.transpileModule(retry!.getText(verifier),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
test("verifier refuses relational retry after unverified restoration or pending recovery",async()=>{
 for(const [restored,pending]of [[false,false],[false,true],[true,true]]){let calls=0;const errors:unknown[]=[];await runRetry(assert,restored,pending,async()=>{calls++},{script:()=>"owned script"},tag,errors);assert.equal(calls,0);assert.equal(errors.length,1);}
});
test("verifier retries and replays only after confirmed restoration with no pending recovery",async()=>{
 const scripts:string[]=[],errors:unknown[]=[];await runRetry(assert,true,false,async(script:string)=>{scripts.push(script)},{script:(owner:string)=>"owned "+owner},tag,errors);assert.deepEqual(scripts,["owned "+tag,"owned "+tag]);assert.deepEqual(errors,[]);
});