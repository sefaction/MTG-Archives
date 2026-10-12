import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const [file, report] of [["acquisition-stamp-expectations.spec.ts", false], ["acquisition-stamp-visibility.spec.ts", true]]) {
  const source=fs.readFileSync(new URL("./ui/"+file,import.meta.url),"utf8");
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  let block;
  function visit(node){
    if(ts.isTryStatement(node)&&node.finallyBlock&&/Block new authenticated polling|Browser cleanup unavailable/.test(node.finallyBlock.getText(tree)))block=node.finallyBlock;
    ts.forEachChild(node,visit);
  }
  visit(tree);assert.ok(block,"Exercise the actual fixture cleanup");
  const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const expected=report?["early-feedback","write-report","acquisition-teardown","late-feedback"]:["early-feedback","acquisition-teardown","late-feedback"];
  async function exercise(faults=[]){
    const calls=[],failures=[];let sweep=0;
    const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
    const context={tag:"ui-stamp-00000000-0000-0000-0000-000000000000",console,AggregateError,page:{isClosed:()=>true},process:{env:{MTG_ACQUISITION_STAMP_EDGE_REPORT:"owned-report"}},started:0,evidence:{},writeFileSync:()=>step("write-report"),cleanupCorrectionFixture:"legacy-feedback:",cancelAndCleanCorrectionFixture:()=>"owned-feedback-sweep:",database:body=>{
      if(body.startsWith("owned-feedback-sweep:"))step(++sweep===1?"early-feedback":"late-feedback");
      else{if(body.includes("legacy-feedback:"))step("early-feedback");step("acquisition-teardown");}
    }};
    let error;try{await vm.runInNewContext("(async()=>"+code+")()",context);}catch(caught){error=caught;}
    return{calls,failures,error};
  }
  for(const fault of expected)test(`${file} still attempts later cleanup after ${fault} fails`,async()=>{
    const result=await exercise([fault]);assert.deepEqual(result.calls,expected);assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file} retains every cleanup failure`,async()=>{const result=await exercise(expected);assert.deepEqual(result.calls,expected);assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);});
  test(`${file} completes normal cleanup`,async()=>{const result=await exercise();assert.deepEqual(result.calls,expected);assert.equal(result.error,undefined);});
}
