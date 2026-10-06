import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import sharp from "sharp";

test.use({hasTouch: true});
function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {windowsHide:true,encoding:"utf8",timeout:30000,
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`});
}

test("manual boundary pointer/keyboard repair, failed and lost acknowledgements, drafts, stale edits, reset and Inventory fence", async ({page,baseURL}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local originals and reviews; controlled suggestions, no accuracy or hardware claim");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag=`ui-manual-region-${randomUUID()}`, password=randomUUID();
  const original={id:`${tag}-original`,name:"Boundary fixture original",setCode:"tst",collectorNumber:"1",lang:"en",
    imageUri:"/fixture-region-original.svg",finishes:["nonfoil","foil"]};
  const alternate={...original,id:`${tag}-alternate`,name:"Boundary fixture alternate",collectorNumber:"2",imageUri:"/fixture-region-alternate.svg"};
  let batch="", photoId="", mode:"reject"|"lost"|"pass"="reject";
  const requests: {requestKey:string;revision:number;region:unknown}[]=[];
  const projectedRevisions: number[]=[];
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[{name:'A',capacity:1}]}}});for(const card of ${JSON.stringify([original,alternate])})await p.card.create({data:{...card,scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click(); await page.waitForURL(/\/dashboard/);
    const created=await page.request.post("/api/acquisition",{headers:{origin:baseURL!},data:{requestKey:randomUUID(),locationId:tag,section:"A",quantity:1}});
    expect(created.ok()).toBe(true);batch=(await created.json()).id;
    const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers:{origin:baseURL!},data:{action:"reserve",requestKey:randomUUID()}});
    expect(reserved.ok()).toBe(true);const {slot}=await reserved.json();
    const bytes=await sharp({create:{width:600,height:840,channels:3,background:"#335577"}}).jpeg().toBuffer();
    const uploaded=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=PHOTO`,{
      headers:{origin:baseURL!,"content-type":"image/jpeg"},data:bytes});
    expect(uploaded.ok()).toBe(true);photoId=(await uploaded.json()).id;
    // This case qualifies UI/save/receipt behavior. Native mechanics and actual
    // queue processing are independently qualified in offline/PG fixtures.
    database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},OR:[{status:{in:['PENDING','RUNNING']}},{stage:'photo-canonical-v1'}]},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    const endpoint=`/api/acquisition/${batch}/review`;
    const read=async()=> (await page.request.get(`${endpoint}?photoId=${photoId}`)).json();
    const start=await read();
    expect((await page.request.post(endpoint,{headers:{origin:baseURL!},data:{action:"accept",photoId,revision:start.revision,
      decision:{cardId:original.id,finish:"NONFOIL",condition:"NM",language:"en"}}})).ok()).toBe(true);
    const savedReview=(await read()).review;
    await page.route("**/fixture-region-*.svg",route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#7799aa"/></svg>'}));
    await page.route(`**${endpoint}?*`,async route=>{
      const response=await route.fetch();expect(response.ok()).toBe(true);const record=await response.json();
      projectedRevisions.push(record.revision);
      await route.fulfill({json:{...record,recognitionStatus:"PENDING",visualStatus:"RUNNING",printingStatus:"RUNNING",
        suggestions:[original,alternate].map(printing=>({printing,reasons:["Controlled UI fixture"]}))}});
    });
    await page.route(`**${endpoint}`,async route=>{
      const body=route.request().postDataJSON();
      if(body.action!=="region")return route.continue();
      requests.push(body);
      if(mode==="reject")return route.fulfill({status:503,json:{error:"Controlled boundary retry"}});
      if(mode==="lost") {const response=await route.fetch();expect(response.ok()).toBe(true);return route.abort("failed");}
      return route.continue();
    });
    await page.goto(`/imports/scan?batch=${batch}`);
    const card=page.getByTestId("capture-card-1");await card.scrollIntoViewIfNeeded();
    await card.getByRole("button",{name:"Correct",exact:true}).click();
    const alternateChoice=card.getByRole("radio",{name:/Boundary fixture alternate/});await alternateChoice.check();
    const condition=card.getByRole("combobox",{name:"Card condition",exact:true});await condition.selectOption("LP");
    await expect(card.getByRole("button",{name:"Edit card boundary",exact:true})).toBeVisible();
    await card.getByRole("button",{name:"Edit card boundary",exact:true}).click();
    const editor=card.getByRole("region",{name:"Card boundary editor",exact:true});
    const first=editor.getByRole("button",{name:"Card corner 1",exact:true});
    await first.press("ArrowRight");await first.press("Shift+ArrowDown");
    await page.setViewportSize({width:1366,height:900});
    const third=editor.getByRole("button",{name:"Card corner 3",exact:true});await third.scrollIntoViewIfNeeded();
    const box=await third.boundingBox();await page.mouse.move(box!.x+22,box!.y+22);await page.mouse.down();
    await page.mouse.move(box!.x+6,box!.y+5,{steps:4});await page.mouse.up();
    const corners=await first.getAttribute("style");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/manual-boundary-desktop.png"});
    await editor.screenshot({path:"test-results/manual-boundary-desktop-editor.png"});
    const apply=editor.getByRole("button",{name:"Apply boundary and recheck",exact:true});
    await apply.click();await expect(editor).toContainText("Controlled boundary retry");expect(await first.getAttribute("style")).toBe(corners);
    expect((await read()).manualRegion).toBeNull();
    mode="lost";await apply.click();await expect(editor).toContainText("Failed to fetch");
    await expect.poll(async()=> (await read()).revision).toBe(requests[0].revision+1);
    expect(await first.getAttribute("style")).toBe(corners);
    mode="pass";await apply.click();await expect(editor).toBeHidden();await expect(card).toContainText("Boundary saved.");
    expect(new Set(requests.map(request=>request.requestKey)).size).toBe(1);
    expect((await read()).review).toEqual(savedReview);expect((await read()).manualRegion).toEqual(requests[0].region);
    expect(Number(database(`console.log(await p.acquisitionCommand.count({where:{run:{sessionId:${JSON.stringify(batch)}},requestKey:{startsWith:'manual-region:'}}}));`))).toBe(1);
    await expect(alternateChoice).toBeChecked();await expect(condition).toHaveValue("LP");
    await page.reload();await card.scrollIntoViewIfNeeded();await expect(condition).toHaveValue("LP");await expect(alternateChoice).toBeChecked();
    await page.setViewportSize({width:320,height:900});await card.getByRole("button",{name:"Edit card boundary",exact:true}).click();
    const second=editor.getByRole("button",{name:"Card corner 2",exact:true});await second.scrollIntoViewIfNeeded();
    const touch=await second.boundingBox(), beforeTouch=await second.getAttribute("style");
    const client=await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:touch!.x+22,y:touch!.y+22}]});
    await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:touch!.x+10,y:touch!.y+30}]});
    await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await client.detach();
    await expect.poll(()=>second.getAttribute("style")).not.toBe(beforeTouch);
    expect(touch!.width).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/manual-boundary-phone.png"});
    await editor.screenshot({path:"test-results/manual-boundary-phone-editor.png"});
    for(let index=0;index<55;index++)await first.press("Shift+ArrowRight");
    const beforeInvalid=requests.length;await apply.click();await expect(editor).toContainText("without crossing edges");expect(requests.length).toBe(beforeInvalid);
    await editor.getByRole("button",{name:"Cancel boundary changes",exact:true}).click();await expect(condition).toHaveValue("LP");
    await card.getByRole("button",{name:"Edit card boundary",exact:true}).click();const beforeStale=await first.getAttribute("style");
    const current=await read();expect((await page.request.post(endpoint,{headers:{origin:baseURL!},data:{action:"region",photoId,
      revision:current.revision,requestKey:randomUUID(),region:null}})).ok()).toBe(true);
    await expect(editor).toContainText("This card changed while you were editing");await expect(apply).toBeDisabled();
    expect(await first.getAttribute("style")).toBe(beforeStale);
    await editor.getByRole("button",{name:"Cancel boundary changes",exact:true}).click();await expect(condition).toHaveValue("LP");
    await card.getByRole("button",{name:"Cancel changes",exact:true}).click();await expect(card).toContainText(/nonfoil · NM/i);
    await card.getByRole("button",{name:"Correct",exact:true}).click();await expect(condition).toHaveValue("NM");
    await expect(card.getByRole("radio",{name:/Boundary fixture original/})).toBeChecked();
    await card.getByRole("button",{name:"Edit card boundary",exact:true}).click();await editor.getByRole("button",{name:"Use automatic boundary",exact:true}).click();
    await expect(editor).toBeHidden();expect((await read()).manualRegion).toBeNull();expect((await read()).review).toEqual(savedReview);
    await alternateChoice.check();await condition.selectOption("LP");
    await card.getByRole("button",{name:"Save card review",exact:true}).click();await expect(card).toContainText("Review saved. Not yet added to Inventory.");
    // A reviewed card stops its analysis poll. Another client's boundary-only
    // correction must still refresh this view through batch progress revision.
    const reviewed=await read();projectedRevisions.length=0;
    expect((await page.request.post(endpoint,{headers:{origin:baseURL!},data:{action:"region",photoId,
      revision:reviewed.revision,requestKey:randomUUID(),region:requests[0].region}})).ok()).toBe(true);
    const otherClient=await read();expect(otherClient.review).toEqual(reviewed.review);
    await expect.poll(()=>projectedRevisions.includes(otherClient.revision)).toBe(true);
    await expect(card).toContainText(/nonfoil · LP/i);
    await card.getByRole("button",{name:"Correct",exact:true}).click();
    await expect(condition).toHaveValue("LP");await expect(alternateChoice).toBeChecked();
    await card.getByRole("button",{name:"Cancel changes",exact:true}).click();
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    const metadata=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photoId)}},select:{digest:true,inputKind:true}})));`));
    expect(metadata).toEqual({digest:createHash("sha256").update(bytes).digest("hex"),inputKind:"PHOTO"});
    await page.getByRole("button",{name:"Stop capture",exact:true}).click();
    await card.scrollIntoViewIfNeeded();await card.getByRole("button",{name:"Continue to Inventory",exact:true}).click();
    const inventory=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});
    await inventory.getByRole("button",{name:"Preview selected cards",exact:true}).click();
    await inventory.getByLabel("Confirm Inventory addition",{exact:true}).getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();
    await expect(card).toContainText("Added to Inventory");await expect(card.getByRole("button",{name:"Edit card boundary",exact:true})).toHaveCount(0);
    const committed=await read();const denied=await page.request.post(endpoint,{headers:{origin:baseURL!},data:{action:"region",photoId,
      revision:committed.revision,requestKey:randomUUID(),region:requests[0].region}});
    expect(denied.ok()).toBe(false);expect((await denied.json()).error).toMatch(/already committed/);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(1);
  } finally {
    await page.unrouteAll({behavior:"wait"});
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:{in:${JSON.stringify([original.id,alternate.id])}}}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Private fixture storage unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned photo');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
