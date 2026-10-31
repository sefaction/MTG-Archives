import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const root=process.env.DECK_IMPORT_SOURCE_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filename=path.join(root,'app/decks/actions.ts');
const tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
const commit=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='commitDeckImport');
assert.ok(commit,'Actual complete import action required');
const gate=commit.body.statements.find(node=>ts.isIfStatement(node)&&node.expression.getText(tree)==='deck.commanderLeagueDeck'&&node.getText(tree).includes('The list was not imported.'));
assert.ok(gate,'Actual complete final League availability branch required');
const code=ts.transpileModule('async function validate(){'+gate.getText(tree)+'\nreturn {ok:true};}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const require=createRequire(pathToFileURL(path.join(root,'tests/league-import-query-budget.test.mjs')));
const helpers=require('../lib/commander-league-inventory.ts');

async function execute({ids,available=ids,capacity=1,league=true,error}){
  let active=0,peak=0,queries=0;
  async function query(where,multiple){
    queries++;active++;peak=Math.max(peak,active);
    try{
      if(error)throw error;
      if(active>capacity)throw Object.assign(new Error('Too many clients already'),{code:'P2037'});
      assert.deepEqual(JSON.parse(JSON.stringify(where.quantity)),{gt:0});
      assert.equal(where.location.commanderLeagueLinks.some.leagueId,'league');
      await Promise.resolve();
      const requested=typeof where.cardId==='string'?[where.cardId]:where.cardId.in;
      const matches=[...new Set(requested.filter(id=>available.includes(id)))];
      return multiple?matches.map(cardId=>({cardId})):matches.length?{id:'stock'}:null;
    }finally{active--;}
  }
  const client={inventoryItem:{findFirst:({where})=>query(where,false),groupBy:({where})=>query(where,true)}};
  const context={deck:{commanderLeagueDeck:league?{leagueId:'league'}:null},lines:ids.map(cardId=>({cardId})),isPrintingInLeague:(...args)=>helpers.isPrintingInLeague(...args,client),areAllPrintingsInLeague:(...args)=>helpers.areAllPrintingsInLeague(...args,client)};
  vm.createContext(context);vm.runInContext(code+'\nglobalThis.run=validate;',context);
  const result=await context.run();return {result,queries,peak};
}

test('actual final import gate can validate82 printings with one available query slot',async()=>{
  const ids=Array.from({length:82},(_,i)=>'printing-'+i);
  const value=await execute({ids});assert.equal(value.result.ok,true);assert.equal(value.queries,1);assert.equal(value.peak,1);
});

test('actual final gate retains whole-list rejection when a printing disappears',async()=>{
  const value=await execute({ids:['present','gone'],available:['present'],capacity:10});
  assert.match(value.result.error,/not in this League's linked inventory/);assert.equal(value.result.ok,undefined);
});

test('ordinary deck imports do not consume League-check connections',async()=>{
  const value=await execute({ids:['ordinary'],league:false});assert.equal(value.result.ok,true);assert.equal(value.queries,0);
});

test('actual final gate does not fail open when PostgreSQL rejects the lookup',async()=>{
  const error=Object.assign(new Error('Too many clients already'),{code:'P2037'});
  await assert.rejects(execute({ids:['card'],error}),caught=>caught===error);
});
