import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

function database(body: string) {
  return execFileSync('docker', ['exec', '-i', 'mtg-archives-web-1', 'node'], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: 'utf8', timeout: 30000,
  });
}

test('small scanner padding is prepared without moving footer zones or changing originals', async ({page, baseURL}) => {
  const scan=process.env.MTG_PADDED_CARD_SCAN_PATH, blank=process.env.MTG_BLANK_CARD_SCAN_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=='1' || !scan || !blank, 'Requires retained local padded and blank scanner originals');
  expect(baseURL).toBe('http://127.0.0.1:13001');
  test.setTimeout(900000);
  const tag=`ui-scan-background-${randomUUID()}`, password=randomUUID();
  const fixtures=[{name:'padded-card.png',buffer:readFileSync(scan!),method:'scanner-background-trim'},
    {name:'blank-scan.png',buffer:readFileSync(blank!),method:'declared-card-scan'}]
    .map(f=>({...f,digest:createHash('sha256').update(f.buffer).digest('hex')}));
  expect(fixtures[0].digest).toBe('0d3c78c4c1d4455cf8d02c57d58881d641bd851e96b7069b0a3ef5edb86df947');
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
    // Use ordinary workers and admission; no priority or queue override.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000}).toBe(2);
    for(const [i,f] of fixtures.entries()) {
      const result=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(f.digest)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true,candidate:{select:{review:true}}}});console.log(JSON.stringify(job));`));
      expect(result.output.native.photoDigest).toBe(f.digest);
      expect(result.output.visual.photoDigest).toBe(f.digest);
      expect(result.output.native.geometry.method).toBe(f.method);
      expect(result.output.visual.geometry.method).toBe(f.method);
      expect(result.output.native.readingZones).toEqual({title:{top:0,bottom:250},footer:{top:1270,bottom:1397}});
      expect(result.output.proposals.automaticAcceptance).toBe(false);
      expect(result.candidate.review).toBe(null);
      if(i===0) {
        expect(result.output.native.geometry.quad).toEqual([[0,0],[1559,0],[1559,2041],[0,2041]]);
        expect(result.output.proposals.evidence.setCodes).toContain('neo');
        expect(result.output.proposals.evidence.collectors).toContain('39');
      } else {
        expect(result.output.native.geometry.quad).toEqual([[0,0],[1559,0],[1559,2159],[0,2159]]);
        expect(result.output.proposals.evidence.setCodes).toEqual([]);
        expect(result.output.proposals.evidence.collectors).toEqual([]);
      }
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('button',{name:i===0?'Prepared card':'Full card image',exact:true})).toBeEnabled({timeout:20000});
      const original=await card.getByRole('link',{name:'Open original photo',exact:true}).getAttribute('href');
      const response=await page.request.get(original!);
      expect(response.ok()).toBe(true);
      expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(f.digest);
    }
    const card=page.getByTestId('capture-card-1');
    await card.getByRole('button',{name:'Reading zones',exact:true}).click();
    for(const width of [1366,320]) {
      await page.setViewportSize({width,height:900});
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(/A small strip of scanner background was trimmed/)).toBeVisible();
      const canvas=card.getByRole('img',{name:'Prepared card 1',exact:true});
      await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>c.width===400 && c.getContext('2d')!.getImageData(0,0,c.width,c.height).data.some((p,i)=>i%4<3 && p>20))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await card.screenshot({path:`test-results/scanner-background-${width}.png`});
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
  }
});
