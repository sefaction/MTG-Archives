import {expect,test,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';
import {web,worker,docker,database,json,sha,holdReference,resumeNative,cleanupReferenceRows} from './acquisition-reference-local';

test('actual scanner queue shares owners and prioritizes first reads over reference backlog across runs',async({browser,baseURL})=>{
  const corpus=process.env.MTG_ANCHOR_FIXTURES_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!corpus,'Requires isolated local development scans');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  const endpoint=JSON.parse(docker(['context','inspect',docker(['context','show']).trim(),'--format','{{json .Endpoints.docker.Host}}']));expect(endpoint).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)expect(process.env.DOCKER_HOST).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  for(const container of [web,worker])expect(docker(['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  test.setTimeout(900000);
  const owners=Array.from({length:2},()=>({id:`ui-reference-scan-${randomUUID()}`,password:randomUUID()})),contexts=await Promise.all(owners.map(()=>browser.newContext({baseURL}))),started=Date.now();
  let held:Awaited<ReturnType<typeof holdReference>>|undefined;
  const report:any={passed:false};const save=()=>{if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH,JSON.stringify({...report,elapsedMs:Date.now()-started},null,2));};
  const owned=`{run:{session:{ownerPlayerId:{in:${JSON.stringify(owners.map(o=>o.id))}}}}}`;
  const jobs=()=>json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:${owned},orderBy:{createdAt:'asc'},include:{run:{select:{session:{select:{ownerPlayerId:true}}}}}})));`);
  const upload=async(page:Page,turns:number[])=>page.getByLabel('Choose card photos').setInputFiles(turns.map(turn=>({name:`reference-${turn}.jpg`,buffer:readFileSync(path.join(corpus!,`reference-${turn}.jpg`)),mimeType:'image/jpeg'})));
  async function batch(page:Page,owner:typeof owners[number],login=true){
    page.setDefaultTimeout(10000);
    if(login){await page.goto('/login');await page.getByLabel(/username or email/i).fill(owner.id);await page.getByLabel(/^password$/i).fill(owner.password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);}
    await page.goto('/imports/scan');await page.getByTestId('storage-destination').getByRole('combobox').fill(owner.id);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
    return new URL(page.url()).searchParams.get('batch')!;
  }
  try{
    for(const owner of owners)database(`const n=${JSON.stringify(owner.id)},hash=await require('bcryptjs').hash(${JSON.stringify(owner.password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:4,sections:[]}}});`);
    const firstPage=await contexts[0].newPage(),secondPage=await contexts[1].newPage(),otherRunPage=await contexts[0].newPage();
    const firstBatch=await batch(firstPage,owners[0]),secondBatch=await batch(secondPage,owners[1]),otherBatch=await batch(otherRunPage,owners[0],false);
    await upload(firstPage,[0,1,2]);held=await holdReference(owners[0].id);const active=held;
    const readyParents=(rows:any[])=>rows.filter(j=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE'&&!j.input.referenceSource&&
      !rows.some(r=>r.stage==='photo-reference-refinement-v1'&&r.input.parents?.printingJobId===j.id));
    // Admission shares the OCR dispatcher. While its actual request is held,
    // backlog consists of completed eligible parents awaiting the next turn.
    await expect.poll(()=>readyParents(jobs()).length,{timeout:20000,intervals:[300,1000]}).toBeGreaterThanOrEqual(1);
    await upload(secondPage,[3]);await upload(otherRunPage,[3]);
    let waiting:any[]=[];
    await expect.poll(()=>{waiting=jobs();return waiting.filter(j=>j.stage==='photo-canonical-v1'&&j.status==='COMPLETE'&&j.runId!==active.job.runId).length},{timeout:10000,intervals:[300,500]}).toBe(2);
    const backlog=readyParents(waiting),fresh=waiting.filter(j=>j.stage==='photo-canonical-v1'&&j.status==='COMPLETE'&&j.runId!==active.job.runId);
    expect(new Set(fresh.map(j=>j.run.session.ownerPlayerId)).size).toBe(2);expect(new Set(fresh.map(j=>j.runId)).size).toBe(2);expect(backlog.length).toBeGreaterThan(0);
    report.backlog=waiting;report.heldMilliseconds=Date.now()-active.heldAt;report.observedNativeCpu=active.observedNativeCpu;expect(report.heldMilliseconds).toBeLessThan(35000);resumeNative(active);held=undefined;
    await expect.poll(()=>jobs().filter((j:any)=>['PENDING','RUNNING'].includes(j.status)).length,{timeout:600000,intervals:[1000,3000]}).toBe(0);
    const after=jobs(),newOwner=after.find((j:any)=>j.stage==='photo-recognition-v1'&&j.runId===fresh.find(j=>j.run.session.ownerPlayerId===owners[1].id).runId),otherRun=after.find((j:any)=>j.stage==='photo-recognition-v1'&&j.runId===fresh.find(j=>j.run.session.ownerPlayerId===owners[0].id).runId);
    expect(newOwner.status).toBe('COMPLETE');expect(otherRun.status).toBe('COMPLETE');
    expect(Date.parse(newOwner.updatedAt)).toBeLessThan(Date.parse(otherRun.updatedAt));
    for(const parent of backlog){const complete=after.find((j:any)=>j.stage==='photo-reference-refinement-v1'&&j.input.parents?.printingJobId===parent.id);expect(complete.status).toBe('COMPLETE');expect(Date.parse(otherRun.updatedAt)).toBeLessThan(Date.parse(complete.updatedAt));}
    expect(after.filter((j:any)=>j.stage==='photo-recognition-v1'&&j.status==='COMPLETE')).toHaveLength(5);
    expect(after.filter((j:any)=>j.stage==='photo-reference-refinement-v1'&&j.status==='COMPLETE')).toHaveLength(5);
    for(const reference of after.filter((j:any)=>j.stage==='photo-reference-refinement-v1')){expect(reference.attempts).toBe(1);expect(reference.output.refinementExecution.inferenceRequests).toBe(1);expect(reference.output.proposals.automaticAcceptance).toBe(false);}
    const photos=json(`console.log(JSON.stringify(await p.acquisitionPhoto.findMany({where:${owned}})));`);expect(photos).toHaveLength(5);
    for(const photo of photos)expect([0,1,2,3].map(turn=>sha(readFileSync(path.join(corpus!,`reference-${turn}.jpg`))))).toContain(photo.digest);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:{in:${JSON.stringify(owners.map(o=>o.id))}}}}));`))).toBe(0);
    report.after=after;report.batches=[firstBatch,secondBatch,otherBatch];report.passed=true;save();
  }catch(error){report.error=(error as Error).message;report.jobs=jobs();save();throw error;
  }finally{
    const failures:unknown[]=[];const clean=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(e){failures.push(e)}};
    if(held)await clean(()=>resumeNative(held!));
    for(const owner of owners){await clean(()=>database(cancelAndCleanCorrectionFixture(owner.id)));await clean(()=>cleanupReferenceRows(owner.id));await clean(()=>database(cancelAndCleanCorrectionFixture(owner.id)));}
    for(const context of contexts)await clean(()=>context.close());report.cleanupFailures=failures.length;save();if(failures.length)throw new AggregateError(failures,'Fairness fixture cleanup failed');
  }
});
