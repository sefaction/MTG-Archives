import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

test.use({ actionTimeout: 15000 });
function database(body: string) {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.code||'Fixture database failed');process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}

for (const width of [1366, 390]) test(`filtered review navigation reaches a card beyond the first page at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local presentation fixture; no recognition or hardware claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  await page.setViewportSize({width, height: 900});
  const tag = `ui-page-navigation-${randomUUID()}`, password = randomUUID();
  const printing = {id: `${tag}-card`, name: "Review navigation fixture", setCode: "tst", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"]};
  const bytes = await sharp({create: {width: 300, height: 420, channels: 3, background: "#335577"}}).jpeg().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex"), photos: string[] = [];
  let batch = "";
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});console.log('{}');`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", {name: /^log in$/i}).click(); await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", {headers: {origin: baseURL!}, data: {requestKey: randomUUID(), locationId: tag, section: "", quantity: 14}});
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const endpoint = `/api/acquisition/${batch}/review`;
    for (let index = 0; index < 14; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, {headers: {origin: baseURL!}, data: {action: "reserve", requestKey: randomUUID()}});
      expect(reserved.ok()).toBe(true); const {slot} = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`, {headers: {origin: baseURL!, "content-type": "image/jpeg"}, data: bytes});
      expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      // Only these presentation-fixture jobs are stopped. Real original/review
      // persistence and candidate ordering are exercised; no native score claim.
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});console.log('{}');`);
      if (index < 13) {
        const record = await (await page.request.get(`${endpoint}?photoId=${photos[index]}`)).json();
        const saved = await page.request.post(endpoint, {headers: {origin: baseURL!}, data: {action: "accept", photoId: photos[index], revision: record.revision, decision: {cardId: printing.id, finish: "NONFOIL", condition: "NM", language: "en"}}});
        expect(saved.ok()).toBe(true);
      }
    }
    const initial = database(`console.log(JSON.stringify(await p.acquisitionCandidate.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{acquisitionOrder:'asc'},select:{id:true,review:true,revision:true}})));`);
    await page.route(`**${endpoint}?photoId=*`, async route => {
      const response = await route.fetch(); expect(response.ok()).toBe(true); const record = await response.json();
      await route.fulfill({json: {...record, suggestions: [{printing, reasons: ["Controlled UI fixture"]}]}});
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const first = page.getByTestId("capture-card-1"), target = page.getByTestId("capture-card-14");
    const filter = page.getByRole("combobox", {name: "Show cards", exact: true});
    await filter.selectOption("ready"); await first.scrollIntoViewIfNeeded();
    await expect(target).toHaveCount(0);
    await first.getByRole("button", {name: "Next awaiting review", exact: true}).click();
    await expect(filter).toHaveValue("all"); await expect(target).toBeFocused();
    expect(await target.evaluate(element => {const box = element.getBoundingClientRect();return box.top < innerHeight && box.bottom > 0;})).toBe(true);
    await page.screenshot({path: `test-results/review-navigation-target-${width}.png`});
    // A manual filter change still returns to bounded paging. Inspecting a bulk
    // proposal must independently reveal the same off-page physical card.
    await filter.selectOption("ready"); await first.scrollIntoViewIfNeeded();
    await expect(target).toHaveCount(0);
    const bulk = page.getByRole("region", {name: "Bulk match review", exact: true});
    await bulk.getByRole("button", {name: "Bulk Confirm Match", exact: true}).click();
    await bulk.getByRole("link", {name: "Inspect or correct", exact: true}).click();
    await expect(filter).toHaveValue("all"); await expect(target).toBeVisible();
    expect(await target.evaluate(element => {const box = element.getBoundingClientRect();return box.top < innerHeight && box.bottom > 0;})).toBe(true);
    await first.scrollIntoViewIfNeeded(); await first.getByRole("button", {name: "Correct", exact: true}).click();
    await first.getByRole("combobox", {name: "Card condition", exact: true}).selectOption("LP");
    await filter.selectOption("ready"); await first.scrollIntoViewIfNeeded();
    await first.getByRole("button", {name: "Next awaiting review", exact: true}).click();
    await expect(target).toBeFocused(); await expect(first.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
    await page.reload(); await first.scrollIntoViewIfNeeded();
    await expect(first.getByRole("combobox", {name: "Card condition", exact: true})).toHaveValue("LP");
    expect(database(`console.log(JSON.stringify(await p.acquisitionCandidate.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},orderBy:{acquisitionOrder:'asc'},select:{id:true,review:true,revision:true}})));`)).toEqual(initial);
    expect(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`)).toBe(0);
    expect(database(`console.log(JSON.stringify(await p.acquisitionPhoto.findMany({where:{run:{sessionId:${JSON.stringify(batch)}}},select:{digest:true}})));`)).toEqual(Array.from({length:14},()=>({digest})));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `test-results/review-navigation-${width}.png`});
  } finally {
    try {
      if (!page.isClosed()) {
        await page.unrouteAll({behavior: "wait"});
        await page.close();
      }
    } finally {
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Fixture root missing');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Unexpected fixture photo');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}console.log('{}');`);
    }
  }
});