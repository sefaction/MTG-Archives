import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
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
test("storage-full guidance works on desktop and phone and clears after saved-original retry",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Owned local protocol fixture; no helper process or physical feed");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(180000);
  const tag="ui-scanner-photo-storage-"+randomUUID(),password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
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
    const first=await begin();
    database("await p.scannerRun.update({where:{id:"+JSON.stringify(first.run.runId)+"},data:{preflightProblem:{code:'PHOTO_STORAGE_LIMIT',scope:'OWNER',limitBytes:4294967296,observedAt:new Date().toISOString()}}});");
    for (const width of [1366,320]) {
      await page.setViewportSize({width,height:900}); await page.reload();
      await expect(scanner).toContainText("Scan-photo storage is full (4 GiB for this account)");
      await expect(scanner).toContainText("originals remain saved on the scanner computer");
      await expect(scanner).toContainText("without scanning the cards again");
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await scanner.scrollIntoViewIfNeeded();
      await page.screenshot({path:"test-results/scanner-photo-quota-"+width+".png"});
    }
    await transfer(first.claim,1);await finish(first.claim,1,false);
    expect(JSON.parse(database("console.log(JSON.stringify((await p.scannerRun.findUniqueOrThrow({where:{id:"+JSON.stringify(first.run.runId)+"}})).preflightProblem));"))).toBeNull();
    await page.reload();
    await expect(scanner).not.toContainText("Scan-photo storage is full");
    await expect(scanner).toContainText("Selected count reached.");
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    database("const n="+JSON.stringify(tag)+",w={run:{session:{createdByUserId:n}}};await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Private fixture root unavailable');for(const photo of await p.acquisitionPhoto.findMany({where:w,select:{id:true}}))for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});for(const run of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){if(!/^[a-f0-9-]{36}$/.test(run.id))throw Error('Fixture identity invalid');await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}await p.scannerRun.deleteMany({where:{agent:{userId:n}}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{id:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});");
  }
});
