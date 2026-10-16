
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {cancelAndCleanCorrectionFixture} from "./ui/correction-fixture";
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const tag="ui-scanner-audit-12345678-1234-1234-1234-123456789abc";
const records:{label:string;node:ts.TryStatement;file:ts.SourceFile;steps:string[];run:Function;workflow:Function}[]=[];
for(const name of ["scanner-counted","scanner-photo-storage","scanner-section-series"]){
 const file=ts.createSourceFile(name,readFileSync("tests/ui/"+name+".spec.ts","utf8"),ts.ScriptTarget.Latest,true);let index=0;
 function visit(node:ts.Node){if(ts.isTryStatement(node)&&node.finallyBlock&&node.finallyBlock.getText(file).includes("const cleanupErrors")){
  assert.ok(node.catchClause);const body=node.finallyBlock.getText(file),steps=body.includes("page.unrouteAll")?["early","browser","legacy","late"]:["early","legacy","late"];
  const run=new AsyncFunction("database","cancelAndCleanCorrectionFixture","tag","page","primaryFailed","primaryError",compile("const requests=[];"+body.slice(1,-1)));
  const workflow=new AsyncFunction("database","cancelAndCleanCorrectionFixture","tag","page","injected",compile("const requests=[];let primaryFailed=false;let primaryError;try{throw injected;} "+node.catchClause.getText(file)+" finally "+body));
  records.push({label:name+":"+(index++),node,file,steps,run,workflow});return;}ts.forEachChild(node,visit);}visit(file);
}
assert.equal(records.length,3);
function fixture(failures:Record<string,unknown>={},closed=false){const seen:string[]=[];let sweeps=0;const database=(sql:string)=>{
 const kind=sql.includes("correctionLibraryAccount")?(sweeps++===0?"early":"late"):"legacy";seen.push(kind);assert.ok(sql.includes(JSON.stringify(tag)),"Exact owned identifier is retained");if(kind in failures)throw failures[kind];return "{}";};
 const page={isClosed:()=>closed,unrouteAll:async()=>{seen.push("browser");if("browser" in failures)throw failures.browser;}};return {seen,database,page};}
for(const r of records){
 for(const step of r.steps)test(r.label+" attempts every later action after "+step+" fails",async()=>{const cause=Error("controlled "+step),f=fixture({[step]:cause});await assert.rejects(r.run(f.database,cancelAndCleanCorrectionFixture,tag,f.page,false,undefined),(e:unknown)=>e instanceof AggregateError&&e.errors.length===1&&e.errors[0]===cause);assert.deepEqual(f.seen,r.steps);});
 test(r.label+" healthy actual finally retains existing action order",async()=>{const f=fixture();await r.run(f.database,cancelAndCleanCorrectionFixture,tag,f.page,false,undefined);assert.deepEqual(f.seen,r.steps);});
 test(r.label+" keeps all primary/cleanup causes in order",async()=>{const primary=Error("controlled primary"),causes=Object.fromEntries(r.steps.map(s=>[s,Error("controlled "+s)])),f=fixture(causes);await assert.rejects(r.workflow(f.database,cancelAndCleanCorrectionFixture,tag,f.page,primary),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[primary,...r.steps.map(s=>causes[s])])===undefined);assert.deepEqual(f.seen,r.steps);});
 test(r.label+" preserves original workflow error when cleanup succeeds",async()=>{const primary=Error("controlled primary"),f=fixture();await assert.rejects(r.workflow(f.database,cancelAndCleanCorrectionFixture,tag,f.page,primary),(e:unknown)=>e===primary);assert.deepEqual(f.seen,r.steps);});
 test(r.label+" refuses invalid ownership before every database/browser action",async()=>{const f=fixture();await assert.rejects(r.run(f.database,cancelAndCleanCorrectionFixture,"real-owner",f.page,false,undefined),(e:unknown)=>e instanceof AggregateError&&e.errors.length===1);assert.deepEqual(f.seen,[]);});
 test(r.label+" keeps falsy workflow causes together with cleanup failure",async()=>{for(const primary of [undefined,null,false,0]){const early=Error("controlled early"),f=fixture({early});await assert.rejects(r.workflow(f.database,cancelAndCleanCorrectionFixture,tag,f.page,primary),(e:unknown)=>e instanceof AggregateError&&assert.deepEqual(e.errors,[primary,early])===undefined);assert.deepEqual(f.seen,r.steps);}});
 if(r.steps.includes("browser"))test(r.label+" retains the existing closed-page route-drain exception guard",async()=>{const f=fixture({browser:Error("already closed")},true);await r.run(f.database,cancelAndCleanCorrectionFixture,tag,f.page,false,undefined);assert.deepEqual(f.seen,r.steps);});
}
