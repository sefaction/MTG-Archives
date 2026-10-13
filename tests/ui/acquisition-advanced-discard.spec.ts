import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {database,json,sha} from './acquisition-reference-local';
import {cleanupCorrectionFixture} from './correction-fixture';
import {acquisitionDraftKey} from '../../lib/acquisition-browser-review-draft';

for(const width of [1366,320]) test(`Advanced discard restores current saved review without a decision at ${width}px`,async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1','Isolated local UI/API fixture; no physical scanner operation');
  expect(baseURL).toBe('http://127.0.0.1:13011');test.setTimeout(180000);page.setDefaultTimeout(10000);
  await page.setViewportSize({width,height:900});
  const tag=`ui-advanced-discard-${randomUUID()}`,password=randomUUID();
  const printing={id:`${tag}-card`,name:'Discard review fixture',setCode:'tst',collectorNumber:'1',lang:'en',imageUri:null,finishes:['nonfoil','foil']};
  let batch='',photo='',failNextRead=false,readFailures=0,decisionPosts=0;
  const bytes=await sharp({create:{width:300,height:420,channels:3,background:'#335577'}}).jpeg().toBuffer();
  const headers={origin:baseURL!};
  const state=()=>json(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({candidate:await p.acquisitionCandidate.findFirst({where:{run:{session:{ownerPlayerId:n}}}}),events:await p.correctionReviewEvent.findMany({where:{ownerPlayerId:n},orderBy:{id:'asc'}}),evidence:await p.correctionEvidence.findMany({where:{ownerPlayerId:n},orderBy:{id:'asc'}}),inventory:await p.inventoryItem.count({where:{currentOwnerId:n}}),commits:await p.acquisitionCommit.count({where:{run:{session:{ownerPlayerId:n}}}})}));`);
  try{
    database(`const n=${JSON.stringify(tag)};await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:await require('bcryptjs').hash(${JSON.stringify(password)},10)}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[]}}});await p.card.create({data:{...${JSON.stringify(printing)},scryfallId:require('crypto').randomUUID(),typeLine:'Creature',rarity:'common'}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);
    const created=await page.request.post('/api/acquisition',{headers,data:{requestKey:randomUUID(),locationId:tag,section:'',quantity:1}});expect(created.ok()).toBe(true);batch=(await created.json()).id;
    const reserved=await page.request.post(`/api/acquisition/${batch}`,{headers,data:{action:'reserve',requestKey:randomUUID()}});expect(reserved.ok()).toBe(true);const {slot}=await reserved.json();
    const uploaded=await page.request.post(`/api/acquisition/${batch}/photos?slot=${slot.id}&key=${randomUUID()}&generation=${slot.generation}&inputKind=CARD_SCAN`,{headers:{...headers,'content-type':'image/jpeg'},data:bytes});expect(uploaded.ok()).toBe(true);photo=(await uploaded.json()).id;
    // Settle ordinary work before freezing saved state; do not rewrite running leases.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{sessionId:${JSON.stringify(batch)}},status:{in:['PENDING','RUNNING']}}}));`)),{timeout:120000,intervals:[500,1000]}).toBe(0);
    const endpoint=`/api/acquisition/${batch}/review`;
    const save=async(condition:string)=>{const r=await(await page.request.get(`${endpoint}?photoId=${photo}`)).json();expect((await page.request.post(endpoint,{headers,data:{action:'accept',photoId:photo,revision:r.revision,decision:{cardId:printing.id,finish:'NONFOIL',condition,language:'en'},evidenceTokens:{current:r.evidenceToken}}})).ok()).toBe(true);};
    await save('NM');
    await page.route(`**${endpoint}?*`,async route=>{if(failNextRead){failNextRead=false;readFailures++;return route.fulfill({status:503,json:{error:'Controlled reload unavailable'}});}return route.continue();});
    page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname===endpoint)decisionPosts++;});
    await page.goto(`/imports/scan?batch=${batch}`);await page.getByRole('button',{name:'Advanced',exact:true}).click();const card=page.getByTestId('capture-card-1');await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('NM');
    await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');await card.getByLabel('Card name',{exact:true}).fill('Unsaved search');
    await expect(card.getByTestId('scan-review-status')).toContainText('Unsaved correction');
    const key=acquisitionDraftKey({userId:tag,batchId:batch,photoId:photo});await expect.poll(()=>page.evaluate(k=>localStorage.getItem(k)!==null,key)).toBe(true);
    // A real saved review changes in another client while the visible draft stays dirty.
    await save('MP');const current=state();expect(current.candidate.review.condition).toBe('MP');
    failNextRead=true;await card.getByRole('button',{name:'Cancel changes',exact:true}).click();
    await expect(card.getByRole('alert')).toContainText('Controlled reload unavailable');expect(readFailures).toBe(1);
    await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('LP');await expect(card.getByLabel('Card name',{exact:true})).toHaveValue('Unsaved search');expect(state()).toEqual(current);
    await card.getByRole('button',{name:'Cancel changes',exact:true}).click();await expect(card).toContainText('Unsaved changes discarded.');
    await expect(card.getByRole('combobox',{name:'Card condition',exact:true})).toHaveValue('MP');await expect(card.getByLabel('Card name',{exact:true})).toHaveValue('');
    await expect(card.getByTestId('scan-review-status')).not.toContainText('Unsaved correction');expect(await page.evaluate(k=>localStorage.getItem(k),key)).toBeNull();
    expect(decisionPosts).toBe(0);expect(state()).toEqual(current);expect(current.inventory).toBe(0);expect(current.commits).toBe(0);
    const original=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');expect(sha(await(await page.request.get(original!)).body())).toBe(sha(bytes));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('HP');await card.getByRole('button',{name:'Cancel changes',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('advanced-discard.png')});
  }finally{
    await page.unrouteAll({behavior:'wait'}).catch(()=>{});
    database(`await p.acquisitionSession.updateMany({where:{ownerPlayerId:${JSON.stringify(tag)}},data:{phase:'CANCELLED'}});`);
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},status:'RUNNING',leaseExpiresAt:{gt:new Date()}}}));`)),{timeout:100000,intervals:[1000,3000]}).toBe(0);
    database(`const n=${JSON.stringify(tag)},w={run:{session:{ownerPlayerId:n}}};const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupCorrectionFixture}await p.acquisitionCommitMember.deleteMany({where:{candidate:w}});await p.acquisitionCommit.deleteMany({where:w});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:${JSON.stringify(printing.id)}}});const fs=require('fs/promises'),path=require('path');for(const photo of photos)for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e});`);
    expect(json(`const n=${JSON.stringify(tag)};console.log(JSON.stringify({users:await p.user.count({where:{id:n}}),accounts:await p.correctionLibraryAccount.count({where:{ownerPlayerId:n}}),photos:await p.acquisitionPhoto.count({where:{run:{session:{ownerPlayerId:n}}}})}));`)).toEqual({users:0,accounts:0,photos:0});
  }
});
