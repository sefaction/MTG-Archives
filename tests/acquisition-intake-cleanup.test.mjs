import * as ownedFixtureFiles from "./ui/owned-fixture-files.ts";
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
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const blocks=[];
  function visit(node) { if(ts.isTryStatement(node)&&node.finallyBlock?.getText(tree).includes('Block new authenticated polling'))blocks.push(node);ts.forEachChild(node,visit); }
  visit(tree);assert.equal(blocks.length,1,'Bind exactly the actual workflow try/catch/finally');
  const statement=blocks[0];
  const declaration=statement.parent.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText(tree)==='workflowFailures'));
  // Replace only the browser/native workflow. Execute its real catch/finally
  // with all ownership, cancellation, drain and cleanup decisions intact.
  const code=ts.transpileModule((declaration?declaration.getText(tree):'')+'\ntry { await workflow(); }'+source.slice(statement.tryBlock.end,statement.end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  async function exercise(faults=[],options={}) {
    const calls=[],failures=[];let sweep=0;
    const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
    const primary=Object.hasOwn(options,'primary')?options.primary:new Error('original workflow');
    const context={...ownedFixtureFiles,tag:'ui-intake-00000000-0000-0000-0000-000000000000',AggregateError,
      workflow:async()=>{if(options.workflowFails)throw primary;},
      cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',
      database:body=> { if(body.startsWith('owned-feedback:'))return step(++sweep===1?'early-feedback':'late-feedback');if(body.startsWith('await p.acquisitionSession.updateMany'))return step('cancel-owned');return step('acquisition-teardown'); },
      browser:{close:async()=>step('browser-close')},context:{close:async()=>step('context-close')},
      release:()=>step('release-upload'),page:{unrouteAll:async()=>step('unroute')},
      expect:{poll:()=>({toBe:async value=>{assert.equal(value,0);step('lease-drain');}})},
    };
    let error,threw=false;try { await vm.runInNewContext('(async()=>{'+code+'})()',context); } catch(caught) {threw=true;error=caught;}
    return {calls,failures,error,threw};
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
  for(const fault of normal)test(`${file}: original workflow survives ${fault}`,async()=>{
    const primary=new Error('original assertion');
    const result=await exercise([fault],{workflowFails:true,primary});
    const expected=normal.filter(name=>!(file.includes('successive')&&((fault==='cancel-owned'&&['lease-drain','acquisition-teardown'].includes(name))||(fault==='lease-drain'&&name==='acquisition-teardown'))));
    assert.deepEqual(result.calls,expected);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors,[primary,...result.failures]);
  });
  for(const primary of [undefined,null,false,0,'']){
    test(`${file}: preserves falsy workflow with cleanup failure ${String(primary)}`,async()=>{
      const result=await exercise(['early-feedback','late-feedback'],{workflowFails:true,primary});
      assert.deepEqual(result.calls,normal);
      assert.ok(result.error instanceof AggregateError);
      assert.deepEqual(result.error.errors,[primary,...result.failures]);
    });
    test(`${file}: healthy cleanup rethrows exact falsy workflow ${String(primary)}`,async()=>{
      const result=await exercise([],{workflowFails:true,primary});
      assert.deepEqual(result.calls,normal);assert.equal(result.threw,true);assert.equal(result.error,primary);
    });
  }
  test(`${file}: preserves original error identity with healthy cleanup`,async()=>{
    const primary=new Error('original assertion');const result=await exercise([],{workflowFails:true,primary});
    assert.deepEqual(result.calls,normal);assert.equal(result.threw,true);assert.equal(result.error,primary);
  });
  test(`${file}: original workflow precedes all ordered cleanup errors`,async()=>{
    const primary=new Error('original assertion');const result=await exercise(normal,{workflowFails:true,primary});
    assert.ok(result.error instanceof AggregateError);assert.deepEqual(result.error.errors,[primary,...result.failures]);
    assert.equal(result.calls.at(-1),'late-feedback');
    if(file.includes('successive'))assert.ok(!result.calls.includes('acquisition-teardown'),'No deletion after failed cancellation');
  });
}
