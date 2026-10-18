import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND, countedScannerSettings } from "../../lib/scanner-counted-profile";

// Explicitly opted-in disposable web/DB fixture, with no inference workers.
// Never uses the shared review database, primary snapshot or physical helper.
function database(body: string) {
  const web=process.env.MTG_COUNT_REVIEW_TEST_WEB!,owner=process.env.MTG_COUNT_REVIEW_TEST_RUN!;
  if(!/^mtg-count-review-ui-[a-f0-9]{8}-web$/.test(web)||! /^[a-f0-9-]{36}$/.test(owner))throw Error("Disposable fixture unavailable");
  const record=JSON.parse(execFileSync("docker",["inspect",web],{encoding:"utf8",windowsHide:true}))[0];
  expect(record.Config.Labels["issue-worker-run"]).toBe(owner);
  return JSON.parse(execFileSync("docker",["exec","-i",web,"node"],{input:
    "const assert=require('assert/strict'),{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{assert(process.env.DATABASE_URL.endsWith('/counted_review_ui'));"+body+"})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding:"utf8",windowsHide:true,timeout:30000}));
}

test("accepted printing survives counted finish and reload before explicit Inventory confirmation",async({page,baseURL})=>{
  test.skip(process.env.MTG_COUNT_REVIEW_TEST!=="1","Requires an explicitly owned disposable stack");
  expect(baseURL).toBe("http://127.0.0.1:13013");test.setTimeout(120000);
  const tag="ui-count-review-"+randomUUID(),password=randomUUID(),agentId=randomUUID(),secret=randomBytes(32).toString("base64url");
  const fixture=database("assert.equal(await p.user.count(),0);const n="+JSON.stringify(tag)+",hash=await require('bcryptjs').hash("+JSON.stringify(password)+",10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[{name:'A',capacity:2}]}}});const cards=[];for(const number of ['1','2'])cards.push(await p.card.create({data:{scryfallId:n+number,oracleId:n,name:n,setCode:'tst',collectorNumber:number,lang:'fr',digital:false,finishes:['foil'],typeLine:'Creature',rarity:'common'}}));console.log(JSON.stringify({cards}));");
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
  await page.goto("/imports/scan?input=scanner&batch="+progress.id);
  const card=page.getByTestId("capture-card-1");await card.scrollIntoViewIfNeeded();
  await card.getByRole("button",{name:"Correct",exact:true}).click();
  await card.getByLabel("Card name",{exact:true}).fill(tag);await card.getByRole("button",{name:"Find printing",exact:true}).click();
  const options=card.getByRole("radio");await expect(options).toHaveCount(2);await options.nth(1).check();
  await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");
  await card.getByRole("combobox",{name:"Card finish",exact:true}).selectOption("FOIL");
  await card.getByRole("button",{name:"Save card review",exact:true}).click();await expect(card.getByTestId("scan-review-status")).toContainText("Reviewed");
  const endpoint="/api/acquisition/"+progress.id+"/review?photoId="+photoId;
  const before=await (await page.request.get(endpoint)).json();expect(before.review.cardId).toBe(fixture.cards[1].id);
  expect(database("console.log(JSON.stringify(await p.inventoryItem.count()));")).toBe(0);
  const finished=await page.request.post("/api/scanner-agent/runs",{headers,data:{action:"finish",...claim,outcome:{outcome:"COMPLETED",imageCount:2,elapsedMs:100,knownPhysicalItems:null,sourceExhausted:"UNKNOWN",nativeError:null}}});expect(finished.ok(),await finished.text()).toBe(true);
  await page.reload();await card.scrollIntoViewIfNeeded();await expect(card.getByTestId("scan-review-status")).toContainText("Reviewed");
  const after=await (await page.request.get(endpoint)).json();expect(after.review).toEqual(before.review);expect(after.revision).toBe(before.revision+1);
  for(const width of [1366,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.screenshot({path:"test-results/counted-review-"+width+".png"});}
  await page.getByRole("checkbox",{name:"Select card 1 for Inventory",exact:true}).check();
  await page.getByRole("link",{name:"Go to Inventory confirmation"}).click();
  const panel=page.getByRole("region",{name:"Add reviewed cards to Inventory",exact:true});await panel.getByRole("button",{name:"Preview selected cards",exact:true}).click();
  const confirmation=panel.getByLabel("Confirm Inventory addition",{exact:true});await expect(confirmation).toContainText(/tst #2/i);
  expect(database("console.log(JSON.stringify(await p.inventoryItem.count()));")).toBe(0);
  await confirmation.getByRole("button",{name:"Add 1 copy to Inventory",exact:true}).click();await expect(card.getByTestId("scan-review-status")).toHaveText("Added to Inventory");
  await page.reload();await card.scrollIntoViewIfNeeded();await expect(card.getByTestId("scan-review-status")).toHaveText("Added to Inventory");
  expect(database("console.log(JSON.stringify(await p.inventoryItem.findMany({select:{cardId:true,language:true,foilStatus:true,condition:true,quantity:true}})));")).toEqual([{cardId:fixture.cards[1].id,language:"fr",foilStatus:"FOIL",condition:"LP",quantity:1}]);
});
