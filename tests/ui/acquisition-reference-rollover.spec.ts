import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';
import {web,worker,docker,database,json,sha,holdReference,cleanupReferenceRows} from './acquisition-reference-local';

test('actual native generation rollover retires an in-flight old reference lineage',async({page,baseURL})=>{
  const corpus=process.env.MTG_ANCHOR_FIXTURES_PATH,compose=process.env.MTG_ANCHOR_COMPOSE_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||process.env.MTG_ANCHOR_MODEL_ROLLOVER!=='1'||!corpus||!compose,'Requires explicit isolated local generation-rollover opt-in');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  const endpoint=JSON.parse(docker(['context','inspect',docker(['context','show']).trim(),'--format','{{json .Endpoints.docker.Host}}']));
  expect(endpoint).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  const composePath=realpathSync(compose!);expect(composePath).toBe(realpathSync(path.resolve('.local-data/isolated-compose.json')));
  for(const name of [web,worker])expect(docker(['inspect',name,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  test.setTimeout(900000);page.setDefaultTimeout(10000);
  const configuration=JSON.parse(readFileSync(composePath,'utf8')),originalImage=configuration.services['acquisition-recognition-worker'].image;
  expect(['mtg-acquisition-recognition:reference-anchor-v3','mtg-acquisition-recognition:reference-anchor-rollover-v4']).toContain(originalImage);
  expect(configuration.services['acquisition-recognition-worker'].mem_limit).toBe('2g');
  expect(configuration.services['acquisition-recognition-worker'].cpus).toBe(1);
  expect(configuration.services['acquisition-recognition-worker'].environment.ACQUISITION_REFERENCE_REFINEMENT_ENABLED).toBe('1');
  const initialContainerImage=docker(['inspect',worker,'--format','{{.Image}}']).trim();
  const initialReady=docker(['logs','--tail','300',worker]).split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).findLast(s=>s.event==='recognition-ready');
  expect(initialReady.model).toMatch(/^[a-f0-9]{64}$/);
  expect(Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{status:{in:['PENDING','RUNNING']}}}));`))).toBe(0);
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now();
  const own=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`,bytes=readFileSync(path.join(corpus!,'reference-1.jpg')),digest=sha(bytes);
  let deployedOld=false;const report:any={scope:'LOCAL_ACTUAL_NATIVE_GENERATION_ROLLOVER',old:null,current:null,passed:false};
  const save=()=>{if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH,JSON.stringify({...report,elapsedMs:Date.now()-started},null,2));};
  const loadImage=(image:string)=>{
    expect(['mtg-acquisition-recognition:reference-anchor',originalImage]).toContain(image);
    configuration.services['acquisition-recognition-worker'].image=image;
    writeFileSync(composePath,JSON.stringify(configuration,null,2));
    docker(['compose','-p','mtg-anchor-qualification','-f',composePath,'up','-d','--no-deps','--force-recreate','acquisition-recognition-worker']);
  };
  try{
    loadImage('mtg-acquisition-recognition:reference-anchor');deployedOld=true;
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[]}}});await p.correctionLibraryAccount.create({data:{ownerPlayerId:n,displayKey:require('crypto').randomBytes(32).toString('hex'),sampleBasisPoints:10000,sampleCap:1}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByLabel('Choose card photos').setInputFiles({name:'reference-1.jpg',buffer:bytes,mimeType:'image/jpeg'});
    const card=page.getByTestId('capture-card-1');await card.scrollIntoViewIfNeeded();
    const held=await holdReference(tag),photoId=held.job.input.photoId;
    const before=json(`console.log(JSON.stringify({jobs:await p.acquisitionProcessingJob.findMany({where:${own}}),evidence:await p.correctionEvidence.findMany({where:{ownerPlayerId:${JSON.stringify(tag)}}})}));`);
    const first=before.jobs.find((j:any)=>j.id===held.job.input.parents.recognitionJobId);
    expect(first.status).toBe('COMPLETE');expect(first.output.native.photoDigest).toBe(digest);
    expect(first.output.native.descriptor).not.toBe(initialReady.model);
    report.old={job:held.job,primary:first,observedNativeCpu:held.observedNativeCpu};save();
    // Replace real native code/model identity during actual work. No expected
    // printing, fake descriptor, mutated parent, lease or job seeding.
    docker(['kill','--signal=KILL',worker]);
    loadImage(originalImage);deployedOld=false;
    expect(docker(['inspect',worker,'--format','{{.Image}}']).trim()).toBe(initialContainerImage);
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${own},stage:'photo-reference-refinement-v1',status:'COMPLETE'}}));`)),{timeout:480000,intervals:[1000,3000]}).toBe(1);
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${own},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:240000,intervals:[1000,3000]}).toBe(0);
    const after=json(`console.log(JSON.stringify({jobs:await p.acquisitionProcessingJob.findMany({where:${own},orderBy:{createdAt:'asc'}}),evidence:await p.correctionEvidence.findMany({where:{ownerPlayerId:${JSON.stringify(tag)}}}),photos:await p.acquisitionPhoto.findMany({where:${own}}),candidates:await p.acquisitionCandidate.findMany({where:${own}})}));`);
    for(const observed of before.jobs.filter((j:any)=>j.status==='COMPLETE'))expect(after.jobs.find((j:any)=>j.id===observed.id).output).toEqual(observed.output);
    for(const evidence of before.evidence)expect(after.evidence.find((e:any)=>e.id===evidence.id)).toEqual(evidence);
    const previous=after.jobs.find((j:any)=>j.id===held.job.id),references=after.jobs.filter((j:any)=>j.stage==='photo-reference-refinement-v1');
    expect(previous.status).toBe('SUPERSEDED');expect(previous.output?.native).toBeUndefined();expect(references).toHaveLength(2);
    expect(new Set(references.map((j:any)=>j.input.lineageKey)).size).toBe(2);
    const current=references.find((j:any)=>j.status==='COMPLETE');
    expect(current.input.model).toBe(initialReady.model);expect(current.output.native.descriptor).toBe(initialReady.model);
    expect(current.output.native.photoDigest).toBe(digest);expect(current.output.refinementExecution.inferenceRequests).toBe(1);
    expect(current.output.proposals.automaticAcceptance).toBe(false);
    expect(after.jobs.filter((j:any)=>j.input?.referenceSource?.referenceJobId===previous.id)).toHaveLength(0);
    expect(after.jobs.filter((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.input?.referenceSource?.referenceJobId===current.id&&j.status==='COMPLETE')).toHaveLength(1);
    expect(after.photos).toHaveLength(1);expect(after.photos[0].digest).toBe(digest);expect(after.candidates).toHaveLength(1);expect(after.candidates[0].review).toBeNull();expect(after.candidates[0].receipt).toBeNull();
    await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toBeEnabled();
    const url=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');const original=await page.request.get(url!);expect(original.ok()).toBe(true);expect(sha(await original.body())).toBe(digest);
    expect(sha(readFileSync(path.join(corpus!,'reference-1.jpg')))).toBe(digest);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    report.current={previous,current,after};report.passed=true;save();
  }catch(error){report.error=(error as Error).message;report.jobs=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:${own}})));`);save();throw error;
  }finally{
    const failures:unknown[]=[];const clean=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(e){failures.push(e)}};
    await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    if(deployedOld||JSON.parse(readFileSync(composePath,'utf8')).services['acquisition-recognition-worker'].image!==originalImage)await clean(()=>loadImage(originalImage));
    await clean(()=>cleanupReferenceRows(tag));await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    report.cleanupFailures=failures.length;save();
    if(failures.length)throw new AggregateError(failures,'Rollover fixture restoration/cleanup failed');
  }
});
