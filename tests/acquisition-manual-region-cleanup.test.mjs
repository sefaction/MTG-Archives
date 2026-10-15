import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const file='acquisition-manual-region.spec.ts',source=fs.readFileSync(new URL('./ui/'+file,import.meta.url),'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let block;
function visit(n){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(tree).includes('page.unrouteAll')&&n.finallyBlock.getText(tree).includes('p.card.deleteMany'))block=n.finallyBlock;ts.forEachChild(n,visit);}visit(tree);assert.ok(block);
const code=ts.transpileModule(block.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,expected=['unroute','early-feedback','source-inventory-teardown','late-feedback'];
async function exercise(faults=[]){const calls=[],failures=[];let sweep=0;const step=name=>{calls.push(name);if(faults.includes(name)){const error=new Error(name);failures.push(error);throw error;}};
 const context={tag:'ui-manual-region-00000000-0000-0000-0000-000000000000',original:{id:'owned-original'},alternate:{id:'owned-alternate'},AggregateError,page:{unrouteAll:async options=>{assert.deepEqual(JSON.parse(JSON.stringify(options)),{behavior:'wait'});step('unroute');}},cancelAndCleanCorrectionFixture:()=> 'owned-feedback:',database:body=>step(body.startsWith('owned-feedback:')?(++sweep===1?'early-feedback':'late-feedback'):'source-inventory-teardown')};let error;try{await vm.runInNewContext('(async()=>'+code+')()',context);}catch(e){error=e;}return {calls,failures,error};}
for(const fault of expected)test(`Manual-region actual block: later cleanup survives ${fault}`,async()=>{const r=await exercise([fault]);assert.deepEqual(r.calls,expected);assert.ok(r.error instanceof AggregateError);assert.deepEqual(r.error.errors,r.failures);});
test('Manual-region actual block: all cleanup causes are retained',async()=>{const r=await exercise(expected);assert.deepEqual(r.calls,expected);assert.ok(r.error instanceof AggregateError);assert.deepEqual(r.error.errors,r.failures);});
test('Manual-region actual block: normal cleanup completes',async()=>{const r=await exercise();assert.deepEqual(r.calls,expected);assert.equal(r.error,undefined);});
