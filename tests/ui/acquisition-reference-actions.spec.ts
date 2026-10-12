import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {cancelAndCleanCorrectionFixture} from './correction-fixture';
import {web,worker,docker,database,json,sha,holdReference,resumeNative,chooseOfferedPrinting,cleanupReferenceRows} from './acquisition-reference-local';

for(const [turn,mode] of ['manual','cancel','commit'].entries())test(`actual reference work respects ${mode} authority`,async({page,baseURL})=>{
  const corpus=process.env.MTG_ANCHOR_FIXTURES_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1'||!corpus,'Isolated local development scans required; no physical scanner operation');
  expect(baseURL).toBe('http://127.0.0.1:13011');
  const endpoint=JSON.parse(docker(['context','inspect',docker(['context','show']).trim(),'--format','{{json .Endpoints.docker.Host}}']));
  expect(endpoint).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)expect(process.env.DOCKER_HOST).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  for(const name of [web,worker])expect(docker(['inspect',name,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim()).toBe('mtg-anchor-qualification');
  test.setTimeout(600000);page.setDefaultTimeout(10000);
  const tag=`ui-reference-scan-${randomUUID()}`,password=randomUUID(),started=Date.now();
  const own=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`,bytes=readFileSync(path.join(corpus!,`reference-${turn}.jpg`)),digest=sha(bytes);
  let held:Awaited<ReturnType<typeof holdReference>>|undefined;
  const report:any={mode,passed:false};
  const save=()=>{if(process.env.MTG_ANCHOR_REPORT_PATH)writeFileSync(process.env.MTG_ANCHOR_REPORT_PATH+`.${mode}.json`,JSON.stringify({...report,elapsedMs:Date.now()-started},null,2));};
  const state=()=>json(`const n=${JSON.stringify(tag)},scope=${own};console.log(JSON.stringify({sessions:await p.acquisitionSession.findMany({where:{ownerPlayerId:n}}),photos:await p.acquisitionPhoto.findMany({where:scope}),candidates:await p.acquisitionCandidate.findMany({where:scope,include:{receipt:true}}),jobs:await p.acquisitionProcessingJob.findMany({where:scope,orderBy:{createdAt:'asc'}}),examples:await p.correctionExample.findMany({where:{ownerPlayerId:n},include:{blob:true}}),evidence:await p.correctionEvidence.findMany({where:{ownerPlayerId:n}}),events:await p.correctionReviewEvent.findMany({where:{ownerPlayerId:n}}),inventory:await p.inventoryItem.findMany({where:{currentOwnerId:n}})}));`);
  const immutable=(before:any,after:any)=>{
    for(const job of before.jobs.filter((j:any)=>j.status==='COMPLETE'))expect(after.jobs.find((j:any)=>j.id===job.id)?.output).toEqual(job.output);
    for(const evidence of before.evidence)expect(after.evidence.find((e:any)=>e.id===evidence.id)).toEqual(evidence);
    if(before.examples[0]?.firstEvidenceId)expect(after.examples[0].firstEvidenceId).toBe(before.examples[0].firstEvidenceId);
  };
  try{
    database(`const n=${JSON.stringify(tag)},hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[]}}});await p.correctionLibraryAccount.create({data:{ownerPlayerId:n,displayKey:require('crypto').randomBytes(32).toString('hex'),sampleBasisPoints:10000,sampleCap:1}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');await page.getByRole('button',{name:'Advanced',exact:true}).click();
    const batch=new URL(page.url()).searchParams.get('batch')!;
    await page.getByLabel('Choose card photos').setInputFiles({name:`reference-${turn}.jpg`,buffer:bytes,mimeType:'image/jpeg'});
    const card=page.getByTestId('capture-card-1');await card.scrollIntoViewIfNeeded();
    held=await holdReference(tag);const active=held,before=state(),photoId=before.photos[0].id;
    expect(before.photos[0].digest).toBe(digest);expect(before.inventory).toHaveLength(0);expect(before.candidates[0].review).toBeNull();expect(before.candidates[0].receipt).toBeNull();
    report.before=before;report.observedNativeCpu=active.observedNativeCpu;save();
    let decision:any;
    if(mode==='manual'){
      decision=await chooseOfferedPrinting(page,card,batch,photoId);
      await card.getByRole('button',{name:'Edit card boundary',exact:true}).click();
      const editor=card.getByRole('region',{name:'Card boundary editor',exact:true});
      await editor.getByRole('button',{name:'Use reference outline',exact:true}).click();
      const first=editor.getByRole('button',{name:'Card corner 1',exact:true});await first.press('ArrowRight');
      await editor.getByRole('button',{name:'Apply boundary and recheck',exact:true}).click();await expect(editor).toBeHidden();await expect(card).toContainText('Boundary saved.');
      const manual=state();expect(manual.candidates[0].manualAnalysis).not.toBeNull();expect(manual.candidates[0].review).toBeNull();
      expect(manual.candidates[0].revision).toBe(before.candidates[0].revision+1);decision.manual=manual.candidates[0].manualAnalysis;
    }else if(mode==='cancel'){
      const batchNumber=before.sessions[0].batchNumber;
      await page.goto(`/imports/batches?view=all&q=${batchNumber}`);
      const article=page.getByRole('article',{name:`Batch ${batchNumber}`,exact:true});
      await article.getByRole('button',{name:'Cancel batch',exact:true}).click();await article.getByRole('button',{name:'Confirm cancel batch',exact:true}).click();
      await expect.poll(()=>state().sessions[0].phase).toBe('CANCELLED');
    }else{
      decision=await chooseOfferedPrinting(page,card,batch,photoId);
      await card.getByRole('button',{name:'Save card review',exact:true}).click();await expect(card).toContainText('Review saved. Not yet added to Inventory.');
      decision.saved=state();expect(decision.saved.inventory).toHaveLength(0);expect(decision.saved.candidates[0].review.cardId).toBe(decision.printing.id);
      await page.getByRole('checkbox',{name:'Select card 1 for Inventory',exact:true}).check();
      await page.getByRole('button',{name:'Stop capture',exact:true}).click();
      await card.getByRole('button',{name:'Continue to Inventory',exact:true}).click();
      const panel=page.getByRole('region',{name:'Add reviewed cards to Inventory',exact:true});await panel.getByRole('button',{name:'Preview selected cards',exact:true}).click();
      const confirmation=panel.getByLabel('Confirm Inventory addition',{exact:true});await expect(confirmation).toContainText('Add 1 copy');
      expect(state().inventory).toHaveLength(0);
      await confirmation.getByRole('button',{name:'Add 1 copy to Inventory',exact:true}).click();await expect(panel).toContainText('Added 1 copy to Inventory.');
      expect(state().inventory).toHaveLength(1);
    }
    report.heldMilliseconds=Date.now()-active.heldAt;expect(report.heldMilliseconds).toBeLessThan(35000);
    report.resume=resumeNative(active);held=undefined;
    await expect.poll(()=>state().jobs.find((j:any)=>j.id===active.job.id).status,{timeout:120000,intervals:[300,1000]}).toBe('SUPERSEDED');
    await expect.poll(()=>state().jobs.filter((j:any)=>['PENDING','RUNNING'].includes(j.status)).length,{timeout:300000,intervals:[1000,3000]}).toBe(0);
    const after=state();immutable(before,after);const old=after.jobs.find((j:any)=>j.id===active.job.id);
    expect(old.output?.native).toBeUndefined();expect(old.attempts).toBe(1);expect(after.jobs.filter((j:any)=>j.input?.referenceSource?.referenceJobId===old.id)).toHaveLength(0);
    if(mode==='commit'){
      const {purgeAfter:beforeDeadline,...original}=before.photos[0];
      const {purgeAfter:afterDeadline,...retained}=after.photos[0];
      expect(beforeDeadline).toBeNull();expect(Date.parse(afterDeadline)).toBeGreaterThan(Date.now());expect(retained).toEqual(original);
    }else expect(after.photos[0]).toEqual(before.photos[0]);
    expect(after.candidates).toHaveLength(1);
    if(mode==='manual'){
      expect(after.candidates[0].manualAnalysis).toEqual(decision.manual);expect(after.candidates[0].review).toBeNull();expect(after.candidates[0].receipt).toBeNull();expect(after.inventory).toHaveLength(0);
      const manual=after.jobs.find((j:any)=>j.stage==='photo-recognition-v1'&&j.status==='COMPLETE'&&j.input.manualAnalysis);
      expect(manual.output.native.geometry.method).toBe('manual-card-region-v1');expect(manual.output.native.photoDigest).toBe(digest);
      await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('LP');await expect(card.getByRole('radio',{name:decision.choice,exact:true})).toBeChecked();
    }else if(mode==='cancel'){
      expect(after.sessions[0].phase).toBe('CANCELLED');expect(after.candidates[0].review).toBeNull();expect(after.candidates[0].receipt).toBeNull();expect(after.inventory).toHaveLength(0);
    }else{
      immutable(decision.saved,after);expect(after.candidates[0].review).toEqual(decision.saved.candidates[0].review);expect(after.events).toEqual(decision.saved.events);
      expect(after.candidates[0].receipt).not.toBeNull();expect(after.inventory).toHaveLength(1);expect(after.inventory[0].cardId).toBe(decision.printing.id);expect(after.inventory[0].condition).toBe('LP');
    }
    const retained=await page.request.get(`/api/acquisition/corrections/${after.examples[0].id}?owner=${encodeURIComponent(tag)}`);expect(retained.ok()).toBe(true);expect(sha(await retained.body())).toBe(digest);expect(sha(readFileSync(path.join(corpus!,`reference-${turn}.jpg`)))).toBe(digest);
    report.after=after;report.decision=decision;report.passed=true;save();
  }catch(error){report.error=(error as Error).message;report.failureState=state();save();throw error;
  }finally{
    const failures:unknown[]=[];const clean=async(action:()=>unknown|Promise<unknown>)=>{try{await action()}catch(e){failures.push(e)}};
    if(held)await clean(()=>resumeNative(held!));await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    await clean(()=>cleanupReferenceRows(tag));await clean(()=>database(cancelAndCleanCorrectionFixture(tag)));
    report.cleanupFailures=failures.length;save();if(failures.length)throw new AggregateError(failures,'Reference action cleanup failed');
  }
});
