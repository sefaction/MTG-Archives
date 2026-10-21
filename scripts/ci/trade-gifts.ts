import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

// Real action/service code and real PostgreSQL. Only request identity and Next's
// cache boundary are adapted; all transfers, audits and notifications execute.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'trade_gift_fixture');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, '127.0.0.1');
const p = new PrismaClient();
const context = new AsyncLocalStorage<any>();
const actionPath = path.resolve('app/trades/actions.ts');
const source = readFileSync(process.env.TRADE_ACTION_SOURCE ?? actionPath, 'utf8');
const actionModule: any = new (Module as any)(actionPath, module);
actionModule.filename = actionPath;
actionModule.paths = (Module as any)._nodeModulePaths(path.dirname(actionPath));
const originalRequire = actionModule.require.bind(actionModule);
actionModule.require = (id: string) => {
  if (id === '@/lib/auth') return {requireLogin:async () => context.getStore().actor, getAccessScope:async (actor: any) => ({mode:actor.role === 'ADMIN' ? 'admin' : 'owner'})};
  if (id === '@/lib/prisma') return {prisma:p};
  if (id === 'next/cache') return {revalidatePath:() => {}};
  return originalRequire(id);
};
actionModule._compile(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, actionPath);
const {confirmPhysicalTrade, createTrade, actOnTrade} = actionModule.exports;

async function fixture(mode: string) {
  const tag = `trade-race-${randomUUID()}`;
  const people = [];
  for (const suffix of ['a','b','admin']) {
    const player = await p.player.create({data:{name:`${tag}-${suffix}`,displayName:`${tag}-${suffix}`}});
    const user = await p.user.create({data:{username:`${tag}-${suffix}`,displayName:suffix,passwordHash:'synthetic-disabled',playerId:player.id,role:suffix === 'admin' ? 'ADMIN' : 'PLAYER'}});
    const location = await p.inventoryLocation.create({data:{ownerPlayerId:player.id,name:'Incoming',normalizedName:'incoming'}});
    people.push({...user, locationId:location.id});
  }
  const league = await p.league.create({data:{name:tag,slug:tag}});
  const season = await p.season.create({data:{leagueId:league.id,name:tag,year:2026,startDate:new Date()}});
  const round = await p.round.create({data:{seasonId:season.id,name:tag,monthNumber:1,startDate:new Date(),endDate:new Date()}});
  const items = [];
  for (let i=0;i<2;i++) {
    const card = await p.card.create({data:{scryfallId:`${tag}-${i}`,name:`${tag}-${i}`,typeLine:'Artifact',setCode:'tst',collectorNumber:String(i),rarity:'common'}});
    const pull = await p.pull.create({data:{roundId:round.id,playerId:people[i].playerId!,cardId:card.id,quantity:20,condition:'NM'}});
    items.push(await p.inventoryItem.create({data:{cardId:card.id,currentOwnerId:people[i].playerId!,originalOpenerId:people[i].playerId!,quantity:10+i*2,condition:'NM',language:'JA',foil:true,foilStatus:'FOIL',sourceType:'PULL',notes:`provenance-${i}`,roundId:round.id,acquiredFromPullId:pull.id,locationId:people[i].locationId,locationSection:'source-section'}}));
  }
  const resident = await p.inventoryItem.create({data:{cardId:items[0].cardId,currentOwnerId:people[1].playerId!,originalOpenerId:people[1].playerId!,quantity:7,condition:'NM',language:'JA',foil:true,foilStatus:'FOIL',sourceType:'MANUAL',notes:'resident',locationId:people[1].locationId}});
  const trade = await p.trade.create({data:{proposerPlayerId:people[0].playerId!,receiverPlayerId:people[1].playerId!,status:'PARTIALLY_COMMITTED',proposerCommittedAt:mode === 'simultaneous' ? null : new Date(),proposerDestinationLocationId:people[0].locationId,receiverDestinationLocationId:people[1].locationId,lines:{create:items.map((item,i)=>({side:i === 0 ? 'PROPOSER' : 'RECEIVER',inventoryItemId:item.id,quantity:i+2,snapshotJson:{},position:0}))}}});
  return {people,items,resident,trade};
}
async function call(f: Awaited<ReturnType<typeof fixture>>, index: number, force = false, destination?: string) {
  const fd = new FormData(); fd.set('tradeId',f.trade.id); fd.set('destinationLocationId',destination ?? f.people[index].locationId);
  if (force) { fd.set('forceComplete','1'); fd.set('reason','synthetic overlap'); }
  return context.run({actor:f.people[index],reads:0,callId:randomUUID()},()=>confirmPhysicalTrade(fd));
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {trade:await p.trade.findUniqueOrThrow({where:{id:f.trade.id}}), items:await p.inventoryItem.findMany({where:{cardId:{in:f.items.map(i=>i.cardId)}},orderBy:{id:'asc'}}), audits:await p.inventoryAuditLog.findMany({where:{tradeId:f.trade.id},orderBy:{id:'asc'}}), events:await p.tradeEvent.findMany({where:{tradeId:f.trade.id},orderBy:{id:'asc'}})};
}
async function main() {
  assert.equal(await p.user.count(),0,'empty hosted disposable schema required');
  for (const side of ['offered','requested']) {
    const f = await fixture('gift');
    await p.trade.delete({where:{id:f.trade.id}});
    const proposer = side === 'offered' ? 0 : 1, recipient = 1-proposer;
    const asActor = (i: number, action: any, fd: FormData) => context.run({actor:f.people[i],reads:0,callId:randomUUID()},()=>action === createTrade ? action({status:"idle",message:""},fd) : action(fd));
    const fd = new FormData();
    fd.set('receiverPlayerId',f.people[recipient].playerId!);
    fd.set('offeredLinesJson',JSON.stringify(side === 'offered' ? [{inventoryItemId:f.items[0].id,quantity:2}] : []));
    fd.set('requestedLinesJson',JSON.stringify(side === 'requested' ? [{inventoryItemId:f.items[0].id,quantity:2}] : []));
    const result = await asActor(proposer,createTrade,fd);
    assert.equal(result.status,'success',result.message);
    f.trade = await p.trade.findFirstOrThrow({where:{proposerPlayerId:f.people[proposer].playerId!}});
    const actionForm = (action: string) => { const form=new FormData();form.set('tradeId',f.trade.id);form.set('action',action);return form; };
    assert.equal(await p.tradeLine.count({where:{tradeId:f.trade.id}}),1);
    await assert.rejects(asActor(proposer,actOnTrade,actionForm('accept')));
    await assert.rejects(asActor(2,actOnTrade,actionForm('accept')));
    await asActor(recipient,actOnTrade,actionForm('accept'));
    await call(f,proposer);
    let s = await state(f);
    assert.equal(s.trade.status,'PARTIALLY_COMMITTED');
    assert.deepEqual(s.items.find(i=>i.id===f.items[0].id),f.items[0]);
    assert.equal(s.audits.length,0);
    await call(f,recipient);
    s = await state(f);
    assert.equal(s.trade.status,'COMPLETED');
    await assert.rejects(call(f,recipient));
    assert.equal(s.events.filter(e=>e.eventType==='completed').length,1);
    assert.equal(s.audits.length,2);
    assert.equal(s.items.find(i=>i.id===f.items[0].id)?.quantity,8);
    assert.deepEqual(s.items.find(i=>i.id===f.items[1].id),f.items[1]);
    assert.deepEqual(s.items.find(i=>i.id===f.resident.id),f.resident);
    const incoming=s.items.filter(i=>i.sourceType==='TRADE');
    assert.equal(incoming.length,1);
    assert.equal(incoming[0].quantity,2);
    assert.equal(incoming[0].currentOwnerId,f.people[1].playerId);
    assert.equal(incoming[0].locationId,f.people[1].locationId);
    for(const key of ['cardId','foil','foilStatus','condition','language','notes','originalOpenerId','roundId','acquiredFromPullId'] as const) assert.equal(incoming[0][key],f.items[0][key]);
    assert.equal(s.items.filter(i=>i.cardId===f.items[0].cardId).reduce((sum,i)=>sum+i.quantity,0),17);
    for(const action of ['cancel','decline']) {
      assert.equal((await asActor(proposer,createTrade,fd)).status,'success');
      const gift=await p.trade.findFirstOrThrow({where:{proposerPlayerId:f.people[proposer].playerId!,status:'PROPOSED'}});
      const terminalForm=new FormData();terminalForm.set('tradeId',gift.id);terminalForm.set('action',action);
      await asActor(action==='cancel'?proposer:recipient,actOnTrade,terminalForm);
      assert.equal((await p.trade.findUniqueOrThrow({where:{id:gift.id}})).status,action==='cancel'?'CANCELLED':'DECLINED');
      assert.equal(await p.inventoryAuditLog.count({where:{tradeId:gift.id}}),0);
      assert.equal((await p.inventoryItem.findUniqueOrThrow({where:{id:f.items[0].id}})).quantity,8);
    }
    fd.set('offeredLinesJson','[]');fd.set('requestedLinesJson','[]');
    const count=await p.trade.count();
    const empty=await asActor(proposer,createTrade,fd);
    assert.equal(empty.status,'error');assert.match(empty.message,/Both sides cannot be empty/);
    assert.equal(await p.trade.count(),count);
  }
  console.log('PASS gifts: both directions, empty rejection, consent, two confirmations, once-only transfer, provenance, resident isolation, conservation, cancellation and decline');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>p.$disconnect());