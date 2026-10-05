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

for (const width of [1366, 320]) test(`No section starts and continues a single counted batch at ${width}px`, async ({ page, baseURL }) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned simulated protocol fixture; no helper or hardware");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 });
  const tag="ui-scanner-no-section-"+randomUUID(), password=randomUUID(), agentId=randomUUID(), secret=randomBytes(32).toString("base64url");
  const auth={authorization:"Bearer "+agentId+"."+secret}, origin={origin:baseURL!};
  const source={id:COUNTED_SCANNER_DEVICE,name:"Simulated counted source",backend:COUNTED_SCANNER_BACKEND,source:"Twain",qualification:"KnownWorking"};
  try {
    database(`const n=${JSON.stringify(tag)};
      await p.player.create({data:{id:n,name:n,displayName:n}});
      await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});
      const card=await p.card.create({data:{scryfallId:n,name:n,setCode:'tst',collectorNumber:'1',typeLine:'Creature',rarity:'common',lang:'en',digital:false,finishes:['nonfoil']}});
      await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:1}]}}});
      await p.inventoryItem.create({data:{currentOwnerId:n,cardId:card.id,quantity:1,locationId:n,locationSection:'A',foilStatus:'NONFOIL',condition:'NM',sourceType:'MANUAL'}});
      await p.inventoryLocation.create({data:{id:n+'-unbounded',name:n+'-unbounded',normalizedName:n+'-unbounded',ownerPlayerId:n,type:'Box',storageLayout:{capacity:null,sections:[]}}});`);
    await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const pairing=await page.request.post("/api/scanners",{headers:origin,data:{action:"pair"}});expect(pairing.ok()).toBe(true);
    expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pairing.json()).code,agentId,secret,name:"Simulated counted source"}})).ok()).toBe(true);
    const pulse=async()=>expect((await page.request.post("/api/scanner-agent/pulse",{headers:auth,data:{version:1,agentVersion:"0.3.0-native",devices:[source]}})).ok()).toBe(true);
    await pulse();await page.goto("/imports/scan?input=scanner");
    const setup=page.getByRole("region",{name:"New scan batch"}), scanner=page.getByRole("region",{name:"Scanner batch"});
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option").first().click();
    await setup.getByRole("button",{name:"No section",exact:true}).click();
    await expect(setup).toContainText("2 spaces available after pending cards");
    await expect(setup.getByLabel("Fill sections one at a time until I stop")).toHaveCount(0);
    const start=setup.getByRole("button",{name:"Start scanner batch",exact:true});
    await expect(start).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await setup.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/scanner-no-section-ready-${width}.png`});
    await pulse();await start.click();await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const polled=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"poll",version:1}});expect(polled.ok()).toBe(true);
    const {run,epoch}=await polled.json();expect(run.physicalTarget).toBe(2);expect(run.logicalTarget).toBe(2);
    const stored=JSON.parse(database(`const n=${JSON.stringify(tag)};const run=await p.scannerRun.findUniqueOrThrow({where:{id:${JSON.stringify(run.runId)}},include:{acquisitionRun:{include:{session:true}}}});console.log(JSON.stringify({section:run.acquisitionRun.session.section,series:run.seriesRootId,sessions:await p.acquisitionSession.count({where:{createdByUserId:n}})}));`));
    expect(stored).toEqual({section:"",series:null,sessions:1});
    const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};
    await pulse();const claimed=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"claim",...claim}});expect(claimed.ok(),await claimed.text()).toBe(true);
    const bytes=await sharp({create:{width:300,height:420,channels:3,background:"white"}}).png().toBuffer();
    for(let sequence=1;sequence<=2;sequence++) {
      const metadata={...claim,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
      const response=await page.request.post("/api/scanner-agent/images",{headers:{...auth,"content-type":"image/png","x-mtg-scanner":JSON.stringify(metadata)},data:bytes});expect(response.ok(),await response.text()).toBe(true);
    }
    const finished=await page.request.post("/api/scanner-agent/runs",{headers:auth,data:{action:"finish",...claim,outcome:{outcome:"COMPLETED",imageCount:2,elapsedMs:100,knownPhysicalItems:null,sourceExhausted:"UNKNOWN",nativeError:null}}});expect(finished.ok(),await finished.text()).toBe(true);
    await expect(scanner).toContainText("Selected count reached");
    await expect(scanner.getByRole("link",{name:"Choose next section",exact:true})).toHaveCount(0);
    await scanner.getByRole("link",{name:"New scanner batch",exact:true}).click();
    await expect(setup.getByRole("button",{name:"No section",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(setup).not.toContainText("Choose the next section before starting.");
    await expect(setup).toContainText("2 spaces are held by other batches directly in this location.");
    await expect(start).toBeDisabled();
    // A location without sections or capacity uses an explicit bounded count.
    await page.getByTestId("storage-destination").getByRole("button",{name:"Change",exact:true}).click();
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag+"-unbounded");
    await page.getByRole("option").first().click();
    await expect(setup).toContainText("Choose a card count for this batch.");await expect(start).toBeDisabled();
    await setup.getByLabel("Set a batch limit (optional)").check();await setup.getByLabel("Cards in this batch").fill("1");
    await pulse();await expect(start).toBeEnabled();await start.click();await expect(scanner).toContainText("Waiting for the Windows helper to start.");
    const final=JSON.parse(database(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({sessions:await p.acquisitionSession.findMany({where:{createdByUserId:n},select:{section:true,target:true}}),stock:await p.inventoryItem.aggregate({where:{currentOwnerId:n},_sum:{quantity:true}})}));`));
    expect(final.sessions).toHaveLength(2);expect(final.sessions.every((s:{section:string})=>s.section==="")).toBe(true);
    expect(final.sessions.map((s:{target:number})=>s.target).sort()).toEqual([1,2]);expect(final.stock._sum.quantity).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/scanner-no-section-fixed-${width}.png`});
  } finally {
    database(`const n=${JSON.stringify(tag)},w={run:{session:{createdByUserId:n}}};
      await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;if(!root||!paths.isAbsolute(root))throw Error('Fixture root unavailable');
      for(const photo of await p.acquisitionPhoto.findMany({where:w,select:{id:true}}))for(const suffix of ['.original','.preview.jpg'])await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      for(const run of await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}})){if(!/^[a-f0-9-]{36}$/.test(run.id))throw Error('Invalid fixture ID');await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});await p.authSession.deleteMany({where:{userId:n}});
      await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{scryfallId:n}});`);
  }
});
