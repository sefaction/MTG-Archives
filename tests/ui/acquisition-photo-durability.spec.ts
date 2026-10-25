import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {cleanupCorrectionFixture} from './correction-fixture';
import {cleanupOwnedPhotoFixtureFiles} from './owned-fixture-files';

const container=process.env.MTG_INVENTORY_TEST_CONTAINER||'',databaseName=process.env.MTG_INVENTORY_TEST_DATABASE||'';
test.skip(process.env.MTG_PHOTO_DURABILITY_FIXTURE!=='1'||!container||!databaseName,'Requires the exact owned directory-fault review target');
test.use({trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'});
function database<T=unknown>(body:string):T{
  if(!/^[a-f0-9]{64}$/.test(container)||!/^review_sync_\w+$/.test(databaseName))throw Error('Expected immutable dedicated review target');
  return JSON.parse(execFileSync('docker',['exec','-i',container,'node'],{windowsHide:true,encoding:'utf8',timeout:30000,
    input:`const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{if(new URL(process.env.DATABASE_URL).pathname!==${JSON.stringify('/'+databaseName)}||process.env.UPLOADS_DATA_PATH!=='/durability-uploads'||process.env.MTG_PHOTO_DIRECTORY_FAULT!=='1')throw Error('Wrong isolated durability fixture');${body}})().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`}));
}
function fingerprint(){return database(`const result={};for(const {tablename} of await p.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename))throw Error('Unexpected table');const rows=await p.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM "'+tablename+'" t ORDER BY row_to_json(t)::text COLLATE "C"');result[tablename]={count:rows.length,hash:require('crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;`);}

for(const width of [1366,320])test(`unfinished photo retry requires directory durability at ${width}px`,async({page,baseURL})=>{
  test.setTimeout(180000);page.setDefaultTimeout(15000);
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');await page.setViewportSize({width,height:900});
  const tag=`ui-photo-sync-${randomUUID()}`,token=randomBytes(32).toString('base64url'),before=fingerprint(),headers={origin:baseURL!};
  const bytes=await sharp({create:{width:80,height:120,channels:3,background:'#335577'}}).png().toBuffer(),digest=createHash('sha256').update(bytes).digest('hex');
  const requests:{url:string;type:string}[]=[];
  let batch='',failed=false,primary:unknown;
  writeFileSync(test.info().outputPath('before.json'),JSON.stringify({tag,before}));
  const flag=(enabled:boolean)=>database(`const fs=require('fs/promises');${enabled?"await fs.writeFile('/durability-flags/fail-sync','owned');":"await fs.unlink('/durability-flags/fail-sync').catch(e=>{if(e.code!=='ENOENT')throw e;});"}return true;`);
  const events=()=>database<string[]>(`const fs=require('fs/promises');return (await fs.readFile('/durability-flags/events','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).trim().split('\\n').filter(Boolean);`);
  const state=()=>database<{photos:{id:string;ready:boolean;readyAt:string|null;digest:string;bytes:number;slotId:string;uploadKey:string}[];counts:number[];stock:unknown[]}>(`const w={run:{sessionId:${JSON.stringify(batch)}}};return {photos:await p.acquisitionPhoto.findMany({where:w,orderBy:{id:'asc'}}),counts:await Promise.all(['acquisitionArtifact','acquisitionCandidate','acquisitionProcessingJob','acquisitionCommit'].map(m=>p[m].count({where:w}))),stock:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}},orderBy:{id:'asc'}})};`);
  try{
    database(`const n=${JSON.stringify(tag)},passwordHash=require('crypto').randomBytes(32).toString('hex');await p.$transaction(async tx=>{await tx.player.create({data:{id:n,name:n,displayName:n}});await tx.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash}});await tx.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:10,sections:[]}}});await tx.card.create({data:{id:n,scryfallId:require('crypto').randomUUID(),name:n,setCode:'tst',collectorNumber:'1',lang:'en',finishes:['nonfoil'],typeLine:'Artifact',rarity:'common'}});await tx.inventoryItem.create({data:{cardId:n,currentOwnerId:n,originalOpenerId:n,quantity:2,condition:'NM',locationId:n,sourceType:'MANUAL'}});await tx.authSession.create({data:{tokenHash:${JSON.stringify(createHash('sha256').update(token).digest('hex'))},userId:n,credentialHash:require('crypto').createHash('sha256').update(passwordHash).digest('hex'),expiresAt:new Date(Date.now()+600000)}});});const fs=require('fs/promises');await fs.writeFile('/durability-flags/events','');return true;`);
    await page.context().addCookies([{name:'mtg_inventory_session',value:token,url:baseURL!,httpOnly:true,sameSite:'Lax'}]);
    const created=await page.request.post('/api/acquisition',{headers,data:{requestKey:randomUUID(),locationId:tag,section:'',quantity:1}});
    expect(created.ok(),await created.text()).toBe(true);batch=(await created.json()).id;
    const stock=state().stock;await page.goto(`/imports/scan?batch=${batch}`);flag(true);
    page.on('request',request=>{if(request.method()==='POST'&&request.url().includes(`/api/acquisition/${batch}/photos?`))requests.push({url:request.url(),type:request.headers()['content-type']});});
    const first=page.waitForResponse(r=>r.url().includes(`/api/acquisition/${batch}/photos?`)&&r.status()===409);
    await page.getByLabel('Choose card photos').setInputFiles({name:'saved-card.png',mimeType:'image/png',buffer:bytes});
    const error=await(await first).json();expect(error).toHaveProperty('error');expect(JSON.stringify(error)).not.toMatch(/controlled private|durability-uploads|EIO/);
    const pending=page.getByRole('region',{name:'Pending uploads',exact:true}),retry=pending.getByRole('button',{name:'Retry upload',exact:true});
    await expect(pending).toContainText(error.error);await expect(retry).toBeEnabled();expect(requests).toHaveLength(1);
    const original=state();expect(original.photos).toHaveLength(1);expect(original.photos[0]).toMatchObject({ready:false,readyAt:null,digest,bytes:bytes.length});expect(original.counts).toEqual([0,0,0,0]);expect(original.stock).toEqual(stock);
    const photo=original.photos[0];
    const proof=()=>database(`const fs=require('fs/promises'),dir='/durability-uploads/acquisition-v1',data=await fs.readFile(dir+'/'+${JSON.stringify(photo.id+'.original')});return {digest:require('crypto').createHash('sha256').update(data).digest('hex'),bytes:data.length,parts:(await fs.readdir(dir)).filter(x=>x.startsWith(${JSON.stringify(photo.id)})&&x.endsWith('.part'))};`);
    expect(proof()).toEqual({digest,bytes:bytes.length,parts:[]});expect(events()).toEqual(['refused']);
    const repeated=page.waitForResponse(r=>r.url()===requests[0].url);await retry.click();
    const repeatedResponse=await repeated;
    writeFileSync(test.info().outputPath('persistent-retry.json'),JSON.stringify({status:repeatedResponse.status(),state:state(),events:events()}));
    expect(repeatedResponse.status()).toBe(409);expect(await repeatedResponse.json()).toEqual(error);
    await expect(retry).toBeEnabled();expect(state()).toEqual(original);expect(events()).toEqual(['refused','refused']);expect(proof()).toEqual({digest,bytes:bytes.length,parts:[]});
    expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('pending-directory-sync.png'),fullPage:true});flag(false);
    const recovered=page.waitForResponse(r=>r.url()===requests[0].url&&r.status()===200);await retry.click();
    const ack=await(await recovered).json();expect(ack).toEqual({id:photo.id,digest,ready:true});await expect(pending).toHaveCount(0);
    expect(requests).toHaveLength(3);expect(requests[2]).toEqual(requests[0]);const ready=state();expect(ready.photos).toHaveLength(1);expect(ready.photos[0]).toMatchObject({id:photo.id,slotId:photo.slotId,uploadKey:photo.uploadKey,ready:true});expect(ready.counts).toEqual([1,1,1,0]);expect(ready.stock).toEqual(stock);expect(events()).toEqual(['refused','refused','synced']);
    // READY is already a durable receipt. ACK replay must remain effect-free
    // even if the filesystem is unavailable again afterward.
    flag(true);const replay=await page.request.post(requests[0].url,{headers:{...headers,'content-type':'image/png'},data:bytes});
    expect(replay.status()).toBe(200);expect(await replay.json()).toEqual(ack);expect(state()).toEqual(ready);expect(events()).toEqual(['refused','refused','synced']);flag(false);
    await page.reload();await expect(page.getByRole('region',{name:'Batch progress',exact:true})).toContainText('1 photo saved');expect(state()).toEqual(ready);expect(proof()).toEqual({digest,bytes:bytes.length,parts:[]});
    writeFileSync(test.info().outputPath('ready.json'),JSON.stringify({original,ready,requests,events:events()}));await page.screenshot({path:test.info().outputPath('recovered.png'),fullPage:true});
  }catch(error){failed=true;primary=error;throw error;}
  finally{
    const errors:unknown[]=[];
    for(const action of [async()=>{await page.goto('about:blank');},async()=>{await page.context().clearCookies();},async()=>{flag(false);},async()=>{
      database(`const n=${JSON.stringify(tag)};await p.acquisitionSession.updateMany({where:{ownerPlayerId:n},data:{phase:'CANCELLED'}});const w={run:{session:{ownerPlayerId:n}}};if(await p.acquisitionProcessingJob.count({where:{...w,status:'RUNNING'}}))throw Error('Live fixture job');const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});${cleanupOwnedPhotoFixtureFiles}${cleanupCorrectionFixture}await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});await p.acquisitionRun.deleteMany({where:{session:{ownerPlayerId:n}}});await p.acquisitionSession.deleteMany({where:{ownerPlayerId:n}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});await p.card.deleteMany({where:{id:n}});return true;`);
    },async()=>{const after=fingerprint();writeFileSync(test.info().outputPath('after.json'),JSON.stringify({tag,after}));expect(after).toEqual(before);}])try{await action();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Photo durability workflow/owned cleanup failed');
  }
});
