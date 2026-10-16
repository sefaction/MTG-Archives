import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

for(const file of ['acquisition-photo-text.spec.ts','acquisition-photo-text-streaming.spec.ts']){
  const source=fs.readFileSync(new URL('./ui/'+file,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),blocks=[];
  function visit(node){if(ts.isTryStatement(node)&&node.finallyBlock?.getText(tree).includes('Block new authenticated polling'))blocks.push(node.finallyBlock);ts.forEachChild(node,visit);}
  visit(tree);assert.equal(blocks.length,1);
  const code=ts.transpileModule(blocks[0].getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const expected=file.includes('streaming')?['early-feedback','save-report','acquisition-teardown','late-feedback']:['early-feedback','acquisition-teardown','late-feedback'];
  async function exercise(faults=[]){
    const calls=[],failures=[];let sweep=0;
    const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
    const report={};const context={tag:'ui-photo-cleanup-00000000-0000-0000-0000-000000000000',AggregateError,Date,report,
      save:()=>{assert.ok(report.finishedAt);step('save-report');},cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',
      database:body=>step(body.startsWith('owned-feedback:')?(++sweep===1?'early-feedback':'late-feedback'):'acquisition-teardown')};
    let error;try{await vm.runInNewContext('(async()=>'+code+')()',context);}catch(caught){error=caught;}
    return {calls,failures,error};
  }
  for(const fault of expected)test(`${file}: later cleanup survives ${fault}`,async()=>{
    const result=await exercise([fault]);assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file}: every cleanup cause remains visible`,async()=>{
    const result=await exercise(expected);assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file}: normal cleanup completes`,async()=>{
    const result=await exercise();assert.deepEqual(result.calls,expected);assert.equal(result.error,undefined);
  });
}
