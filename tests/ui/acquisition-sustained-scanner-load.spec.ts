import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {database,json,cleanupReferenceRows} from './acquisition-reference-local';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';
import {observeLoad} from '../../tools/acquisition-eval/scanner-load-resources';

test('bounded124 scanner software load preserves native observations and human authority',async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!process.env.MTG_SUSTAINED_SCAN_ROOT||!process.env.MTG_SUSTAINED_REPORT,'Explicit retained development originals and local report required; no hardware feed');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  test.setTimeout(3600000);
  expect(database("console.log(process.env.DATABASE_URL?.includes('/acquisition_anchor_review'));").trim()).toBe('true');
  const root=process.env.MTG_SUSTAINED_SCAN_ROOT!;
  const labels=readFileSync('tools/acquisition-eval/scan-batch-manifest.json');
  const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
  expect(sha(labels)).toBe('e4fb66da1db57bd43b84c57be9cdebfeafffed6cedb24b13661d8b0cf851ff81');
  const manifest=JSON.parse(labels.toString());
  const entries=manifest.entries;
  expect(entries).toHaveLength(124);
  const inputs=entries.map((e:any)=>{const file=path.join(root,e.file);expect(sha(readFileSync(file))).toBe(e.sha256);return file});
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now();
  const report=process.env.MTG_SUSTAINED_REPORT!,progress=report+'.progress.json',deadline=started+3000000;
  let primaryError:unknown,diagnosticError:unknown,observer:Awaited<ReturnType<typeof observeLoad>>|undefined;
  const remaining=()=>Math.max(1,deadline-Date.now());
  const scope=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  writeFileSync(progress,JSON.stringify({owner:tag,started,phase:'setup'}));
  try{
    observer=await observeLoad(report+'.resources.json');
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:124,sections:[]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
    await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByLabel('Choose card photos').setInputFiles(inputs);
    writeFileSync(progress,JSON.stringify({owner:tag,started,phase:'ordinary-native-pipeline'}));
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionPhoto.count({where:${scope}}));`)),{timeout:300000,intervals:[1000,3000]}).toBe(124);
    const saved=new Set<string>();
    await expect.poll(()=>{const complete=json(`const rows=await p.acquisitionProcessingJob.findMany({where:{...${scope},stage:'photo-printing-evidence-v1',status:'COMPLETE'},select:{candidateId:true,artifact:{select:{digest:true}}}});console.log(JSON.stringify(rows));`);
      for(const row of complete){const digest=row.artifact.digest;if(saved.has(digest))continue;const entry=entries.find((e:any)=>e.sha256===digest);if(!entry)throw Error('Foreign completed artifact');const observed=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{...${scope},artifact:{digest:${JSON.stringify(digest)}}},orderBy:{createdAt:'desc'},select:{id:true,stage:true,status:true,attempts:true,input:true,output:true}})));`);writeFileSync(report+'.partial.'+entry.file+'.json',JSON.stringify(observed,null,2));saved.add(digest);}
      const printed=new Set(complete.map((r:any)=>r.candidateId)).size;writeFileSync(progress,JSON.stringify({owner:tag,started,phase:'ordinary-native-pipeline',printed,partialOutputs:saved.size}));return printed;},{timeout:remaining(),intervals:[5000,10000]}).toBe(124);
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${scope},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:300000,intervals:[3000,5000]}).toBe(0);
    const refinements=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{...${scope},stage:'photo-reference-refinement-v1'},select:{id:true,status:true}})));`);
    expect(refinements.some((j:any)=>j.status==='FAILED')).toBe(false);
    for(const refinement of refinements.filter((j:any)=>j.status==='COMPLETE')){
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${scope},stage:'photo-printing-evidence-v1',status:'COMPLETE',input:{path:['referenceSource','referenceJobId'],equals:${JSON.stringify(refinement.id)}}}}));`)),{timeout:300000,intervals:[3000,5000]}).toBe(1);
    }
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${scope},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:300000,intervals:[3000,5000]}).toBe(0);
    const results=json(`const fs=require('fs'),path=require('path'),crypto=require('crypto');const jobs=await p.acquisitionProcessingJob.findMany({where:${scope},select:{id:true,stage:true,status:true,attempts:true}});const photos=await p.acquisitionPhoto.findMany({where:${scope},select:{id:true,digest:true}});const originals=photos.map(photo=>({id:photo.id,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.original'))).digest('hex')}));console.log(JSON.stringify({jobs,photos,originals}));`);
    expect(results.jobs.filter((j:any)=>j.status==='FAILED')).toHaveLength(0);
    const scored:any[]=[];
    for(const entry of entries){
      const observed=json(`const jobs=await p.acquisitionProcessingJob.findMany({where:{...${scope},artifact:{digest:${JSON.stringify(entry.sha256)}}},orderBy:{createdAt:'desc'},select:{id:true,stage:true,status:true,attempts:true,input:true,output:true,candidateRevision:true,candidate:{select:{revision:true,review:true,receipt:true}}}});const cards=await p.card.findMany({where:{id:{in:jobs.flatMap(j=>j.output?.proposals?.proposals?.map(c=>c.card.id)??[])}},select:{id:true,scryfallId:true}});console.log(JSON.stringify({jobs,cards}));`);
      writeFileSync(report+'.'+entry.file+'.json',JSON.stringify(observed,null,2));
      const jobs=observed.jobs;
      const baseline=process.env.MTG_SUSTAINED_NATIVE_BASELINE;
      if(baseline){const old=JSON.parse(readFileSync(path.join(baseline,'current-124-report.json.'+entry.file+'.json'),'utf8')).jobs.find((j:any)=>j.stage==='photo-recognition-v1').output.native;const primary=jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.input.photoId===jobs.find((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE').input.photoId);for(const key of ['geometry','text','lines','orientations','readingZones'])expect(primary.output.native[key],entry.file+' '+key).toEqual(old[key]);}
      const lookup=new Map(observed.cards.map((c:any)=>[c.id,c.scryfallId]));
      const printing=jobs.find((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE');
      expect(printing).toBeTruthy();expect(printing.candidate.review).toBeNull();expect(printing.candidate.receipt).toBeNull();
      expect(printing.candidateRevision).toBe(printing.candidate.revision);
      expect(printing.output.proposals.automaticAcceptance).toBe(false);
      expect(printing.output.printingNative.photoDigest).toBe(entry.sha256);
      const offered=printing.output.proposals.proposals.map((proposal:any)=>lookup.get(proposal.card.id));
      expect(offered.every((id:any)=>typeof id==='string')).toBe(true);
      // Expected identity enters only this scoring step, after native inference.
      scored.push({file:entry.file,sha256:entry.sha256,labelStatus:entry.labelStatus,firstCorrect:entry.labelStatus==='IDENTIFIED'?offered[0]===entry.scryfallId:null,expectedOffered:entry.labelStatus==='IDENTIFIED'?offered.includes(entry.scryfallId):null,offered,jobs});
    }
    expect(results.photos).toHaveLength(124);
    for(const photo of results.photos){expect(results.originals.find((r:any)=>r.id===photo.id).sha256).toBe(photo.digest);expect(entries.some((e:any)=>e.sha256===photo.digest)).toBe(true)}
    for(const entry of entries)expect(sha(readFileSync(path.join(root,entry.file)))).toBe(entry.sha256);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    const summary={developmentOnly:true,physicalCopyIndependence:'UNKNOWN',manifestSha256:sha(labels),samples:124,identifiedSamples:entries.filter((e:any)=>e.labelStatus==='IDENTIFIED').length,unresolvedSamples:entries.filter((e:any)=>e.labelStatus!=='IDENTIFIED').map((e:any)=>e.file),first:scored.filter((r:any)=>r.firstCorrect).length,offered:scored.filter((r:any)=>r.expectedOffered).length,elapsedMs:Date.now()-started,refinements:refinements.filter((r:any)=>r.status==='COMPLETE').length,printingAttempts:results.jobs.filter((j:any)=>j.stage==='photo-printing-evidence-v1').map((j:any)=>({status:j.status,attempts:j.attempts}))};
    writeFileSync(report,JSON.stringify({summary,results:scored},null,2));
    console.log(JSON.stringify(summary));
  }catch(error){
    primaryError=error;
    try{const jobs=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:${scope},orderBy:{createdAt:'asc'},select:{id:true,stage:true,status:true,attempts:true,errorCode:true}})));`);
    writeFileSync(report+'.failure.json',JSON.stringify({elapsedMs:Date.now()-started,error:String(error),jobs},null,2));}catch(e){diagnosticError=e}throw error;
  }finally{
    const failures:unknown[]=[...(primaryError?[primaryError]:[]),...(diagnosticError?[diagnosticError]:[])];
    try{await observer?.stop()}catch(e){failures.push(e)}
    try{database(`await p.authSession.deleteMany({where:{userId:${JSON.stringify(tag)}}});`+cancelAndCleanCorrectionFixture(tag))}catch(e){failures.push(e)}
    try{cleanupReferenceRows(tag)}catch(e){failures.push(e)}
    try{database(cancelAndCleanCorrectionFixture(tag))}catch(e){failures.push(e)}
    try{writeFileSync(progress,JSON.stringify({owner:tag,phase:'ended',primaryFailed:Boolean(primaryError),allFailures:failures.length}))}catch(e){failures.push(e)}
    if(failures.length)throw new AggregateError(failures,'Sustained124 workflow, observations or exact-owned cleanup failed');
  }
});

