import {expect, test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

function database(body: string) {
  return execFileSync('docker', ['exec', '-i', 'mtg-archives-web-1', 'node'], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:'utf8', timeout:30000,
  });
}

test('complete physical scanner edges align reading zones; clipped originals cannot supply them', async ({page,baseURL})=>{
  const aligned=process.env.MTG_ALIGNED_CARD_SCAN_PATH, clipped=process.env.MTG_CLIPPED_CARD_SCAN_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1' || !aligned || !clipped, 'Requires retained local fi-7160 originals; never operates scanner');
  expect(baseURL).toBe('http://127.0.0.1:13001');
  test.setTimeout(900000);
  const tag=`ui-scan-framing-${randomUUID()}`, password=randomUUID(), started=Date.now();
  const fixtures=[{name:'aligned.png',buffer:readFileSync(aligned!),framing:'ALIGNED'},
    {name:'clipped.png',buffer:readFileSync(clipped!),framing:'CLIPPED'}]
    .map(f=>({...f,digest:createHash('sha256').update(f.buffer).digest('hex')}));
  expect(fixtures.map(f=>f.digest)).toEqual([
    'db588adc1cddf7e3c711aaa749ed07cd21671fa4b93fc37dd976490cba4ba521',
    'dcda2c55851b2348d13df78c94ae3cf784e3c61f4a7072286f167a6cbaec9b6d',
  ]);
  const results:unknown[]=[];
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:2,sections:[]}}});`);
    await page.goto('/login');
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);
    await page.getByRole('option').first().click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
    await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.getByLabel('Choose card photos').setInputFiles(fixtures.map(f=>({name:f.name,buffer:f.buffer,mimeType:'image/png'})));
    // Ordinary admission and workers; no queue, priority or publication override.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000,intervals:[1000,3000,5000]}).toBe(2);
    for(const [i,f] of fixtures.entries()) {
      const result=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(f.digest)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true,candidateRevision:true,candidate:{select:{revision:true,review:true,proposal:true,receipt:true}}}});console.log(JSON.stringify(job));`));
      expect(result.candidateRevision).toBe(result.candidate.revision);
      expect(result.candidate.review).toBeNull();
      expect(result.candidate.receipt).toBeNull();
      expect(result.output.native.photoDigest).toBe(f.digest);
      expect(result.output.visual.photoDigest).toBe(f.digest);
      expect(result.output.native.geometry.framing).toBe(f.framing);
      expect(result.output.visual.geometry.framing).toBe(f.framing);
      expect(result.output.proposals.automaticAcceptance).toBe(false);
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      if(i===0) {
        expect(result.output.native.geometry.method).toBe('scanner-card-edges');
        expect(result.output.visual.geometry.quad).toEqual(result.output.native.geometry.quad);
        expect(result.output.native.readingZones).toEqual({title:{top:0,bottom:250},footer:{top:1270,bottom:1397}});
        expect(result.output.native.text.title.join(' ')).toMatch(/Blessing/i);
        await expect(card.getByRole('button',{name:'Prepared card',exact:true})).toBeEnabled();
        await expect(card.getByText(/Reading image aligned to the outer card edges/)).toBeVisible();
      } else {
        expect(result.output.native.geometry.status).toBe('NEEDS_CROP');
        expect(result.output.native.geometry.quad).toBeUndefined();
        expect(result.output.native.readingZones).toBeUndefined();
        expect(result.output.native.orientations).toEqual([]);
        expect(result.output.native.text).toEqual({title:[],footer:[]});
        await expect(card.getByRole('button',{name:'Reading zones',exact:true})).toBeDisabled();
        await expect(card.getByText(/missing edge cannot be recovered by trimming/)).toBeVisible();
      }
      const original=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
      const response=await page.request.get(original!);
      expect(response.ok()).toBe(true);
      expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(f.digest);
      results.push({digest:f.digest,native:result.output.native,visualGeometry:result.output.visual.geometry,evidence:result.output.proposals.evidence});
    }
    const card=page.getByTestId('capture-card-1');
    await card.getByRole('button',{name:'Reading zones',exact:true}).click();
    for(const width of [1366,320]) {
      await page.setViewportSize({width,height:900});
      await card.scrollIntoViewIfNeeded();
      const canvas=card.getByRole('img',{name:'Prepared card 1',exact:true});
      await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>c.width===400 && c.getContext('2d')!.getImageData(0,0,c.width,c.height).data.some((p,i)=>i%4<3 && p>20))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await card.screenshot({path:`test-results/scanner-framing-${width}.png`});
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    if(process.env.MTG_FRAMING_REPORT_PATH) writeFileSync(process.env.MTG_FRAMING_REPORT_PATH,JSON.stringify({elapsedMs:Date.now()-started,results},null,2));
  } finally {
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
  }
});
