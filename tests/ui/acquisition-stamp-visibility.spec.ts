import { cancelAndCleanCorrectionFixture } from "./correction-fixture";
import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

test.use({actionTimeout:30000});

function database(body: string) {
  return execFileSync("docker", ["exec", "-i", "mtg-archives-web-1", "node"], {
    input: `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

test("visible Boggart stamp survives clipped search margin through existing review", async ({page,baseURL})=>{
  const root=process.env.MTG_ACQUISITION_OLD_SCANS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || !root,"Requires the private retained scan corpus");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(900000);
  const tag=`ui-stamp-edge-${randomUUID()}`,password=randomUUID();
  const manifest=JSON.parse(readFileSync(path.join(root!,"label-manifest-v2.json"),"utf8"));
  const entry=manifest.entries.find((e:any)=>e.file==="test-scan.065.jpg");
  const started=Date.now();
  let evidence:any;
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[{name:'A',capacity:1}]}}});`);
    await page.goto('/login');
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/imports/scan');
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);
    await page.getByRole('option').first().click();
    await page.getByRole('button',{name:/^A\s/}).click();
    await page.getByRole('button',{name:'Start batch',exact:true}).click();
    await page.locator('summary').filter({hasText:'Batch defaults:'}).click();
    await page.getByRole('combobox',{name:'Batch finish',exact:true}).selectOption('NONFOIL');
    await page.getByRole('combobox',{name:'Batch condition',exact:true}).selectOption('NM');
    await page.getByRole('button',{name:'Save batch defaults',exact:true}).click();
    await expect(page.getByText('Batch defaults saved.',{exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'Library image type'}).selectOption('CARD_SCAN');
    const buffer=readFileSync(path.join(root!,"originals",entry.file));
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
    await page.getByLabel('Choose card photos').setInputFiles({name:entry.file,mimeType:'image/jpeg',buffer});
    // The unchanged ordinary queues, native limits and ten-minute printing gate.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000}).toBe(1);
    const result=JSON.parse(database(`const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},select:{output:true,candidate:{select:{review:true}},run:{select:{session:{select:{locationId:true,section:true}}}}}});const expected=await p.card.findUniqueOrThrow({where:{scryfallId:${JSON.stringify(entry.scryfallId)}},select:{id:true}});const raw=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},stage:'photo-recognition-v1',status:'COMPLETE'},select:{output:true}});console.log(JSON.stringify({job,expectedId:expected.id,raw:raw.output}));`));
    evidence=result.job.output;
    expect(evidence.native).toEqual(result.raw.native);
    expect(evidence.native.photoDigest).toBe(entry.sha256);
    expect(evidence.native.geometry.method).toBe('declared-card-scan');
    expect(evidence.printingNative.observedStamp).toBe('PRESENT');
    expect(evidence.printingNative.conflictingObservations).toBe(false);
    expect(evidence.printingNative.candidates.some((c:any)=>c.stamp.version==='registered-printing-evidence-dev5' && c.stamp.status==='PRESENT')).toBe(true);
    expect(evidence.proposals.proposals[0].card.id).toBe(result.expectedId);
    expect(evidence.proposals.proposals[0].reasons).toContain('STAMP_PRESENT');
    expect(evidence.proposals.automaticAcceptance).toBe(false);
    expect(result.job.candidate.review).toBeNull();
    expect(result.job.run.session).toEqual({locationId:tag,section:'A'});
    const card=page.getByTestId('capture-card-1');
    const advanced=page.getByRole('button',{name:'Advanced',exact:true});
    const simple=page.getByRole('button',{name:'Simple',exact:true});
    if(await advanced.count())await advanced.click();
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('scan-printing-status')).toContainText('Printing check complete',{timeout:20000});
    await expect(card.getByText('Observed stamp agrees with this printing. Other printing details still need verification.')).toBeVisible();
    await page.screenshot({path:'test-results/stamp-edge-advanced-1366.png'});
    if(await simple.count())await simple.click();
    for(const width of [1366,320]){
      await page.setViewportSize({width,height:900});
      await card.scrollIntoViewIfNeeded();
      const reference=card.getByRole('img',{name:/^Printing: Boggart Ram-Gang /}).first();
      await expect.poll(()=>reference.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
      const scan=card.getByRole('img',{name:/^(Original scan|Full card image|Detected card) 1$/});
      await expect.poll(()=>scan.evaluate((canvas:HTMLCanvasElement)=>canvas.width>0 && canvas.height>0 && canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4<3 && v>20))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/stamp-edge-simple-${width}.png`});
    }
    if(await simple.count())await card.getByRole('button',{name:'Correct',exact:true}).click();
    await card.getByRole('combobox',{name:'Card condition',exact:true}).selectOption('LP');
    await expect(card.getByRole('button',{name:'Save card review',exact:true})).toBeEnabled();
    await card.getByRole('button',{name:'Save card review',exact:true}).click();
    await expect(card).toContainText('Review saved. Not yet added to Inventory.');
    const saved=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}},select:{review:true,revision:true}})));`));
    await page.reload();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('LP');
    const after=JSON.parse(database(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}},select:{review:true,revision:true}})));`));
    expect(after).toEqual(saved);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
  } finally {
    const cleanupFailures: unknown[] = [];
    const cleanup = (action: () => void) => {
      try { action(); } catch (error) { cleanupFailures.push(error); }
    };
    cleanup(() => database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');"));
    try { if (!page.isClosed()) { await page.goto("/dashboard"); } } catch { console.log("Browser cleanup unavailable; owned database cleanup still runs"); }
    cleanup(() => { if(process.env.MTG_ACQUISITION_STAMP_EDGE_REPORT)writeFileSync(process.env.MTG_ACQUISITION_STAMP_EDGE_REPORT,JSON.stringify({elapsedMs:Date.now()-started,evidence},null,2)+'\n');
    });
    cleanup(() => { database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionProcessingTurn.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
    });
    cleanup(() => database(cancelAndCleanCorrectionFixture(tag) + "console.log('{}');"));
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "Stamp visibility fixture cleanup failed");
  }
});
