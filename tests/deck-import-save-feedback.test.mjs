import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root=process.env.DECK_IMPORT_SOURCE_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filename=path.join(root,'components/DeckImportPanel.tsx');
const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let declaration;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='preSubmit')declaration=node;ts.forEachChild(node,visit);}
visit(source);assert.ok(declaration,'Complete real preSubmit declaration required');
const code=ts.transpileModule(declaration.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function harness(save=async()=>undefined){
  const state={errors:[],calls:0,prevented:0,form:{linesJson:'reviewed82',mode:'merge'},tasks:[]};
  const context={Error,FormData:class{constructor(form){this.form=form;}},commitPending:{current:false},reviewStale:false,loading:false,resolving:false,summary:{unresolvedIncluded:0},setCommitError:value=>state.errors.push(value),startCommit:callback=>state.tasks.push(callback()),commitDeckImport:async data=>{state.calls++;assert.equal(data.form,state.form);return save();}};
  vm.createContext(context);vm.runInContext(code+'\nglobalThis.submit=preSubmit;',context);
  return {state,context,submit:()=>context.submit({preventDefault:()=>state.prevented++,currentTarget:state.form}),settled:()=>Promise.all(state.tasks)};
}

test('failed save retains review and explains uncertain outcome without exposing server details',async()=>{
  const h=harness(async()=>{throw new Error('PRIVATE database query and credentials');});
  h.submit();await h.settled();
  assert.match(h.state.errors.at(-1),/could not be confirmed/i);
  assert.match(h.state.errors.at(-1),/review is still available/i);
  assert.match(h.state.errors.at(-1),/check the deck before retrying/i);
  assert.doesNotMatch(h.state.errors.at(-1),/PRIVATE|credentials|database query/);
  assert.equal(h.state.form.linesJson,'reviewed82');assert.equal(h.context.commitPending.current,false);
});

test('safe production error reference is retained for investigation',async()=>{
  const error=Object.assign(new Error('private failure'),{digest:'1234567890'});
  const h=harness(async()=>{throw error;});h.submit();await h.settled();
  assert.match(h.state.errors.at(-1),/Reference: 1234567890/);assert.doesNotMatch(h.state.errors.at(-1),/private failure/);
});

test('arbitrary exception metadata is not shown as a reference',async()=>{
  const h=harness(async()=>{throw {digest:'private query text',message:'private server detail'};});h.submit();await h.settled();
  assert.match(h.state.errors.at(-1),/review is still available/i);assert.doesNotMatch(h.state.errors.at(-1),/private|Reference:/);
});

test('ordinary successful save still completes and releases the pending fence',async()=>{
  const h=harness();h.submit();await h.settled();assert.equal(h.state.calls,1);assert.deepEqual(h.state.errors,['']);assert.equal(h.context.commitPending.current,false);
});

test('returned actionable League rejection is preserved',async()=>{
  const h=harness(async()=>({error:'Choose an available League printing.'}));h.submit();await h.settled();assert.equal(h.state.errors.at(-1),'Choose an available League printing.');assert.equal(h.context.commitPending.current,false);
});

test('double click cannot submit a second pending import',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const h=harness(()=>wait);h.submit();h.submit();assert.equal(h.state.calls,1);release();await h.settled();assert.equal(h.context.commitPending.current,false);
});

for(const flag of ['reviewStale','loading','resolving'])test(`${flag} still refuses saving`,async()=>{
  const h=harness();h.context[flag]=true;h.submit();await h.settled();assert.equal(h.state.calls,0);assert.match(h.state.errors.at(-1),/Parse and review/);
});

test('included unresolved entries still refuse saving',async()=>{
  const h=harness();h.context.summary.unresolvedIncluded=5;h.submit();await h.settled();assert.equal(h.state.calls,0);assert.match(h.state.errors.at(-1),/Resolve or exclude 5/);
});
