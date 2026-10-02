import {expect,test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
function database(body:string){return execFileSync("docker",["exec","-i","mtg-archives-web-1","node"],{input:`const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,encoding:"utf8",timeout:30000,windowsHide:true});}
for(const width of [1366,390]) test(`terminal scan states offer safe manual recovery at ${width}px`,async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local controlled status fixture; no native/hardware claim");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(180000);page.setDefaultTimeout(15000);await page.setViewportSize({width,height:900});
  const tag=`ui-processing-${randomUUID()}`,password=randomUUID();
  const printing={id:tag,name:`Recovery fixture ${tag}`,setCode:"tst",collectorNumber:"1",lang:"en",finishes:["nonfoil","foil"],imageUri:"/processing-fixture.svg"};
  const bytes=await sharp({create:{width:300,height:420,channels:3,background:"#667788"}}).png().toBuffer();const digest=createHash("sha256").update(bytes).digest("hex");
  let batch="",photo="",status:any={recognitionStatus:"FAILED",visualStatus:"COMPLETE",printingStatus:"COMPLETE",catalog:null},reads=0;
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box'}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const created=await page.request.post("/api/acquisition",{headers:{origin:baseURL!},data:{requestKey:randomUUID(),locationId:tag,section:"",quantity:1}});expect(created.ok()).toBe(true);batch=(await created.json()).id;
    const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers:{origin:baseURL!},data:{action:"reserve",requestKey:randomUUID()}});expect(reserved.ok()).toBe(true);const{slot}=await reserved.json();
    const uploaded=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,{headers:{origin:baseURL!,"content-type":"image/png"},data:bytes});expect(uploaded.ok()).toBe(true);photo=(await uploaded.json()).id;
    database(`await p.acquisitionProcessingJob.updateMany({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,errorCode:'CONTROLLED_UI_FIXTURE'}});`);
    const endpoint=`/api/acquisition/${batch}/review`;
    await page.route("**/processing-fixture.svg",r=>r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#778899"/></svg>'}));
    await page.route(`**${endpoint}?photoId=*`,async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);const record=await response.json();reads++;await route.fulfill({json:{...record,...status,suggestions:[]}});});
    const card=page.getByTestId("capture-card-1"),compact=card.getByTestId("scan-compact-status"),recovery=card.getByTestId("scan-processing-recovery");
    const original=async()=>{const response=await page.request.get(`/api/acquisition/${batch}/photos/${photo}`);expect(response.ok()).toBe(true);expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(digest);};
    const saved=async()=> (await(await page.request.get(`${endpoint}?photoId=${photo}`)).json()).review;
    const inventory=()=>Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`));
    for(const [next,label] of [
      [{recognitionStatus:"FAILED",visualStatus:"COMPLETE",printingStatus:"COMPLETE",catalog:null},"Card identification failed"],
      [{recognitionStatus:"NO_MATCH",visualStatus:"FAILED",printingStatus:"COMPLETE",catalog:null},"Image comparison failed"],
      [{recognitionStatus:"NO_MATCH",visualStatus:"COMPLETE",printingStatus:"FAILED",catalog:{status:"CHECKING",printingCoverage:"UNRESOLVED"}},"Printing check failed"],
      [{recognitionStatus:"NO_MATCH",visualStatus:"COMPLETE",printingStatus:"COMPLETE",catalog:null},"No printing found"],
    ] as const){status=next;await page.goto(`/imports/scan?batch=${batch}`);await card.scrollIntoViewIfNeeded();await expect(compact).toHaveText(label);await expect(recovery.getByRole("button",{name:"Find printing manually",exact:true})).toBeVisible();await expect(compact).not.toContainText("Waiting");expect(await saved()).toBeNull();expect(inventory()).toBe(0);console.log(JSON.stringify({width,terminalState:label,passed:true}));}
    await card.screenshot({path:`test-results/processing-failure-${width}.png`});
    // A late supplemental failure updates in place, including a dirty correction.
    status={recognitionStatus:"NO_MATCH",visualStatus:"RUNNING",printingStatus:"COMPLETE",catalog:null};await page.reload();await card.scrollIntoViewIfNeeded();await expect(compact).toHaveText("Comparing card image…");
    const before=reads;status={...status,visualStatus:"FAILED"};await expect.poll(()=>reads,{timeout:15000}).toBeGreaterThan(before);await expect(compact).toHaveText("Image comparison failed");
    status={...status,visualStatus:"RUNNING"};
    await recovery.getByRole("button",{name:"Find printing manually",exact:true}).click();await expect(card.getByLabel("Card name",{exact:true})).toBeFocused();await card.getByLabel("Card name",{exact:true}).fill(printing.name);await card.getByRole("button",{name:"Find printing",exact:true}).click();
    await card.getByRole("radio",{name:`${printing.name} · TST #1 (en)`,exact:true}).check();await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");await card.getByRole("combobox",{name:"Card finish",exact:true}).selectOption("NONFOIL");
    const afterSearch=reads;status={...status,visualStatus:"FAILED"};await expect.poll(()=>reads,{timeout:15000}).toBeGreaterThan(afterSearch);await expect(card.getByLabel("Card name",{exact:true})).toHaveValue(printing.name);expect(await saved()).toBeNull();expect(inventory()).toBe(0);
    await page.reload();await card.scrollIntoViewIfNeeded();await expect(card).toContainText("Unsaved correction restored");await expect(card.getByRole("combobox",{name:"Card condition",exact:true})).toHaveValue("LP");
    await card.getByRole("button",{name:"Save card review",exact:true}).click();await expect(card).toContainText("Review saved. Not yet added to Inventory.");expect(await saved()).toMatchObject({cardId:printing.id,condition:"LP",finish:"NONFOIL"});expect(inventory()).toBe(0);await expect(recovery).toHaveCount(0);await expect(compact).toHaveText("Review saved");
    await page.reload();await card.scrollIntoViewIfNeeded();await expect(compact).toHaveText("Review saved");await expect(recovery).toHaveCount(0);await original();expect(inventory()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.screenshot({path:`test-results/processing-recovery-${width}.png`});
  }finally{
    try { if(!page.isClosed()){await page.unrouteAll({behavior:"wait"});await page.goto("/dashboard");} } catch(error){console.log("Browser cleanup unavailable; owned database cleanup still runs");}
    database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const w={run:{session:{createdByUserId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:n}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw new Error('Private fixture path unavailable');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid owned photo identity');for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});}`);
  }
});
