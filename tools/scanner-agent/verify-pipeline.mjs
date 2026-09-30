// LOCAL TEST ONLY: real scanner spool -> existing HTTP intake -> existing workers
// -> existing review. No alternate image processing or Inventory commit.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { deliver, auditRun, sessionInstruction } from './transport.mjs';

if (process.env.MTG_LOCAL_PILOT_TEST !== '1') throw new Error('Requires explicit local pilot environment');
const samples = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const evidenceFile = process.argv[3];
assert.ok(Array.isArray(samples) && samples.length > 0 && samples.every(s =>
  typeof s.directory === 'string' && typeof s.artifactId === 'string' && typeof s.label === 'string'));
assert.equal(typeof evidenceFile,'string');
const tag = `scanner-qualification-${randomUUID()}`, password = randomUUID();
function database(body) {
  return execFileSync('docker', ['exec', '-i', 'mtg-archives-web-1', 'node'], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: 'utf8', timeout: 30000, windowsHide: true
  });
}
const browser = await chromium.launch();
const context = await browser.newContext({baseURL: 'http://127.0.0.1:13001', viewport:{width:1366,height:768}});
const page = await context.newPage();
const results = [];
try {
  database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[{name:'A',capacity:1}]}}});`);
  await page.goto('/login');
  await page.getByLabel(/username or email/i).fill(tag);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button',{name:/^log in$/i}).click();
  await page.waitForURL(/\/dashboard/);
  const cookie = (await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
  for (const sample of samples) {
    const audit = await auditRun(sample.directory);
    assert.equal(audit.artifacts.length, 1, 'This fixture only admits independently observed single-front runs');
    assert.equal(sample.artifactId, audit.artifacts[0].id);
    const deliveryDirectory = path.join('.local-data', 'scanner-pipeline-fixtures', randomUUID());
    await mkdir(deliveryDirectory, {recursive:true});
    for (const name of ['run.json','events.jsonl',`${sample.artifactId}.json`,`${sample.artifactId}.png`])
      await copyFile(path.join(sample.directory,name),path.join(deliveryDirectory,name));
    const response = await context.request.post('/api/acquisition', {
      headers:{Origin:'http://127.0.0.1:13001'},
      data:{requestKey:randomUUID(),locationId:tag,section:'A',quantity:null}
    });
    assert.equal(response.ok(),true);
    const session = await response.json();
    assert.equal(session.target,1);
    const instruction = await sessionInstruction('http://127.0.0.1:13001',session.id,cookie);
    assert.equal(instruction.sessionPhysicalTarget,1);
    const plan = {baseUrl:'http://127.0.0.1:13001',sessionId:session.id,
      physicalFronts:[sample.artifactId],operatorReconciledPhysicalFronts:true};
    const first = await deliver(deliveryDirectory,plan,cookie);
    const retry = await deliver(deliveryDirectory,plan,cookie);
    assert.deepEqual(first,retry);
    const photoId = first.receipts[0].photoId;
    const started = Date.now();
    let state;
    while (Date.now()-started < 180000) {
      state=JSON.parse(database(`console.log(JSON.stringify({photos:await p.acquisitionPhoto.count({where:{run:{session:{id:${JSON.stringify(session.id)}}}}}),jobs:await p.acquisitionProcessingJob.findMany({where:{artifact:{sourceId:${JSON.stringify(photoId)}}},select:{stage:true,status:true,output:true}})}));`));
      if (state.jobs.some(j=>j.stage==='photo-recognition-v1' && j.status==='COMPLETE') &&
          !state.jobs.some(j=>j.status==='PENDING'||j.status==='RUNNING')) break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    assert.equal(state.photos,1,'Retry must preserve one photo');
    assert.ok(state.jobs.some(j=>j.stage==='photo-canonical-v1' && j.status==='COMPLETE'));
    assert.ok(state.jobs.some(j=>j.stage==='photo-recognition-v1' && j.status==='COMPLETE'));
    const recognitionResponse=await context.request.get(`/api/acquisition/${session.id}/photos/${photoId}/recognition`);
    assert.ok(recognitionResponse.ok());
    const recognition=await recognitionResponse.json();
    await page.goto(`/imports/scan?batch=${session.id}`);
    await page.getByTestId('capture-card-1').waitFor();
    await page.getByTestId('capture-card-1').scrollIntoViewIfNeeded();
    await page.getByRole('button',{name:'Save card review'}).waitFor();
    await page.screenshot({path:`${deliveryDirectory}/pipeline-review.png`,fullPage:true});
    const progress=await (await context.request.get(`/api/acquisition/${session.id}`)).json();
    assert.equal(progress.locationId,tag); assert.equal(progress.section,'A');
    assert.equal(progress.slots.length,1); assert.equal(progress.availableSlots,0);
    const full=await context.request.post(`/api/acquisition/${session.id}`,{headers:{Origin:'http://127.0.0.1:13001'},data:{action:'reserve',requestKey:randomUUID()}});
    assert.equal(full.status(),409);
    results.push({label:sample.label,runId:audit.run.request.runId,artifact:audit.artifacts[0],
      target:session.target,instruction,locationSection:'A',idempotentReplay:true,fullBatchRejected:true,
      stages:state.jobs.map(j=>({stage:j.stage,status:j.status})),recognition,
      processingElapsedMs:Date.now()-started});
    await writeFile(evidenceFile,JSON.stringify({results,inventoryCommit:false},null,2));
  }
  assert.equal(JSON.parse(database(`console.log(JSON.stringify(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})));`)),0);
  console.log(JSON.stringify({passed:true,samples:results.length,inventoryRows:0}));
} finally {
  await browser.close();
  database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
}
