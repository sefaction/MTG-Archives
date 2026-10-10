import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { cleanupCorrectionFixture } from "./correction-fixture";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { windowsHide:true,encoding:"utf8",timeout:30000,
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());` });
}

test("bulk deselection survives incremental proposals without a review or Inventory write",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local controlled proposals; no recognition/hardware claim");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({width:1366,height:768});
  const tag=`ui-bulk-preview-${randomUUID()}`,password=randomUUID();
  const printing={id:`${tag}-card`,name:"Bulk preview fixture",setCode:"tst",collectorNumber:"1",lang:"en",imageUri:null,finishes:["nonfoil","foil"]};
  let batch="",hold=false,held=0,pending=0;
  let release:()=>void=()=>{};let gate=new Promise<void>(resolve=>{release=resolve;});
  let obsolete=false,changeSecond=false;
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:64,sections:[{name:'A',capacity:64}]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const created=await page.request.post("/api/acquisition",{headers:{origin:baseURL!},data:{requestKey:randomUUID(),locationId:tag,section:"A",quantity:32}});
    expect(created.ok()).toBe(true);batch=(await created.json()).id;
    const bytes=await sharp({create:{width:300,height:420,channels:3,background:"#335577"}}).jpeg().toBuffer();
    const photos:string[]=[];
    for(let index=0;index<32;index++){
      const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers:{origin:baseURL!},data:{action:"reserve",requestKey:randomUUID()}});
      expect(reserved.ok()).toBe(true);const {slot}=await reserved.json();
      const uploaded=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,{headers:{origin:baseURL!,"content-type":"image/jpeg"},data:bytes});
      expect(uploaded.ok()).toBe(true);photos.push((await uploaded.json()).id);
      database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    }
    const endpoint=`/api/acquisition/${batch}/review`;
    await page.route(`**${endpoint}?*`,async route=>{
      const wasObsolete=obsolete,wasChanged=changeSecond,wait=gate,shouldHold=hold;
      const response=await route.fetch();const record=await response.json();
      const index=photos.indexOf(new URL(route.request().url()).searchParams.get("photoId")!);
      const delayed=shouldHold&&index>=4;
      if(delayed){held++;pending++;await wait;}
      try {
        const proposal=wasObsolete?{...printing,name:"Obsolete preview"}:wasChanged&&index===1?{...printing,id:`${tag}-different`,collectorNumber:"2",name:"Changed printing"}:printing;
        await route.fulfill({json:{...record,suggestions:[{printing:proposal,reasons:["Controlled bulk proposal"]}]}});
      } finally { if(delayed) pending--; }
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    // Settle initial individual-row lookups before holding bulk requests.
    await page.getByTestId("capture-card-1").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("capture-card-1")).toContainText(printing.name);
    const bulk=page.getByRole("region",{name:"Bulk match review",exact:true});
    hold=true;await bulk.getByRole("button",{name:"Bulk Confirm Match",exact:true}).click();
    await expect(bulk).toContainText("Loading proposals: 4 of 32");await expect.poll(()=>held).toBe(4);
    const first=bulk.getByRole("checkbox",{name:`Card 1: ${printing.name}`,exact:true});
    await first.uncheck();await expect(first).not.toBeChecked();release();
    await expect(bulk.getByText(/Loading proposals:/)).toHaveCount(0);
    await expect(first).not.toBeChecked(); // Old local next-array replaces the user's deselection.
    await expect(bulk.getByRole("button",{name:"Confirm 31 selected matches",exact:true})).toBeEnabled();
    // Explicit approval cannot silently transfer to a newly proposed printing.
    const second=bulk.getByRole("checkbox",{name:`Card 2: ${printing.name}`,exact:true});
    await second.uncheck();await second.check();changeSecond=true;
    await bulk.getByRole("button",{name:"Reload proposals",exact:true}).click();
    await expect(bulk.getByText(/Loading proposals:/)).toHaveCount(0);
    await expect(bulk.getByRole("checkbox",{name:"Card 2: Changed printing",exact:true})).not.toBeChecked();
    await expect(first).not.toBeChecked();
    await expect(bulk.getByRole("button",{name:"Confirm 30 selected matches",exact:true})).toBeEnabled();
    changeSecond=false;
    // Exercise the full incremental list and both layouts without saving it.
    const choices=bulk.getByRole("checkbox");
    for(let step=0;step<Math.ceil(32/12);step++){
      const before=await choices.count();if(before===32)break;
      // Scroll through the last card's image: its checkbox is above the tall
      // image and can leave the paging trigger below the viewport margin.
      // Avoid racing a click against the automatically removed Load more button.
      await bulk.getByRole("img",{name:`Scan of card ${before}`,exact:true}).scrollIntoViewIfNeeded();
      await expect.poll(()=>choices.count()).toBeGreaterThan(before);
    }
    await bulk.getByRole("checkbox",{name:`Card 32: ${printing.name}`,exact:true}).scrollIntoViewIfNeeded();
    await expect(bulk.getByRole("checkbox")).toHaveCount(32);
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({path:"test-results/bulk-preview-desktop.png",fullPage:false});
    await page.setViewportSize({width:320,height:700});
    await first.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/bulk-preview-phone.png",fullPage:false});
    await page.setViewportSize({width:1366,height:768});
    // Replace a preview while its later group is still in flight.
    held=0;hold=true;obsolete=true;gate=new Promise<void>(resolve=>{release=resolve;});
    await bulk.getByRole("button",{name:"Reload proposals",exact:true}).click();
    await expect(bulk).toContainText("Loading proposals: 4 of 32");await expect.poll(()=>held).toBe(4);
    hold=false;obsolete=false;
    await bulk.getByRole("button",{name:"Reload proposals",exact:true}).click();
    await expect(bulk.getByText(/Loading proposals:/)).toHaveCount(0);
    release();
    await expect.poll(()=>pending).toBe(0);
    await expect(bulk).not.toContainText("Obsolete preview");
    await expect(first).not.toBeChecked();
    await expect(bulk.getByRole("button",{name:"Confirm 31 selected matches",exact:true})).toBeEnabled();
    // Closing and reopening also invalidates an old generation.
    held=0;hold=true;obsolete=true;gate=new Promise<void>(resolve=>{release=resolve;});
    await bulk.getByRole("button",{name:"Reload proposals",exact:true}).click();
    await expect(bulk).toContainText("Loading proposals: 4 of 32");await expect.poll(()=>held).toBe(4);
    await bulk.getByRole("button",{name:"Back to card list",exact:true}).click();
    hold=false;obsolete=false;
    await bulk.getByRole("button",{name:"Bulk Confirm Match",exact:true}).click();
    await expect(bulk.getByText(/Loading proposals:/)).toHaveCount(0);
    release();
    await expect.poll(()=>pending).toBe(0);
    await expect(bulk).not.toContainText("Obsolete preview");
    await expect(first).not.toBeChecked();
    await expect(bulk.getByRole("button",{name:"Confirm 31 selected matches",exact:true})).toBeEnabled();
    const counts=JSON.parse(database(`const w={run:{sessionId:${JSON.stringify(batch)}}};console.log(JSON.stringify({reviews:await p.acquisitionCandidate.count({where:{...w,review:{not:require('@prisma/client').Prisma.DbNull}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})}));`));
    expect(counts).toEqual({reviews:0,inventory:0});
  }finally{
    release();
    try{if(!page.isClosed())await page.unrouteAll({behavior:"wait"});}
    catch{console.log("Browser unavailable; owned database cleanup still runs");}
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      ${cleanupCorrectionFixture}
      await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
