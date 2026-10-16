import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
for(const file of ['acquisition-quick-finish.spec.ts','acquisition-processing-recovery.spec.ts']){
  const source=fs.readFileSync(new URL('./ui/'+file,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let block;
  function visit(node){if(ts.isTryStatement(node)&&node.finallyBlock?.getText(tree).includes('Block new authenticated polling'))block=node.finallyBlock;ts.forEachChild(node,visit)}visit(tree);
  assert.ok(block,'Exercise the actual finally block, not a copied cleanup implementation');
  const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const expected=['early-feedback','unroute','leave-review','acquisition-teardown','late-feedback'];
  async function exercise(faults=[]){
    const calls=[],failures=[];let sweep=0;const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error}};
    const tag='ui-controlled-review-00000000-0000-0000-0000-000000000000';
    const context={tag,AggregateError,printings:[{id:tag}],cleanupCorrectionFixture:'original-feedback',cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',page:{isClosed:()=>false,unrouteAll:async()=>step('unroute'),goto:async()=>step('leave-review')},database:body=>step(body.startsWith('owned-feedback:')?(++sweep===1?'early-feedback':'late-feedback'):'acquisition-teardown')};
    let error;try{await vm.runInNewContext('(async()=>'+code+')()',context)}catch(e){error=e}return {calls,failures,error};
  }
  for(const fault of expected)test(`${file}: remaining cleanup survives ${fault}`,async()=>{const result=await exercise([fault]);assert.deepEqual(result.calls,expected);assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures)});
  test(`${file}: all causes remain visible`,async()=>{const result=await exercise(expected);assert.deepEqual(result.calls,expected);assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures)});
  test(`${file}: normal cleanup completes`,async()=>{const result=await exercise();assert.deepEqual(result.calls,expected);assert.equal(result.error,undefined)});
}
