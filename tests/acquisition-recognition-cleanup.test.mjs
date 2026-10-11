import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

for (const file of ['acquisition-printing.spec.ts','acquisition-footer-identifiers.spec.ts','acquisition-scanner-framing.spec.ts']) {
  const source=fs.readFileSync(new URL('./ui/'+file,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let block;
  function visit(node){if(ts.isTryStatement(node)&&node.finallyBlock?.getText(tree).includes('Block new authenticated polling'))block=node.finallyBlock;ts.forEachChild(node,visit);}
  visit(tree);assert.ok(block,'Exercise the actual fixture cleanup');
  const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const expected=file==='acquisition-printing.spec.ts'?['early-feedback','visual-report','printing-report','acquisition-teardown','late-feedback']:['early-feedback','acquisition-teardown','late-feedback'];
  async function exercise(faults=[]) {
    const calls=[],failures=[];let sweep=0;
    const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
    const context={tag:'ui-recognition-00000000-0000-0000-0000-000000000000',AggregateError,
      visualReuseResults:[{}],reuseResults:[{}],cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',
      require:name=>{assert.equal(name,'fs');return {mkdirSync:path=>assert.equal(path,'test-results'),writeFileSync:path=>step(path.endsWith('visual-reuse-application.json')?'visual-report':'printing-report')};},
      database:body=>step(body.startsWith('owned-feedback:')?(++sweep===1?'early-feedback':'late-feedback'):'acquisition-teardown')};
    let error;try{await vm.runInNewContext('(async()=>'+code+')()',context);}catch(caught){error=caught;}
    return {calls,failures,error};
  }
  for(const fault of expected)test(`${file}: later cleanup survives ${fault}`,async()=>{
    const result=await exercise([fault]);assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file}: every cleanup failure remains visible`,async()=>{
    const result=await exercise(expected);assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file}: normal cleanup completes`,async()=>{
    const result=await exercise();assert.deepEqual(result.calls,expected);assert.equal(result.error,undefined);
  });
}
