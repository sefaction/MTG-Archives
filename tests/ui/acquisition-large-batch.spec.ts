import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test, type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, rmdirSync, unlinkSync} from 'node:fs';
import path from 'node:path';
import {assertNativeWorkerContinuity, type NativeWorkerSnapshot} from '../native-worker-continuity';
import {cleanupInventoryScalePageBody, inventoryFingerprintBody, inventoryScaleOwners, seedInventoryScaleBody} from '../acquisition-inventory-scale';
import {finalizeQualificationReport,qualificationReportWriter} from '../qualification-report';

test.use({trace:'off',video:'off',actionTimeout:15000});
function docker(...args:string[]) {
  return execFileSync('docker',args,{encoding:'utf8',timeout:30000,windowsHide:true}).trim();
}
function database(body:string,timeout=30000) {
  return JSON.parse(execFileSync('docker',['exec','-i','mtg-archives-web-1','node'],{
    input:`const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:'utf8',timeout,windowsHide:true,
  }));
}
function workerSnapshots(): NativeWorkerSnapshot[] {
  return ['acquisition-recognition','acquisition-visual','acquisition-printing'].map(name=>{
    const container=`mtg-archives-${name}-worker-1`;
    const worker=JSON.parse(docker('inspect',container,'--format','{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}},"restarts":{{.RestartCount}}}'));
    const events=Object.fromEntries(docker('exec',container,'cat','/sys/fs/cgroup/memory.events').split('\n').map(line=>{
      const [key,value]=line.trim().split(/\s+/);return [key,Number(value)];
    }));
    return {...worker,name,oom:events.oom,oomKills:events.oom_kill};
  });
}

test('large scan-image batches retain every input through ordinary native queues and paged review',async({browser,baseURL})=>{
  const root=process.env.MTG_ACQUISITION_PLAYABLE_SCANS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||process.env.MTG_ACQUISITION_LARGE_BATCH_TEST!=='1'||!root,
    'Explicit local-only large-batch opt-in and preserved private development scans required');
  expect(baseURL).toBe('http://127.0.0.1:13001');
  const count=Number(process.env.MTG_ACQUISITION_LARGE_BATCH_COUNT??100);
  expect([100,300]).toContain(count);
  const inventoryScale=process.env.MTG_ACQUISITION_LARGE_BATCH_INVENTORY_SCALE==='1';
  if(inventoryScale)expect(count).toBe(300);
  test.setTimeout(count===100?1800000:3600000);
  const endpoint=JSON.parse(docker('context','inspect',docker('context','show'),'--format','{{json .Endpoints.docker.Host}}'));
  expect(endpoint).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)expect(process.env.DOCKER_HOST).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  const targets=count===100?[100]:[160,80,40,20];
  const manifestBytes=readFileSync(path.join(root!,'playable-manifest.json'));
  const entries=JSON.parse(manifestBytes.toString('utf8')).entries;
  expect(entries).toHaveLength(67);
  const originals=entries.map((entry:any)=>{
    const buffer=readFileSync(path.join(root!,'originals',entry.file));
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
    return {name:entry.file,mimeType:'image/jpeg',buffer,digest:entry.sha256};
  });
  const run=randomUUID(),password=randomUUID();
  const spool=path.resolve('.local-data','large-batch-inputs',run);
  const spooled:string[]=[];
  mkdirSync(spool,{recursive:true});
  const owners=targets.map((target,i)=>({tag:`ui-large-${run}-${i}`,target}));
  const contexts=await Promise.all(owners.map(()=>browser.newContext({baseURL})));
  await Promise.all(contexts.map(context=>context.addInitScript(()=>{
    const original=window.fetch.bind(window);
    const failures: unknown[]=[];
    (window as any).__qualificationUploadFailures=failures;
    window.fetch=async(...args: Parameters<typeof fetch>)=>{
      const response=await original(...args);
      const url=new URL(response.url);
      const photo=/^\/api\/acquisition\/[^/]+\/photos$/.test(url.pathname);
      const reservation=/^\/api\/acquisition\/[^/]+$/.test(url.pathname);
      const options=args[1];
      if(url.origin===location.origin && options?.method==='POST' && response.status>=400 && (photo||reservation)){
        // Observe a clone in the browser: CDP may discard a response body before
        // a busy qualification runner can read it. Never delay/mock the request.
        const entry={operation:photo?'photo':'reservation',status:response.status};
        void response.clone().json().then(body=>{
          if(failures.length<2000)failures.push({...entry,bodyAvailable:true,retryable:body?.retryable===true,
            generic:body?.error==='The scan request could not be completed. Refresh and retry.'});
        },()=>{if(failures.length<2000)failures.push({...entry,bodyAvailable:false});});
      }
      return response;
    };
  })));
  const pages=await Promise.all(contexts.map(context=>context.newPage()));
  const started=Date.now();
  const report:any={version:1,scope:inventoryScale?'300_INPUTS_FOUR_OWNERS_150000_COPY_REVIEW':count===100?'100_INPUTS_ONE_OWNER_NATIVE_BATCH':'300_INPUTS_FOUR_UNEVEN_OWNERS_NATIVE_STRESS',
    startedAt:new Date(started).toISOString(),count,ownerTargets:targets,passed:false,
    corpusSha256:createHash('sha256').update(manifestBytes).digest('hex'),samples:[],progress:[],authenticatedInventory:[],
    limits:['Reused 67 development scans with repetitions, not independent physical/printing accuracy',
      'Logical capture candidates, no physical scanner or Inventory commit',
      inventoryScale?'150,000 physical copies in 16,400 rows across four disposable owners; not 150,000 rows or independent printing accuracy':
        'Fixture owners have empty Inventory; this is not the 150,000-copy database-load gate',
      'Sampled Docker readings and authenticated page fetches, not exhaustive peaks or operator throughput']};
  const output=process.env.MTG_ACQUISITION_LARGE_BATCH_REPORT_PATH;
  const writeReport=qualificationReportWriter(output);
  const save=()=>writeReport(report);
  const captureBrowserFailures=async()=>{
    const current=await Promise.all(pages.map(page=>page.evaluate(()=>
      (window as any).__qualificationUploadFailures??[]).catch(()=>null)));
    report.browserUploadFailures=current.map((rows,i)=>rows?.length ? rows :
      report.browserUploadFailures?.[i]??rows);
    save();
  };
  const failedResponses: Promise<void>[]=[];
  report.httpFailures=[];
  pages.forEach((page,owner)=>page.on('response',response=>{
    const url=new URL(response.url());
    const photo=/^\/api\/acquisition\/[^/]+\/photos$/.test(url.pathname);
    const reservation=/^\/api\/acquisition\/[^/]+$/.test(url.pathname);
    if(url.origin!==baseURL || response.request().method()!=='POST' ||
      response.status()<400 || !(photo||reservation))return;
    // Classifications only: no request bodies, URLs/identities, credentials,
    // arbitrary server error text or image data in the qualification report.
    failedResponses.push((async()=>{
      const body=await response.json().catch(()=>null);
      report.httpFailures.push({owner,operation:photo?'photo':'reservation',status:response.status(),
        bodyAvailable:body!==null,
        retryable:body?.retryable===true,
        generic:body?.error==='The scan request could not be completed. Refresh and retry.'});
      save();
    })());
  }));
  const sample=()=>{
    try{report.samples.push({at:new Date().toISOString(),workers:docker('stats','--no-stream','--format','{{json .}}',
      'mtg-archives-web-1','mtg-archives-acquisition-recognition-worker-1','mtg-archives-acquisition-visual-worker-1',
      'mtg-archives-acquisition-printing-worker-1').split('\n').filter(Boolean).map(line=>{
        const row=JSON.parse(line);return{name:row.Name,memory:row.MemUsage,cpu:row.CPUPerc};
      })});}catch{report.samples.push({at:new Date().toISOString(),unavailable:true});}
    save();
  };
  const measureInventory=async(page:Page,owner:number)=>{
    const at=Date.now();const response=await page.request.get('/inventory',{timeout:15000});
    await response.body();report.authenticatedInventory.push({owner,status:response.status(),milliseconds:Date.now()-at});
    expect(response.status()).toBe(200);save();
  };
  let timer:ReturnType<typeof setInterval>|undefined;
  let qualified=false;
  const inventoryBaselines: unknown[]=[];
  try{
    report.existingInventoryBefore=database(inventoryFingerprintBody());save();
    report.workersBefore=workerSnapshots();save();
    for(const worker of report.workersBefore)assertNativeWorkerContinuity(worker,worker);
    database(`for(const owner of ${JSON.stringify(owners)}){const n=owner.tag;const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:owner.target,sections:[{name:'A',capacity:owner.target}]}}});}console.log('{}');`);
    if(inventoryScale){
      const seededAt=Date.now();
      report.inventoryScale=database(seedInventoryScaleBody(owners.map(owner=>owner.tag)),60000);
      expect(report.inventoryScale).toMatchObject({rows:16400,copies:150000,locations:2501,printingCount:5000});
      report.inventoryScale.seedMilliseconds=Date.now()-seededAt;
    }
    for(const [i,owner] of owners.entries()){
      const fingerprint=database(inventoryFingerprintBody(owner.tag));
      expect(fingerprint).toMatchObject(inventoryScale?{rows:inventoryScaleOwners[i].rows,copies:inventoryScaleOwners[i].copies}:{rows:0,copies:0});
      inventoryBaselines.push(fingerprint);
    }
    report.inventoryBaselines=inventoryBaselines;save();
    sample();timer=setInterval(sample,30000);
    await Promise.all(pages.map(async(page,i)=>{
      const owner=owners[i];
      await page.goto('/login');await page.getByLabel(/username or email/i).fill(owner.tag);
      await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();
      await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
      await page.getByTestId('storage-destination').getByRole('combobox').fill(owner.tag);
      await page.getByRole('option').first().click();await page.getByRole('button',{name:/^A\s/}).click();
      await page.getByRole('button',{name:'Start batch',exact:true}).click();
      const advanced=page.getByRole('button',{name:'Advanced',exact:true});
      await advanced.click();
      await page.getByRole('combobox',{name:'Batch finish',exact:true}).selectOption('NONFOIL');
      await page.getByRole('combobox',{name:'Batch condition',exact:true}).selectOption('NM');
      await page.getByRole('button',{name:'Save batch defaults',exact:true}).click();
      await expect(page.getByText('Batch defaults saved.',{exact:true})).toBeVisible();
      await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
      // Playwright's in-memory aggregate transfer has a 50-MiB ceiling. Use
      // private owned copies with unique names, as a real library picker does.
      const files=Array.from({length:owner.target},(_,n)=>{
        const file=path.join(spool,`owner-${i}-input-${n+1}.jpg`);
        copyFileSync(path.join(root!,'originals',entries[n%entries.length].file),file);
        spooled.push(file);return file;
      });
      await page.getByLabel('Choose card photos').setInputFiles(files);
      await expect.poll(()=>database(`console.log(await p.acquisitionPhoto.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}},ready:true}}));`),
        {timeout:300000,intervals:[1000,3000]}).toBe(owner.target);
      await expect(page.getByRole('heading',{name:new RegExp(`${owner.target} of ${owner.target} cards`)})).toBeVisible();
      await measureInventory(page,i);
      const inputs=database(`const where={run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}}};const candidates=await p.acquisitionCandidate.findMany({where,orderBy:{acquisitionOrder:'asc'},select:{observations:{select:{artifact:{select:{digest:true}}}}}});console.log(JSON.stringify({photos:await p.acquisitionPhoto.count({where:{...where,ready:true}}),artifacts:await p.acquisitionArtifact.count({where}),slots:await p.acquisitionCaptureSlot.count({where}),candidates:await p.acquisitionCandidate.count({where}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(owner.tag)}}}),digests:candidates.map(c=>{if(c.observations.length!==1)throw Error('Expected one observation per single-image candidate');return c.observations[0].artifact.digest})}));`);
      report.inputs??=[];report.inputs[i]=inputs;save();
      for(const key of ['photos','artifacts','slots','candidates'])expect(inputs[key]).toBe(owner.target);
      expect(inputs.inventory).toBe(inventoryScale?inventoryScaleOwners[i].rows:0);
      expect(database(inventoryFingerprintBody(owner.tag))).toEqual(inventoryBaselines[i]);
      expect(inputs.digests).toEqual(Array.from({length:owner.target},(_,n)=>originals[n%originals.length].digest));
    }));
    report.uploadsReadyMilliseconds=Date.now()-started;save();
    await captureBrowserFailures();
    // No priority, label, provider, native-result or deadline override. This is
    // a new bounded large-batch measurement, not a relaxation of the 7-input gate.
    await expect.poll(async()=>{
      const groups=owners.map(owner=>database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.groupBy({by:['stage','status'],where:{run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}}},_count:{_all:true}})));`));
      report.progress.push({at:new Date().toISOString(),owners:groups});save();
      for(const [i,group] of groups.entries()){
        if(group.some((row:any)=>row.status==='FAILED'))throw Error(`Native job failed for fixture owner ${i}`);
      }
      return groups.reduce((sum,group)=>sum+(group.find((row:any)=>row.stage==='photo-printing-evidence-v1'&&row.status==='COMPLETE')?._count._all??0),0);
    },{timeout:count===100?1200000:2700000,intervals:[1000,5000,10000]}).toBe(count);
    report.printingCompleteMilliseconds=Date.now()-started;
    for(const [i,owner] of owners.entries()){
      const state=database(`const where={run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}}};const jobs=await p.acquisitionProcessingJob.findMany({where:{...where,stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:{candidate:{acquisitionOrder:'asc'}},select:{output:true,artifact:{select:{digest:true}}}});console.log(JSON.stringify({photos:await p.acquisitionPhoto.count({where:{...where,ready:true}}),artifacts:await p.acquisitionArtifact.count({where}),slots:await p.acquisitionCaptureSlot.count({where}),candidates:await p.acquisitionCandidate.count({where}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(owner.tag)}}}),rows:jobs.map(j=>({digest:j.artifact.digest,nativeDigest:j.output.printingNative.photoDigest,automatic:j.output.proposals.automaticAcceptance,descriptor:j.output.printingNative.descriptor}))}));`);
      for(const key of ['photos','artifacts','slots','candidates'])expect(state[key]).toBe(owner.target);
      expect(state.rows).toHaveLength(owner.target);expect(state.inventory).toBe(inventoryScale?inventoryScaleOwners[i].rows:0);
      for(const [n,row] of state.rows.entries()){
        expect(row.digest).toBe(originals[n%originals.length].digest);expect(row.nativeDigest).toBe(row.digest);
        expect(row.automatic).toBe(false);
      }
      report[i]=state;await measureInventory(pages[i],i);
      const page=pages[i],simple=page.getByRole('button',{name:'Simple',exact:true});
      if(await simple.count())await simple.click();
      while(await page.locator('[data-testid^="capture-card-"]').count()<owner.target){
        const before=await page.locator('[data-testid^="capture-card-"]').count();
        await page.getByRole('button',{name:'Load more cards',exact:true}).scrollIntoViewIfNeeded();
        await expect.poll(()=>page.locator('[data-testid^="capture-card-"]').count(),{timeout:20000}).toBeGreaterThan(before);
      }
      await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(owner.target);
      const first=page.getByTestId('capture-card-1');await first.scrollIntoViewIfNeeded();
      if(await simple.count())await first.getByRole('button',{name:'Correct',exact:true}).click();
      await first.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');
      await first.getByRole('button',{name:'Save card review',exact:true}).click();
      await expect(first).toContainText('Review saved. Not yet added to Inventory.');
      const saved=database(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}},acquisitionOrder:0},select:{review:true,revision:true}})));`);
      await page.reload();await first.scrollIntoViewIfNeeded();await expect(first).toContainText('LP');
      expect(database(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}},acquisitionOrder:0},select:{review:true,revision:true}})));`)).toEqual(saved);
      expect(database(inventoryFingerprintBody(owner.tag))).toEqual(inventoryBaselines[i]);
      if(inventoryScale){
        // Additional bounded authenticated samples; retain each measurement
        // rather than presenting a small sample as an operator throughput target.
        for(let sample=0;sample<4;sample++)await measureInventory(page,i);
      }
      for(const width of [1366,390]){
        await page.setViewportSize({width,height:900});await first.scrollIntoViewIfNeeded();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/large-batch-${count}${inventoryScale?'-inventory-scale':''}-owner-${i}-${width}.png`});
      }
    }
    report.workersAfter=workerSnapshots();
    for(const [i,worker] of report.workersAfter.entries())assertNativeWorkerContinuity(report.workersBefore[i],worker);
    qualified=true;
  }finally{
    // Independent feedback cleanup must precede browser/report operations.
    for (const owner of owners) database(cancelAndCleanCorrectionFixture(owner.tag) + "console.log('{}');");
    if(timer)clearInterval(timer);report.checksFinishedAt=new Date().toISOString();save();
    await Promise.allSettled(failedResponses);
    await captureBrowserFailures();
    try{
      report.uploadStateBeforeCleanup=owners.map(owner=>database(`const where={run:{session:{ownerPlayerId:${JSON.stringify(owner.tag)}}}};console.log(JSON.stringify({photos:await p.acquisitionPhoto.count({where}),ready:await p.acquisitionPhoto.count({where:{...where,ready:true}}),slots:await p.acquisitionCaptureSlot.count({where}),candidates:await p.acquisitionCandidate.count({where})}));`));
    }catch{report.uploadStateBeforeCleanupUnavailable=true;}
    save();
    // Record resource state even when a throughput/UI assertion fails. These
    // counters cover the container lifetime and may include earlier runs.
    try{
      report.workerLifetime=['acquisition-recognition','acquisition-visual','acquisition-printing'].map(name=>{
        const container=`mtg-archives-${name}-worker-1`;
        const events=Object.fromEntries(docker('exec',container,'cat','/sys/fs/cgroup/memory.events').split('\n').map(line=>{
          const[key,value]=line.trim().split(/\s+/);return[key,Number(value)];
        }));
        return{name,scope:'CONTAINER_LIFETIME_NOT_TEST_ONLY',events,
          peakBytes:Number(docker('exec',container,'cat','/sys/fs/cgroup/memory.peak')),
          restarts:Number(docker('inspect',container,'--format','{{.RestartCount}}'))};
      });save();
    }catch{report.workerLifetimeUnavailable=true;save();}
    database(`await p.acquisitionSession.updateMany({where:{ownerPlayerId:{in:${JSON.stringify(owners.map(owner=>owner.tag))}}},data:{phase:'CANCELLED'}});console.log('{}');`);
    for(const owner of owners){
      // Bound individual cleanup operations as well as fixture creation. A
      // large DELETE can outlive the Docker client while still running inside
      // the container; do not abandon later owners after that timeout.
      let removed=0,exhausted=false;
      for(let page=0;page<100;page++){
        const count=database(cleanupInventoryScalePageBody(owner.tag));
        removed+=count;
        if(count===0){exhausted=true;break;}
      }
      if(!exhausted)throw Error('Owned Inventory cleanup exceeded its bounded pages');
      report.inventoryCleanup??=[];report.inventoryCleanup.push({removed});save();
      database(`const n=${JSON.stringify(owner.tag)};await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n,parentLocationId:{not:null}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned photo path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});}console.log('{}');`);
    }
    report.cleanup=database(`console.log(JSON.stringify({users:await p.user.count({where:{id:{in:${JSON.stringify(owners.map(o=>o.tag))}}}}),sessions:await p.acquisitionSession.count({where:{ownerPlayerId:{in:${JSON.stringify(owners.map(o=>o.tag))}}}}),locations:await p.inventoryLocation.count({where:{ownerPlayerId:{in:${JSON.stringify(owners.map(o=>o.tag))}}}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:{in:${JSON.stringify(owners.map(o=>o.tag))}}}})}));`);
    report.existingInventoryAfter=database(inventoryFingerprintBody());
    save();
    for(const context of contexts)await context.close();
    for(const file of spooled){
      if(!path.resolve(file).startsWith(spool+path.sep))throw Error('Unexpected private fixture path');
      unlinkSync(file);
    }
    rmdirSync(spool);
    expect(report.cleanup).toEqual({users:0,sessions:0,locations:0,inventory:0});
    if(report.existingInventoryBefore)expect(report.existingInventoryAfter).toEqual(report.existingInventoryBefore);
    report.finishedAt=new Date().toISOString();finalizeQualificationReport(writeReport,report,qualified);
  }
});
