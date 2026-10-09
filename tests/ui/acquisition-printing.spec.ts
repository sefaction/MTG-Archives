import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import { checkAcquisitionCompactReview } from "./acquisition-compact-review-steps";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000,
  });
}
const compactOnly = process.env.MTG_ACQUISITION_COMPACT_ONLY_TEST === "1";
test(compactOnly ? "compact review replays one native basic-land scan with saved drafts and no Inventory writes" : "printing checks cover text-led stamped scans and image-led unreadable text without Inventory changes", async ({page, baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST !== "1" || !process.env.MTG_ACQUISITION_NEW_SCANS_PATH,
    "Requires local snapshot and private new scanner corpus");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(900000);
  const tag=`ui-printing-${randomUUID()}`, password=randomUUID();
  const manifest=JSON.parse(readFileSync("tools/acquisition-eval/scan-batch-manifest.json", "utf8"));
  // Repeated35 is an explicit source-mode regression, not another independent
  // recognition sample. Its PHOTO geometry fails; CARD_SCAN must keep all edges.
  const entries=[36,35,1,35].map(n=>manifest.entries[n-1]);
  const reuseResults: unknown[] = [];
  const visualReuseResults: unknown[] = [];
  const visualReuseTest = process.env.MTG_VISUAL_REUSE_TEST === "1";
  let visualRefreshes = 0;
  expect(visualReuseTest && process.env.MTG_PRINTING_REUSE_TEST === "1").toBe(false);
  const basicLandPath=process.env.MTG_ACQUISITION_BASIC_LAND_SCAN_PATH;
  if(compactOnly && !basicLandPath) throw new Error('Compact replay requires the fifth native basic-land fixture');
  if(basicLandPath) entries.push({file:path.basename(basicLandPath),
    sha256:'c612250b17dbb4ef3b4cb45fda99f3d525a6efe4a642bea8c941c893be873ced',
    scryfallId:'d061b9a8-e95d-48ec-a1c9-337433b62dfc'});
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:${entries.length},sections:[]}}});`);
    await page.goto('/login');
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);
    await page.getByRole('option').first().click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByRole('combobox',{name:'Batch finish',exact:true}).selectOption('NONFOIL');
    await page.getByRole('combobox',{name:'Batch condition',exact:true}).selectOption('NM');
    await page.getByRole('button',{name:'Save batch defaults'}).click();
    await expect(page.getByText('Batch defaults saved.')).toBeVisible();
    for(const [i,entry] of entries.entries()){
      // A UI-only follow-up reserves four empty positions, then scans the same
      // fifth card. It does not requalify or count the other four native cases.
      if(compactOnly && i<4){
        const batchId = new URL(page.url()).searchParams.get('batch');
        const response=await page.request.post(`/api/acquisition/${batchId}`,{headers:{origin:baseURL!},data:{action:'reserve',requestKey:randomUUID()}});
        expect(response.ok(), await response.text()).toBe(true);
        continue;
      }
      if(i===3 || compactOnly)await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
      expect(path.basename(entry.file)).toBe(entry.file);
      const buffer=readFileSync(i===4 ? basicLandPath! : path.join(process.env.MTG_ACQUISITION_NEW_SCANS_PATH!,entry.file));
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
      await page.getByLabel('Choose card photos').setInputFiles({name:entry.file,mimeType:'image/jpeg',buffer});
      // Use the real shared queue. A new fixture batch must receive worker
      // turns while older unreviewed batches are being reprocessed.
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:240000}).toBe(compactOnly ? 1 : process.env.MTG_PRINTING_REUSE_TEST === '1' ? 2*i+1 : i+1+visualRefreshes);
      const output=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entry.sha256)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{output:true,createdAt:true,updatedAt:true,candidate:{select:{review:true}}}});const expected=await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}});console.log(JSON.stringify({output:job.output,createdAt:job.createdAt,updatedAt:job.updatedAt,review:job.candidate.review,expectedId:expected.id}));`));
      expect(output.output.proposals.proposals.some((p:any)=>p.card.id===output.expectedId)).toBe(true);
      expect(output.output.native.photoDigest).toBe(entry.sha256);
      expect(output.output.printingNative.photoDigest).toBe(entry.sha256);
      expect(output.output.proposals.automaticAcceptance).toBe(false);
      expect(output.review).toBe(null);
      if (visualReuseTest) {
        const prior = JSON.parse(database(`const job=await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(output.output.sourceVisualJobId)}}});console.log(JSON.stringify({id:job.id,input:job.input,output:job.output,createdAt:job.createdAt,updatedAt:job.updatedAt}));`));
        expect(prior.output.visualExecution.reused).toBe(false);
        expect(prior.output.visualExecution.inferenceRequests).toBe(1);
        if (i === 0) execFileSync('docker', ['restart','mtg-archives-acquisition-visual-worker-1'],
          {encoding:'utf8',timeout:180000,windowsHide:true});
        const refresh = JSON.parse(database(`const source=await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(prior.id)}}});const newer=await p.acquisitionProcessingJob.create({data:{runId:source.runId,artifactId:source.artifactId,candidateId:source.candidateId,candidateRevision:source.candidateRevision,stage:source.stage,versionKey:require('crypto').randomUUID(),input:source.input,availableAt:new Date(0)}});console.log(JSON.stringify({id:newer.id,createdAt:newer.createdAt}));`));
        let reused: any;
        await expect.poll(() => {
          reused=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(refresh.id)}}});console.log(JSON.stringify({status:job.status,output:job.output,updatedAt:job.updatedAt}));`));
          return reused.status;
        }, {timeout:240000}).toBe('COMPLETE');
        expect(reused.output.visualExecution.reused).toBe(true);
        expect(reused.output.visualExecution.inferenceRequests).toBe(0);
        expect(reused.output.visual).toEqual(prior.output.visual);
        expect(reused.output.photoId).toBe(prior.output.photoId);
        // Let ordinary catalog/printing consume the new visual lineage before
        // adding the next photo. Do not adjust admission, fairness or deadlines.
        await expect.poll(() => Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE',output:{path:['sourceVisualJobId'],equals:${JSON.stringify(refresh.id)}}}}));`)),
          {timeout:240000}).toBe(1);
        const refreshed = JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE',output:{path:['sourceVisualJobId'],equals:${JSON.stringify(refresh.id)}}}});console.log(JSON.stringify(job.output));`));
        expect(refreshed.proposals).toEqual(output.output.proposals);
        expect(refreshed.printingNative).toEqual(output.output.printingNative);
        visualRefreshes++;
        visualReuseResults.push({sample:i,inputKind:prior.output.visualReuse.inputKind,
          nativeMilliseconds:prior.output.visual.milliseconds,
          freshHandlerMilliseconds:prior.output.visualExecution.milliseconds,
          reuseHandlerMilliseconds:reused.output.visualExecution.milliseconds,
          refreshToPublicationMilliseconds:Date.parse(reused.updatedAt)-Date.parse(refresh.createdAt),
          inferenceRequests:0, identicalNativeEvidence:true, identicalFinalProposals:true,afterWorkerRestart:i===0});
      }
      if (process.env.MTG_PRINTING_REUSE_TEST === '1') {
        expect(output.output.printingExecution.reused).toBe(false);
        expect(output.output.printingExecution.inferenceRequests).toBe(1);
        if (i === 0 && process.env.MTG_PRINTING_REUSE_RESTART_TEST === '1')
          execFileSync('docker', ['restart', 'mtg-archives-acquisition-printing-worker-1'], {encoding:'utf8',timeout:180000});
        const refresh = JSON.parse(database(`const source=await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(output.output.sourceCatalogJobId)}}});const newer=await p.acquisitionProcessingJob.create({data:{runId:source.runId,artifactId:source.artifactId,candidateId:source.candidateId,candidateRevision:source.candidateRevision,stage:source.stage,versionKey:require('crypto').randomUUID(),input:source.input,status:'COMPLETE',output:source.output}});console.log(JSON.stringify({id:newer.id,createdAt:newer.createdAt}));`));
        const start = Date.now();
        let reused: any;
        await expect.poll(() => {
          reused=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirst({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE',output:{path:['sourceCatalogJobId'],equals:${JSON.stringify(refresh.id)}}},select:{output:true,createdAt:true,updatedAt:true}});console.log(JSON.stringify(job));`));
          return Boolean(reused);
        }, {timeout:240000}).toBe(true);
        expect(reused.output.printingExecution.reused).toBe(true);
        expect(reused.output.printingExecution.inferenceRequests).toBe(0);
        expect(reused.output.printingNative).toEqual(output.output.printingNative);
        expect(reused.output.printing).toEqual(output.output.printing);
        expect(reused.output.proposals).toEqual(output.output.proposals);
        expect(reused.output.native).toEqual(output.output.native);
        reuseResults.push({sample:i, nativeMilliseconds:output.output.printingNative.milliseconds,
          freshHandlerMilliseconds:output.output.printingExecution.milliseconds,
          freshJobMilliseconds:Date.parse(output.updatedAt)-Date.parse(output.createdAt),
          reuseHandlerMilliseconds:reused.output.printingExecution.milliseconds,
          reuseJobMilliseconds:Date.parse(reused.updatedAt)-Date.parse(reused.createdAt),
          refreshToPublicationMilliseconds:Date.parse(reused.updatedAt)-Date.parse(refresh.createdAt),
          observedPollMilliseconds:Date.now()-start, inferenceRequests:0, identicalRecognition:true,
          afterWorkerRestart:i===0 && process.env.MTG_PRINTING_REUSE_RESTART_TEST==='1'});
      }
      if(output.output.native.geometry.status==='PROPOSED'){
        expect(output.output.native.readingZones).toEqual({
          title:{top:0,bottom:250},footer:{top:1270,bottom:1397},
        });
        for(const observation of output.output.native.orientations)
          for(const line of observation.lines){
            const ys=line.polygon.map((p:number[])=>p[1]);
            expect(Math.max(...ys)<=250 || Math.min(...ys)>=1270).toBe(true);
          }
      }
      if(i===0){
        expect(output.output.printing.observedStamp).toBe('PRESENT');
        expect(output.output.proposals.proposals[0].card.id).toBe(output.expectedId);
        expect(output.output.proposals.proposals[0].reasons).toContain('STAMP_PRESENT');
        expect(output.output.visual.candidates.some((c:any)=>c.scryfallId===entry.scryfallId)).toBe(false);
      }
      if(i===1){
        expect(output.output.native.geometry.status).toBe('NEEDS_CROP');
        expect(output.output.native.orientations).toHaveLength(0);
      }
      if(i===3){
        expect(output.output.native.geometry.method).toBe('declared-card-scan');
        expect(output.output.native.orientations).toHaveLength(2);
        const corners=output.output.native.geometry.quad;
        expect(Math.min(...corners.map((p:number[])=>p[0]))).toBe(0);
        expect(Math.min(...corners.map((p:number[])=>p[1]))).toBe(0);
        const saved=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionPhoto.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},inputKind:'CARD_SCAN'},select:{width:true,height:true,inputKind:true}})));`));
        expect(Math.max(...corners.map((p:number[])=>p[0]))).toBe(saved.width-1);
        expect(Math.max(...corners.map((p:number[])=>p[1]))).toBe(saved.height-1);
      }
      if(i===4){
        expect(output.output.native.geometry.method).toBe('declared-card-scan');
        expect(output.output.proposals.proposals[0].card.id).toBe(output.expectedId);
        expect(output.output.proposals.evidence.collectors).toContain('304');
        expect(output.output.proposals.evidence.setCodes).toEqual(['fin']);
        expect(output.output.proposals.evidence.languages).toEqual(['en']);
        expect(output.output.visual.candidates[0].scryfallId).toBe(entry.scryfallId);
        expect(output.output.visual.geometricCandidates[0].scryfallId).toBe(entry.scryfallId);
      }
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId('scan-printing-status')).toContainText('Printing check complete',{timeout:20000});
      await expect.poll(()=>card.getByRole('img',{name:/^Printing: /}).evaluate(el=>
        (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth>0)).toBe(true);
      await expect(card.getByRole('heading',{name:'What the scanner read'})).toBeVisible();
      if(i===0)await expect(card.getByText('Observed stamp agrees with this printing. Other printing details still need verification.')).toBeVisible();
      if(i===4)for(const width of [1366,320]){
        await page.setViewportSize({width,height:900});
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByRole('img',{name:/^Printing: Mountain /})).toBeVisible();
        await card.getByRole('button',{name:'Reading zones',exact:true}).click();
        await expect.poll(()=>card.getByRole('img',{name:'Full card image 5',exact:true}).evaluate(el=>
          (el as HTMLCanvasElement).width)).toBe(400);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/footer-zone-review-${width}.png`});
      }
    }
    // The opt-in paired reuse gate keeps its own evidence denominator. The
    // independent compact-card geometry/draft gate runs in the ordinary test;
    // it must not be relabelled as recognition/reuse accuracy or throughput.
    if(basicLandPath && !visualReuseTest)await checkAcquisitionCompactReview(page);
    if(compactOnly){
      expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
      return;
    }
    const card=page.getByTestId('capture-card-1');
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:900});
      await card.scrollIntoViewIfNeeded();
      await card.getByRole('button',{name:'Original',exact:true}).click();
      await expect.poll(()=>card.getByRole('img',{name:'Original scan 1',exact:true}).evaluate(el=>{
        const canvas=el as HTMLCanvasElement;
        return canvas.width>0 && canvas.height>0 && canvas.getContext('2d')!.getImageData(
          Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[3]===255;
      })).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/printing-review-${width}.png`});
    }
    database(`const prior=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entries[0].sha256)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:[{createdAt:'desc'},{id:'desc'}]});await p.acquisitionProcessingJob.create({data:{runId:prior.runId,artifactId:prior.artifactId,candidateId:prior.candidateId,candidateRevision:prior.candidateRevision,stage:prior.stage,versionKey:require('crypto').randomUUID(),input:prior.input,status:'FAILED',attempts:3,maxAttempts:3,errorCode:'PROCESSING_FAILED'}});`);
    await page.reload();
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('scan-printing-status')).toContainText('Printing verification failed',{timeout:20000});
    await card.getByRole('button',{name:'Original',exact:true}).click();
    await expect(card.getByRole('img',{name:'Original scan 1',exact:true})).toBeVisible();
    await expect(card.getByRole('img',{name:/^Printing: Timberland Ancient /})).toBeVisible();
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    if (visualReuseResults.length) {
      const fs = require('fs');
      fs.mkdirSync('test-results', {recursive:true});
      fs.writeFileSync('test-results/visual-reuse-application.json', JSON.stringify({version:1,samples:visualReuseResults},null,2));
    }
    if (reuseResults.length) {
      const fs = require('fs');
      fs.mkdirSync('test-results', {recursive:true});
      fs.writeFileSync('test-results/printing-reuse-application.json', JSON.stringify({version:1,samples:reuseResults},null,2));
    }
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
  }
});
