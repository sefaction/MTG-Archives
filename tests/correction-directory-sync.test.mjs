import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(process.env.MTG_DIRECTORY_SYNC_SOURCE || new URL('../lib/acquisition-correction-files.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('correction-files.ts',source,ts.ScriptTarget.Latest,true);
const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='syncDirectory');
assert.ok(node,'Exercise complete actual directory sync function');
const code=ts.transpileModule(node.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const fault=code=>Object.assign(Error('bounded directory-sync fault'),{code});
function load(open,platform='linux'){return vm.runInNewContext(code+'\nsyncDirectory',{open,process:{platform},AggregateError});}
async function exercise(failures=new Map(),platform='linux'){
  const calls=[];const step=n=>{calls.push(n);if(failures.has(n))throw failures.get(n);};
  const sync=load(async(directory,mode)=>{assert.equal(directory,'owned-directory');assert.equal(mode,'r');step('open');return{sync:async()=>step('sync'),close:async()=>step('close')};},platform);
  let threw=false,error;try{await sync('owned-directory');}catch(e){threw=true;error=e;}
  return{calls,threw,error};
}
test('Windows directory sync remains a no-op',async()=>{const r=await exercise(new Map([['open',fault('EIO')]]),'win32');assert.deepEqual(r.calls,[]);assert.equal(r.threw,false);});
test('ordinary directory sync closes exactly once',async()=>{const r=await exercise();assert.deepEqual(r.calls,['open','sync','close']);assert.equal(r.threw,false);});
for(const phase of ['open','sync','close'])test('lone '+phase+' error keeps identity',async()=>{
  const cause=fault('EIO'),r=await exercise(new Map([[phase,cause]]));assert.equal(r.threw,true);assert.equal(r.error,cause);assert.deepEqual(r.calls,phase==='open'?['open']:['open','sync','close']);
});
test('simultaneous sync and close failures retain ordered causes and primary storage code',async()=>{
  const sync=fault('ENOSPC'),close=fault('EIO'),r=await exercise(new Map([['sync',sync],['close',close]]));assert.deepEqual(r.calls,['open','sync','close']);assert.ok(r.error instanceof AggregateError);assert.deepEqual(r.error.errors,[sync,close]);assert.equal(r.error.cause,sync);assert.equal(r.error.code,'ENOSPC');
});
for(const first of [undefined,null,false,0,''])test('falsy sync error '+String(first)+' remains first when close fails',async()=>{
  const close=fault('EIO'),r=await exercise(new Map([['sync',first],['close',close]]));assert.equal(r.threw,true);assert.ok(r.error instanceof AggregateError);assert.deepEqual(r.error.errors,[first,close]);assert.equal(r.error.cause,first);assert.equal(Object.hasOwn(r.error,'code'),false);
});
test('non-string primary code is not replaced with a secondary code',async()=>{const first={code:17},close=fault('EACCES'),r=await exercise(new Map([['sync',first],['close',close]]));assert.deepEqual(r.error.errors,[first,close]);assert.equal(r.error.cause,first);assert.equal(Object.hasOwn(r.error,'code'),false);});
test('lone falsy sync failure remains a rejection',async()=>{const r=await exercise(new Map([['sync',undefined]]));assert.equal(r.threw,true);assert.equal(r.error,undefined);assert.deepEqual(r.calls,['open','sync','close']);});
test('Linux real directory handles retain both faults and neighboring bytes',{skip:process.platform==='win32'},async()=>{
  const parent=path.resolve('.local-data');await fsp.mkdir(parent,{recursive:true});const root=await fsp.mkdtemp(path.join(parent,'directory-sync-'));const neighbor=path.join(root,'neighbor.original');await fsp.writeFile(neighbor,'unchanged bytes');
  try{await load(fsp.open)(root);const first=fault('ENOSPC'),second=fault('EIO');let closed=false;
    const actual=load(async(directory,mode)=>{const h=await fsp.open(directory,mode);return{sync:async()=>{await h.sync();throw first;},close:async()=>{await h.close();closed=true;throw second;}};});
    await assert.rejects(actual(root),e=>{assert.deepEqual(e.errors,[first,second]);assert.equal(e.cause,first);assert.equal(e.code,'ENOSPC');return true;});assert.equal(closed,true);assert.equal(await fsp.readFile(neighbor,'utf8'),'unchanged bytes');
  }finally{assert.ok(root.startsWith(parent+path.sep)&&path.basename(root).startsWith('directory-sync-'));await fsp.rm(root,{recursive:true,force:true});}
});
