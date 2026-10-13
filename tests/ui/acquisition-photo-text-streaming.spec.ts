import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}
const json=(body: string)=>JSON.parse(database(body));

test("whole-photo hints support streaming review while other photos are queued", async ({page, baseURL}) => {
  const phone=process.env.MTG_ACQUISITION_CORPUS_PATH;
  const additional=process.env.MTG_ACQUISITION_ADDITIONAL_PHOTOS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || !phone || !additional,
    "Requires preserved private development originals and local workers");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  // Separate integration scope from the seven-input, ten-minute printing gate.
  // Each card retains that deadline; this does not qualify full-batch throughput.
  test.setTimeout(2100000);
  const tag=`ui-photo-text-${randomUUID()}`, password=randomUUID();
  const cases=[
    {file: "PXL_20260928_003441259.jpg", root: phone!, name: "Winter, Team Player"},
    {file: "PXL_20260928_003443452.jpg", root: phone!, name: "Winter, Tormented Loner"},
    {file: "PXL_20260928_030544422.jpg", root: additional!, name: "Cunning Geysermage"},
  ];
  const report:any={version:1,scope:"THREE_REUSED_ORIGINALS_STREAMING_REVIEW_NOT_BATCH_THROUGHPUT",
    startedAt:new Date().toISOString(),tag,passed:false,results:[],raw:[],samples:[],digests:[],
    limits:["Reused difficult development photos, not independent accuracy", "Name retrieval, not exact-printing qualification",
      "Review begins at catalog suggestions, not completion of printing checks", "Seven-input printing gate failed and remains unqualified"]};
  const save=()=>{
    if(process.env.MTG_ACQUISITION_PHOTO_TEXT_REPORT_PATH)
      writeFileSync(process.env.MTG_ACQUISITION_PHOTO_TEXT_REPORT_PATH,JSON.stringify(report,null,2)+"\n");
  };
  const owner=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  let firstSaved:any, firstFeedback:any;
  const feedback=()=>json(`const own={ownerPlayerId:${JSON.stringify(tag)}};console.log(JSON.stringify({examples:await p.correctionExample.findMany({where:own,orderBy:{id:'asc'},include:{blob:true}}),events:await p.correctionReviewEvent.findMany({where:own,orderBy:{id:'asc'}}),evidence:await p.correctionEvidence.findMany({where:own,orderBy:{id:'asc'}})}));`);
  try {
    save();
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[{name:'A',capacity:3}]}}});`);
    // Deterministic first-photo control for this disposable owner only. Ordinary
    // owners retain their configured 64 GB limit and 2% random sampling.
    database(`await p.correctionLibraryAccount.create({data:{ownerPlayerId:${JSON.stringify(tag)},displayKey:require('crypto').randomBytes(32).toString('hex'),sampleBasisPoints:10000,sampleCap:1}});`);
    await page.goto('/login');
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);
    await page.getByRole('option').first().click();
    await page.getByRole('button',{name:/^A\s/}).click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    if(!await page.getByRole('combobox',{name:'Batch finish',exact:true}).isVisible())
      await page.locator('summary').filter({hasText:/^Batch defaults:/}).click();
    await expect(page.getByRole('combobox',{name:'Batch finish',exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'Batch finish',exact:true}).selectOption('NONFOIL');
    await page.getByRole('combobox',{name:'Batch condition',exact:true}).selectOption('NM');
    await page.getByRole('button',{name:'Save batch defaults',exact:true}).click();
    await expect(page.getByText('Batch defaults saved.',{exact:true})).toBeVisible();
    for(const [i,entry] of cases.entries()) {
      const buffer=readFileSync(path.join(entry.root,entry.file));
      report.digests.push(createHash('sha256').update(buffer).digest('hex'));
      await page.getByLabel('Choose card photos').setInputFiles({name:`case-${i+1}.jpg`,mimeType:'image/jpeg',buffer});
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionPhoto.count({where:{...${owner},ready:true}}));`)),{timeout:60000}).toBe(i+1);
      save();
    }
    // Ordinary ingestion, queue admission and leases. No priority, native-output
    // injection, expected-card hint, provider stub, or Inventory operation.
    for(const [i,entry] of cases.entries()) {
      const where=`{...${owner},candidate:{acquisitionOrder:${i}},stage:'photo-catalog-reconciliation-v1',status:'COMPLETE'}`;
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:${where}}));`)),{timeout:600000,intervals:[1000,2000,5000]}).toBeGreaterThan(0);
      const result=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirstOrThrow({where:${where},orderBy:{createdAt:'desc'},select:{output:true,candidate:{select:{review:true}},run:{select:{session:{select:{locationId:true,section:true}}}}}})));`);
      const raw=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirstOrThrow({where:{...${owner},candidate:{acquisitionOrder:${i}},stage:'photo-recognition-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true}})));`);
      const sample=json(`console.log(JSON.stringify({catalogCandidates:await p.acquisitionCandidate.count({where:{...${owner},jobs:{some:{stage:'photo-catalog-reconciliation-v1',status:'COMPLETE'}}}}),jobs:await p.acquisitionProcessingJob.groupBy({by:['stage','status'],where:${owner},_count:{_all:true}})}));`);
      report.results.push(result);report.raw.push(raw);report.samples.push({at:new Date().toISOString(),...sample});save();
      const output=result.output;
      expect(output.native).toEqual(raw.output.native);
      expect(output.native.photoDigest).toBe(report.digests[i]);
      expect(output.proposals.proposals.some((p:any)=>p.card.name===entry.name)).toBe(true);
      expect(output.proposals.automaticAcceptance).toBe(false);
      expect(result.candidate.review).toBeNull();
      expect(result.run.session).toEqual({locationId:tag,section:'A'});
      expect(output.native.photoText.scope).toBe('WHOLE_PHOTO');
      expect(['COMPLETE','PARTIAL']).toContain(output.native.photoText.status);
      const hints=output.proposals.proposals.filter((p:any)=>p.card.name===entry.name);
      expect(hints.some((p:any)=>p.reasons.includes('UNLOCALIZED_NAME_HINT'))).toBe(true);
      expect(hints.every((p:any)=>!p.reasons.includes('STRONG_EXACT_PRINTING'))).toBe(true);
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('img',{name:new RegExp(`^Printing: ${entry.name}`)}).first()).toBeVisible({timeout:20000});
      if(i!==0)continue;
      // Prove first-card review is available before the rest of the batch.
      expect(sample.catalogCandidates).toBeLessThan(cases.length);
      const simple=page.getByRole('button',{name:'Simple',exact:true});
      const advanced=page.getByRole('button',{name:'Advanced',exact:true});
      if(await advanced.count())await advanced.click();
      await card.scrollIntoViewIfNeeded();
      await card.getByTestId('unlocalized-photo-text').getByText('Whole-photo OCR (unlocalized)',{exact:true}).click();
      await expect(card.getByTestId('unlocalized-photo-text')).toContainText('do not verify title, footer, language or stamp regions');
      await expect(card.getByTestId('scan-proposal-evidence')).toContainText('exact printing unverified');
      await page.screenshot({path:'test-results/photo-text-streaming-advanced-1366.png'});
      if(await simple.count())await simple.click();
      for(const width of [1366,390,320]) {
        await page.setViewportSize({width,height:900});
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByTestId('scan-name-only')).toHaveText('Name only · check printing');
        const reference=card.getByRole('img',{name:/^Printing: Winter, Team Player /});
        await expect.poll(()=>reference.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
        const scan=card.getByRole('img',{name:/^(Original scan|Detected card) 1$/});
        await expect.poll(()=>scan.evaluate((canvas:HTMLCanvasElement)=>canvas.width>0 && canvas.height>0 &&
          canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((v,index)=>index%4<3 && v>20))).toBe(true);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/photo-text-streaming-simple-${width}.png`});
      }
      if(await simple.count()) {
        await card.getByRole('button',{name:'Correct',exact:true}).click();
        await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');
        await advanced.click();await simple.click();
        await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('LP');
      } else await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');
      await card.getByRole('button',{name:'Save card review',exact:true}).click();
      await expect(card).toContainText('Review saved. Not yet added to Inventory.');
      firstSaved=json(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{...${owner},acquisitionOrder:0},select:{review:true,revision:true}})));`);
      expect(firstSaved.review.condition).toBe('LP');
      const atFirstSave=json(`console.log(JSON.stringify({catalogCandidates:await p.acquisitionCandidate.count({where:{...${owner},jobs:{some:{stage:'photo-catalog-reconciliation-v1',status:'COMPLETE'}}}})}));`);
      expect(atFirstSave.catalogCandidates).toBeLessThan(cases.length);
      report.firstReview={condition:'LP',revision:firstSaved.revision,catalogCandidates:atFirstSave.catalogCandidates,savedBeforeBatchCatalogComplete:true};
      await expect.poll(()=>feedback().examples[0]?.blob.state,{timeout:120000}).toBe('PRESERVED');
      firstFeedback=feedback();
      expect(firstFeedback.examples).toHaveLength(1);
      expect(firstFeedback.examples[0].normalControl).toBe(true);
      expect(firstFeedback.examples[0].labelState).toBe('UNVERIFIED');
      expect(firstFeedback.examples[0].label.decision.condition).toBe('LP');
      expect(firstFeedback.events).toHaveLength(1);
      expect(firstFeedback.evidence.length).toBeGreaterThan(0);
      const original=await page.request.get(`/api/acquisition/corrections/${firstFeedback.examples[0].id}?owner=${encodeURIComponent(tag)}`);
      expect(original.ok()).toBe(true);
      expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(report.digests[0]);
      report.feedback={reviewEvents:1,initialEvidenceBundles:firstFeedback.evidence.length,originalDigest:report.digests[0],conserved:false};
      await page.reload();await card.scrollIntoViewIfNeeded();
      await expect(card).toContainText('LP');
      save();
    }
    // Keep the existing per-stage deadline: both untouched cards must finish
    // before checking the saved early correction against later background work.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${owner},candidate:{acquisitionOrder:{gt:0}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000}).toBe(cases.length - 1);
    // The early human review fences its older analysis. Completing that stale
    // job is not required; silently failing or retaining a lease is not safe.
    const firstPrintingJobs=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{...${owner},candidate:{acquisitionOrder:0},stage:'photo-printing-evidence-v1'},select:{status:true,errorCode:true,attempts:true,candidateRevision:true,leaseToken:true,leaseExpiresAt:true,output:true}})));`);
    // Review can precede printing admission entirely. Existing older jobs must
    // terminate safely; there must never be a new job for the saved revision.
    expect(firstPrintingJobs.length).toBeLessThanOrEqual(1);
    const firstPrinting=firstPrintingJobs[0];
    if(firstPrinting) {
      expect(['COMPLETE','SUPERSEDED']).toContain(firstPrinting.status);
      expect(firstPrinting.candidateRevision).toBeLessThan(firstSaved.revision);
      expect(firstPrinting.leaseToken).toBeNull();
      expect(firstPrinting.leaseExpiresAt).toBeNull();
      if(firstPrinting.status==='SUPERSEDED') {
        // Queue retirement uses INPUT_CHANGED; an already claimed handler
        // retires its own lease with no error when its review fence advances.
        expect([null,'INPUT_CHANGED']).toContain(firstPrinting.errorCode);
        if(firstPrinting.errorCode===null)expect(firstPrinting.attempts).toBeGreaterThan(0);
        expect(firstPrinting.output).toBeNull();
      } else {
        expect(firstPrinting.errorCode).toBeNull();
        expect(firstPrinting.output).not.toBeNull();
      }
    }
    report.printingLifecycle={untouchedComplete:cases.length-1,
      firstStatus:firstPrinting?.status??'NOT_ENQUEUED_AFTER_REVIEW',firstRevision:firstPrinting?.candidateRevision??null,
      savedRevision:firstSaved.revision};
    const after=json(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{...${owner},acquisitionOrder:0},select:{review:true,revision:true}})));`);
    expect(after).toEqual(firstSaved);
    const laterFeedback=feedback();
    expect(laterFeedback.examples).toHaveLength(1);
    expect(laterFeedback.examples[0].label).toEqual(firstFeedback.examples[0].label);
    expect(laterFeedback.examples[0].labelState).toBe('UNVERIFIED');
    expect(laterFeedback.events).toEqual(firstFeedback.events);
    for(const evidence of firstFeedback.evidence)
      expect(laterFeedback.evidence.find((entry:any)=>entry.id===evidence.id)).toEqual(evidence);
    const originalAfter=await page.request.get(`/api/acquisition/corrections/${firstFeedback.examples[0].id}?owner=${encodeURIComponent(tag)}`);
    expect(originalAfter.ok()).toBe(true);
    expect(createHash('sha256').update(await originalAfter.body()).digest('hex')).toBe(report.digests[0]);
    report.feedback={...report.feedback,finalEvidenceBundles:laterFeedback.evidence.length,conserved:true,printingComplete:cases.length-1+(firstPrinting?.status==='COMPLETE'?1:0),printingRetired:firstPrinting?.status==='SUPERSEDED'?1:0,printingNotEnqueued:firstPrinting?0:1};
    const firstRaw=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirstOrThrow({where:{...${owner},candidate:{acquisitionOrder:0},stage:'photo-recognition-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true}})));`);
    expect(firstRaw).toEqual(report.raw[0]);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    report.passed=true;
  } finally {
    // Block new authenticated polling and retire only this fixture owner.
    const cleanupFailures: unknown[] = [];
    const cleanup = async (action: () => unknown | Promise<unknown>) => {
      try { await action(); } catch (error) { cleanupFailures.push(error); }
    };
    await cleanup(() => { database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');"); });
    await cleanup(async () => { report.finishedAt=new Date().toISOString();
save(); });
    await cleanup(async () => { database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`); });
    // A final sweep also catches writes completed during legacy teardown.
    await cleanup(() => { database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');"); });
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "acquisition-photo-text-streaming.spec.ts cleanup failed");
  }
});
