import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND } from "../../lib/scanner-counted-profile";
function database(body:string) {
  return execFileSync("docker",["exec","-i","mtg-archives-web-1","node"],{input:
    "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{"+body+"})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding:"utf8",timeout:30000,windowsHide:true});
}
test("counted source selects one, preserves hopper remainder, then explicitly refills the same batch",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local protocol fixture; no helper process or physical feed");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(180000);
  const tag="ui-scanner-counted-"+randomUUID(),password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
  const headers={authorization:"Bearer "+agentId+"."+secret},origin={origin:baseURL!};
  const source={id:COUNTED_SCANNER_DEVICE,name:"Counted protocol fixture",backend:COUNTED_SCANNER_BACKEND,source:"Twain",qualification:"KnownWorking"};
  const bytes=await sharp({create:{width:300,height:420,channels:3,background:"white"}}).png().toBuffer();
  try {
    database("const n="+JSON.stringify(tag)+";const hash=await require('bcryptjs').hash("+JSON.stringify(password)+",10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:170,sections:[{name:'A',capacity:85},{name:'B',capacity:85}]}}});const card=await p.card.findFirstOrThrow();await p.inventoryItem.create({data:{currentOwnerId:n,cardId:card.id,quantity:2,condition:'NM',locationId:n,locationSection:'A'}});");
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const pair=await page.request.post("/api/scanners",{headers:origin,data:{action:"pair"}});expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pair.json()).code,agentId,secret,name:"Counted protocol fixture"}})).ok()).toBe(true);
    const pulse=async(qualification="KnownWorking")=>expect((await page.request.post("/api/scanner-agent/pulse",{headers,data:{version:1,agentVersion:"0.3.0-native",devices:[{...source,qualification}]}})).ok()).toBe(true);
    await pulse();await page.goto("/imports/scan?input=scanner");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);await page.getByRole("option").first().click();
    await page.getByRole("button",{name:/^A\s/}).click();
    const setup=page.getByRole("region",{name:"New scan batch"}),scanner=page.getByRole("region",{name:"Scanner batch"});
    await expect(setup).toContainText("83 spaces available after pending cards");
    await setup.getByLabel("Set a batch limit (optional)").check();await setup.getByLabel("Cards in this batch").fill("1");
    await pulse();await setup.getByRole("button",{name:"Start scanner batch",exact:true}).click();
    await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const polled=async()=>{const response=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"poll",version:1}});expect(response.ok()).toBe(true);return response.json();};
    const begin=async()=>{
      await pulse();const {run,epoch}=await polled();const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};
      const response=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"claim",...claim}});expect(response.ok()).toBe(true);expect((await response.json()).feedAuthorized).toBe(true);return {run,claim};
    };
    const transfer=async(claim:Awaited<ReturnType<typeof begin>>["claim"],count:number)=>{
      for(let sequence=1;sequence<=count;sequence++) {
        const metadata={...claim,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
        const response=await page.request.post("/api/scanner-agent/images",{headers:{...headers,"content-type":"image/png","x-mtg-scanner":JSON.stringify(metadata)},data:bytes});
        expect(response.ok(),await response.text()).toBe(true);
      }
    };
    const finish=async(claim:Awaited<ReturnType<typeof begin>>["claim"],count:number,empty:boolean)=>{
      const response=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"finish",...claim,outcome:{outcome:empty?"SOURCE_EXHAUSTED":"COMPLETED",
        imageCount:count,elapsedMs:100,knownPhysicalItems:null,sourceExhausted:empty?"REPORTED_EMPTY":"UNKNOWN",nativeError:null}}});expect(response.ok(),await response.text()).toBe(true);
    };
    const queued=await polled();
    await pulse("Unsupported");
    const refused=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"claim",version:1,
      runId:queued.run.runId,epoch:queued.epoch,executionId:randomUUID()}});
    expect(refused.status()).toBe(409);
    expect(await refused.text()).toContain("needs review or reconciliation");
    expect((await polled()).run.status).toBe("QUEUED");
    const first=await begin();expect(first.run.physicalTarget).toBe(1);expect(first.run.settings.widthInches).toBe(2.7);expect(first.run.settings.dpi).toBe(600);
    await transfer(first.claim,1);await finish(first.claim,1,false);
    await expect(scanner).toContainText("Selected count reached.");
    await expect(scanner).toContainText("Image count recorded automatically.");
    await expect(scanner.getByLabel("Cards physically emitted")).toHaveCount(0);
    const capacity=await page.request.get("/api/scanners/capacity?location="+encodeURIComponent(tag)+"&section=A");
    expect((await capacity.json()).remaining).toBe(82);
    await scanner.getByRole("link",{name:"Choose next section",exact:true}).click();
    await expect(setup).toContainText("Choose the next section before starting.");await expect(setup.getByRole("button",{name:"Start scanner batch",exact:true})).toBeDisabled();
    await setup.getByRole("button",{name:/^B\s/}).click();await expect(setup).toContainText("85 spaces available after pending cards");
    await setup.getByLabel("Set a batch limit (optional)").check();await setup.getByLabel("Cards in this batch").fill("3");
    await pulse();await setup.getByRole("button",{name:"Start scanner batch",exact:true}).click();
    await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const early=await begin();expect(early.run.physicalTarget).toBe(3);await transfer(early.claim,2);await finish(early.claim,2,true);
    await expect(scanner).toContainText("Hopper emptied early. 1 cards remain in this batch.");
    await expect(scanner).toContainText("Image count recorded automatically.");
    await expect(scanner.getByRole("button",{name:"Confirm physical count",exact:true})).toHaveCount(0);
    await expect(scanner.getByRole("link",{name:"Choose next section",exact:true})).toHaveCount(0);
    await expect(scanner.getByRole("button",{name:"Resume unfinished batch",exact:true})).toBeDisabled();
    for(const width of [1366,320]) {await page.setViewportSize({width,height:900});await scanner.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"test-results/scanner-counted-paused-"+width+".png"});}
    await page.reload();await expect(scanner).toContainText("Refill this batch");
    await scanner.getByRole("checkbox",{name:/I refilled card fronts/}).check();await pulse("Unsupported");
    await scanner.getByRole("button",{name:"Resume unfinished batch",exact:true}).click();
    await expect(scanner.getByRole("alert")).toContainText("supports card counts");
    await expect(scanner).toContainText("1 cards remain in this batch");
    await pulse();
    await scanner.getByRole("button",{name:"Resume unfinished batch",exact:true}).click();
    await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const resumed=await begin();expect(resumed.run.runId).not.toBe(early.run.runId);expect(resumed.run.sessionId).toBe(early.run.sessionId);
    expect(resumed.run.physicalTarget).toBe(1);expect(resumed.run.sequenceOffset).toBe(2);expect(resumed.run.logicalTarget).toBe(3);
    await transfer(resumed.claim,1);await finish(resumed.claim,1,false);
    await expect(scanner).toContainText("Selected count reached.");await expect(scanner).toContainText("3 images saved.");
    await expect(scanner).toContainText("Image count recorded automatically.");
    await expect(scanner.getByLabel("Cards physically emitted")).toHaveCount(0);
    await expect(scanner.getByRole("link",{name:"Choose next section",exact:true})).toBeVisible();
    const state=JSON.parse(database("const sessions=await p.acquisitionSession.findMany({where:{createdByUserId:"+JSON.stringify(tag)+"},orderBy:{createdAt:'asc'},include:{run:{include:{scannerRuns:{orderBy:{segment:'asc'}},photos:{include:{slot:true}}}}}});console.log(JSON.stringify({sessions,quantity:(await p.inventoryItem.aggregate({where:{currentOwnerId:"+JSON.stringify(tag)+"},_sum:{quantity:true}}))._sum.quantity,audits:await p.inventoryAuditLog.count({where:{changedByUserId:"+JSON.stringify(tag)+"}})}));"));
    expect(state.sessions).toHaveLength(2);expect(state.sessions[1].run.scannerRuns).toHaveLength(2);expect(state.quantity).toBe(2);expect(state.audits).toBe(0);
    expect(state.sessions[1].run.photos.map((p:any)=>p.slot.position).sort()).toEqual([0,1,2]);
    for(const width of [1366,320]) {await page.setViewportSize({width,height:900});await scanner.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"test-results/scanner-counted-complete-"+width+".png"});}
  } finally {
    database("const n="+JSON.stringify(tag)+",w={run:{session:{createdByUserId:n}}};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Private fixture root unavailable');for(const photo of await p.acquisitionPhoto.findMany({where:w,select:{id:true}}))for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});for(const run of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){if(!/^[a-f0-9-]{36}$/.test(run.id))throw Error('Fixture identity invalid');await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}await p.scannerRun.deleteMany({where:{agent:{userId:n}}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});");
  }
});
