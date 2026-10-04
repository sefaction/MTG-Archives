import {test, expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {input:
    "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + body + "})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());",
    encoding: "utf8", timeout: 30000, windowsHide: true});
}
test("batch dashboard keeps card totals distinct and cancels, trashes and restores owned batches", async ({page, baseURL}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local dashboard fixture; no physical scanner");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = "ui-batch-dashboard-" + randomUUID(), password = randomUUID(), origin = {origin: baseURL!};
  const conservation = () => database("console.log(JSON.stringify(await p.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}})));");
  const before = conservation();
  try {
    database("const n=" + JSON.stringify(tag) + ";const hash=await require('bcryptjs').hash(" + JSON.stringify(password) + ",10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:'Dashboard fixture storage',normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:85,sections:[{name:'A',capacity:85}]}}});");
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", {name: /^log in$/i}).click(); await page.waitForURL(/\/dashboard/);
    const response = await page.request.post("/api/acquisition", {headers: origin, data: {requestKey: randomUUID(), locationId: tag, section: "A", quantity: 2}});
    expect(response.ok(), await response.text()).toBe(true);
    const batch = await response.json();
    // Synthetic candidates isolate dashboard semantics from recognition speed.
    // Real original retention and native-drain behavior have database fixtures.
    database("const s=await p.acquisitionSession.findUniqueOrThrow({where:{id:" + JSON.stringify(batch.id) + "},include:{run:true}});const card=await p.card.findFirstOrThrow({where:{digital:false}});for(let i=0;i<2;i++){const slot=await p.acquisitionCaptureSlot.create({data:{runId:s.run.id,requestKey:require('crypto').randomUUID(),position:i,generation:1}});await p.acquisitionCandidate.create({data:{runId:s.run.id,physicalId:slot.id,identityKind:'EPISODE',acquisitionOrder:i,spatialOrder:0,expectedSides:['FRONT'],provisional:false,uncertainty:[],revision:0,countConfirmed:true,...(i===0?{review:{cardId:card.id,language:'en',finish:'NONFOIL',condition:'NM',actorId:s.createdByUserId}}:{})}});}await p.acquisitionSession.update({where:{id:s.id},data:{phase:'COMPLETE'}});for(let i=0;i<26;i++){const {id,batchNumber,createdAt,updatedAt,run,...copy}=s;await p.acquisitionSession.create({data:{...copy,requestKey:require('crypto').randomUUID(),phase:'DRAFT',run:{create:{sourceRunId:require('crypto').randomUUID(),providerId:run.providerId,enforcement:run.enforcement,controls:run.controls}}}});}");
    await page.goto("/imports/batches");
    await expect(page.getByRole("heading", {name: "Batch dashboard", exact: true})).toBeVisible();
    await expect(page.getByRole("navigation", {name: "Batch pages"})).toContainText("Page 1 of 2");
    await page.getByRole("link", {name: "Next", exact: true}).click();
    await expect(page.getByRole("navigation", {name: "Batch pages"})).toContainText("Page 2 of 2");
    await page.goto("/imports/batches?view=pending&page=999");
    await expect(page.getByRole("navigation", {name: "Batch pages"})).toContainText("Page 2 of 2");
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.getByLabel("Find a batch").fill(String(batch.batchNumber));
    await page.getByRole("button", {name: "Refresh batches", exact: true}).click();
    await expect(page.getByLabel("Find a batch")).toHaveValue(String(batch.batchNumber));
    await page.getByRole("button", {name: "Search", exact: true}).click();
    const card = page.getByRole("article", {name: `Batch ${batch.batchNumber}`, exact: true});
    await expect(card.locator("dl")).toContainText("Saved2");
    await expect(card).toContainText("1 match needs confirmation"); await expect(card).toContainText("1 confirmed card awaits Inventory addition");
    const totals = page.getByRole("region", {name: "Card totals"});
    await expect(totals).toContainText("Saved cards2"); await expect(totals).toContainText("Evaluated1");
    await expect(totals).toContainText("Assigned to storage2"); await expect(totals).toContainText("Confirmed matches1"); await expect(totals).toContainText("Added to Inventory0");
    for (const width of [1366, 320]) {await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: `test-results/batch-dashboard-pending-${width}.png`, fullPage: true});}
    await card.getByRole("button", {name: "Cancel batch", exact: true}).click();
    await expect(card.getByRole("group", {name: `Confirm cancel batch ${batch.batchNumber}`})).toContainText("accepted scanner load will finish");
    await card.getByRole("button", {name: "Confirm cancel batch", exact: true}).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("link", {name: "Cancelled", exact: true}).click();
    await expect(card).toContainText("Cancelled");
    await card.getByRole("button", {name: "Resume processing", exact: true}).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("link", {name: "All batches", exact: true}).click();
    await card.getByRole("button", {name: "Move to Trash", exact: true}).click();
    await expect(card).toContainText("seven days");
    await card.getByRole("button", {name: "Confirm move to Trash", exact: true}).click();
    await expect(card).toHaveCount(0);
    const hidden = await page.request.get(`/api/acquisition/${batch.id}`); expect(hidden.ok()).toBe(false);
    await page.getByRole("link", {name: "Trash", exact: true}).click();
    await expect(card).toContainText("Restore before");
    await page.screenshot({path: "test-results/batch-dashboard-trash-320.png", fullPage: true});
    await card.getByRole("button", {name: "Restore batch", exact: true}).click();
    await page.waitForURL(/view=all/);
    await expect(page.getByLabel("Find a batch")).toHaveValue(String(batch.batchNumber));
    await expect(card).toContainText("Needs review");
    const state = JSON.parse(database("const s=await p.acquisitionSession.findUniqueOrThrow({where:{id:" + JSON.stringify(batch.id) + "},include:{run:{include:{candidates:true}}}});console.log(JSON.stringify({phase:s.phase,trash:s.trashedAt,candidates:s.run.candidates,scanner:await p.scannerRun.count({where:{acquisitionRunId:s.run.id}})}));"));
    expect(state.phase).toBe("COMPLETE"); expect(state.trash).toBeNull(); expect(state.candidates).toHaveLength(2); expect(state.candidates.filter((candidate: {review: unknown}) => candidate.review)).toHaveLength(1); expect(state.scanner).toBe(0);
    // An interrupted scanner with no finish receipt must be accessible after
    // Restore without releasing reservation or creating a physical command.
    const scannerId = randomUUID();
    database("const s=await p.acquisitionSession.findUniqueOrThrow({where:{id:" + JSON.stringify(batch.id) + "},include:{run:true}});await p.scannerAgent.create({data:{id:" + JSON.stringify(scannerId) + ",userId:s.createdByUserId,tokenHash:require('crypto').randomBytes(32).toString('hex'),credentialHash:require('crypto').randomUUID(),name:'Recovery metadata fixture',expiresAt:new Date(Date.now()+86400000)}});await p.scannerRun.create({data:{id:" + JSON.stringify(scannerId) + ",agentId:" + JSON.stringify(scannerId) + ",acquisitionRunId:s.run.id,epoch:require('crypto').randomUUID(),requestPayload:'{}',deviceId:'fixture',device:{},settings:{},status:'ERROR',executionId:require('crypto').randomUUID()}});await p.acquisitionSession.update({where:{id:s.id},data:{scannerReserved:2}});");
    await card.getByRole("button", {name: "Move to Trash", exact: true}).click();
    await card.getByRole("button", {name: "Confirm move to Trash", exact: true}).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("link", {name: "Trash", exact: true}).click();
    await card.getByRole("button", {name: "Restore batch", exact: true}).click();
    await page.waitForURL(/view=cancelled/);
    await expect(page.getByLabel("Find a batch")).toHaveValue(String(batch.batchNumber));
    await expect(card).toContainText("Cancelled · waiting for scanner");
    await expect(card).toContainText("needs recovery");
    await expect(card.getByRole("link", {name: "View saved cards", exact: true})).toBeVisible();
    await expect(card.getByRole("button", {name: "Resume processing", exact: true})).toBeDisabled();
    expect((await page.request.get(`/api/acquisition/${batch.id}`)).ok()).toBe(true);
    const resume = await page.request.post(`/api/acquisition/${batch.id}/lifecycle`, {headers: origin, data: {action: "resume-processing"}});
    expect(resume.ok()).toBe(false); expect(await resume.text()).toContain("scanner recovery");
    const held = JSON.parse(database("console.log(JSON.stringify({session:await p.acquisitionSession.findUniqueOrThrow({where:{id:" + JSON.stringify(batch.id) + "},select:{phase:true,trashedAt:true,scannerReserved:true}}),run:await p.scannerRun.findUniqueOrThrow({where:{id:" + JSON.stringify(scannerId) + "},select:{outcome:true,reconciliation:true,admissionReleasedAt:true}},),runs:await p.scannerRun.count({where:{agentId:" + JSON.stringify(scannerId) + "}})}));"));
    expect(held.session).toEqual({phase: "CANCELLED", trashedAt: null, scannerReserved: 2});
    expect(held.run).toEqual({outcome: null, reconciliation: null, admissionReleasedAt: null}); expect(held.runs).toBe(1);
    for (const width of [1366, 320]) {await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: `test-results/batch-dashboard-restored-recovery-${width}.png`, fullPage: true});}
    expect(conservation()).toBe(before);
  } finally {
    database("const n=" + JSON.stringify(tag) + ";const sessions=await p.acquisitionSession.findMany({where:{createdByUserId:n},include:{run:true}});const w={runId:{in:sessions.map(s=>s.run.id)}};await p.scannerRun.deleteMany({where:{agent:{userId:n}}});await p.scannerAgent.deleteMany({where:{userId:n}});for(const model of ['acquisitionCommitMember','acquisitionCommit','acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{id:w.runId}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});");
  }
});

test("batch pages remain available after the last row is cancelled or trashed", async ({page, baseURL}) => {
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1", "Owned local metadata fixture; no physical scanner");
  expect(baseURL).toBe("http://127.0.0.1:13001"); test.setTimeout(180000);
  const tag = "ui-batch-pages-" + randomUUID(), password = randomUUID(), origin = {origin: baseURL!};
  const before = database("console.log(JSON.stringify(await p.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}})));");
  try {
    database("const n=" + JSON.stringify(tag) + ";const hash=await require('bcryptjs').hash(" + JSON.stringify(password) + ",10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:'Page recovery storage',normalizedName:n,ownerPlayerId:n,type:'Box'}});");
    await page.goto("/login"); await page.getByLabel(/username or email/i).fill(tag); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", {name: /^log in$/i}).click(); await page.waitForURL(/\/dashboard/);
    const response = await page.request.post("/api/acquisition", {headers: origin, data: {requestKey: randomUUID(), locationId: tag, section: "", quantity: 2}});
    expect(response.ok(), await response.text()).toBe(true); const batch = await response.json();
    database("const s=await p.acquisitionSession.findUniqueOrThrow({where:{id:" + JSON.stringify(batch.id) + "},include:{run:true}});for(let i=0;i<25;i++){const {id,batchNumber,createdAt,updatedAt,run,...copy}=s;await p.acquisitionSession.create({data:{...copy,requestKey:require('crypto').randomUUID(),run:{create:{sourceRunId:require('crypto').randomUUID(),providerId:run.providerId,enforcement:run.enforcement,controls:run.controls}}}});}");
    await page.goto("/imports/batches?view=pending&page=2");
    const rows = page.getByRole("article"), pages = page.getByRole("navigation", {name: "Batch pages"});
    await expect(rows).toHaveCount(1); await expect(pages).toContainText("Page 2 of 2");
    await rows.getByRole("button", {name: "Cancel batch", exact: true}).click();
    await rows.getByRole("button", {name: "Confirm cancel batch", exact: true}).click();
    await expect(pages).toContainText("Page 1 of 1"); await expect(rows).toHaveCount(25);
    await expect(page.getByText("No batches need closing out.", {exact: true})).toHaveCount(0);
    await page.goto("/imports/batches?view=all&page=2");
    await expect(rows).toHaveCount(1); await expect(pages).toContainText("Page 2 of 2");
    await rows.getByRole("button", {name: "Move to Trash", exact: true}).click();
    await rows.getByRole("button", {name: "Confirm move to Trash", exact: true}).click();
    await expect(pages).toContainText("Page 1 of 1"); await expect(rows).toHaveCount(25);
    await page.goto("/imports/batches?view=cancelled&page=999");
    await expect(pages).toContainText("Page 1 of 1"); await expect(rows).toHaveCount(1);
    await page.goto("/imports/batches?view=pending&q=nonexistent-fixture-batch&page=999");
    await expect(pages).toContainText("Page 1 of 1"); await expect(rows).toHaveCount(0);
    await expect(pages.getByRole("link")).toHaveCount(0);
    expect(database("console.log(JSON.stringify(await p.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}})));" )).toBe(before);
  } finally {
    database("const n=" + JSON.stringify(tag) + ";const w={run:{session:{createdByUserId:n}}};await p.acquisitionCommand.deleteMany({where:w});await p.acquisitionEvent.deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});");
  }
});
