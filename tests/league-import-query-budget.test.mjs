import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// October31 policy replaces pool refusal. Execute the complete real action:
// absent cards save; physical writes, management and write fences stay intact.
const root=process.env.DECK_IMPORT_SOURCE_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filename=path.join(root,'app/decks/actions.ts');
const tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
const commit=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='commitDeckImport');
assert.ok(commit,'Actual complete import action required');
const code=ts.transpileModule(commit.getText(tree).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
async function execute({count=100,mode='merge',league=true,physicalQuantity=0,available=false,managedError,lockError,unresolved=0}={}){
  const state={poolQueries:0,transactions:0,locks:0,deletes:0,rows:[],paths:[],redirect:null};
  const lines=Array.from({length:count},(_,i)=>({cardId:'card-'+i,quantity:i===0?8:1,section:i===1?'COMMANDER':'MAINBOARD',physicalQuantity}));
  const fd=new FormData();for(const [key,value] of Object.entries({deckId:'deck',mode,linesJson:JSON.stringify(lines),unresolvedIncludedCount:String(unresolved)}))fd.set(key,value);
  const tx={card:{findUnique:async({where})=>({id:where.id,name:where.id,scryfallId:where.id,oracleId:where.id})},deckCard:{deleteMany:async()=>{state.deletes++},findFirst:async()=>null,create:async({data})=>{state.rows.push(data)}}};
  const redirected={};
  const context={Error,Number,JSON,Object,DeckSection:{COMMANDER:"COMMANDER"},FoilStatus:{NONFOIL:'NONFOIL',FOIL:'FOIL',ETCHED:'ETCHED'},formString:(form,key)=>String(form.get(key)||''),requireManagedDeck:async()=>{if(managedError)throw managedError;return {user:{id:'owner'},deck:{id:'deck',ownerUserId:'owner',ownerUser:{playerId:'player'},commanderLeagueDeck:league?{leagueId:'league'}:null}}},getDeckCommittedSummary:async()=>({committedQuantity:0}),areAllPrintingsInLeague:async()=>{state.poolQueries++;return available},rejectLeagueInventoryCommitment:()=>{throw new Error('League decks do not support physical inventory commitment.')},lockWritableDeck:async()=>{state.locks++;if(lockError)throw lockError;},prisma:{$transaction:async(callback)=>{state.transactions++;return callback(tx)}},revalidatePath:p=>state.paths.push(p),redirect:p=>{state.redirect=p;throw redirected;}};
  vm.createContext(context);vm.runInContext(code+'\nglobalThis.run=commitDeckImport;',context);
  let result;try{result=await context.run(fd);}catch(error){if(error!==redirected)throw error;}
  return {state,result};
}
for(const mode of ['merge','replace'])test(`${mode}: all100 League rows save without pool lookup, including absent cards`,async()=>{
  const {state,result}=await execute({mode});assert.equal(result,undefined);assert.equal(state.redirect,'/decks/deck');
  assert.equal(state.rows.length,100);assert.equal(state.rows.reduce((n,row)=>n+row.quantity,0),107);
  assert.equal(state.rows.filter(row=>row.isCommander).length,1);assert.equal(state.poolQueries,0);assert.equal(state.locks,1);
  assert.equal(state.deletes,mode==='replace'?1:0);assert.deepEqual(state.paths,['/decks/deck']);
});
test('ordinary list-only import stays independent of League pool',async()=>{
  const {state}=await execute({league:false,count:2});assert.equal(state.rows.length,2);assert.equal(state.poolQueries,0);
});
test('League physical-copy request still rejects before starting a write',async()=>{
  await assert.rejects(execute({physicalQuantity:1,available:true}),/do not support physical inventory commitment/);
});
test('unresolved included cards still refuse import',async()=>{await assert.rejects(execute({unresolved:1}),/Resolve or exclude 1/);});
test('denied management and later write-fence failures still propagate',async()=>{
  for(const key of ['managedError','lockError']){const failure=new Error(key);await assert.rejects(execute({[key]:failure}),error=>error===failure);}
});
