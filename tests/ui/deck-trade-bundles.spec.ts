import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

let containerId = "";
const q = JSON.stringify;
function docker(args: string[], input?: string) {
  return execFileSync("docker", args, { input, encoding: "utf8", windowsHide: true, timeout: 60_000 }).trim();
}
function database<T = any>(body: string): T {
  assert.match(containerId, /^[a-f0-9]{64}$/);
  return JSON.parse(docker(["exec", "-i", containerId, "node"], `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());`));
}
function snapshot() {
  return database<Record<string, unknown>>(String.raw`const tables=await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const result={};for(const {tablename} of tables){const name='"'+tablename.replaceAll('"','""')+'"';result[tablename]=await p.$queryRawUnsafe('SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),\'\')) AS digest FROM '+name+' t');}return result;`);
}
function verifyTarget(baseURL: string | undefined) {
  const name = process.env.MTG_DECK_TEST_CONTAINER, project = process.env.MTG_DECK_TEST_PROJECT;
  assert.ok(name && project && process.env.MTG_DECK_TEST_DATABASE, "Explicit owned target required");
  assert.equal(baseURL, `http://127.0.0.1:${process.env.MTG_DECK_TEST_PORT}`);
  assert.equal(process.env.MTG_DECK_TEST_DATABASE, "deck_trade_review807_20261023");
  const endpoint = JSON.parse(docker(["context", "inspect", docker(["context", "show"]), "--format", "{{json .Endpoints.docker.Host}}"]));
  assert.match(process.env.DOCKER_HOST || endpoint, /^(npipe:\/\/|unix:\/\/\/)/);
  const [web] = JSON.parse(docker(["inspect", name]));
  assert.equal(web.Config.Labels["com.docker.compose.project"], project);
  assert.equal(web.State.Running, true); assert.equal(web.State.OOMKilled, false);
  assert.deepEqual(web.NetworkSettings.Ports["3000/tcp"], [{ HostIp: "127.0.0.1", HostPort: process.env.MTG_DECK_TEST_PORT }]);
  const url = new URL(web.Config.Env.find((entry: string) => entry.startsWith("DATABASE_URL=")).slice(13));
  assert.equal(url.hostname, "postgres"); assert.equal(url.pathname, "/" + process.env.MTG_DECK_TEST_DATABASE);
  containerId = web.Id;
}
type Person = { id: string; playerId: string; username: string; destinationId: string; folderId: string; tagId: string };
type Deck = { id: string; name: string; owner: number; locationId: string };
type Fixture = { people: Person[]; decks: Deck[]; loose: { id: string; cardName: string }[] };
async function login(page: Page, person: Person, password: string) {
  await page.goto("/login"); await page.getByLabel(/username or email/i).fill(person.username);
  await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/);
}
async function openTrade(page: Page, id: string, history = false) {
  await page.goto(`/trades?view=${history ? "history" : "active"}`);
  const panel = page.locator(`details[data-trade-id="${id}"]`);
  await expect(panel).toHaveCount(1);
  const group = page.locator("details").filter({ has: panel }).filter({ has: page.locator(":scope > summary h2") });
  if (!await group.evaluate((element: HTMLDetailsElement) => element.open)) await group.locator(":scope > summary").click();
  if (!await panel.evaluate((element: HTMLDetailsElement) => element.open)) await panel.locator(":scope > summary").click();
  return panel;
}
async function addDeck(page: Page, deck: Deck, side: "offer" | "request") {
  const picker = page.getByRole("region", { name: side === "offer" ? "Whole decks to offer" : "Whole decks to request" });
  await picker.getByRole("textbox").fill(deck.name);
  await picker.getByRole("button", { name: "Find decks", exact: true }).click();
  await picker.getByRole("button", { name: `Review ${deck.name}`, exact: true }).click();
  await expect(picker.getByRole("heading", { name: `Review ${deck.name}`, exact: true })).toBeVisible();
  await picker.getByRole("checkbox", { name: "I reviewed the complete list and committed copies." }).check();
  await picker.getByRole("button", { name: "Add whole deck", exact: true }).click();
}
async function submit(page: Page, message: string) {
  await page.getByText("Add message or notes", { exact: true }).click();
  await page.getByLabel("Message / notes").fill(message);
  await page.getByRole("button", { name: "Submit Proposal", exact: true }).click();
  await expect(page.getByText("Trade proposal sent.", { exact: true })).toBeVisible();
  return database<string>(`return (await p.trade.findFirstOrThrow({where:{message:${q(message)}}})).id;`);
}
const state = (id: string) => database(`return p.trade.findUniqueOrThrow({where:{id:${q(id)}}});`);

for (const width of [1366, 320]) test(`whole-deck mixed counter, receipt, immutable history and gifts at ${width}px`, async ({ browser, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Requires explicit owned synthetic runtime");
  test.setTimeout(240_000); verifyTarget(baseURL);
  expect(database<number>("return p.tradeAnnouncementWebhookEndpoint.count({where:{enabled:true}});")).toBe(0);
  const baseline = snapshot(), tag = `deck-ui-${randomUUID()}`, password = randomUUID();
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ baseURL, viewport: { width, height: 900 } })));
  const failures: unknown[] = [];
  try {
    const f = database<Fixture>(`const tag=${q(tag)}, hash=await require('bcryptjs').hash(${q(password)},10);return p.$transaction(async tx=>{
      const people=[];
      for(let index=0;index<4;index++){
        const player=index===3?{id:people[0].playerId}:await tx.player.create({data:{id:tag+'-player-'+index,name:tag+'-'+index,displayName:'Deck partner '+index}});
        const user=await tx.user.create({data:{id:tag+'-user-'+index,username:tag+'-'+index,displayName:'Deck partner '+index,passwordHash:hash,playerId:player.id,inventoryDefaultVisibility:'PUBLIC'}});
        const destinationId=tag+'-destination-'+index,folderId=tag+'-folder-'+index,tagId=tag+'-tag-'+index;
        if(index!==3){await tx.inventoryLocation.create({data:{id:destinationId,ownerPlayerId:player.id,name:'Incoming '+index,normalizedName:'incoming-'+index}});await tx.inventoryLocation.create({data:{ownerPlayerId:player.id,name:'Unassigned',normalizedName:'unassigned'}});}
        await tx.deckFolder.create({data:{id:folderId,ownerUserId:user.id,name:'My decks '+index}});
        await tx.deckTag.create({data:{id:tagId,ownerUserId:user.id,name:'My tag '+index,normalizedName:'my tag '+index}});
        people.push({id:user.id,playerId:player.id,username:user.username,destinationId,folderId,tagId});
      }
      const cards=[];for(let index=0;index<59;index++)cards.push(await tx.card.create({data:{id:tag+'-card-'+index,scryfallId:tag+'-'+index,name:tag+' Card '+index,setCode:'tst',collectorNumber:String(index),typeLine:'Artifact',rarity:'common'}}));
      const decks=[];for(const [index,owner] of [0,0,0,1,1,1,1,0,0].entries()){
        const id=tag+'-deck-'+index,locationId=tag+'-location-'+index,name='Review deck '+index+' '+tag;
        await tx.deck.create({data:{id,name,ownerUserId:people[owner].id,visibility:(owner===1&&index!==6)||index===2?'PUBLIC':'PRIVATE',folderId:people[owner].folderId}});
        await tx.deckTagAssignment.create({data:{deckId:id,tagId:people[owner].tagId}});
        await tx.inventoryLocation.create({data:{id:locationId,deckId:id,ownerPlayerId:people[owner].playerId,name:'Deck '+index,normalizedName:id,kind:'DECK',systemManaged:true,visibility:owner===1?'PUBLIC':'PRIVATE'}});
        const count=index===0?55:1;
        for(let i=0;i<count;i++){await tx.deckCard.create({data:{deckId:id,cardId:cards[i].id,cardName:cards[i].name,quantity:2,section:index===7?'MAYBEBOARD':'MAINBOARD',notes:tag+'-PRIVATE-LIST-NOTE'}});if(![1,4,6].includes(index))await tx.inventoryItem.create({data:{id:tag+'-stock-'+index+'-'+i,currentOwnerId:people[owner].playerId,originalOpenerId:people[1-owner].playerId,cardId:cards[i].id,quantity:1,locationId,condition:'NM',foilStatus:i%2?'FOIL':'NONFOIL',foil:!!(i%2),language:i%2?'FR':'EN',sourceType:'MANUAL',notes:tag+'-PRIVATE-STOCK-NOTE'}});}
        if(index===0){await tx.deckCard.create({data:{deckId:id,cardName:'List only Maybeboard',quantity:3,section:'MAYBEBOARD'}});await tx.inventoryItem.create({data:{id:tag+'-zero',currentOwnerId:people[0].playerId,cardId:cards[0].id,quantity:0,condition:'NM',locationId,notes:'Preserve zero metadata'}});}
        decks.push({id,name,owner,locationId});
      }
      const league=await tx.commanderLeague.create({data:{id:tag+'-league',name:tag,slug:tag,year:2026,createdByUserId:people[0].id}});
      const member=await tx.commanderLeagueMember.create({data:{leagueId:league.id,userId:people[0].id,role:'ADMIN'}});
      const round=await tx.commanderLeagueRound.create({data:{leagueId:league.id,monthNumber:1,name:'Round',startDate:new Date('2026-01-01'),endDate:new Date('2026-02-01')}});
      await tx.commanderLeagueDeck.create({data:{leagueId:league.id,memberId:member.id,roundId:round.id,archiveDeckId:decks[8].id,name:'Unsubmitted League deck'}});
      const loose=[];for(let index=0;index<4;index++){const owner=index<2?0:1;const item=await tx.inventoryItem.create({data:{id:tag+'-loose-'+index,currentOwnerId:people[owner].playerId,originalOpenerId:people[owner].playerId,cardId:cards[55+index].id,quantity:6,locationId:people[owner].destinationId,condition:'NM',language:'JA',sourceType:'MANUAL',notes:'Loose provenance'}});loose.push({id:item.id,cardName:cards[55+index].name});}
      return {people,decks,loose};},{timeout:30000});`);
    const [alice, bob, observer, sibling] = await Promise.all(contexts.map(context => context.newPage()));
    for (const [index, page] of [alice, bob, observer, sibling].entries()) { page.setDefaultTimeout(10_000); await login(page, f.people[index], password); }
    const endpoint = (deck: Deck, side: string, owner: number) => `/api/trades/decks?ownerId=${f.people[owner].playerId}&side=${side}&deckId=${deck.id}`;
    expect((await alice.request.get(endpoint(f.decks[6], "requested", 1))).status()).toBe(404);
    expect((await sibling.request.get(endpoint(f.decks[0], "offered", 0))).status()).toBe(404);
    expect((await alice.request.get(endpoint(f.decks[7], "offered", 0))).status()).toBe(409);
    expect((await alice.request.get(endpoint(f.decks[8], "offered", 0))).status()).toBe(409);
    const complete = await (await alice.request.get(endpoint(f.decks[0], "offered", 0))).json();
    expect(complete.review.cards).toHaveLength(56); expect(complete.review.committedCopies).toBe(55);
    expect(JSON.stringify(complete)).not.toMatch(/PRIVATE-LIST-NOTE|PRIVATE-STOCK-NOTE|ownerUserId|originalOpenerId|folderId|tagIds|locationId/);
    await alice.goto(`/decks/${f.decks[0].id}`); await alice.getByRole("link", { name: "Offer whole deck", exact: true }).click();
    await alice.getByRole("combobox", { name: "Trade partner", exact: true }).selectOption(f.people[1].playerId);
    await alice.getByRole("button", { name: "Load desk", exact: true }).click();
    const offeredPicker = alice.getByRole("region", { name: "Whole decks to offer" });
    await expect(offeredPicker.getByRole("heading", { name: `Review ${f.decks[0].name}`, exact: true })).toBeVisible();
    await offeredPicker.getByRole("checkbox").check(); await offeredPicker.getByRole("button", { name: "Add whole deck", exact: true }).click();
    await addDeck(alice, f.decks[1], "offer"); await addDeck(alice, f.decks[3], "request"); await addDeck(alice, f.decks[4], "request");
    async function addLoose(page: Page, index: number, offer: boolean) {
      const search = page.locator("details").filter({ has: page.locator(":scope > summary h3").filter({ hasText: offer ? "Search Deck partner 0's inventory" : "Search Deck partner 1's inventory" }) });
      await search.locator(":scope > summary").click(); await search.getByRole("textbox").fill(f.loose[index].cardName);
      await search.getByRole("button").filter({ hasText: f.loose[index].cardName }).click();
      await search.locator(":scope > summary").click();
    }
    for (let i=0;i<4;i++) await addLoose(alice,i,i<2);
    for (const [index, input] of (await alice.getByLabel("Qty", { exact: true }).all()).entries()) await input.fill(String(index+1));
    expect(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    const original = await submit(alice, tag+" original");
    expect(database<number>(`return p.tradeDeckBundle.count({where:{tradeId:${q(original)}}});`)).toBe(4);
    await alice.goto(`/decks/${f.decks[0].id}`); await expect(alice.getByRole("status")).toContainText("reserved in an active trade");
    await expect(alice.getByRole("link", { name: "Offer whole deck", exact: true })).toHaveCount(0);
    expect((await bob.request.get(endpoint(f.decks[0], "requested", 0))).status()).toBe(404);
    const panel = await openTrade(bob, original);
    await expect(panel.getByRole("region", { name: `Whole deck: ${f.decks[0].name}` })).toContainText("55 committed copies");
    expect(await panel.locator(".trade-card-preview").count()).toBeLessThan(55);
    await panel.getByRole("link", { name: "Counter From This", exact: true }).click();
    await expect(bob.locator('input[name="offeredDecksJson"]')).toHaveValue(new RegExp(f.decks[3].id));
    expect(JSON.parse(await bob.locator('input[name="offeredDecksJson"]').inputValue())).toHaveLength(2);
    expect(JSON.parse(await bob.locator('input[name="requestedDecksJson"]').inputValue())).toHaveLength(2);
    expect(JSON.parse(await bob.locator('input[name="offeredLinesJson"]').inputValue()).map((line: any) => line.quantity)).toEqual([3,4]);
    expect(JSON.parse(await bob.locator('input[name="requestedLinesJson"]').inputValue()).map((line: any) => line.quantity)).toEqual([1,2]);
    await bob.getByRole("button", { name: `Remove ${f.decks[4].name}`, exact: true }).click();
    await bob.getByRole("button", { name: `Remove ${f.decks[1].name}`, exact: true }).click();
    await addDeck(bob,f.decks[5],"offer"); await addDeck(bob,f.decks[2],"request");
    for (const input of await bob.getByLabel("Qty", { exact: true }).all()) await input.fill("1");
    const counter = await submit(bob,tag+" counter"); expect(state(original).status).toBe("DECLINED");
    expect(state(counter).status).toBe("PROPOSED");
    expect((await alice.request.get(endpoint(f.decks[1], "offered", 0))).status()).toBe(200);
    await observer.goto("/trades?view=active"); await expect(observer.locator(`details[data-trade-id="${counter}"]`)).toHaveCount(0);
    const beforeTransfer = database(`return {stock:await p.inventoryItem.findMany({where:{id:{startsWith:${q(tag)}}},orderBy:{id:'asc'}}),list:await p.deckCard.findMany({where:{deckId:{in:${q(f.decks.map(deck=>deck.id))}}},orderBy:{id:'asc'}})};`);
    const firstStock = beforeTransfer.stock.find((row: any) => row.id===tag+'-stock-0-0');
    database(`return p.inventoryItem.update({where:{id:${q(firstStock.id)}},data:{notes:'Injected stale consent'}});`);
    const stalePanel = await openTrade(alice,counter); await stalePanel.getByRole("button", { name:"Accept",exact:true }).click();
    await expect(stalePanel.getByRole("status")).toContainText("A traded deck changed"); expect(state(counter).status).toBe("PROPOSED");
    database(`return p.inventoryItem.update({where:{id:${q(firstStock.id)}},data:{notes:${q(firstStock.notes)},updatedAt:new Date(${q(firstStock.updatedAt)})}});`);
    await (await openTrade(alice,counter)).getByRole("button", { name:"Accept",exact:true }).click();
    await expect.poll(()=>state(counter).status).toBe("ACCEPTED_PENDING_EXCHANGE");
    async function confirm(page: Page, person: number, incoming: Deck[], first: boolean, tradeId=counter, loose=true) {
      const trade = await openTrade(page,tradeId), form = trade.locator("form").filter({ has: page.getByRole("button", { name:"Confirm Physical Trade",exact:true }) });
      if (incoming.length) {
        const beforeStatus=state(tradeId).status;
        expect(await form.getByRole("combobox", { name:incoming[0].name+" visibility",exact:true }).evaluate((select:HTMLSelectElement)=>select.validity.valueMissing)).toBe(true);
        await form.getByRole("button", { name:"Confirm Physical Trade",exact:true }).click();
        expect(state(tradeId).status).toBe(beforeStatus);
      }
      for(const [index,deck] of incoming.entries()){
        await form.getByRole("combobox", { name:deck.name+" visibility",exact:true }).selectOption(index?"PUBLIC":"PRIVATE");
        await form.getByRole("combobox", { name:deck.name+" folder",exact:true }).selectOption(f.people[person].folderId);
        await form.getByRole("group", { name:'Receive '+deck.name,exact:true }).getByRole("checkbox", { name:'My tag '+person,exact:true }).check();
      }
      const destination=form.locator('select[name="destinationLocationId"]');
      if(loose)await destination.selectOption(f.people[person].destinationId);else await expect(destination).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:test.info().outputPath(`receipt-${person}-${tradeId}.png`),fullPage:true});
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({path:test.info().outputPath(`receipt-viewport-${person}-${tradeId}.png`)});
      await form.getByRole("button", { name:"Confirm Physical Trade",exact:true }).click();
      await expect.poll(()=>state(tradeId).status).toBe(first?"PARTIALLY_COMMITTED":"COMPLETED");
    }
    await confirm(bob,1,[f.decks[0],f.decks[2]],true);
    expect(database(`return p.inventoryItem.findMany({where:{id:{startsWith:${q(tag)}}},orderBy:{id:'asc'}});`)).toEqual(beforeTransfer.stock);
    await confirm(alice,0,[f.decks[3],f.decks[5]],false);
    const received = database(`return {decks:await p.deck.findMany({where:{id:{in:${q([0,2,3,5].map(i=>f.decks[i].id))}}},include:{tags:true}}),stock:await p.inventoryItem.findMany({where:{id:{startsWith:${q(tag)}}},orderBy:{id:'asc'}}),list:await p.deckCard.findMany({where:{deckId:{in:${q(f.decks.map(deck=>deck.id))}}},orderBy:{id:'asc'}}),locations:await p.inventoryLocation.findMany({where:{id:{in:${q([0,2,3,5].map(i=>f.decks[i].locationId))}}}})};`);
    expect(received.list).toEqual(beforeTransfer.list);
    for(const i of [0,2,3,5]){
      const deck=received.decks.find((row:any)=>row.id===f.decks[i].id), recipient=1-f.decks[i].owner;
      expect(deck.ownerUserId).toBe(f.people[recipient].id);expect(deck.folderId).toBe(f.people[recipient].folderId);
      expect(deck.tags.map((row:any)=>row.tagId)).toEqual([f.people[recipient].tagId]);
      expect(received.locations.find((row:any)=>row.id===f.decks[i].locationId)).toMatchObject({ownerPlayerId:f.people[recipient].playerId,deckId:deck.id});
      const old=beforeTransfer.stock.filter((row:any)=>row.locationId===f.decks[i].locationId), now=received.stock.filter((row:any)=>row.locationId===f.decks[i].locationId);
      const stable=(rows:any[])=>rows.map(({currentOwnerId,updatedAt,...row})=>row);
      expect(stable(now)).toEqual(stable(old));expect(now.every((row:any)=>row.currentOwnerId===f.people[recipient].playerId)).toBe(true);
    }
    expect(database<number>(`return p.tradeEvent.count({where:{tradeId:${q(counter)},eventType:'completed'}});`)).toBe(1);
    for(const [index,page] of [alice,bob].entries()){
      await page.goto('/decks');for(const i of [0,2,3,5]){
        const links=page.locator(`a[href="/decks/${f.decks[i].id}"]`);
        if(f.decks[i].owner===index)await expect(links).toHaveCount(0);
        else await expect(links.filter({hasText:f.decks[i].name})).toBeVisible();
      }
      const history=await openTrade(page,counter,true);await expect(history.getByRole('region',{name:`Whole deck: ${f.decks[0].name}`})).toContainText('Complete deck list (56 entries)');
      expect(await history.innerHTML()).not.toMatch(/PRIVATE-LIST-NOTE|PRIVATE-STOCK-NOTE/);
    }
    const anonymous=await browser.newContext({baseURL});try{expect((await anonymous.request.get(`/decks/${f.decks[0].id}`)).status()).toBe(404);expect((await anonymous.request.get(`/decks/${f.decks[2].id}`)).status()).toBe(200);}finally{await anonymous.close();}
    database(`return p.deck.update({where:{id:${q(f.decks[0].id)}},data:{name:'Renamed after completion'}});`);
    await expect((await openTrade(alice,counter,true)).getByRole('region',{name:`Whole deck: ${f.decks[0].name}`})).toBeVisible();
    for(const requestOnly of [false,true]){
      const deck=f.decks[requestOnly?4:1];await alice.goto(`/trades?receiverId=${f.people[1].playerId}`);
      await expect(alice.getByRole('button',{name:'Submit Proposal',exact:true})).toBeDisabled();
      await addDeck(alice,deck,requestOnly?'request':'offer');const gift=await submit(alice,tag+' gift '+requestOnly);
      await (await openTrade(bob,gift)).getByRole('button',{name:'Accept',exact:true}).click();await expect.poll(()=>state(gift).status).toBe('ACCEPTED_PENDING_EXCHANGE');
      await confirm(alice,0,requestOnly?[deck]:[],true,gift,false);await confirm(bob,1,requestOnly?[]:[deck],false,gift,false);
      expect(database(`return p.deck.findUniqueOrThrow({where:{id:${q(deck.id)}}});`).ownerUserId).toBe(f.people[requestOnly?0:1].id);
    }
  }catch(error){failures.push(error);}finally{
    for(const context of contexts)try{await context.close();}catch(error){failures.push(error);}
    try{
      database(`const ids=${q([0,1,2,3].map(i=>tag+'-user-'+i))},owners=${q([0,1,2].map(i=>tag+'-player-'+i))};const trades=await p.trade.findMany({where:{createdByUserId:{in:ids}},select:{id:true}}),tradeIds=trades.map(row=>row.id);
        await p.notificationDeliveryJob.deleteMany({where:{sourceId:{in:tradeIds}}});await p.notification.deleteMany({where:{recipientUserId:{in:ids}}});
        await p.inventoryAuditLog.deleteMany({where:{OR:[{changedByUserId:{in:ids}},{tradeId:{in:tradeIds}}]}});await p.trade.deleteMany({where:{id:{in:tradeIds}}});
        await p.inventoryItem.deleteMany({where:{cardId:{startsWith:${q(tag)}}}});await p.commanderLeague.deleteMany({where:{id:${q(tag+'-league')}}});
        await p.deck.deleteMany({where:{id:{startsWith:${q(tag)}}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:owners}}});
        await p.deckFolder.deleteMany({where:{ownerUserId:{in:ids}}});await p.deckTag.deleteMany({where:{ownerUserId:{in:ids}}});await p.user.deleteMany({where:{id:{in:ids}}});await p.player.deleteMany({where:{id:{in:owners}}});await p.card.deleteMany({where:{id:{startsWith:${q(tag)}}}});return true;`);
      assert.deepEqual(snapshot(),baseline,'All original table fingerprints must match after exact owned cleanup');
      console.log(`PASS exact owned ${width}px fixture cleanup and ${Object.keys(baseline).length}-table preservation`);
    }catch(error){failures.push(error);}
    if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'Deck workflow and cleanup failed');
  }
});
