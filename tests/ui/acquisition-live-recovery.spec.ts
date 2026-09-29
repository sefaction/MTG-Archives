import {expect, test} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const worker="mtg-archives-acquisition-recognition-worker-1";
function docker(...args:string[]) {
  return execFileSync("docker",args,{encoding:"utf8",timeout:30000,windowsHide:true}).trim();
}
function database(body:string) {
  return execFileSync("docker",["exec","-i","mtg-archives-web-1","node"],{
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:"utf8",timeout:30000,windowsHide:true,
  }).trim();
}
const json=(body:string)=>JSON.parse(database(body));

test("24 real scans retain artifacts and a saved correction across an actual OCR worker crash",async({page,baseURL})=>{
  const root=process.env.MTG_ACQUISITION_PLAYABLE_SCANS_PATH;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || process.env.MTG_ACQUISITION_RESTART_TEST!=="1" || !root,
    "Explicit local-only restart opt-in and private preserved originals required");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(2700000);
  const endpoint=docker("context","inspect",docker("context","show"),"--format","{{json .Endpoints.docker.Host}}");
  expect(JSON.parse(endpoint)).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)expect(process.env.DOCKER_HOST).toMatch(/^(npipe:\/\/|unix:\/\/)/);
  expect(docker("inspect",worker,"--format",'{{index .Config.Labels "com.docker.compose.project"}}')).toBe("mtg-archives");
  expect(docker("inspect",worker,"--format","{{.State.Running}}")).toBe("true");
  const imageBefore=docker("inspect",worker,"--format","{{.Image}}");
  const startedBefore=docker("inspect",worker,"--format","{{.State.StartedAt}}");
  const tag=`ui-recovery-${randomUUID()}`,password=randomUUID();
  const manifest=JSON.parse(readFileSync(path.join(root!,"label-manifest.json"),"utf8"));
  const playable=manifest.entries.filter((e:any)=>e.category==="PLAYABLE" && e.labelStatus==="IDENTIFIED");
  const names=["scan-test.24.jpg","scan-test.22.jpg","scan-test.42.jpg","scan-test.67.jpg"];
  for(const e of playable)if(names.length<24 && !names.includes(e.file))names.push(e.file);
  const entries=names.map(file=>playable.find((e:any)=>e.file===file));
  expect(entries).toHaveLength(24);
  expect(entries.every(Boolean)).toBe(true);
  const photos=entries.map(entry=>{
    const buffer=readFileSync(path.join(root!,"originals",entry.file));
    expect(createHash("sha256").update(buffer).digest("hex")).toBe(entry.sha256);
    return {name:entry.file,mimeType:"image/jpeg",buffer};
  });
  const owner=`{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}}`;
  const report:any={version:1,scope:"REUSED_DEVELOPMENT_SCANS_LOCAL_RESTART_RELIABILITY",startedAt:new Date().toISOString(),
    count:entries.length,imageBefore,samples:[],uploadRetries:[],interrupt:null,passed:false,
    limits:["One OCR container crash, not a host/database/browser-storage loss","24 uploads, not full large-batch qualification",
      "Reused scans are not independent accuracy samples","Sampled Docker memory/CPU, not exhaustive peak instrumentation"]};
  mkdirSync(".local-data/recovery-qualification",{recursive:true});
  const saveReport=()=>writeFileSync(`.local-data/recovery-qualification/${tag}.json`,JSON.stringify(report,null,2)+"\n");
  let stopped=false,timer:ReturnType<typeof setInterval>|undefined;
  const sample=()=>{
    try {
      const stats=docker("stats","--no-stream","--format","{{json .}}",worker,
        "mtg-archives-acquisition-visual-worker-1","mtg-archives-acquisition-printing-worker-1");
      report.samples.push({at:new Date().toISOString(),workers:stats.split("\n").filter(Boolean).map(line=>{
        const s=JSON.parse(line);return {name:s.Name,cpu:s.CPUPerc,memory:s.MemUsage,pids:s.PIDs};
      })});
    } catch {report.samples.push({at:new Date().toISOString(),unavailable:true});}
    saveReport();
  };
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:24,sections:[]}}});`);
    await page.goto("/login");
    await page.getByLabel(/username or email/i).fill(tag);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button",{name:/^log in$/i}).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/imports/scan");
    await page.getByTestId("storage-destination").getByRole("combobox").fill(tag);
    await page.getByRole("option").first().click();
    await page.getByRole("button",{name:"Start batch",exact:true}).click();
    await page.getByRole("combobox",{name:"Library image type"}).selectOption("CARD_SCAN");
    const advanced=page.getByRole("button",{name:"Advanced",exact:true});
    if(await advanced.count())await advanced.click();
    await page.getByRole("combobox",{name:"Batch finish",exact:true}).selectOption("NONFOIL");
    await page.getByRole("combobox",{name:"Batch condition",exact:true}).selectOption("NM");
    await page.getByRole("button",{name:"Save batch defaults",exact:true}).click();
    await expect(page.getByText("Batch defaults saved.")).toBeVisible();
    sample();timer=setInterval(sample,30000);
    await page.getByLabel("Choose card photos").setInputFiles(photos.slice(0,1));
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${owner},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000}).toBe(1);
    const card=page.getByTestId("capture-card-1");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("scan-printing-status")).toContainText("Printing check complete");
    await card.getByRole("combobox",{name:"Card condition",exact:true}).selectOption("LP");
    await card.getByRole("button",{name:"Save card review",exact:true}).click();
    await expect(card).toContainText("Review saved.");
    const saved=json(`console.log(JSON.stringify(await p.acquisitionCandidate.findFirstOrThrow({where:${owner},orderBy:{acquisitionOrder:'asc'},select:{id:true,revision:true,review:true}})));`);
    expect(saved.review.condition).toBe("LP");
    const frozen=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{candidateId:${JSON.stringify(saved.id)},status:'COMPLETE'},orderBy:{id:'asc'},select:{id:true,output:true}})));`);
    // Drop one real successful upload acknowledgement after the server has
    // saved its bytes. Retry must reuse the retained identity, not add a card.
    let droppedAck=false;
    await page.route("**/api/acquisition/*/photos?*",async route=>{
      const response=await route.fetch();
      if(!droppedAck && response.ok()){
        droppedAck=true;
        report.lostAcknowledgement={at:new Date().toISOString(),method:"ABORT_AFTER_REAL_SUCCESS"};
        saveReport();
        await route.abort("failed");
      }else await route.fulfill({response});
    });
    await page.getByLabel("Choose card photos").setInputFiles(photos.slice(1));
    let claimed:any;
    await expect.poll(()=>{
      claimed=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findFirst({where:{...${owner},stage:'photo-recognition-v1',status:'RUNNING'},select:{id:true,status:true,attempts:true,leaseToken:true,leaseExpiresAt:true}})));`);
      return Boolean(claimed);
    },{timeout:600000,intervals:[100,250,500]}).toBe(true);
    docker("kill","--signal","KILL",worker);stopped=true;
    expect(docker("inspect",worker,"--format","{{.State.Running}}")).toBe("false");
    const interrupted=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(claimed.id)}},select:{status:true,attempts:true,leaseToken:true,output:true}})));`);
    expect(interrupted.status,"The killed process must still own an unfinished lease; a completed scan does not prove crash recovery").toBe("RUNNING");
    expect(interrupted.output).toBe(null);
    expect(interrupted.leaseToken).toBe(claimed.leaseToken);
    report.interrupt={jobId:claimed.id,at:new Date().toISOString(),attemptBefore:claimed.attempts,
      leaseExpiresAt:claimed.leaseExpiresAt,method:"DOCKER_SIGKILL",exitCode:Number(docker("inspect",worker,"--format","{{.State.ExitCode}}"))};
    saveReport();
    docker("start",worker);stopped=false;
    expect(docker("inspect",worker,"--format","{{.State.Running}}")).toBe("true");
    expect(docker("inspect",worker,"--format","{{.Image}}")).toBe(imageBefore);
    expect(docker("inspect",worker,"--format","{{.State.StartedAt}}")).not.toBe(startedBefore);
    // Keep the real lease expiry and availability; do not accelerate fixture jobs.
    await expect(page.getByRole("heading",{name:/24 of 24 cards/})).toBeVisible({timeout:120000});
    // Retained upload failures (#468) need the same visible Retry operation a
    // user would perform. Record bounded intervention; never call it automatic
    // upload recovery or silently wait for a photo that has no processing job.
    const retries=new Map<number,number>();
    await expect.poll(async()=>{
      const retry=page.getByRole("button",{name:"Retry upload",exact:true}).first();
      if(await retry.count()){
        const text=await retry.locator("..").innerText();
        const position=Number(text.match(/^Photo\s+(\d+):/)?.[1]);
        expect(position).toBeGreaterThan(0);
        const attempt=(retries.get(position)??0)+1;
        expect(attempt,"Retained upload did not recover after three visible retries").toBeLessThanOrEqual(3);
        retries.set(position,attempt);
        report.uploadRetries.push({at:new Date().toISOString(),position,attempt,message:text});
        saveReport();
        await retry.click();
      }
      return Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{...${owner},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`));
    },{timeout:1800000,intervals:[1000,3000]}).toBe(24);
    expect(droppedAck).toBe(true);
    expect(report.uploadRetries.length).toBeGreaterThan(0);
    const recovered=json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findUniqueOrThrow({where:{id:${JSON.stringify(claimed.id)}},select:{status:true,attempts:true,leaseToken:true,output:true,updatedAt:true}})));`);
    expect(recovered.status).toBe("COMPLETE");
    expect(recovered.attempts).toBe(claimed.attempts+1);
    expect(recovered.leaseToken).toBe(null);
    expect(recovered.output).not.toBe(null);
    report.interrupt.attemptAfter=recovered.attempts;
    report.interrupt.recoveredAt=recovered.updatedAt;
    report.interrupt.verifiedAt=new Date().toISOString();
    expect(json(`console.log(JSON.stringify(await p.acquisitionCandidate.findUniqueOrThrow({where:{id:${JSON.stringify(saved.id)}},select:{id:true,revision:true,review:true}})));`)).toEqual(saved);
    expect(json(`console.log(JSON.stringify(await p.acquisitionProcessingJob.findMany({where:{candidateId:${JSON.stringify(saved.id)},status:'COMPLETE'},orderBy:{id:'asc'},select:{id:true,output:true}})));`)).toEqual(frozen);
    const state=json(`const w=${owner};const expected=await p.card.findMany({where:{scryfallId:{in:${JSON.stringify(entries.map(e=>e.scryfallId))}}},select:{id:true,scryfallId:true}});const photos=await p.acquisitionPhoto.findMany({where:w,select:{digest:true,ready:true,generation:true}});const jobs=await p.acquisitionProcessingJob.findMany({where:{...w,stage:'photo-printing-evidence-v1',status:'COMPLETE'},select:{output:true,artifact:{select:{digest:true}}}});console.log(JSON.stringify({expected:Object.fromEntries(expected.map(c=>[c.scryfallId,c.id])),photos,artifacts:await p.acquisitionArtifact.count({where:w}),slots:await p.acquisitionCaptureSlot.count({where:w}),candidates:await p.acquisitionCandidate.count({where:w}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}),rows:jobs.map(j=>({digest:j.artifact.digest,proposals:j.output.proposals.proposals.map(v=>v.card.id),automatic:j.output.proposals.automaticAcceptance,nativeDigest:j.output.printingNative.photoDigest}))}));`);
    expect(state.photos).toHaveLength(24);
    expect(state.artifacts).toBe(24);
    expect(state.slots).toBe(24);
    expect(state.candidates).toBe(24);
    expect(state.inventory).toBe(0);
    for(const entry of entries){
      expect(state.photos.filter((p:any)=>p.digest===entry.sha256)).toHaveLength(1);
      expect(state.photos.find((p:any)=>p.digest===entry.sha256).ready).toBe(true);
      const row=state.rows.find((r:any)=>r.digest===entry.sha256);
      expect(row.nativeDigest).toBe(entry.sha256);
      expect(row.automatic).toBe(false);
      expect(state.expected[entry.scryfallId]).toBeTruthy();
      expect(row.proposals).toContain(state.expected[entry.scryfallId]);
    }
    report.firstCorrect=entries.filter(e=>state.rows.find((r:any)=>r.digest===e.sha256).proposals[0]===state.expected[e.scryfallId]).length;
    report.offered=entries.length;
    await page.reload();
    await page.getByTestId("capture-card-1").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("capture-card-1").getByRole("combobox",{name:"Card condition",exact:true})).toHaveValue("LP");
    await expect(page.getByTestId("capture-card-1").getByTestId("scan-review-status")).toContainText("Reviewed");
    await page.getByRole("button",{name:"Load more cards",exact:true}).scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid^="capture-card-"]')).toHaveCount(24);
    sample();
    report.passed=true;
  } finally {
    if(timer)clearInterval(timer);
    if(stopped)docker("start",worker);
    report.finishedAt=new Date().toISOString();
    saveReport();
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}`);
  }
  console.log(JSON.stringify({scope:report.scope,count:report.count,firstCorrect:report.firstCorrect,
    offered:report.offered,interrupt:report.interrupt,uploadRetries:report.uploadRetries.length,
    resourceSamples:report.samples.length,passed:report.passed}));
});
