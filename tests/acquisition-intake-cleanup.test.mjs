import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fixtures = [
  ['acquisition-photo-intake.spec.ts', ['early-feedback','browser-close','acquisition-teardown','late-feedback']],
  ['acquisition-upload-recovery.spec.ts', ['early-feedback','release-upload','unroute','acquisition-teardown','late-feedback']],
  ['acquisition-library-batch.spec.ts', ['early-feedback','release-upload','context-close','acquisition-teardown','late-feedback']],
  ['acquisition-successive-batches.spec.ts', ['early-feedback','cancel-owned','lease-drain','acquisition-teardown','late-feedback']],
];
for (const [file, normal] of fixtures) {
  const source=fs.readFileSync(new URL('./ui/'+file,import.meta.url),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let block;
  function visit(node) { if(ts.isTryStatement(node)&&node.finallyBlock?.getText(tree).includes('Block new authenticated polling'))block=node.finallyBlock;ts.forEachChild(node,visit); }
  visit(tree);assert.ok(block,'Exercise the actual fixture finally block');
  const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  async function exercise(faults=[]) {
    const calls=[],failures=[];let sweep=0;
    const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
    const context={tag:'ui-intake-00000000-0000-0000-0000-000000000000',AggregateError,
      cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',
      database:body=> { if(body.startsWith('owned-feedback:'))return step(++sweep===1?'early-feedback':'late-feedback');if(body.startsWith('await p.acquisitionSession.updateMany'))return step('cancel-owned');return step('acquisition-teardown'); },
      browser:{close:async()=>step('browser-close')},context:{close:async()=>step('context-close')},
      release:()=>step('release-upload'),page:{unrouteAll:async()=>step('unroute')},
      expect:{poll:()=>({toBe:async value=>{assert.equal(value,0);step('lease-drain');}})},
    };
    let error;try { await vm.runInNewContext('(async()=>'+code+')()',context); } catch(caught) {error=caught;}
    return {calls,failures,error};
  }
  for(const fault of normal) test(`${file}: retains ${fault} and attempts later safe cleanup`,async()=>{
    const result=await exercise([fault]);
    const expected=normal.filter(name=>!(file.includes('successive')&&((fault==='cancel-owned'&&['lease-drain','acquisition-teardown'].includes(name))||(fault==='lease-drain'&&name==='acquisition-teardown'))));
    assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors,result.failures);
  });
  test(`${file}: preserves multiple failures`,async()=>{
    const result=await exercise(normal);assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors,result.failures);
    assert.equal(result.calls.at(-1),'late-feedback');
    if(file.includes('successive'))assert.ok(!result.calls.includes('acquisition-teardown'),'No deletion after failed cancellation');
  });
  test(`${file}: completes normal cleanup`,async()=>{
    const result=await exercise();assert.deepEqual(result.calls,normal);assert.equal(result.error,undefined);
  });
}
