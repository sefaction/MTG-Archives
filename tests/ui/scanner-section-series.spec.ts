import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND } from "../../lib/scanner-counted-profile";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], { input:
    "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{"+body+"})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding: "utf8", timeout: 30000, windowsHide: true });
}
test("section series waits for each choice, refills its unfinished batch, and persists Stop", async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned simulated protocol fixture; no helper or hardware");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag="ui-scanner-series-"+randomUUID(), password=randomUUID(), agentId=randomUUID(), secret=randomBytes(32).toString("base64url");
  const auth={authorization:"Bearer "+agentId+"."+secret}, origin={origin:baseURL!};
  const source={id:COUNTED_SCANNER_DEVICE,name:"Simulated counted source",backend:COUNTED_SCANNER_BACKEND,source:"Twain",qualification:"KnownWorking"};
  const bytes=await sharp({create:{width:300,height:420,channels:3,background:"white"}}).png().toBuffer();
  try {
    database("const n="+JSON.stringify(tag)+";await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash("+JSON.stringify(password)+",10)}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:7,sections:[{name:'A',capacity:2},{name:'B',capacity:3},{name:'C',capacity:2}]}}});");
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const pair=await page.request.post("/api/scanners",{headers:origin,data:{action:"pair"}});expect(pair.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pair.json()).code,agentId,secret,name:"Simulated counted source"}})).ok()).toBe(true);
    const pulse=async()=>expect((await page.request.post("/api/scanner-agent/pulse",{headers:auth,data:{version:1,agentVersion:"0.3.0-native",devices:[source]}})).ok()).toBe(true);
    const poll=async()=>{const r=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"poll",version:1}});expect(r.ok()).toBe(true);return r.json();};
    const begin=async()=>{await pulse();const {run,epoch}=await poll();const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};
      const r=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"claim",...claim}});expect(r.ok()).toBe(true);return {run,claim};};
    const deliver=async(claim:Awaited<ReturnType<typeof begin>>["claim"],count:number,empty=false)=>{
      for(let sequence=1;sequence<=count;sequence++) {
        const metadata={...claim,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
        const r=await page.request.post("/api/scanner-agent/images",{headers:{...auth,"content-type":"image/png","x-mtg-scanner":JSON.stringify(metadata)},data:bytes});expect(r.ok(),await r.text()).toBe(true);
      }
      const r=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"finish",...claim,outcome:{outcome:empty?"SOURCE_EXHAUSTED":"COMPLETED",imageCount:count,elapsedMs:100,knownPhysicalItems:null,sourceExhausted:empty?"REPORTED_EMPTY":"UNKNOWN",nativeError:null}}});expect(r.ok(),await r.text()).toBe(true);
    };
    const setup=page.getByRole("region",{name:"New scan batch"}), scanner=page.getByRole("region",{name:"Scanner batch"});
    const verifyAutomaticCount=async()=>{
      await expect(scanner).toContainText("Image count recorded automatically.");
      await expect(scanner.getByLabel("Cards physically emitted")).toHaveCount(0);
    };
    await pulse();await page.goto("/imports/scan?input=scanner");await expect(page.getByRole("note")).toContainText("helper 0.4.2 and the Cards profile with Pre-Pick Off");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);await page.getByRole("option").first().click();await setup.getByRole("button",{name:/^A\s/}).click();
    await expect(setup.getByLabel("Fill sections one at a time until I stop")).toBeChecked();
    await pulse();await setup.getByRole("button",{name:"Start scanner batch",exact:true}).click();await expect(scanner).toContainText("Section series · batch 1");
    const first=await begin();expect(first.run.physicalTarget).toBe(2);await deliver(first.claim,2);await expect(scanner).toContainText("Selected count reached");await verifyAutomaticCount();
    expect((await poll()).run).toBeNull();await page.reload();await expect(scanner).toContainText("Section series · batch 1");expect((await poll()).run).toBeNull();
    await scanner.getByRole("link",{name:"Choose next section",exact:true}).click();await expect(setup.getByRole("button",{name:"Start scanner batch",exact:true})).toBeDisabled();
    await page.reload();await expect(setup.getByRole("button",{name:"Start scanner batch",exact:true})).toBeDisabled();expect((await poll()).run).toBeNull();
    await expect(setup.getByRole("button",{name:/^A\s/})).toContainText("0 / 2 cards · 2 held by batches · full");
    await expect(setup).toContainText("0 / 7 cards overall · 2 held by batches");
    await setup.getByLabel("Only sections with room").check();
    await expect(setup.getByRole("button",{name:/^A\s/})).toHaveCount(0);
    await expect(setup.getByRole("button",{name:/^B\s/})).toContainText("3 spaces left");
    await setup.getByLabel("Only sections with room").uncheck();
    await setup.getByRole("button",{name:/^B\s/}).click();await pulse();await setup.getByRole("button",{name:"Start scanner batch",exact:true}).click();await expect(scanner).toContainText("Section series · batch 2");
    const second=await begin();expect(second.run.physicalTarget).toBe(3);await deliver(second.claim,1,true);await expect(scanner).toContainText("Hopper emptied early. 2 cards remain");await verifyAutomaticCount();
    await page.reload();await expect(scanner.getByRole("button",{name:"Resume unfinished batch",exact:true})).toBeDisabled();expect((await poll()).run).toBeNull();
    for(const width of [1366,320]){await page.setViewportSize({width,height:900});await scanner.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/scanner-series-paused-${width}.png`});}
    await scanner.getByRole("checkbox",{name:/I refilled card fronts/}).check();await pulse();await scanner.getByRole("button",{name:"Resume unfinished batch",exact:true}).click();await expect(scanner).toContainText("Waiting for the Windows helper");
    const tail=await begin();expect(tail.run.sessionId).toBe(second.run.sessionId);expect(tail.run.physicalTarget).toBe(2);expect(tail.run.sequenceOffset).toBe(1);
    await deliver(tail.claim,2);await expect(scanner).toContainText("Selected count reached");await verifyAutomaticCount();expect((await poll()).run).toBeNull();
    await scanner.getByRole("link",{name:"Choose next section",exact:true}).click();await setup.getByRole("button",{name:/^C\s/}).click();await expect(setup).toContainText("2 spaces available after pending cards");
    await expect(setup.getByRole("button",{name:/^A\s/})).toContainText("2 held by batches · full");
    await expect(setup.getByRole("button",{name:/^B\s/})).toContainText("3 held by batches · full");
    for(const width of [1366,320]){await page.setViewportSize({width,height:900});await setup.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/scanner-series-reservations-${width}.png`});}
    await setup.getByRole("button",{name:"Stop section series",exact:true}).click();await expect(scanner).toContainText("Series stopped.");await expect(scanner.getByRole("link",{name:"Choose next section",exact:true})).toHaveCount(0);
    await page.reload();await expect(scanner).toContainText("Series stopped.");await expect(scanner).not.toContainText("Choose the next section before feeding more");expect((await poll()).run).toBeNull();
    const refused=await page.request.post("/api/scanners/runs",{headers:origin,data:{action:"create",requestKey:randomUUID(),agentId,deviceId:source.id,locationId:tag,section:"C",quantity:null,loadedCount:null,settings:first.run.settings,operatorLoadedSimplexFronts:true,continuous:true,continueFrom:tail.run.runId}});expect(refused.ok()).toBe(false);
    const state=JSON.parse(database("const n="+JSON.stringify(tag)+";console.log(JSON.stringify({sessions:await p.acquisitionSession.count({where:{createdByUserId:n}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{createdByUserId:n}}}}),copies:await p.inventoryItem.count({where:{currentOwnerId:n}}),audits:await p.inventoryAuditLog.count({where:{changedByUserId:n}}),runs:await p.scannerRun.findMany({where:{agentId:"+JSON.stringify(agentId)+"},select:{seriesOrdinal:true,segment:true}})}));"));
    expect(state.sessions).toBe(2);expect(state.photos).toBe(5);expect(state.copies).toBe(0);expect(state.audits).toBe(0);expect(state.runs.map((r:any)=>[r.seriesOrdinal,r.segment]).sort()).toEqual([[0,0],[1,0],[1,1]]);
    for(const width of [1366,320]){await page.setViewportSize({width,height:900});await scanner.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/scanner-series-stopped-${width}.png`});}
  } finally {
    // Block new authenticated polling and retire only this fixture owner.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    try {
    database("const n="+JSON.stringify(tag)+",w={run:{session:{createdByUserId:n}}};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Fixture root unavailable');for(const photo of await p.acquisitionPhoto.findMany({where:w,select:{id:true}}))for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});for(const run of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){if(!/^[a-f0-9-]{36}$/.test(run.id))throw Error('Invalid fixture ID');await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}await p.scannerRun.deleteMany({where:{agent:{userId:n}}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});");

    } finally {
      // A final sweep also catches writes completed during legacy teardown.
      database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    }
  }
});
