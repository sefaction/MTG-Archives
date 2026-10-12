import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';

const container='mtg-anchor-qualification-web-1';
function database(body:string){
  return execFileSync('docker',['exec','-i',container,'node'],{input:
    `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:16*1024*1024});
}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const recognitionContainer='mtg-anchor-qualification-acquisition-recognition-worker-1';
async function interruptOwnedNative(owner:string,mode:'native-kill'|'worker-restart'){
  const owned=`{run:{session:{ownerPlayerId:${JSON.stringify(owner)}}}}`;
  let active:any;
  await expect.poll(()=>{
    active=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirst({where:{...${owned},stage:'photo-reference-refinement-v1',status:'RUNNING'},select:{id:true,attempts:true,leaseToken:true,leaseExpiresAt:true,input:true}})));`));
    return Boolean(active);
  },{timeout:300000,intervals:[100,200,300]}).toBe(true);
  const nativeStat=()=>JSON.parse(execFileSync('docker',['exec',recognitionContainer,'python','-c',
    "import os,json; rows=[]\nfor d in os.listdir('/proc'):\n if d.isdigit():\n  try:\n   c=open('/proc/'+d+'/cmdline','rb').read().split(b'\\0');s=open('/proc/'+d+'/stat').read().split();\n   if len(c)>2 and c[1]==b'/app/tools/acquisition-runtime/recognize.py' and b'--stream' in c:rows.append({'pid':int(d),'ticks':int(s[13])+int(s[14])})\n  except (FileNotFoundError,ProcessLookupError,PermissionError):pass\nassert len(rows)==1, 'Expected one recognition stream';print(json.dumps(rows[0]))"],
    {encoding:'utf8',windowsHide:true,timeout:10000}));
  const before=nativeStat();
  await expect.poll(()=>{const now=nativeStat();expect(now.pid).toBe(before.pid);return now.ticks-before.ticks},
    {timeout:3000,intervals:[100,100,200]}).toBeGreaterThan(0);
  // Recheck the exact owned lease immediately before fault injection. No
  // manufactured job, changed deadline, lease override or alternate image.
  const live=JSON.parse(database(`const where={status:'RUNNING',stage:{in:['photo-recognition-v1','photo-reference-refinement-v1']}};const rows=await p.acquisitionProcessingJob.findMany({where,select:{id:true,leaseToken:true}});console.log(JSON.stringify(rows));`));
  expect(live).toEqual([{id:active.id,leaseToken:active.leaseToken}]);
  const imageBefore=execFileSync('docker',['inspect',recognitionContainer,'--format','{{.Image}}'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  if(mode==='native-kill')execFileSync('docker',['exec',recognitionContainer,'python','-c',
    "import os,signal;pid="+before.pid+";c=open('/proc/'+str(pid)+'/cmdline','rb').read().split(b'\\0');assert c[1]==b'/app/tools/acquisition-runtime/recognize.py' and b'--stream' in c;os.kill(pid,signal.SIGKILL)"],{windowsHide:true,timeout:10000});
  else{
    execFileSync('docker',['kill','--signal=KILL',recognitionContainer],{windowsHide:true,timeout:10000});
    execFileSync('docker',['start',recognitionContainer],{windowsHide:true,timeout:10000});
  }
  let reclaimed:any;
  await expect.poll(()=>{
    reclaimed=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(active.id)}},select:{status:true,attempts:true,leaseToken:true,updatedAt:true}})));`));
    return reclaimed.status==='RUNNING'&&reclaimed.attempts===active.attempts+1;
  },{timeout:180000,intervals:[100,200,300]}).toBe(true);
  expect(reclaimed.leaseToken).not.toBe(active.leaseToken);
  if(mode==='worker-restart')expect(Date.parse(reclaimed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(active.leaseExpiresAt));
  expect(execFileSync('docker',['inspect',recognitionContainer,'--format','{{.Image}}'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim()).toBe(imageBefore);
  return {mode,jobId:active.id,firstAttempts:active.attempts,leaseExpiresAt:active.leaseExpiresAt,reclaimedAt:reclaimed.updatedAt,observedNativeCpu:true,sameImage:true};
}
test('ordinary scanner queue performs one source-bound reference reread and preserves original observations',async({page,baseURL})=>{
  const corpus=process.env.MTG_ANCHOR_FIXTURES_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!corpus,'Requires isolated local review and retained development originals; never operates scanner');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  expect(execFileSync('docker',['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}'],{encoding:'utf8',windowsHide:true}).trim()).toBe('mtg-anchor-qualification');
  const recoveryMode=process.env.MTG_ANCHOR_RECOVERY_MODE;
  expect([undefined,'native-kill','worker-restart']).toContain(recoveryMode);
  test.setTimeout(1200000);
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now();
  const fixtures=[...Array.from({length:4},(_,turn)=>({name:`reference-${turn}.jpg`,refined:true,turn})),
    {name:'complete.png',refined:false,turn:0},{name:'clipped.png',refined:false,turn:0}]
    .map(f=>({...f,buffer:readFileSync(path.join(corpus!,f.name))})).map(f=>({...f,digest:sha(f.buffer)}));
  const results:any[]=[];
  let recovery:Awaited<ReturnType<typeof interruptOwnedNative>>|undefined;
  if(process.env.MTG_ANCHOR_PROGRESS_PATH)writeFileSync(process.env.MTG_ANCHOR_PROGRESS_PATH,JSON.stringify({owner:tag,started,phase:'setup'}));
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:${fixtures.length},sections:[]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByLabel('Choose card photos').setInputFiles(fixtures.map(f=>({name:f.name,buffer:f.buffer,mimeType:f.name.endsWith('.jpg')?'image/jpeg':'image/png'})));
    const where=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
    // Actual admission, native workers and publication. No model stub, source
    // job seeding, priority override, expected printing ID or lease adjustment.
    if(recoveryMode)recovery=await interruptOwnedNative(tag,recoveryMode as 'native-kill'|'worker-restart');
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${where},stage:'photo-reference-refinement-v1',status:{in:['COMPLETE','SUPERSEDED','FAILED']}}}));`)),{timeout:900000,intervals:[1000,3000,5000]}).toBe(fixtures.length);
    for(const [i,f] of fixtures.entries()){
      const scope=`{...${where},artifact:{digest:${JSON.stringify(f.digest)}}}`;
      const jobs=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:${scope},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,stage:true,status:true,input:true,output:true,candidateRevision:true,attempts:true,candidate:{select:{revision:true,review:true,receipt:true}}}})));`));
      if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH+`.photo-${i}.json`,JSON.stringify({digest:f.digest,jobs},null,2));
      const first=jobs.find((j:any)=>j.stage==='photo-recognition-v1');
      const reference=jobs.find((j:any)=>j.stage==='photo-reference-refinement-v1');
      expect(jobs.filter((j:any)=>j.stage==='photo-reference-refinement-v1')).toHaveLength(1);
      expect(first.status).toBe('COMPLETE');expect(first.output.native.photoDigest).toBe(f.digest);
      expect(reference.candidate.review).toBeNull();expect(reference.candidate.receipt).toBeNull();
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('link',{name:'Open original photo',exact:true})).toBeVisible();
      if(f.refined){
        expect(reference.status).toBe('COMPLETE');
        expect(reference.output.native.geometry.method).toBe('reference-anchor-region-v1');
        expect(reference.output.native.geometry.boundaryVerified).toBe(false);
        expect(reference.output.native.photoDigest).toBe(f.digest);
        expect(reference.output.native.geometry.manualRegion).toBeUndefined();
        expect(reference.output.primaryObservation.jobId).toBe(first.id);
        expect(reference.output.primaryReadings).toEqual(first.output.native.orientations.map(({rotationDegrees,text}:any)=>({rotationDegrees,text})));
        expect(reference.output.refinementExecution.inferenceRequests).toBe(1);
        expect(reference.output.refinementExecution.milliseconds).toBeLessThan(45000);
        expect(reference.output.proposals.automaticAcceptance).toBe(false);
        expect(reference.output.native.orientations.flatMap((o:any)=>[...o.text.footer,...(o.text.footerSupplemental??[])]).length)
          .toBeGreaterThan(first.output.native.orientations.flatMap((o:any)=>[...o.text.footer,...(o.text.footerSupplemental??[])]).length);
        await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${scope},stage:'photo-printing-evidence-v1',status:'COMPLETE',input:{path:['referenceSource','referenceJobId'],equals:${JSON.stringify(reference.id)}}}}));`)),{timeout:300000,intervals:[1000,3000,5000]}).toBe(1);
        const derived=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirstOrThrow({where:{...${scope},stage:'photo-printing-evidence-v1',status:'COMPLETE',input:{path:['referenceSource','referenceJobId'],equals:${JSON.stringify(reference.id)}}},select:{input:true,output:true,candidateRevision:true}})));`));
        expect(derived.output.referenceSource.referenceJobId).toBe(reference.id);
        expect(derived.output.proposals.automaticAcceptance).toBe(false);
        expect(derived.output.native.geometry.method).toBe('reference-anchor-region-v1');
        expect(derived.output.primaryReadings).toEqual(reference.output.primaryReadings);
        expect(derived.candidateRevision).toBe(reference.candidate.revision);
        await card.scrollIntoViewIfNeeded();
        await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toBeEnabled();
        await expect(card.getByText(/Reference landmarks suggest this outline/)).toBeVisible();
        const inferredImage=card.getByRole('img',{name:`Inferred card ${i+1}`,exact:true});
        await expect.poll(()=>inferredImage.evaluate((canvas:HTMLCanvasElement)=>canvas.width===400&&
          canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((n,index)=>index%4<3&&n>20))).toBe(true);
        await card.getByText('First readings from your original',{exact:true}).click();
        const originalReadings=card.locator('details').filter({hasText:'First readings from your original'});
        const originalTokens=first.output.native.orientations.flatMap((o:any)=>[...o.text.title,...o.text.footer,...(o.text.footerSupplemental??[])]);
        await expect(originalReadings).toContainText(originalTokens[0]??'No readable title/footer in this direction.');
        if(i===0)for(const width of [1366,320]){
          await page.setViewportSize({width,height:1000});await card.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await card.screenshot({path:`test-results/reference-reread-${width}.png`});
          await inferredImage.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
          await inferredImage.screenshot({path:`test-results/reference-reread-image-${width}.png`});
        }
        results.push({digest:f.digest,turn:f.turn,primary:first.output,reference:reference.output,derived:derived.output});
      }else{
        expect(reference.status).toBe('SUPERSEDED');
        expect(reference.output.referenceAdmission.status).toBe('SKIPPED');
        if(f.name==='clipped.png')expect(reference.output.referenceAdmission.reason).toBe('PHYSICAL_CLIPPING');
        else expect(['ALREADY_FRAMED','DIRECT_GEOMETRY_AUTHORITATIVE']).toContain(reference.output.referenceAdmission.reason);
        await expect(card.getByRole('button',{name:'Inferred card',exact:true})).toHaveCount(0);
        await expect(card.getByText(f.name==='clipped.png'?/missing edge cannot be recovered by trimming/:/aligned to the outer card edges/)).toBeVisible();
        results.push({digest:f.digest,primary:first.output,skip:reference.output});
      }
      const original=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
      const response=await page.request.get(original!);expect(response.ok()).toBe(true);expect(sha(await response.body())).toBe(f.digest);
      expect(sha(readFileSync(path.join(corpus!,f.name)))).toBe(f.digest);
    }
    // More than one ordinary polling/snapshot-refresh interval cannot create
    // another reread or replace immutable original observations.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${where},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:180000,intervals:[1000,3000]}).toBe(0);
    expect(Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${where},stage:'photo-reference-refinement-v1'}}));`))).toBe(fixtures.length);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    if(recovery){
      const recovered=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(recovery.jobId)}},select:{status:true,attempts:true}})));`));
      expect(recovered.status).toBe('COMPLETE');expect(recovered.attempts).toBe(recovery.firstAttempts+1);
      recovery={...recovery,...recovered};
    }
    if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH,JSON.stringify({elapsedMs:Date.now()-started,recovery,results},null,2));
  }catch(error){
    if(process.env.MTG_ANCHOR_REPORT_PATH){
      try{const jobs=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,stage:true,status:true,input:true,output:true,artifactId:true,candidateRevision:true,attempts:true,errorCode:true}})));`));
        writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH+'.failure.json',JSON.stringify({elapsedMs:Date.now()-started,error:(error as Error).message,jobs},null,2));
      }catch(snapshotError){throw new AggregateError([error,snapshotError],'Reference qualification failed and its job snapshot was unavailable');}
    }
    throw error;
  }finally{
    const failures:unknown[]=[];const cleanup=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(e){failures.push(e)}};
    await cleanup(()=>database(`await p.authSession.deleteMany({where:{userId:${JSON.stringify(tag)}}});`+cancelAndCleanCorrectionFixture(tag)));
    await cleanup(()=>database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw Error('Invalid owned photo namespace');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`));
    await cleanup(()=>database(cancelAndCleanCorrectionFixture(tag)+`const n=${JSON.stringify(tag)};if(await p.correctionLibraryAccount.count({where:{ownerPlayerId:n}}))throw Error('Owned independent account remains');`));
    if(process.env.MTG_ANCHOR_PROGRESS_PATH)writeFileSync(process.env.MTG_ANCHOR_PROGRESS_PATH,JSON.stringify({owner:tag,phase:'ended',cleanupFailures:failures.length}));
    if(failures.length)throw new AggregateError(failures,'reference scanner fixture cleanup failed');
  }
});
