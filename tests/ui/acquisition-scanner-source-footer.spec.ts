import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';import path from 'node:path';
import {database,json,cleanupReferenceRows,docker,web} from './acquisition-reference-local';import {cancelAndCleanCorrectionFixture} from './correction-fixture';

test('visible source footer guides clipped scan review while preserving original geometry and decisions',async({page,baseURL})=>{
  const root=process.env.MTG_RESERVED_SCANNER_ROOT,report=process.env.MTG_RESERVED_SCANNER_REPORT;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!root||!report,'Frozen private labelled inputs and explicit isolated local diagnostic run required');
  expect(baseURL).toBe('http://127.0.0.1:13011');test.setTimeout(2100000);
  expect(docker(['inspect',web,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  expect(database("console.log(process.env.DATABASE_URL?.includes('/acquisition_anchor_review'));").trim()).toBe('true');
  const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),manifestBytes=readFileSync(path.join(root!,'manifest.json')),manifest=JSON.parse(manifestBytes.toString()),entries=manifest.entries;
  expect(entries.length).toBeGreaterThan(0);expect(entries.length).toBeLessThanOrEqual(100);expect(new Set(entries.map((e:any)=>e.sha256)).size).toBe(entries.length);
  const inputs=entries.map((e:any)=>{expect(e.inputKind).toBe('CARD_SCAN');expect(e.file).toMatch(/^[a-z0-9-]+\.(png|jpg)$/);const file=path.join(root!,'originals',e.file);expect(sha(readFileSync(file))).toBe(e.sha256);return file;});
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now(),deadline=started+1800000,scope=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  let failed=false,primaryError:unknown;const progress=report!+'.progress.json';
  const state=()=>json(`console.log(JSON.stringify({photos:await p.acquisitionPhoto.findMany({where:${scope},select:{id:true,digest:true}}),jobs:await p.acquisitionProcessingJob.findMany({where:${scope},select:{id:true,stage:true,status:true,attempts:true,input:true,errorCode:true}})}));`);
  writeFileSync(progress,JSON.stringify({owner:tag,started,phase:'SETUP',manifestSha256:sha(manifestBytes)}));
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:${entries.length},sections:[]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.getByLabel('Choose card photos').setInputFiles(inputs);
    await expect.poll(()=>state().photos.length,{timeout:120000,intervals:[1000,3000]}).toBe(entries.length);
    let stable=0;
    await expect.poll(()=>{const s=state(),live=s.jobs.filter((j:any)=>['PENDING','RUNNING'].includes(j.status));const terminal=s.photos.filter((p:any)=>s.jobs.some((j:any)=>j.input.photoId===p.id&&((j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE')||j.status==='FAILED'))).length;
      writeFileSync(progress,JSON.stringify({owner:tag,started,phase:'PROCESSING',photos:s.photos.length,terminal,live:live.length,failedJobs:s.jobs.filter((j:any)=>j.status==='FAILED').length}));
      stable=terminal===entries.length&&live.length===0?stable+1:0;return stable>=3;
    },{timeout:Math.max(1,deadline-Date.now()),intervals:[5000]}).toBe(true);
    const observed=state(),rows:any[]=[];
    for(const entry of entries){
      const photo=observed.photos.find((p:any)=>p.digest===entry.sha256);expect(photo).toBeTruthy();
      const result=json(`const jobs=await p.acquisitionProcessingJob.findMany({where:{...${scope},input:{path:['photoId'],equals:${JSON.stringify(photo.id)}}},orderBy:{createdAt:'desc'},include:{candidate:{select:{revision:true,review:true,receipt:true}}}});const ids=jobs.flatMap(j=>j.output?.proposals?.proposals?.map(c=>c.card.id)??[]);const cards=await p.card.findMany({where:{id:{in:ids}},select:{id:true,scryfallId:true}});const fs=require('fs'),path=require('path'),crypto=require('crypto');const bytes=fs.readFileSync(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',${JSON.stringify(photo.id)}+'.original'));console.log(JSON.stringify({jobs,cards,storedDigest:crypto.createHash('sha256').update(bytes).digest('hex')}));`);
      expect(result.storedDigest).toBe(entry.sha256);expect(sha(readFileSync(path.join(root!,'originals',entry.file)))).toBe(entry.sha256);
      writeFileSync(report!+'.'+entry.sampleId+'.json',JSON.stringify(result,null,2));
      const printing=result.jobs.find((j:any)=>j.stage==='photo-printing-evidence-v1'&&j.status==='COMPLETE'),lookup=new Map(result.cards.map((c:any)=>[c.id,c.scryfallId]));
      const offered=printing?.output.proposals.proposals.map((p:any)=>lookup.get(p.card.id))??[];
      for(const job of result.jobs){expect(job.candidate.review).toBeNull();expect(job.candidate.receipt).toBeNull();}
      if(printing){expect(printing.output.proposals.automaticAcceptance).toBe(false);expect(printing.candidateRevision).toBe(printing.candidate.revision);expect(printing.output.printingNative.photoDigest).toBe(entry.sha256);}
      if(entry.sampleId==='val34-19'){
        const primary=result.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.status==='COMPLETE');
        expect(primary.output.native.geometry).toEqual({status:'NEEDS_CROP',framing:'CLIPPED'});
        expect(primary.output.native.orientations).toEqual([]);
        const source=primary.output.native.photoText.readings.find((r:any)=>r.rotationDegrees===0).scannerSource;
        expect(source.scope).toBe('SCANNER_SOURCE_PIXELS');expect(source.boundaryVerified).toBe(false);
        expect([source.width,source.height]).toEqual([1560,2160]);
        expect(source.lines.some((line:any)=>line.text.includes('153/264'))).toBe(true);
        expect(source.lines.some((line:any)=>line.text.includes('WAR'))).toBe(true);
        expect(printing.output.proposals.proposals[0].card.id).toBe(result.cards.find((c:any)=>c.scryfallId===entry.expectedScryfallIds[0]).id);
        expect(primary.output.proposals.automaticAcceptance).toBe(false);
        const card=page.getByTestId(`capture-card-${entries.indexOf(entry)+1}`);
        const details=card.getByTestId('unlocalized-photo-text');
        if(!await details.evaluate((e:any)=>e.open))await details.locator('summary').click();
        for(const width of [1366,320]){
          await page.setViewportSize({width,height:1000});
          await expect(details.getByText('Visible scan identifiers',{exact:true}).first()).toBeVisible();
          await expect(details.getByText('The card edges remain unverified. These readings do not confirm a printing or a stamp.').first()).toBeVisible();
          await expect(card.getByText(/The card reaches the edge of the scan/)).toBeVisible();
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        }
        const link=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
        const download=await page.request.get(link!);expect(download.ok()).toBe(true);expect(sha(await download.body())).toBe(entry.sha256);
      }
      // Expected identities enter scoring only after all recognition has ended.
      const scorable=entry.expectedScryfallIds?.length===1;
      const primary=result.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.status==='COMPLETE');
      const primaryEligible=primary?.output.proposals.automaticAcceptance===true,primaryFirst=lookup.get(primary?.output.proposals.proposals[0]?.card.id);
      rows.push({sampleId:entry.sampleId,sha256:entry.sha256,printingGroup:entry.conservativeGroup,knownDesktopDevelopmentOverlap:entry.knownDesktopDevelopmentOverlap,physicalGroup:entry.physicalGroup??null,scorable,primaryTextEligible:primaryEligible,primaryTextFirst:primaryFirst,wrongPrimaryTextEligibility:scorable&&primaryEligible?primaryFirst!==entry.expectedScryfallIds[0]:null,finalAutomaticAcceptance:printing?.output.proposals.automaticAcceptance??null,completed:Boolean(printing),failedStages:result.jobs.filter((j:any)=>j.status==='FAILED').map((j:any)=>({stage:j.stage,code:j.errorCode})),firstCorrect:scorable?offered[0]===entry.expectedScryfallIds[0]:null,expectedOffered:scorable?offered.includes(entry.expectedScryfallIds[0]):null,offered});
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    const cohort=(selected:any[])=>({samples:selected.length,scorable:selected.filter(r=>r.scorable).length,completed:selected.filter(r=>r.completed).length,firstCorrect:selected.filter(r=>r.firstCorrect).length,expectedOffered:selected.filter(r=>r.expectedOffered).length,failedSamples:selected.filter(r=>r.failedStages.length).length,primaryTextEligible:selected.filter(r=>r.primaryTextEligible).length,wrongPrimaryTextEligibility:selected.filter(r=>r.wrongPrimaryTextEligibility).length,finalAutomatic:selected.filter(r=>r.finalAutomaticAcceptance===true).length,groups:new Set(selected.map(r=>r.printingGroup)).size});
    const summary={scope:manifest.scope,manifestSha256:sha(manifestBytes),currentSourceSha256:manifest.currentSourceSha256,physicalBoundaryLabels:'NONE',historicalTrainingIndependence:'UNKNOWN',physicalCopyIndependence:'UNKNOWN',all:cohort(rows),notInDesktopDevelopment:cohort(rows.filter(r=>!r.knownDesktopDevelopmentOverlap)),knownDesktopDevelopment:cohort(rows.filter(r=>r.knownDesktopDevelopmentOverlap)),elapsedMs:Date.now()-started,accuracyNotAsserted:true};
    writeFileSync(report!,JSON.stringify({summary,owner:tag,photos:observed.photos,rows},null,2));console.log(JSON.stringify(summary));
  }catch(error){failed=true;primaryError=error;try{writeFileSync(report!+'.failure.json',JSON.stringify({owner:tag,elapsedMs:Date.now()-started,error:String(error),state:state()},null,2));}catch(diagnostic){primaryError=new AggregateError([error,diagnostic],'Validation and failure capture failed');}}
  finally{
    const failures:unknown[]=failed?[primaryError]:[];const cleanup=async(action:()=>unknown|Promise<unknown>)=>{try{await action();}catch(error){failures.push(error);}};
    await cleanup(()=>database(`await p.authSession.deleteMany({where:{userId:${JSON.stringify(tag)}}});`+cancelAndCleanCorrectionFixture(tag)));
    await cleanup(async()=>{if(!page.isClosed())await page.goto('/login');});await cleanup(()=>cleanupReferenceRows(tag));await cleanup(()=>database(cancelAndCleanCorrectionFixture(tag)));
    await cleanup(()=>writeFileSync(progress,JSON.stringify({owner:tag,phase:'ENDED',primaryFailed:failed,failures:failures.length})));
    if(failures.length)throw new AggregateError(failures,'Reserved scanner diagnostic or owned cleanup failed');
  }
});
