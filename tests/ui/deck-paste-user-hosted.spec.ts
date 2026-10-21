import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { loadIsolatedQualificationTarget } from "./isolated-qualification-target";
const source=readFileSync("tests/fixtures/deck-paste-user-2026-10-21.txt","utf8");
const catalog=JSON.parse(readFileSync("tests/fixtures/deck-paste-public-catalog.json","utf8"));
const evidence=".local-data/qualification-ci", Q=JSON.stringify;
if(createHash("sha256").update(source).digest("hex")!=="23a4a81ed1918f0718ca7a08b659caf24b25d6e65d3f9675ec021c5d7749c431")throw Error("Fixture changed");
if(catalog.outcomes.length!==87||catalog.outcomes.some((r:any)=>!["EXACT_NAME","EXACT_FLAVOR_NAME"].includes(r.outcome)))throw Error("Unresolved catalog");
function database(body:string):any {
  const t=loadIsolatedQualificationTarget();if(!t)throw Error("Owned target required");
  return JSON.parse(execFileSync("docker",["exec","-i",t.web.id,"node","--import","/app/node_modules/tsx/dist/loader.mjs"],{
    input:"const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{assert.equal(process.env.MTG_ISOLATED_QUALIFICATION_RUN,"+Q(t.runId)+");"+body+"})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding:"utf8",timeout:90000,windowsHide:true}));
}
function save(name:string,value:any){mkdirSync(evidence,{recursive:true});writeFileSync(evidence+"/"+name+".json",JSON.stringify(value,null,2));}
function setup(league:boolean){
  const tag="paste-example-"+randomUUID(),password=randomUUID();
  const f=database(
    "assert.match(process.env.ADMIN_USERNAME,/^ci-admin-[a-f0-9]{8}$/);assert.equal(await p.user.count(),1);assert.equal((await p.user.findUniqueOrThrow({where:{username:process.env.ADMIN_USERNAME}})).role,'ADMIN');assert.equal(await p.card.count(),0);const tag="+Q(tag)+",cards="+Q(catalog.cards)+",outcomes="+Q(catalog.outcomes)+";"+
    "await p.player.create({data:{id:tag,name:tag,displayName:tag}});await p.user.create({data:{id:tag,username:tag,displayName:tag,playerId:tag,passwordHash:await require('bcryptjs').hash("+Q(password)+",10)}});"+
    "const {cardWriteData}=require('./lib/card-import.ts'),created=[];for(const raw of cards){const {projectionSHA256,...card}=raw;created.push(await p.card.create({data:{scryfallId:card.id,...cardWriteData(card)}}));}"+
    "const make=name=>p.deck.create({data:{ownerUserId:tag,name,format:'COMMANDER',visibility:'PRIVATE'}}),deck=await make('Supplied example'),control="+(league?"null":"await make('Supplied list-only control')")+";let leagueId=null,locationId=null;"+
    (league?
    "const location=await p.inventoryLocation.create({data:{ownerPlayerId:tag,name:'Public synthetic League pool',normalizedName:'public synthetic league pool',visibility:'PUBLIC'}});locationId=location.id;"+
    "const league=await p.commanderLeague.create({data:{name:tag,slug:tag,year:2026,createdByUserId:tag}});leagueId=league.id;const member=await p.commanderLeagueMember.create({data:{leagueId,userId:tag,role:'ADMIN'}});"+
    "const round=await p.commanderLeagueRound.create({data:{leagueId,monthNumber:1,name:'January',startDate:new Date('2026-01-01'),endDate:new Date('2026-02-01')}});"+
    "await p.commanderLeagueDeck.create({data:{archiveDeckId:deck.id,leagueId,memberId:member.id,roundId:round.id,name:deck.name}});await p.commanderLeagueLocation.create({data:{leagueId,locationId}});"+
    "for(const row of outcomes){const card=created.find(c=>c.scryfallId===row.card.id);await p.inventoryItem.create({data:{cardId:card.id,currentOwnerId:tag,originalOpenerId:tag,locationId,quantity:row.quantity,foilStatus:row.foil?'FOIL':'NONFOIL',sourceType:'MANUAL',condition:'NM',language:'EN'}});}":"")+
    "return {tag,deckId:deck.id,controlId:control?.id,leagueId,locationId,cards:created.map(c=>({id:c.id,scryfallId:c.scryfallId,name:c.name}))};");
  return {...f,password};
}
function clean(f:any){database("const tag="+Q(f.tag)+";assert.match(tag,/^paste-example-[a-f0-9-]{36}$/);"+
  "await p.inventoryAuditLog.deleteMany({where:{changedByUserId:tag}});await p.inventoryItem.deleteMany({where:{currentOwnerId:tag}});await p.commanderLeague.deleteMany({where:{createdByUserId:tag}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:tag}});await p.deck.deleteMany({where:{ownerUserId:tag}});await p.authSession.deleteMany({where:{userId:tag}});await p.user.delete({where:{id:tag}});await p.player.delete({where:{id:tag}});await p.card.deleteMany({where:{id:{in:"+Q(f.cards.map((c:any)=>c.id))+"}}});return {clean:true};");}
function snapshot(f:any,deckId=f.deckId){return database("return {deck:await p.deckCard.findMany({where:{deckId:"+Q(deckId)+"},orderBy:{cardId:'asc'}}),inventory:await p.inventoryItem.findMany({where:{currentOwnerId:"+Q(f.tag)+"},orderBy:{id:'asc'},include:{location:true}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:"+Q(f.tag)+"},orderBy:{id:'asc'}}),pool:await p.commanderLeagueLocation.findMany(),games:await p.commanderLeagueGame.count(),submissions:await p.commanderLeagueDeckSubmission.count()};");}
async function login(page:Page,f:any){await page.goto("/login");await page.getByLabel(/username or email/i).fill(f.tag);await page.getByLabel(/^password$/i).fill(f.password);await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);}
async function prepare(page:Page,f:any,id:string,name:string){
  await page.goto("/decks/"+id+"/import");await page.getByLabel("Decklist text",{exact:true}).fill(source);await page.getByRole("button",{name:"Parse and review",exact:true}).click();
  await expect(page.getByRole("button",{name:"Parse and review",exact:true})).toBeEnabled({timeout:180000});
  let rows=JSON.parse(await page.locator("input[name=linesJson]").inputValue());save(name+"-automatic-review",rows);expect(rows).toHaveLength(87);
  // Public records prove these flavor names. Select the canonical printing in
  // actual review without modifying rawLine, parsed name, or supplied text.
  for(const alias of catalog.outcomes.filter((r:any)=>r.outcome==="EXACT_FLAVOR_NAME")){
    if(!rows[alias.line-1].cardId){
      const row=page.getByRole("row").filter({has:page.locator("code").filter({hasText:alias.raw})});
      await row.getByRole("button",{name:"Resolve",exact:true}).click();
      await row.getByPlaceholder("Card name or Scryfall query, e.g. command tower set:c20").fill(alias.card.name);
      await row.getByRole("button").filter({has:page.locator("strong").filter({hasText:alias.card.name})}).click({timeout:180000});
    }
  }
  const button=page.getByRole("button",{name:"Import 100 deck-list copies",exact:true});await expect(button).toBeEnabled({timeout:180000});
  rows=JSON.parse(await page.locator("input[name=linesJson]").inputValue());
  for(const [i,line] of rows.entries()){const r=catalog.outcomes[i],c=f.cards.find((c:any)=>c.scryfallId===r.card.id);expect(line.rawLine).toBe(r.raw);expect(line.quantity).toBe(r.quantity);expect(line.cardId).toBe(c.id);expect(line.included).toBe(true);expect(line.physicalFoilStatus).toBe(r.foil?"FOIL":"NONFOIL");}
  expect(rows.reduce((n:number,r:any)=>n+r.quantity,0)).toBe(100);await expect(page.getByLabel("Decklist text",{exact:true})).toHaveValue(source);save(name+"-prepared-review",rows);return button;
}
async function apply(page:Page,button:any,id:string,name:string){
  const posts:any[]=[],errors:string[]=[];const response=(r:any)=>{if(r.request().method()==="POST")posts.push({path:new URL(r.url()).pathname,status:r.status()});},error=(e:Error)=>errors.push(e.message),began=Date.now();page.on("response",response);page.on("pageerror",error);
  try{await button.click();await page.waitForURL("**/decks/"+id,{timeout:90000});expect(errors).toEqual([]);expect(posts.filter(r=>r.status>=500)).toEqual([]);}
  finally{page.off("response",response);page.off("pageerror",error);save(name+"-apply",{elapsedMs:Date.now()-began,posts,errors,url:page.url()});}
}
function checkList(s:any,f:any){expect(s.deck).toHaveLength(87);expect(s.deck.reduce((n:number,r:any)=>n+r.quantity,0)).toBe(100);for(const r of catalog.outcomes){const c=f.cards.find((c:any)=>c.scryfallId===r.card.id),actual=s.deck.find((v:any)=>v.cardId===c.id);expect(actual.quantity).toBe(r.quantity);expect(actual.section).toBe("MAINBOARD");}}
test("#808 ordinary supplied list and all physical copies",async({page,baseURL})=>{
  test.setTimeout(420000);expect(baseURL).toBe(loadIsolatedQualificationTarget()!.baseURL);const f=setup(false);
  try{
    await login(page,f);const before=snapshot(f);save("808-before",before);
    let button=await prepare(page,f,f.controlId,"808-list-only");await apply(page,button,f.controlId,"808-list-only");
    const control=snapshot(f,f.controlId);checkList(control,f);expect(control.inventory).toEqual(before.inventory);expect(control.audits).toEqual(before.audits);
    await prepare(page,f,f.deckId,"808-physical");const copies=page.getByLabel("Create and commit inventory",{exact:true});await expect(copies).toHaveCount(87);for(let i=0;i<87;i++)await copies.nth(i).check();
    const rows=JSON.parse(await page.locator("input[name=linesJson]").inputValue());expect(rows.reduce((n:number,r:any)=>n+r.physicalQuantity,0)).toBe(100);
    await page.setViewportSize({width:390,height:960});button=page.getByRole("button",{name:"Import 100 deck-list copies and commit 100 physical",exact:true});await button.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+"/808-phone-before-apply.png"});
    await apply(page,button,f.deckId,"808-physical");const after=snapshot(f);save("808-after",after);checkList(after,f);
    expect(after.inventory.reduce((n:number,r:any)=>n+r.quantity,0)).toBe(100);expect(after.inventory.filter((r:any)=>r.foilStatus==="FOIL").reduce((n:number,r:any)=>n+r.quantity,0)).toBe(1);expect(after.audits).toHaveLength(174);
    for(const r of catalog.outcomes){const c=f.cards.find((c:any)=>c.scryfallId===r.card.id),stock=after.inventory.filter((v:any)=>v.cardId===c.id&&v.quantity>0);expect(stock).toHaveLength(1);expect(stock[0].quantity).toBe(r.quantity);expect(stock[0].foilStatus).toBe(r.foil?"FOIL":"NONFOIL");expect(stock[0].condition).toBe("NM");expect(stock[0].language).toBe("EN");expect(stock[0].location.kind).toBe("DECK");expect(stock[0].location.deckId).toBe(f.deckId);}
    save("808-result",{status:"PASS",rows:87,copies:100,foilCopies:1,aliasesManuallyReviewed:true,historicalCauseUnknown:true});
  }finally{clean(f);}
});
test("#844 League supplied full list final apply preserves pool",async({page,baseURL})=>{
  test.setTimeout(420000);expect(baseURL).toBe(loadIsolatedQualificationTarget()!.baseURL);const f=setup(true);
  try{
    await login(page,f);const before=snapshot(f);save("844-before",before);const button=await prepare(page,f,f.deckId,"844-league");await expect(page.getByLabel("Create and commit inventory",{exact:true})).toHaveCount(0);
    await page.setViewportSize({width:1366,height:900});await button.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+"/844-desktop-before-apply.png"});await apply(page,button,f.deckId,"844-league");
    const after=snapshot(f);save("844-after",after);checkList(after,f);expect(after.inventory).toEqual(before.inventory);expect(after.audits).toEqual(before.audits);expect(after.pool).toEqual(before.pool);expect(after.games).toBe(0);expect(after.submissions).toBe(0);
    save("844-result",{status:"PASS",rows:87,copies:100,poolInventoryAuditUnchanged:true,aliasesManuallyReviewed:true,historicalCauseUnknown:true});
  }finally{clean(f);}
});
