import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=process.env.DECK_SEARCH_ROUTE_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filename=path.join(root,'app/api/decks/card-search/route.ts');
const tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
// Execute the complete actual route; replace only its authentication and search
// boundaries. Tests need neither a live account nor a database to check the API.
const declarations=tree.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(tree)).join('\n');
const code=ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;

function route({authenticationError}={}){
  const searches=[];
  let loginCalls=0;
  const context={exports:{},Response,
    requireLogin:async()=>{loginCalls++;if(authenticationError)throw authenticationError;return{playerId:'current-owner'};},
    searchDeckCardPrintings:async input=>{
      searches.push(input);
      return{query:input.query,message:'Synthetic results',counts:{owned:0,local:30,scryfall:0},
        results:Array.from({length:input.limit??30},(_,i)=>({cardId:'printing-'+i}))};
    }};
  vm.createContext(context);vm.runInContext(code,context);
  return{searches,loginCalls:()=>loginCalls,get:url=>context.exports.GET({nextUrl:new URL(url,'http://localhost')})};
}

test('omitted limit preserves the search default and returns multiple printing choices',async()=>{
  const r=route();
  const response=await r.get('/api/decks/card-search?q=Forest&scryfall=1');
  const data=await response.json();
  assert.equal(data.results.length,30);
  assert.equal(r.searches[0].limit,undefined);
  assert.equal(r.searches[0].query,'Forest');
  assert.equal(r.searches[0].ownerPlayerId,'current-owner');
  assert.equal(r.searches[0].includeScryfall,true);
  assert.equal(r.loginCalls(),1);
});

test('explicit result limits retain existing lower and upper bounds',async()=>{
  for(const [value,expected] of [['1',1],['30',30],['175',175],['200',175],['0',1],['-5',1],['',1]]){
    const r=route();await r.get('/api/decks/card-search?q=Forest&limit='+value);
    assert.equal(r.searches[0].limit,expected,value);
    assert.equal(r.searches[0].includeScryfall,false);
  }
});

test('invalid and fractional limits retain the service default',async()=>{
  for(const value of ['not-a-number','2.5','Infinity']){
    const r=route();const response=await r.get('/api/decks/card-search?q=Forest&limit='+value);
    assert.equal(r.searches[0].limit,undefined,value);
    assert.equal((await response.json()).results.length,30);
  }
});

test('authentication failure prevents card lookup',async()=>{
  const sentinel=new Error('Authentication required');const r=route({authenticationError:sentinel});
  await assert.rejects(r.get('/api/decks/card-search?q=Forest'),error=>error===sentinel);
  assert.equal(r.searches.length,0);
  assert.equal(r.loginCalls(),1);
});
