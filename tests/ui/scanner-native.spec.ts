import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

function database(body: string) {
  return execFileSync("docker",["exec","-i","mtg-archives-web-1","node"],{input:
    `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{${body}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());`,
    encoding:"utf8",timeout:30000,windowsHide:true});
}
test("website START through actual Windows fixture helper reaches ordinary recognition and review",async({page,baseURL})=>{
  const dotnet=process.env.MTG_SCANNER_DOTNET,dll=process.env.MTG_SCANNER_HELPER_DLL,original=process.env.MTG_SCANNER_NATIVE_PNG;
  test.skip(process.env.MTG_LOCAL_PILOT_TEST!=="1" || !dotnet || !dll || !original,"Opted-in local Windows fixture; no motor/physical accuracy claim");
  expect(baseURL).toBe("http://127.0.0.1:13001");test.setTimeout(900000);
  const tag=`ui-scanner-native-${randomUUID()}`,password=randomUUID();
  const originalHash=createHash("sha256").update(readFileSync(original!)).digest("hex");
  let agentId="",child:ChildProcess|undefined,log="";
  const helper=(args:string[],input?:string)=>execFileSync(dotnet!,[dll!,...args],{input,encoding:"utf8",timeout:45000,windowsHide:true});
  const began=Date.now();
  try {
    database(`const n=${JSON.stringify(tag)};const hash=await require('bcryptjs').hash(${JSON.stringify(password)},10);await p.player.create({data:{id:n,name:n,displayName:n}});await p.user.create({data:{id:n,username:n,displayName:n,playerId:n,passwordHash:hash}});await p.inventoryLocation.create({data:{id:n,name:n,normalizedName:n,ownerPlayerId:n,type:'Box',storageLayout:{capacity:1,sections:[{name:'A',capacity:1}]}}});`);
    await page.goto('/login');await page.getByLabel(/username or email/i).fill(tag);await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button',{name:/^log in$/i}).click();await page.waitForURL(/\/dashboard/);await page.goto('/imports/scan');
    const connections=page.getByRole('region',{name:'Scanner connections'});
    await connections.getByRole('button',{name:'Connect a scanner',exact:true}).click();
    await expect(connections.getByRole('button',{name:'Connect this computer'})).toBeVisible();
    const pairing=await page.request.post('/api/scanners',{data:{action:'pair'},headers:{origin:baseURL!}});
    expect(pairing.ok()).toBe(true);
    const code=(await pairing.json()).code as string;
    agentId=helper(['connect',baseURL!,'--local'],`${code}\n`).match(/Connection identity: ([a-f0-9-]{36})/)?.[1]??'';expect(agentId).not.toBe('');
    child=spawn(dotnet!,[dll!,'fixture-server',agentId,original!],{windowsHide:true,env:{...process.env,MTG_LOCAL_PILOT_TEST:'1'},stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',chunk=>{log+=chunk.toString();});child.stderr?.on('data',chunk=>{log+=chunk.toString();});
    await expect(connections.getByText('Online',{exact:true})).toBeVisible({timeout:30000});
    await connections.getByRole('button',{name:'Scanner connected',exact:true}).click(); // No pairing secret in screenshots.
    await page.getByTestId('storage-destination').getByRole('combobox').fill(tag);await page.getByRole('option').first().click();
    await page.getByRole('button',{name:/^A\s/}).click();
    await page.getByLabel('Scan from a connected scanner',{exact:true}).check();
    const source=page.getByRole('combobox',{name:'Scanner source',exact:true});
    await expect(source.locator('option')).toHaveCount(2);
    await expect(source).toHaveValue(/.+/);
    await expect(page.getByText('Scan settings · 600 DPI')).toBeVisible();
    await page.getByRole('button',{name:'Start scanner batch',exact:true}).click();
    const scanner=page.getByRole('region',{name:'Scanner batch'});
    await expect(scanner).toContainText('Scanner run ended.',{timeout:90000});
    await expect(scanner).toContainText('1 image saved');
    const state=JSON.parse(database(`const run=await p.scannerRun.findFirstOrThrow({where:{agentId:${JSON.stringify(agentId)}},include:{acquisitionRun:{include:{session:true,photos:true,candidates:true}}}});console.log(JSON.stringify(run));`));
    expect(state.status).toBe('DRAINED');expect(state.acquisitionRun.session.locationId).toBe(tag);expect(state.acquisitionRun.session.section).toBe('A');
    const photo=state.acquisitionRun.photos[0];expect(photo.digest).toBe(originalHash);expect(photo.inputKind).toBe('CARD_SCAN');
    expect(photo.sourceMetadata.backend).toBe('fixture');expect(photo.sourceMetadata.side).toBe('UNKNOWN');
    expect(state.loadedCount).toBeNull();
    expect(state.acquisitionRun.candidates[0].countConfirmed).toBe(true);
    expect(state.outcome.knownPhysicalItems).toBeNull();expect(state.outcome.sourceExhausted).toBe('UNKNOWN');
    // Verify full native pipeline as a reused recognition input, not hardware evidence.
    await expect.poll(()=>Number(database(`console.log(await p.acquisitionProcessingJob.count({where:{run:{session:{createdByUserId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'}}));`)),{timeout:600000,intervals:[3000,5000]}).toBe(1);
    const result=JSON.parse(database(`const photo=await p.acquisitionPhoto.findUniqueOrThrow({where:{id:${JSON.stringify(photo.id)}}});const raw=await require('fs/promises').readFile(process.env.UPLOADS_DATA_PATH+'/acquisition-v1/'+photo.id+'.original');const job=await p.acquisitionProcessingJob.findFirstOrThrow({where:{run:{session:{createdByUserId:${JSON.stringify(tag)}}},stage:'photo-printing-evidence-v1',status:'COMPLETE'},select:{output:true}});console.log(JSON.stringify({digest:require('crypto').createHash('sha256').update(raw).digest('hex'),output:job.output}));`));
    expect(result.digest).toBe(originalHash);expect(JSON.stringify(result.output)).toContain('Sunblade Samurai');
    const card=page.getByTestId('capture-card-1');await expect(card).toContainText('Sunblade Samurai',{timeout:20000});
    await page.getByRole('button',{name:'Bulk Confirm Match'}).click();
    const bulk=page.getByRole('region',{name:'Bulk match review'});
    await expect(bulk.getByText(/Card 1: Sunblade Samurai/)).toBeVisible({timeout:30000});
    await expect(bulk.getByRole('checkbox',{name:/Card 1: Sunblade Samurai/})).toBeChecked();
    await bulk.getByRole('button',{name:'Confirm 1 selected match'}).click();
    await expect(bulk).toContainText('1 review saved. Inventory has not changed.');
    await card.scrollIntoViewIfNeeded(); // Review rows load when they enter the viewport.
    await expect(card).toContainText('Review saved',{timeout:20000});
    for(const width of [1366,320]) {await page.setViewportSize({width,height:900});await scanner.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/scanner-native-${width}.png`});}
    // The fixture has one retained front and a natural end; it does not prove
    // that physical double feeds can never occur.
    await expect(scanner).toContainText('Image count recorded automatically.');
    await page.reload();await expect(scanner).toContainText('Image count recorded automatically.');
    expect(log).toContain('"fixture":true');expect(log).toContain('Scanner run settled: 1 image(s) retained/delivered');
    expect(log.match(/"kind":"AcquisitionStarted"/g)?.length).toBe(1);
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    await page.getByRole('link',{name:'Add 1 confirmed card to Inventory',exact:true}).click();
    const inventory=page.getByRole('region',{name:'Add reviewed cards to Inventory'});
    await expect(inventory).toBeVisible();
    await inventory.getByRole('button',{name:'Review 1 confirmed card for Inventory',exact:true}).click();
    const addition=page.getByLabel('Confirm Inventory addition');
    await expect(addition).toContainText('Add 1 copy');
    expect(Number(database(`console.log(await p.inventoryItem.count({where:{currentOwnerId:${JSON.stringify(tag)}}}));`))).toBe(0);
    await addition.getByRole('button',{name:'Add 1 copy to Inventory',exact:true}).click();
    await expect(inventory).toContainText('Added 1 copy to Inventory.');
    const committed=JSON.parse(database(`console.log(JSON.stringify({rows:await p.inventoryItem.findMany({where:{currentOwnerId:${JSON.stringify(tag)}}}),audits:await p.inventoryAuditLog.count({where:{changedByUserId:${JSON.stringify(tag)},changeType:'acquisition_committed'}})}));`));
    expect(committed.rows).toHaveLength(1);expect(committed.audits).toBe(1);
    expect(committed.rows[0]).toMatchObject({quantity:1,locationId:tag,locationSection:'A',sourceType:'ACQUISITION',foilStatus:'NONFOIL',condition:'NM'});
    for(const width of [1366,320]) {await page.setViewportSize({width,height:900});await inventory.scrollIntoViewIfNeeded();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/scanner-inventory-${width}.png`});}
    writeFileSync('test-results/scanner-native-result.json',JSON.stringify({passed:true,fixture:true,physicalScans:0,inventoryChanges:1,explicitFinalConfirmation:true,elapsedMs:Date.now()-began,originalDigest:originalHash,sourcePreserved:true,location:true,recognitionName:'Sunblade Samurai'}));
  } finally {
    if(child && child.exitCode===null && child.signalCode===null){
      child.kill();await new Promise<void>(resolve=>{child!.once('exit',()=>resolve());setTimeout(resolve,5000);});
      if(child.exitCode===null && child.signalCode===null)throw new Error('Owned fixture helper still running; retain its spool for recovery');
    }
    writeFileSync('test-results/scanner-native-helper.log',log);
    if(agentId) {
      helper(['forget',agentId]);const local=process.env.LOCALAPPDATA;
      if(!local || !path.isAbsolute(local))throw new Error('Private helper fixture root unavailable');
      const parent=path.resolve(local,'MTGArchives','ScannerAgent'),own=path.resolve(parent,agentId);
      if(!path.isAbsolute(parent) || path.dirname(own)!==parent || !/^[a-f0-9-]{36}$/.test(agentId))throw new Error('Helper fixture cleanup escaped');
      rmSync(own,{recursive:true,force:true});
    }
    database(`
      const n=${JSON.stringify(tag)};
      await p.acquisitionSession.updateMany({where:{createdByUserId:n},data:{phase:'CANCELLED'}});
      const w={run:{session:{createdByUserId:n}}};
      const fs=require('fs/promises'),paths=require('path'),root=process.env.UPLOADS_DATA_PATH;
      if(!root || !paths.isAbsolute(root))throw new Error('Private fixture storage unavailable');
      const photos=await p.acquisitionPhoto.findMany({where:w,select:{id:true}});
      for(const photo of photos)for(const suffix of ['.original','.preview.jpg'])
        await fs.unlink(paths.join(root,'acquisition-v1',photo.id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      const runs=await p.scannerRun.findMany({where:{agent:{userId:n}},select:{id:true}});
      for(const run of runs){
        if(!/^[a-f0-9-]{36}$/.test(run.id))throw new Error('Invalid owned fixture identity');
        await fs.unlink(paths.join(root,'scanner-control-v1',run.id+'.start.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
      }
      await p.scannerRun.deleteMany({where:{agent:{userId:n}}});
      await p.acquisitionCommitMember.deleteMany({where:w});await p.acquisitionCommit.deleteMany({where:w});
      await p.inventoryAuditLog.deleteMany({where:{changedByUserId:n}});await p.inventoryItem.deleteMany({where:{currentOwnerId:n}});
      for(const model of ['acquisitionProcessingJob','acquisitionProcessingTurn','acquisitionPhoto','acquisitionObservation','acquisitionCountCorrection','acquisitionCandidate','acquisitionArtifact','acquisitionCaptureSlot','acquisitionCommand','acquisitionEvent'])await p[model].deleteMany({where:w});
      await p.acquisitionRun.deleteMany({where:{session:{createdByUserId:n}}});
      await p.acquisitionSession.deleteMany({where:{createdByUserId:n}});
      await p.scannerPairing.deleteMany({where:{userId:n}});await p.scannerAgent.deleteMany({where:{userId:n}});
      await p.authSession.deleteMany({where:{userId:n}});await p.inventoryLocation.deleteMany({where:{id:n}});
      await p.user.deleteMany({where:{id:n}});await p.player.deleteMany({where:{id:n}});
    `);
  }
});
