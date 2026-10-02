import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {acquisitionDraftKey} from "../../lib/acquisition-browser-review-draft";

function database(body: string) {
  return JSON.parse(execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    windowsHide: true, encoding: "utf8", timeout: 30000,
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(()=>{process.exitCode=1}).finally(()=>p.$disconnect());`,
  }));
}
for (const width of [1366, 320]) test(`saved card exposes explicit Inventory handoff and protects corrections at ${width}px`, async ({page, baseURL}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local presentation/commit fixture; no native or hardware accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  page.setDefaultTimeout(15000); await page.setViewportSize({width, height:900});
  const tag = `ui-inventory-handoff-${randomUUID()}`, password = randomUUID();
  const printing = {id: `${tag}-card`, name: "Inventory handoff fixture", setCode: "tst", collectorNumber: "1",
    lang: "en", imageUri: null, finishes: ["nonfoil"]};
  let batch = "";
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:20,sections:[{name:'A',capacity:20}]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});console.log('{}');`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password); await page.getByRole("button", {name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    const created = await page.request.post("/api/acquisition", {headers:{origin:baseURL!},
      data:{requestKey:randomUUID(),locationId:tag,section:"A",quantity:3}});
    expect(created.ok()).toBe(true); batch = (await created.json()).id;
    const bytes = await sharp({create:{width:300,height:420,channels:3,background:"#335577"}}).jpeg().toBuffer();
    const photos: string[] = [];
    for (let index=0; index<3; index++) {
      const reserved = await page.request.post(`/api/acquisition/${batch}`, {headers:{origin:baseURL!},
        data:{action:"reserve",requestKey:randomUUID()}});
      expect(reserved.ok()).toBe(true); const {slot} = await reserved.json();
      const uploaded = await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,
        {headers:{origin:baseURL!,"content-type":"image/jpeg"},data:bytes});
      expect(uploaded.ok()).toBe(true); photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});console.log('{}');`);
    }
    const endpoint = `/api/acquisition/${batch}/review`;
    for (const photoId of [photos[0],photos[2]]) {
      const record = await (await page.request.get(`${endpoint}?photoId=${photoId}`)).json();
      expect((await page.request.post(endpoint,{headers:{origin:baseURL!},data:{action:"accept",photoId,
        revision:record.revision,decision:{cardId:printing.id,finish:"NONFOIL",condition:"NM",language:"en"}}})).ok()).toBe(true);
    }
    await page.route(`**${endpoint}?*`,async route=>{
      const response=await route.fetch(); const record=await response.json();
      await route.fulfill({json:{...record,suggestions:[{printing,reasons:["Controlled UI fixture"]}]}});
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    await page.getByRole("button",{name:"Simple",exact:true}).click();
    const first=page.getByTestId("capture-card-1"), second=page.getByTestId("capture-card-2"), third=page.getByTestId("capture-card-3");
    await first.scrollIntoViewIfNeeded();
    const next=first.getByRole("button",{name:"Continue to Inventory",exact:true});
    await expect(next).toBeVisible(); await expect(next).toBeEnabled();
    await expect(second.getByRole("button",{name:"Continue to Inventory",exact:true})).toHaveCount(0);
    // No storage event/render occurs between this new correction and the click.
    // The handoff must re-read its own key and preserve even unreadable drafts.
    await next.evaluate((button,key)=>{
      localStorage.setItem(key,"controlled unreadable correction");
      (button as HTMLButtonElement).click();
      localStorage.removeItem(key);
    },acquisitionDraftKey({userId:tag,batchId:batch,photoId:photos[0]}));
    await expect(page.getByText("Save or cancel this correction before continuing to Inventory.",{exact:true})).toBeVisible();
    await expect(page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true})).toBeHidden();
    await first.getByRole("button",{name:"Correct",exact:true}).click();
    await first.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");
    await expect(next).toBeDisabled(); await expect(first).toContainText("Save or cancel this correction");
    await first.getByRole("button",{name:"Cancel changes",exact:true}).click();
    await expect(next).toBeEnabled();
    await third.getByRole("checkbox",{name:"Select card 3 for Inventory",exact:true}).check();
    await first.scrollIntoViewIfNeeded(); await next.focus(); await page.keyboard.press("Enter");
    const inventory=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});
    await expect(inventory).toBeVisible(); await expect(inventory).toContainText("2 selected");
    await expect(page.locator("#scan-inventory")).toBeFocused();
    expect(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`)).toBe(0);
    await expect(inventory.getByRole("button",{name:"Preview selected cards",exact:true})).toBeDisabled();
    await inventory.getByRole("link",{name:"Go to capture controls",exact:true}).click();
    await page.getByRole("button",{name:"Stop capture",exact:true}).click();
    await first.scrollIntoViewIfNeeded(); await next.click();
    await inventory.getByRole("button",{name:"Preview selected cards",exact:true}).click();
    const confirm=inventory.getByLabel("Confirm Inventory addition",{exact:true});
    await expect(confirm).toContainText("Add 2 copies");
    expect(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/inventory-handoff-${width}.png`});
    await confirm.getByRole("button",{name:"Add 2 copies to Inventory",exact:true}).click();
    await expect(inventory).toContainText("Added 2 copies to Inventory.");
    const evidence=database(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({copies:await p.inventoryItem.aggregate({where:{currentOwnerId:n},_sum:{quantity:true}}),members:await p.acquisitionCommitMember.count({where:{candidate:{run:{sessionId:${JSON.stringify(batch)}}}}}),rows:await p.inventoryItem.count({where:{currentOwnerId:n}}),audits:await p.inventoryAuditLog.findMany({where:{changedByUserId:n,changeType:'acquisition_committed'},select:{afterJson:true}})}));`);
    expect(evidence.copies._sum.quantity).toBe(2); expect(evidence.members).toBe(2);
    expect(evidence.rows).toBe(1); expect(evidence.audits).toHaveLength(1);
    expect(evidence.audits[0].afterJson.quantity).toBe(2);
    await page.reload(); await first.scrollIntoViewIfNeeded(); await expect(first).toContainText("Added to Inventory");
    await expect(first.getByRole("button",{name:"Continue to Inventory",exact:true})).toHaveCount(0);
  } finally {
    await page.unrouteAll({behavior:"wait"}); await page.close();
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Private fixture storage unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Unexpected fixture photo');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}console.log('{}');`);
  }
});
