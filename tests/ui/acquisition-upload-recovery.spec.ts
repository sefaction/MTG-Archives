import {test,expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";

function database(body:string){
  return JSON.parse(execFileSync("docker",["exec","-i","mtg-archives-web-1","node"],{
    input:`const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:"utf8",timeout:30000,windowsHide:true,
  }));
}

test("12 library photos recover transient errors and preserve bounded failure/reload",async({page,baseURL})=>{
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1","Requires local snapshot");
  expect(baseURL).toBe("http://127.0.0.1:13001");
  test.setTimeout(120000);
  const tag=`ui-upload-recovery-${randomUUID()}`,password=randomUUID();
  const buffer=await sharp({create:{width:420,height:600,channels:3,background:"#335577"}}).jpeg().toBuffer();
  const digest=createHash("sha256").update(buffer).digest("hex");
  const files=Array.from({length:12},(_,i)=>({name:`card-${i+1}.jpg`,mimeType:"image/jpeg",buffer}));
  const requests=new Map<string,{ordinal:number,count:number,url:string,position?:number}>();
  let active=0,maximum=0,lostAck=false,release!:()=>void;
  let reservationKey="",reservationAttempts=0,reservationRecovered=false;
  const gate=new Promise<void>(resolve=>{release=resolve});
  try{
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash,role:'PLAYER'}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:12,sections:[]}}});console.log('null');`);
    await page.setViewportSize({width:390,height:844});
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
    await page.route("**/api/acquisition/*",async route=>{
      const request=route.request();
      if(request.method()!=="POST"){await route.continue();return;}
      const body=request.postDataJSON();
      if(body.action!=="reserve"){await route.continue();return;}
      if(!reservationKey)reservationKey=body.requestKey;
      if(body.requestKey!==reservationKey){await route.continue();return;}
      reservationAttempts++;
      if(reservationAttempts===1){
        await route.fulfill({status:409,json:{error:"Temporary conflict",retryable:true}});
        return;
      }
      const response=await route.fetch();
      expect(response.ok()).toBe(true);
      if(reservationAttempts===2)await route.abort("failed");
      else{reservationRecovered=true;await route.fulfill({response});}
    });
    await page.route("**/api/acquisition/*/photos?*",async route=>{
      active++;maximum=Math.max(maximum,active);
      try{
        const request=route.request(),address=new URL(request.url()),key=address.searchParams.get("key")!;
        const previous=requests.get(key);
        const row=previous??{ordinal:requests.size+1,count:0,url:request.url()};
        expect(request.url()).toBe(row.url);
        expect(createHash("sha256").update(request.postDataBuffer()!).digest("hex")).toBe(digest);
        expect(address.searchParams.get("generation")).toBe("0");
        expect(address.searchParams.get("inputKind")).toBe("CARD_SCAN");
        row.count++;requests.set(key,row);
        if(row.ordinal===2 && row.count<=2){
          if(row.count===2)await gate;
          await route.fulfill({status:409,json:{error:"Temporary conflict",retryable:true}});
          return;
        }
        if(row.ordinal===3 && row.count===1){
          await route.fulfill({status:409,json:{error:"Photo upload identity conflict"}});
          return;
        }
        if(row.ordinal===4 && row.count<=3){
          await route.fulfill({status:409,json:{error:"Temporary conflict",retryable:true}});
          return;
        }
        const response=await route.fetch();
        if(row.ordinal===1 && row.count===1){
          expect(response.ok()).toBe(true);lostAck=true;await route.abort("failed");
        }else await route.fulfill({response});
      }finally{active--;}
    });
    await page.getByLabel("Choose card photos").setInputFiles(files);
    await expect(page.getByText("Retrying upload (1 of 2)",{exact:false}).first()).toBeVisible();
    await page.setViewportSize({width:320,height:844});
    await page.getByText("Retrying upload (1 of 2)",{exact:false}).first().scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:"test-results/acquisition-upload-retrying-phone.png"});
    await page.setViewportSize({width:390,height:844});
    release();
    const pending=page.getByRole("region",{name:"Pending uploads"});
    const identity=pending.getByRole("listitem").filter({hasText:"Photo upload identity conflict"});
    await expect(identity.getByRole("button",{name:"Retry upload",exact:true})).toBeVisible();
    expect([...requests.values()].find(r=>r.ordinal===3)!.count).toBe(1);
    await identity.getByRole("button",{name:"Retry upload",exact:true}).click();
    const exhausted=pending.getByRole("listitem").filter({hasText:"Temporary conflict"});
    await expect(exhausted.getByRole("button",{name:"Retry upload",exact:true})).toBeVisible();
    expect([...requests.values()].find(r=>r.ordinal===4)!.count).toBe(3);
    await expect(page.getByRole("heading",{name:/12 of 12 cards/})).toBeVisible();
    await expect.poll(()=>database(`console.log(await p.acquisitionPhoto.count({where:{run:{session:{ownerPlayerId:${JSON.stringify(tag)}}},ready:true}}));`)).toBe(11);
    expect([...requests.values()].find(r=>r.ordinal===1)!.count).toBe(2);
    expect([...requests.values()].find(r=>r.ordinal===2)!.count).toBe(3);
    expect(lostAck).toBe(true);expect(maximum).toBeLessThanOrEqual(2);
    await page.reload();
    await expect(page.getByText(/12 photos prepared/)).toBeVisible({timeout:30000});
    await expect(page.getByRole("button",{name:"Retry upload",exact:true})).toHaveCount(0);
    const state=database(`const w={run:{session:{ownerPlayerId:${JSON.stringify(tag)}}}};console.log(JSON.stringify({photos:await p.acquisitionPhoto.findMany({where:w,select:{ready:true,generation:true,inputKind:true}}),artifacts:await p.acquisitionArtifact.count({where:w}),slots:await p.acquisitionCaptureSlot.count({where:w}),candidates:await p.acquisitionCandidate.count({where:w}),inventory:await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}})}));`);
    expect(state.photos).toHaveLength(12);
    expect(state.photos.every((p:any)=>p.ready&&p.generation===1&&p.inputKind==="CARD_SCAN")).toBe(true);
    expect(state.artifacts).toBe(12);expect(state.slots).toBe(12);expect(state.candidates).toBe(12);expect(state.inventory).toBe(0);
    expect([...requests.values()].find(r=>r.ordinal===4)!.count).toBe(4);
    expect(requests.size).toBe(12);expect(maximum).toBeLessThanOrEqual(2);
    expect(reservationAttempts).toBe(3);expect(reservationRecovered).toBe(true);
    await expect(page.getByRole("button",{name:"Photo library",exact:true})).toBeDisabled();
    await page.screenshot({path:"test-results/acquisition-upload-recovered-phone.png"});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    console.log(JSON.stringify({scope:"UPLOAD_RECOVERY_NOT_ACCURACY",photos:12,maximumConcurrent:maximum,lostAcknowledgements:1,reservationAttempts,reservationRecovered,transientConflictRecovery:true,domainAutomaticRetries:0,exhaustedAttempts:3,reloadRecovery:true,inventory:0}));
  }finally{
    release();
    await page.unrouteAll({behavior:"wait"});
    database(`const n=${JSON.stringify(tag)};const sessions=await p.acquisitionSession.findMany({where:{ownerPlayerId:n},select:{id:true}});const runs=await p.acquisitionRun.findMany({where:{sessionId:{in:sessions.map(s=>s.id)}},select:{id:true}});const where={runId:{in:runs.map(r=>r.id)}};const photos=await p.acquisitionPhoto.findMany({where});await p.acquisitionProcessingJob.deleteMany({where});await p.acquisitionPhoto.deleteMany({where});await p.acquisitionCommand.deleteMany({where});await p.acquisitionCaptureSlot.deleteMany({where});await p.acquisitionCountCorrection.deleteMany({where});await p.acquisitionObservation.deleteMany({where});await p.acquisitionEvent.deleteMany({where});await p.acquisitionCandidate.deleteMany({where});await p.acquisitionArtifact.deleteMany({where});await p.acquisitionRun.deleteMany({where:{id:{in:runs.map(r=>r.id)}}});await p.acquisitionSession.deleteMany({where:{id:{in:sessions.map(s=>s.id)}}});await p.inventoryLocation.deleteMany({where:{ownerPlayerId:n}});await p.authSession.deleteMany({where:{userId:n}});await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});const fs=require('fs/promises'),path=require('path');for(const photo of photos){if(!/^[a-f0-9-]{36}$/.test(photo.id))throw new Error('Invalid fixture path');for(const suffix of ['original','preview.jpg'])await fs.unlink(path.join(process.env.UPLOADS_DATA_PATH,'acquisition-v1',photo.id+'.'+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e})}console.log('null');`);
  }
});
