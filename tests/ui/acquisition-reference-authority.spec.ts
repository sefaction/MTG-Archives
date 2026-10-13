import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';

import {web,worker,docker,database,json,sha,holdReference,resumeNative,chooseOfferedPrinting} from './acquisition-reference-local';

test('actual reference rereads conserve draft edits, saved feedback and retake authority',async({page,baseURL})=>{
  const corpus=process.env.MTG_ANCHOR_FIXTURES_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!corpus,'Requires isolated local development scans; no physical scanner operation');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  const endpoint=JSON.parse(docker(['context','inspect',docker(['context','show']).trim(),'--format','{{json .Endpoints.docker.Host}}']));
  expect(endpoint).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  for(const name of [web,worker])expect(docker(['inspect',name,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  test.setTimeout(1200000);
  page.setDefaultTimeout(10000);
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now();
  const own=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  const reports:any[]=[];let held:Awaited<ReturnType<typeof holdReference>>|undefined;
  const report=()=>{if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH,JSON.stringify({elapsedMs:Date.now()-started,reports},null,2));};
  const snapshot=(photoId:string)=>json(`
    const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photoId)}}});
    const jobs=await p.acquisitionProcessingJob.findMany({where:{...${own},input:{path:['photoId'],equals:${JSON.stringify(photoId)}}},orderBy:{createdAt:'asc'}});
    const candidate=await p.acquisitionCandidate.findFirstOrThrow({where:{...${own},physicalId:photo.slotId}});
    const scope={ownerPlayerId:${JSON.stringify(tag)},sourcePhotoId:${JSON.stringify(photoId)}};
    const examples=await p.correctionExample.findMany({where:scope,include:{blob:true}});
    const evidence=await p.correctionEvidence.findMany({where:scope});
    const events=await p.correctionReviewEvent.findMany({where:scope});
    console.log(JSON.stringify({photo,jobs,candidate,examples,evidence,events}));`);
  const immutable=(before:any,after:any)=>{
    for(const job of before.jobs.filter((j:any)=>j.status==='COMPLETE'))expect(after.jobs.find((j:any)=>j.id===job.id)?.output).toEqual(job.output);
    for(const evidence of before.evidence)expect(after.evidence.find((e:any)=>e.id===evidence.id)).toEqual(evidence);
    if(before.examples[0].firstEvidenceId!==null)expect(after.examples[0].firstEvidenceId).toBe(before.examples[0].firstEvidenceId);
  };
  if(process.env.MTG_ANCHOR_PROGRESS_PATH)writeFileSync(process.env.MTG_ANCHOR_PROGRESS_PATH,JSON.stringify({owner:tag,phase:'setup'}));
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:3,sections:[]}}});await p.correctionLibraryAccount.create({data:{ownerPlayerId:n,displayKey:require('crypto').randomBytes(32).toString('hex'),sampleBasisPoints:10000,sampleCap:3}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();
    const batch=new URL(page.url()).searchParams.get('batch')!;
    for(const [index,mode] of ['draft','saved','retake'].entries()){
      const bytes=readFileSync(path.join(corpus!,`reference-${index}.jpg`)),digest=sha(bytes);
      await page.getByLabel('Choose card photos').setInputFiles({name:`reference-${index}.jpg`,buffer:bytes,mimeType:'image/jpeg'});
      const card=page.getByTestId(`capture-card-${index+1}`);await card.scrollIntoViewIfNeeded();
      held=await holdReference(tag);const photoId=held.job.input.photoId;
      const before=snapshot(photoId);expect(before.photo.digest).toBe(digest);
      expect(before.jobs.find((j:any)=>j.id===held!.job.input.parents.recognitionJobId).status).toBe('COMPLETE');
      expect(before.examples).toHaveLength(1);expect(before.examples[0].blob.state).toBe('PRESERVED');
      const currentHold=held;
      let decision:any;
      if(mode!=='retake'){
        decision=await chooseOfferedPrinting(page,card,batch,photoId);
        await expect(card.getByTestId('scan-review-status')).toContainText('Unsaved correction');
        if(mode==='saved'){
          await card.getByRole('button',{name:'Save card review',exact:true}).click();
          await expect(card).toContainText('Review saved. Not yet added to Inventory.');
          const saved=snapshot(photoId);expect(saved.candidate.review.cardId).toBe(decision.printing.id);expect(saved.candidate.review.condition).toBe('LP');
          expect(saved.examples[0].firstEvidenceId).toEqual(expect.any(String));
          expect(saved.events).toHaveLength(1);expect(saved.examples[0].label.decision.condition).toBe('LP');
          decision.saved=saved;
        }
      }else{
        const replacement=readFileSync(path.join(corpus!,'complete.png'));
        await card.getByRole('button',{name:'Retake',exact:true}).click();
        await page.getByLabel('Choose card photos').setInputFiles({name:'replacement.png',buffer:replacement,mimeType:'image/png'});
        await expect.poll(()=>json(`console.log(JSON.stringify(await p.acquisitionPhoto.count({where:{...${own},slotId:${JSON.stringify(before.photo.slotId)},generation:${before.photo.generation+1},ready:true}})));`)).toBe(1);
        decision={replacementDigest:sha(replacement)};
      }
      // Keep the ordinary deadline intact; changes must happen during real work.
      const heldMilliseconds=Date.now()-currentHold.heldAt;
      expect(heldMilliseconds).toBeLessThan(35000);
      const resumed=resumeNative(currentHold);held=undefined;
      if(mode==='draft')expect(resumed.resumed).toBe(true);
      await expect.poll(()=>json(`console.log(JSON.stringify((await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(currentHold.job.id)}}})).status));`),{timeout:120000,intervals:[300,1000]}).toBe(mode==='draft'?'COMPLETE':'SUPERSEDED');
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${own},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:300000,intervals:[1000,3000]}).toBe(0);
      const after=snapshot(photoId);immutable(before,after);
      const job=after.jobs.find((j:any)=>j.id===currentHold.job.id);expect(job.attempts).toBe(1);
      if(mode==='draft'){
        expect(after.candidate.review).toBeNull();expect(job.output.proposals.automaticAcceptance).toBe(false);
        await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('LP');
        await expect(card.getByRole('radio',{name:decision.choice,exact:true})).toBeChecked();
        await expect(card.getByTestId('scan-review-status')).toContainText('Unsaved correction');
        await card.screenshot({path:'test-results/reference-draft-preserved.png'});
        // Discard directly in Advanced after the actual late native reread.
        await expect(card.getByRole('button',{name:'Cancel changes',exact:true})).toBeVisible();
        await card.getByRole('button',{name:'Cancel changes',exact:true}).click();
        await expect(card.getByTestId('scan-review-status')).not.toContainText('Unsaved correction');
        expect(snapshot(photoId).candidate.review).toBeNull();
        await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toBeEnabled();
      }else{
        expect(job.output?.native).toBeUndefined();
        expect(after.jobs.filter((j:any)=>j.input?.referenceSource?.referenceJobId===job.id)).toHaveLength(0);
        if(mode==='saved'){
          immutable(decision.saved,after);
          expect(after.candidate.review).toEqual(decision.saved.candidate.review);
          expect(after.events).toEqual(decision.saved.events);expect(after.examples[0].label).toEqual(decision.saved.examples[0].label);
          await expect(card).toContainText(/LP/);await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toHaveCount(0);
        }else{
          const replacement=json(`console.log(JSON.stringify(await p.acquisitionPhoto.findFirstOrThrow({where:{...${own},slotId:${JSON.stringify(before.photo.slotId)},generation:${before.photo.generation+1},ready:true}})));`);
          expect(replacement.digest).toBe(decision.replacementDigest);
          // Retake advances the slot generation and preserves the older source
          // row/bytes; purging is a distinct retention operation.
          expect(after.photo).toEqual(before.photo);
          expect(replacement.generation).toBe(before.photo.generation+1);
          const replacementUrl=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
          expect(replacementUrl).toContain(replacement.id);
          const visibleOriginal=await page.request.get(replacementUrl!);expect(visibleOriginal.ok()).toBe(true);expect(sha(await visibleOriginal.body())).toBe(decision.replacementDigest);
          await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toHaveCount(0);
          expect(after.candidate.physicalId).toBe(before.candidate.physicalId);
          expect(Number(database(`console.log(await p.acquisitionCandidate.count({where:${own}}));`))).toBe(3);
        }
      }
      const retained=await page.request.get(`/api/acquisition/corrections/${after.examples[0].id}?owner=${encodeURIComponent(tag)}`);
      expect(retained.ok()).toBe(true);expect(sha(await retained.body())).toBe(digest);expect(sha(readFileSync(path.join(corpus!,`reference-${index}.jpg`)))).toBe(digest);
      reports.push({mode,before,after,decision,observedNativeCpu:currentHold.observedNativeCpu,heldMilliseconds,waitAndCheckMilliseconds:Date.now()-currentHold.heldAt});report();
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  }catch(error){
    if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH+'.failure.json',JSON.stringify({error:(error as Error).message,reports,jobs:json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:${own}})));`)},null,2));
    throw error;
  }finally{
    const failures:unknown[]=[];const clean=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(e){failures.push(e)}};
    if(held)await clean(()=>resumeNative(held!));
    await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    await clean(()=>database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned photo');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`));
    await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    if(process.env.MTG_ANCHOR_PROGRESS_PATH)writeFileSync(process.env.MTG_ANCHOR_PROGRESS_PATH,JSON.stringify({owner:tag,phase:'ended',cleanupFailures:failures.length}));
    if(failures.length)throw new AggregateError(failures,'Reference authority cleanup failed');
  }
});
