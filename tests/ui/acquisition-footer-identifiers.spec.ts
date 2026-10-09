import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {ACQUISITION_FOOTER_PARSER_VERSION} from "../../lib/acquisition-footer";
import {CATALOG_RESOLVER_VERSION} from "../../lib/acquisition-catalog-status";

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000,
  });
}

test("real scanner footers reach shared catalog and printing review without automatic confirmation", async ({page,baseURL})=>{
  const root=process.env.MTG_ACQUISITION_PLAYABLE_SCANS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || !root,"Requires the private preserved playable scanner corpus");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(900000);
  const tag=`ui-footer-${randomUUID()}`,password=randomUUID();
  const manifest=JSON.parse(readFileSync(path.join(root!,"label-manifest.json"),"utf8"));
  const entries=["scan-test.24.jpg","scan-test.25.jpg","scan-test.26.jpg","scan-test.67.jpg"]
    .map(file=>manifest.entries.find((e:any)=>e.file===file));
  expect(entries.every(Boolean)).toBe(true);
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:4,sections:[]}}});`);
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
    const advanced=page.getByRole('button',{name:'Advanced',exact:true});
    if(await advanced.count())await advanced.click();
    const photos=entries.map(entry=>{
      const buffer=readFileSync(path.join(root!,"originals",entry.file));
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
      return {name:entry.file,mimeType:'image/jpeg',buffer};
    });
    await page.getByLabel('Choose card photos').setInputFiles(photos);
    // No priority/availability override: use the same queues as the local user.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000}).toBe(entries.length);
    for(const [i,entry] of entries.entries()){
      const result=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},artifact:{digest:${JSON.stringify(entry.sha256)}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},orderBy:{createdAt:'desc'},select:{output:true,candidate:{select:{review:true}}}});const expected=await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true,setCode:true,collectorNumber:true}});console.log(JSON.stringify({output:job.output,review:job.candidate.review,expected}));`));
      expect(result.output.versions.footerParser).toBe(ACQUISITION_FOOTER_PARSER_VERSION);
      expect(result.output.versions.resolver).toBe(CATALOG_RESOLVER_VERSION);
      expect(result.output.printingNative.photoDigest).toBe(entry.sha256);
      expect(result.output.native.geometry.method).toBe('declared-card-scan');
      expect(result.output.proposals.proposals[0].card.id).toBe(result.expected.id);
      expect(result.output.proposals.proposals[0].reasons).toContain('RECOVERED_FOOTER_LAYOUT');
      expect(result.output.proposals.evidence.setCodes).toContain(result.expected.setCode);
      expect(result.output.proposals.evidence.collectors).toContain(result.expected.collectorNumber.replace(/^0+(?=\d)/,''));
      expect(result.output.proposals.automaticAcceptance).toBe(false);
      expect(result.review).toBe(null);
      const card=page.getByTestId(`capture-card-${i+1}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId('scan-printing-status')).toContainText('Printing check complete',{timeout:20000});
      await expect(card.getByRole('img',{name:/^Printing: /}).first()).toBeVisible();
    }
    const card=page.getByTestId('capture-card-1');
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:900});
      const simple=page.getByRole('button',{name:'Simple',exact:true});
      if(await simple.count())await simple.click();
      await card.scrollIntoViewIfNeeded();
      const reference=card.getByRole('img',{name:/^Printing: Blackblade Reforged /});
      await expect(reference).toBeVisible();
      await expect.poll(()=>reference.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
      const scan=card.getByRole('img',{name:/^(Original scan|Full card image|Detected card) 1$/});
      await expect(scan).toBeVisible();
      // Mode changes repaint a canvas asynchronously. Visibility alone can
      // capture an empty canvas before the original image has been decoded.
      await expect.poll(()=>scan.evaluate((canvas:HTMLCanvasElement)=>{
        if(!canvas.width || !canvas.height)return false;
        const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
        return pixels.some((value,index)=>index%4<3 && value>20);
      })).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/footer-identifiers-${width}.png`});
    }
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    // Block new authenticated polling and retire only this fixture owner.
    database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    try {
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);

    } finally {
      // A final sweep also catches writes completed during legacy teardown.
      database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');");
    }
  }
});
