import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {PRINTING_POLICY_VERSION} from "../../lib/acquisition-printing";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000,
  });
}

test("real stamped scans resolve List identity while reference annotations stay unknown", async ({page,baseURL})=>{
  const root=process.env.MTG_ACQUISITION_PLAYABLE_SCANS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || !root,"Requires the private preserved playable scanner corpus");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(900000);
  const tag=`ui-stamp-${randomUUID()}`,password=randomUUID();
  const manifest=JSON.parse(readFileSync(path.join(root!,"label-manifest.json"),"utf8"));
  const entries=["scan-test.22.jpg","scan-test.42.jpg"].map(file=>manifest.entries.find((e:any)=>e.file===file));
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
    // Runs against the footer branch and the cumulative Simple/Advanced build.
    const advanced=page.getByRole('button',{name:'Advanced',exact:true});
    if(await advanced.count())await advanced.click();
    for(const [i,entry] of entries.entries()){
      const buffer=readFileSync(path.join(root!,"originals",entry.file));
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
      await page.getByLabel('Choose card photos').setInputFiles({name:entry.file,mimeType:'image/jpeg',buffer});
      await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:360000}).toBe(i+1);
      const result=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entry.sha256)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true,candidate:{select:{review:true}}}});const expected=await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}});console.log(JSON.stringify({output:job.output,review:job.candidate.review,expectedId:expected.id}));`));
      expect(result.output.versions.printingPolicy).toBe(PRINTING_POLICY_VERSION);
      expect(result.output.printingNative.photoDigest).toBe(entry.sha256);
      expect(result.output.native.geometry.method).toBe('declared-card-scan');
      expect(result.output.proposals.proposals[0].card.id).toBe(result.expectedId);
      expect(result.output.proposals.proposals[0].reasons).toContain('STAMP_PRESENT');
      expect(result.output.proposals.automaticAcceptance).toBe(false);
      expect(result.review).toBe(null);
      const comparison=result.output.printing.candidates.find((c:any)=>c.cardId===result.expectedId);
      expect(comparison).toMatchObject({expectedStampState:'PRESENT',expectationSource:'CATALOG_LIST_REPRINT',
        referenceStampState:'UNKNOWN',referenceRelation:'UNRESOLVED',relation:'AGREES_WITH_STAMP_STATE'});
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId('scan-printing-status')).toContainText('Printing check complete',{timeout:20000});
      await expect(card.getByRole('img',{name:new RegExp('^Printing: '+entry.name+' ')})).toBeVisible();
      await expect(card.getByText('List reprint catalog identity',{exact:true})).toBeVisible();
      await expect(card.getByText('Observed stamp agrees with this printing. Other printing details still need verification.')).toBeVisible();
    }
    const card=page.getByTestId('capture-card-1');
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:900});
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('img',{name:/^Printing: Hematite Golem /})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/stamp-expectations-${width}.png`});
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    // Independent feedback cleanup must precede browser/report operations.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
  }
});
