import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

// Real action/service code and real PostgreSQL. Only request identity and Next's
// cache boundary are adapted; all transfers, audits and notifications execute.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.MTG_TRADE_FIXTURE, '1');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'postgres');
const p = new PrismaClient();
const context = new AsyncLocalStorage<any>();
let gates: Record<string, ReturnType<typeof barrier>> = {};
let injectRollback = false;
const observations: any[] = [];
function barrier(name: string) {
  let arrivals = 0, release!: () => void;
  const ready = new Promise<void>(r => release = r);
  let timer: ReturnType<typeof setTimeout>;
  return async () => {
    arrivals++;
    if (arrivals === 1) timer = setTimeout(() => { observations.push({gate:name, arrivals, timeout:true}); release(); }, 1500);
    if (arrivals === 2) { clearTimeout(timer); observations.push({gate:name, arrivals, timeout:false}); release(); }
    await ready;
  };
}
function wrap(client: any, transaction = false): any {
  return new Proxy(client, {get(target, key) {
    if (key === '$transaction') return (fn: any) => target.$transaction((tx: any) => fn(wrap(tx, true)), {maxWait:10000, timeout:20000});
    const value = target[key];
    if (typeof key === 'string' && ['trade','inventoryItem'].includes(key)) return new Proxy(value, {get(model, method) {
      const fn = model[method];
      if (typeof fn !== 'function') return fn;
      return async (args: any) => {
        if (injectRollback && transaction && key === 'inventoryItem' && method === 'create') throw new Error('fixture receipt rollback');
        const result = await fn.call(model, args);
        const ctx = context.getStore();
        if (ctx && key === 'trade' && method === 'findUnique' && args.include) {
          ctx.reads++;
          await gates[`read-${ctx.reads}`]?.();
        }
        if (ctx && transaction && key === 'trade' && method === 'findUnique' && args.select?.status) await gates.status?.();
        return result;
      };
    }});
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}
const actionPath = path.resolve('app/trades/actions.ts');
const source = readFileSync(process.env.TRADE_ACTION_SOURCE ?? actionPath, 'utf8');
const actionModule: any = new (Module as any)(actionPath, module);
actionModule.filename = actionPath;
actionModule.paths = (Module as any)._nodeModulePaths(path.dirname(actionPath));
const originalRequire = actionModule.require.bind(actionModule);
actionModule.require = (id: string) => {
  if (id === '@/lib/auth') return {requireLogin:async () => context.getStore().actor, getAccessScope:async (actor: any) => ({mode:actor.role === 'ADMIN' ? 'admin' : 'owner'})};
  if (id === '@/lib/prisma') return {prisma:wrap(p)};
  if (id === 'next/cache') return {revalidatePath:() => {}};
  return originalRequire(id);
};
actionModule._compile(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, actionPath);
const {confirmPhysicalTrade} = actionModule.exports;

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
  return context.run({actor:f.people[index],reads:0},()=>confirmPhysicalTrade(fd));
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {trade:await p.trade.findUniqueOrThrow({where:{id:f.trade.id}}), items:await p.inventoryItem.findMany({where:{cardId:{in:f.items.map(i=>i.cardId)}},orderBy:{id:'asc'}}), audits:await p.inventoryAuditLog.findMany({where:{tradeId:f.trade.id},orderBy:{id:'asc'}}), events:await p.tradeEvent.findMany({where:{tradeId:f.trade.id},orderBy:{id:'asc'}})};
}
function assertOnce(f: Awaited<ReturnType<typeof fixture>>, s: Awaited<ReturnType<typeof state>>) {
  assert.equal(s.trade.status,'COMPLETED');
  assert.equal(s.events.filter(e=>e.eventType === 'completed').length,1,'exactly one completion event');
  assert.equal(s.audits.length,4,'one source and one receipt audit per line');
  assert.deepEqual(s.items.find(i=>i.id === f.resident.id),f.resident,'resident untouched');
  for (let i=0;i<2;i++) {
    const original = f.items[i], quantity = i+2;
    assert.equal(s.items.find(item=>item.id === original.id)?.quantity,original.quantity-quantity,'source decremented once');
    const incoming = s.items.filter(item=>item.cardId === original.cardId && item.sourceType === 'TRADE');
    assert.equal(incoming.length,1,'exactly one received lot');
    const item = incoming[0];
    assert.equal(item.quantity,quantity);
    assert.equal(item.currentOwnerId,f.people[1-i].playerId);
    assert.equal(item.locationId,f.people[1-i].locationId);
    assert.equal(item.locationSection,null);
    for (const key of ['cardId','foil','foilStatus','condition','language','notes','originalOpenerId','roundId','acquiredFromPullId'] as const) assert.equal(item[key],original[key],key);
    assert.equal(s.items.filter(item=>item.cardId === original.cardId).reduce((sum,item)=>sum+item.quantity,0),original.quantity+(i === 0 ? 7 : 0),'physical copy conservation');
  }
}
const results: any[] = [];
try {
  assert.equal(await p.user.count(),0,'empty synthetic database required');
  for (const mode of ['duplicate','simultaneous','admin-overlap']) {
    const f = await fixture(mode);
    gates = {'read-1':barrier('initial'), 'read-2':barrier('completion-load'), status:barrier('transaction-status')};
    const settled = await Promise.allSettled(mode === 'duplicate' ? [call(f,1),call(f,1)] : mode === 'simultaneous' ? [call(f,0),call(f,1)] : [call(f,2,true),call(f,1)]);
    gates = {};
    const s = await state(f);
    let violation: string | null = null;
    try { assertOnce(f,s); } catch (error: any) { violation = error.message; }
    results.push({mode,settled:settled.map(r=>r.status === 'fulfilled' ? {status:r.status} : {status:r.status,error:String(r.reason)}),completionEvents:s.events.filter(e=>e.eventType === 'completed').length,sourceQuantities:f.items.map(i=>s.items.find(x=>x.id === i.id)?.quantity),receivedLots:s.items.filter(i=>i.sourceType === 'TRADE').length,audits:s.audits.length,violation});
    if (process.env.EXPECT_TRADE_DEFECT !== '1') assert.equal(violation,null,`${mode}: ${violation}`);
  }
  if (process.env.EXPECT_TRADE_DEFECT === '1') assert(results.some(r=>r.completionEvents > 1),'baseline must demonstrate actual duplicate transfer, not a timeout');
  // Real transactional failure after the first source decrements must roll back.
  const f = await fixture('rollback');
  const before = await state(f);
  injectRollback = true;
  await assert.rejects(call(f,1),/fixture receipt rollback/);
  injectRollback = false;
  const after = await state(f);
  assert.deepEqual(after.items,before.items);
  assert.equal(after.audits.length,0);
  assert.equal(after.events.filter(e=>e.eventType === 'completed').length,0);
  assert.notEqual(after.trade.status,'COMPLETED');
  results.push({mode:'rollback',passed:true,confirmationAtomic:after.events.length === 0});
  // Destination and participant authority remain real action checks.
  const denial = await fixture('denial');
  await assert.rejects(call(denial,1,false,''),/Choose a destination/);
  await assert.rejects(call(denial,1,false,denial.people[0].locationId),/active normal location/);
  await assert.rejects(call(denial,2),/Only trade participants/);
  results.push({mode:'authorization-and-destination',passed:true});
} finally {
  writeFileSync(process.env.TRADE_REPORT ?? '/tmp/trade-report.json',JSON.stringify({head:process.env.SOURCE_SHA,actionSha256:createHash('sha256').update(source).digest('hex'),adapters:['auth request identity','next cache invalidation'],results,observations},null,2));
  await p.$disconnect();
}
