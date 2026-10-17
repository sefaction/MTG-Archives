import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND, countedScannerSettings } from "../../lib/scanner-counted-profile";

// Explicitly opted-in disposable web/DB fixture, with no inference workers.
// Never uses the shared review database, primary snapshot or physical helper.
function database(body: string) {
  const web=process.env.MTG_CATALOG_FRESHNESS_TEST_WEB!,owner=process.env.MTG_CATALOG_FRESHNESS_TEST_RUN!;
  if(!/^mtg-catalog-ui-[a-f0-9]{8}-web$/.test(web)||! /^[a-f0-9-]{36}$/.test(owner))throw Error("Disposable fixture unavailable");
  const record=JSON.parse(execFileSync("docker",["inspect",web],{encoding:"utf8",windowsHide:true}))[0];
  expect(record.Config.Labels["issue-worker-run"]).toBe(owner);
  return JSON.parse(execFileSync("docker",["exec","-i",web,"node","--import","/app/node_modules/tsx/dist/loader.mjs"],{input:
    "const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{assert(process.env.DATABASE_URL.endsWith('/catalog_freshness_ui'));"+body+"})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding:"utf8",windowsHide:true,timeout:30000}));
}

test("late catalog results update status and attribution while preserving an open correction draft",async({page,baseURL})=>{
  test.skip(process.env.MTG_CATALOG_FRESHNESS_TEST!=="1","Requires an explicitly owned disposable stack");
  expect(baseURL).toBe("http://127.0.0.1:13014");test.setTimeout(120000);page.setDefaultTimeout(15000);
  const tag="ui-catalog-draft-"+randomUUID(),password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
  const fixture=database("assert.equal(await p.user.count(),0);const n="+JSON.stringify(tag)+",hash=await require('bcryptjs').hash("+JSON.stringify(password)+",10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});const cards=[];for(const number of ['1','2'])cards.push(await p.card.create({data:{scryfallId:require('crypto').randomUUID(),oracleId:n,name:n,setCode:'tst',collectorNumber:number,lang:'fr',digital:false,finishes:['foil'],typeLine:'Creature',rarity:'common'}}));console.log(JSON.stringify({cards}));");
  await page.goto("/login");await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button",{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
  const origin={origin:baseURL!},headers={authorization:"Bearer "+agentId+"."+secret};
  const pair=await page.request.post("/api/scanners",{headers:origin,data:{action:"pair"}});expect(pair.ok()).toBe(true);
  expect((await page.request.post("/api/scanner-agent/pair",{data:{version:1,pairCode:(await pair.json()).code,agentId,secret,name:"Synthetic counted review fixture"}})).ok()).toBe(true);
  expect((await page.request.post("/api/scanner-agent/pulse",{headers,data:{version:1,agentVersion:"fixture",devices:[{id:COUNTED_SCANNER_DEVICE,name:"Synthetic counted source",backend:COUNTED_SCANNER_BACKEND,source:"Twain",qualification:"KnownWorking"}]}})).ok()).toBe(true);
  const created=await page.request.post("/api/scanners/runs",{headers:origin,data:{action:"create",requestKey:randomUUID(),agentId,deviceId:COUNTED_SCANNER_DEVICE,locationId:tag,section:"A",quantity:2,loadedCount:2,settings:countedScannerSettings,operatorLoadedSimplexFronts:true}});
  expect(created.ok(),await created.text()).toBe(true);const progress=await created.json();
  const poll=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"poll",version:1}});expect(poll.ok()).toBe(true);const {run,epoch}=await poll.json();
  const claim={version:1,runId:run.runId,epoch,executionId:randomUUID()};expect((await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"claim",...claim}})).ok()).toBe(true);
  const bytes=await sharp({create:{width:75,height:105,channels:3,background:"white"}}).png().toBuffer();let photoId="";
  for(let sequence=1;sequence<=2;sequence++){
    const metadata={...claim,artifactId:randomUUID(),sequence,timestamp:new Date().toISOString(),side:"UNKNOWN",physicalBoundary:"UNKNOWN"};
    const response=await page.request.post("/api/scanner-agent/images",{headers:{...headers,"content-type":"image/png","x-mtg-scanner":JSON.stringify(metadata)},data:bytes});expect(response.ok(),await response.text()).toBe(true);if(sequence===1)photoId=(await response.json()).photoId;
  }

  const finished=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"finish",...claim,outcome:{outcome:"COMPLETED",imageCount:2,elapsedMs:100,knownPhysicalItems:null,sourceExhausted:"UNKNOWN",nativeError:null}}});expect(finished.ok()).toBe(true);
  const seeded=database("const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:"+JSON.stringify(photoId)+"}}),candidate=await p.acquisitionCandidate.findFirstOrThrow({where:{runId:photo.runId,physicalId:photo.slotId}}),artifact=await p.acquisitionArtifact.findFirstOrThrow({where:{runId:photo.runId,sourceId:photo.id}});const text={title:["+JSON.stringify(tag)+"],footer:['TST FR','R 1']},orientations=[{rotationDegrees:0,text,lines:[]},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],r=require('./lib/acquisition-recognition.ts');const output={version:1,photoId:photo.id,native:{version:1,descriptor:'a'.repeat(64),descriptorDetails:{},photoDigest:photo.digest,text,orientations,geometry:{status:'PROPOSED',method:'declared-card-scan',framing:'ALIGNED',quad:[[0,0],[74,0],[74,104],[0,104]]},lines:[],milliseconds:1,automaticAcceptance:false},versions:{catalog:'b'.repeat(64),model:'a'.repeat(64)},proposals:r.proposeOrientedAcquisitionPrintings(r.createAcquisitionRecognitionIndex([]),orientations),catalog:{status:'CHECKING',printingCoverage:'UNRESOLVED'}};const job=await p.acquisitionProcessingJob.create({data:{runId:photo.runId,artifactId:artifact.id,candidateId:candidate.id,candidateRevision:candidate.revision,stage:'photo-recognition-v1',versionKey:'catalog-draft-fixture',input:{photoId:photo.id,digest:photo.digest,inputKind:'CARD_SCAN',versions:output.versions},status:'COMPLETE',output}});await require('./lib/acquisition-catalog-reconciliation.ts').enqueueCatalogReconciliation(p);console.log(JSON.stringify({jobId:job.id,revision:candidate.revision}));");
  await page.goto("/imports/scan?input=scanner&batch="+progress.id);
  await page.getByRole("button",{name:"Advanced",exact:true}).click();
  const card=page.getByTestId("capture-card-1");await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId("scan-catalog-status")).toContainText("Checking the catalog");
  await card.getByLabel("Card name",{exact:true}).fill(tag);await card.getByRole("button",{name:"Find printing",exact:true}).click();
  const options=card.getByRole("radio");await expect(options).toHaveCount(2);await options.nth(1).check();
  await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");await card.getByRole("combobox",{name:"Card finish",exact:true}).selectOption("FOIL");
  await expect(card.getByTestId("scan-review-status")).toContainText("Unsaved correction");
  const endpoint="/api/acquisition/"+progress.id+"/review?photoId="+photoId;
  const initial=await (await page.request.get(endpoint)).json();expect(initial.review).toBeNull();expect(initial.revision).toBe(seeded.revision);
  const reconciled=database("const {enqueueCatalogReconciliation,createCatalogReconciliationHandler}=require('./lib/acquisition-catalog-reconciliation.ts'),{CATALOG_RECONCILIATION_STAGE}=require('./lib/acquisition-catalog-status.ts'),{claimAcquisitionJobs,completeAcquisitionJob}=require('./lib/acquisition-jobs.ts');await enqueueCatalogReconciliation(p);const jobs=await claimAcquisitionJobs(p,{workerId:'owned-draft-fixture',stages:[CATALOG_RECONCILIATION_STAGE],limit:1});assert.equal(jobs.length,1);const handler=createCatalogReconciliationHandler(p,async()=>({status:'FOUND',cacheHit:true,lookupKey:'owned-fixture',requestsMade:0,printingCoverage:'CHECKED',cards:[{id:"+JSON.stringify(fixture.cards[0].scryfallId)+",name:"+JSON.stringify(tag)+"}]}));const output=await handler(jobs[0],AbortSignal.timeout(10000));assert.equal(output.catalog.status,'RESOLVED');assert.equal(await completeAcquisitionJob(p,jobs[0],output),'COMPLETE');console.log(JSON.stringify({jobId:jobs[0].id,first:output.proposals.proposals[0].card.id}));");
  expect(reconciled.first).toBe(fixture.cards[0].id);
  // No navigation/reload: the active dirty editor polls the newly published job.
  await expect(card.getByTestId("scan-catalog-status")).toContainText("Printing information checked",{timeout:15000});
  await expect(options.nth(1)).toBeChecked();await expect(card.getByRole("combobox",{name:"Card condition",exact:true})).toHaveValue("LP");
  const current=await (await page.request.get(endpoint)).json();expect(current.suggestions[0].printing.id).toBe(fixture.cards[0].id);expect(current.review).toBeNull();expect(current.revision).toBe(initial.revision);
  expect(database("console.log(JSON.stringify(await p.inventoryItem.count()));")).toBe(0);
  for(const width of [1366,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.screenshot({path:"test-results/catalog-draft-"+width+".png"});}
  let sent:any=null;await page.route("**/api/acquisition/*/review",async route=>{if(route.request().method()==="POST")sent=route.request().postDataJSON();await route.continue();});
  await card.getByRole("button",{name:"Save card review",exact:true}).click();await expect(card.getByTestId("scan-review-status")).toContainText("Reviewed");
  expect(sent.decision.cardId).toBe(fixture.cards[1].id);expect(sent.evidenceTokens.edit).toBeTruthy();expect(sent.evidenceTokens.current).toBeTruthy();expect(sent.evidenceTokens.edit).not.toBe(sent.evidenceTokens.current);
  const evidence=database("console.log(JSON.stringify((await p.correctionEvidence.findMany({where:{ownerPlayerId:"+JSON.stringify(tag)+"},select:{payload:true}})).map(row=>row.payload).filter(e=>e.role==='EDIT'||e.role==='CURRENT').map(e=>({role:e.role,offered:e.identity.suggestions.map(c=>c.id),jobs:e.identity.jobs.map(j=>({id:j.id,hash:j.outputHash}))}))));");
  expect(evidence.find((e:any)=>e.role==='EDIT').offered).toEqual([]);expect(evidence.find((e:any)=>e.role==='CURRENT').offered[0]).toBe(fixture.cards[0].id);
  expect(evidence.find((e:any)=>e.role==='EDIT').jobs.find((j:any)=>j.id===reconciled.jobId).hash).toBeNull();expect(evidence.find((e:any)=>e.role==='CURRENT').jobs.find((j:any)=>j.id===reconciled.jobId).hash).toBeTruthy();
  const saved=await (await page.request.get(endpoint)).json();expect(saved.review.cardId).toBe(fixture.cards[1].id);expect(saved.review.condition).toBe("LP");
  await card.getByRole("button",{name:"Continue to Inventory",exact:true}).click();
  const panel=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});await panel.getByRole("button",{name:"Preview selected cards",exact:true}).click();
  const confirmation=panel.getByLabel("Confirm Inventory addition",{exact:true});await expect(confirmation).toContainText(/tst #2/i);expect(database("console.log(JSON.stringify(await p.inventoryItem.count()));")).toBe(0);
  await confirmation.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();await expect(card.getByTestId("scan-review-status")).toHaveText("Added to Inventory");
  expect(database("console.log(JSON.stringify(await p.inventoryItem.findMany({select:{cardId:true,language:true,foilStatus:true,condition:true,quantity:true}})));")).toEqual([{cardId:fixture.cards[1].id,language:"fr",foilStatus:"FOIL",condition:"LP",quantity:1}]);
});
