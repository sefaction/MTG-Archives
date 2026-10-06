import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm, cp, chmod, readdir, open, utimes } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import sharp from "sharp";
import { createBackup, restoreBackup } from "../lib/backup";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot, beginAcquisitionPhoto,
  finalizeAcquisitionPhoto, getAcquisitionCardReview, saveAcquisitionReview } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, readAcquisitionPhotoBytes, removeAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { completeCorrectionCapture, type CorrectionCaptureClaim, runCorrectionCaptureOnce,
  collectDeletedCorrectionBlobs, releasePreservedCorrectionPins, cleanCorrectionTemporaries } from "../lib/acquisition-correction-worker";
import { readCorrectionBlob } from "../lib/acquisition-correction-files";
import { changeCorrectionExample, readCorrectionExample } from "../lib/acquisition-correction-access";

// Exact disposable endpoint supplied only by verify-correction-recovery.ts.
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "correction-restore-fixture"); assert.equal(url.pathname, "/acquisition_correction_restore");
assert.equal(process.env.UPLOADS_DATA_PATH, "/drill/uploads"); assert.equal(process.env.BACKUP_DIR, "/drill/backups");
const db = new PrismaClient();
const cli = "/app/node_modules/prisma/build/index.js", tsx = "/app/node_modules/tsx/dist/cli.mjs";
const migration = "20261006193000_recognition_correction_library";
const deploy = () => execFileSync(process.execPath, [cli,"migrate","deploy"], { stdio: "pipe", timeout: 120000 });
async function killCopy(phase: "PREPARED" | "PUBLISHED", expectedBlobId: string) {
  await rm("/drill/copy-ready.json", { force: true });
  // Load TypeScript in this process: killing a launcher would leave its child
  // alive, retaining the transaction and defeating the interruption test.
  const child = spawn(process.execPath, ["--import","tsx","scripts/verify-correction-copy-child.ts",phase], { stdio: ["ignore","pipe","pipe"] });
  const exited = new Promise<number | null>((resolve,reject) => { child.once("exit", code => resolve(code)); child.once("error",reject); });
  let diagnostics = ""; child.stderr.on("data", data => { diagnostics += String(data); });
  try {
    let value: { phase: string; claim: CorrectionCaptureClaim } | undefined;
    for (let i=0;i<300;i++) {
      const text = await readFile("/drill/copy-ready.json","utf8").catch(e => { if(e.code !== "ENOENT") throw e; return null; });
      if(text) { value=JSON.parse(text); break; }
      if(child.exitCode !== null) throw new Error(`Owned copy child exited before boundary: ${diagnostics}`);
      await setTimeout(50);
    }
    assert.ok(value, "Copy child did not reach the requested durable boundary");
    assert.equal(value.phase, phase); assert.equal(value.claim.blobId, expectedBlobId);
    child.kill("SIGKILL"); await exited;
    const job = await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: value.claim.id } });
    assert.equal(job.status,"RUNNING"); assert.equal(job.leaseToken,value.claim.leaseToken);
    assert.equal((await db.correctionBlob.findUniqueOrThrow({ where: { id: expectedBlobId } })).state,"PENDING");
    assert.ok(await db.correctionRetentionPin.count({ where: { blobId: expectedBlobId, releasedAt: null } }));
    return value.claim;
  } finally { if(child.exitCode === null) { child.kill("SIGKILL"); await exited; } }
}
async function main() {
  const started = Date.now();
  await mkdir("/drill/uploads", { recursive: true }); await mkdir("/drill/custom", { recursive: true });
  process.env.BACKUP_APPDATA_PATHS = "/drill/custom";
  // The driver has applied the old schema with the new migration held aside.
  const legacy = await createBackup();
  assert.deepEqual(legacy.manifest.appdata.map(e => e.envName),["BACKUP_APPDATA_PATHS_1","UPLOADS_DATA_PATH"]);
  await cp(`/drill/staged-migration/${migration}`,`/app/prisma/migrations/${migration}`,{recursive:true}); deploy();
  const owners = ["correction-archive-owner-a","correction-archive-owner-b"];
  const actors = owners.map(userId => ({ userId, adminMode: false }));
  const card = await db.card.create({ data: { scryfallId: randomUUID(), name: "Synthetic archive printing", setCode: "crx", collectorNumber: "1", typeLine: "Land", rarity: "common", lang: "en", finishes: ["nonfoil"] } });
  const bytes = await sharp({ create: { width: 100,height:140,channels:3,background:"#778899" } }).jpeg().toBuffer();
  const other = await sharp({ create: { width: 100,height:140,channels:3,background:"#112233" } }).jpeg().toBuffer();
  const photos: { id:string; owner:string; sessionId:string; bytes:Buffer; digest:string; size:number }[] = [];
  for (const [index,owner] of owners.entries()) {
    await db.player.create({ data: { id:owner,name:owner,displayName:owner } });
    await db.user.create({ data: { id:owner,username:owner,displayName:owner,playerId:owner,passwordHash:"fixture-not-login" } });
    await db.inventoryLocation.create({ data: { id:owner,ownerPlayerId:owner,name:owner,normalizedName:owner,type:"Box",storageLayout:{capacity:10,sections:[]} } });
    await db.$transaction(tx => ensureCorrectionAccount(tx,owner));
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId:owner },data:{sampleBasisPoints:0} });
    const session = await createAcquisitionSession(db,actors[index],{requestKey:randomUUID(),ownerPlayerId:owner,locationId:owner,section:"",
      policy:{kind:"MANUAL",quantity:index?1:3},run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL","PAUSE","RESUME"]}});
    await executeAcquisitionCommand(db,actors[index],session.session.id,{requestKey:"start",revision:0,command:"START"});
    for(let n=0;n<(index?1:3);n++) {
      const original = n===2?other:bytes, metadata=await inspectAcquisitionPhoto(original,"image/jpeg");
      const {slot}=await reserveAcquisitionCaptureSlot(db,actors[index],session.session.id,randomUUID());
      const photo=await beginAcquisitionPhoto(db,actors[index],session.session.id,{slotId:slot.id,uploadKey:randomUUID(),generation:0,metadata,inputKind:"CARD_SCAN"});
      await writeAcquisitionPhotoBytes(photo.id,original,"raw",photo.digest);
      await finalizeAcquisitionPhoto(db,actors[index],session.session.id,photo.id);
      const view=await getAcquisitionCardReview(db,actors[index],session.session.id,photo.id);
      await saveAcquisitionReview(db,actors[index],session.session.id,{action:"accept",photoId:photo.id,revision:view.revision,
        decision:{cardId:card.id,language:"en",finish:"NONFOIL",condition:"NM"},evidenceTokens:{current:view.evidenceToken,displayed:[]}});
      photos.push({id:photo.id,owner,sessionId:session.session.id,bytes:original,digest:photo.digest,size:photo.bytes});
    }
  }
  const shared = await db.correctionExample.findFirstOrThrow({where:{sourcePhotoId:photos[0].id}});
  // Real kernel errors in private fixture-only roots: a bounded full tmpfs and
  // a separate unprivileged process facing a root-owned library directory.
  for(const mode of ["ENOSPC","EACCES"] as const) {
    const root=mode==="ENOSPC"?"/failure-space":"/drill/permission-space";
    await mkdir(`${root}/acquisition-v1`,{recursive:true});
    await writeFile(`${root}/acquisition-v1/${photos[0].id}.original`,photos[0].bytes,{mode:0o644});
    const namespace=`${root}/correction-library-v1`;
    const ownerHash=createHash("sha256").update(owners[0]).digest("hex");
    await mkdir(`${namespace}/${ownerHash}/temporary`,{recursive:true});
    if(mode==="ENOSPC") {
      const filler=await open(`${root}/owned-filler`,"w");
      try { for(let n=0;n<64;n++) await filler.write(Buffer.alloc(4096)); assert.fail("Owned tmpfs did not fill within its strict bound"); }
      catch(error:any) {assert.equal(error.code,"ENOSPC");} finally {await filler.close();}
    } else {await chmod(root,0o777);await chmod(namespace,0o700);}
    await db.correctionCaptureOutbox.update({where:{blobId:shared.blobId},data:{availableAt:new Date(1)}});
    await db.correctionLibraryAccount.update({where:{ownerPlayerId:owners[0]},data:{lastCaptureAt:null}});
    execFileSync(process.execPath,["--import","tsx","scripts/verify-correction-storage-child.ts",mode,shared.blobId],{
      env:{...process.env,UPLOADS_DATA_PATH:root},...(mode==="EACCES"?{uid:65534,gid:65534}:{}),encoding:"utf8",timeout:30000,stdio:"pipe"});
    if(mode==="ENOSPC")await rm(`${root}/owned-filler`);
  }
  const interrupted = await db.correctionExample.findFirstOrThrow({ where: { sourcePhotoId:photos[2].id } });
  await db.correctionCaptureOutbox.update({ where:{blobId:interrupted.blobId},data:{availableAt:new Date(0)} });
  await db.correctionCaptureOutbox.update({where:{blobId:shared.blobId},data:{availableAt:new Date()}});
  await db.correctionLibraryAccount.update({where:{ownerPlayerId:owners[0]},data:{lastCaptureAt:null}});
  const firstClaim = await killCopy("PREPARED",interrupted.blobId);
  await db.correctionCaptureOutbox.update({ where:{id:firstClaim.id},data:{leaseExpiresAt:new Date(0)} });
  await db.correctionLibraryAccount.update({ where:{ownerPlayerId:owners[0]},data:{lastCaptureAt:null} });
  const oldClaim = await killCopy("PUBLISHED",interrupted.blobId);
  assert.notEqual(oldClaim.leaseToken,firstClaim.leaseToken);
  await db.correctionCaptureOutbox.update({ where:{id:oldClaim.id},data:{leaseExpiresAt:new Date(Date.now()+300000)} });
  assert.deepEqual(await readCorrectionBlob(owners[0],photos[2].digest,photos[2].size),other);
  const temporary=`/drill/uploads/correction-library-v1/${createHash("sha256").update(owners[0]).digest("hex")}/temporary`;
  const parts=await readdir(temporary);assert.equal(parts.length,2);
  const past=new Date(Date.now()-7200000);
  for(const part of parts)await utimes(`${temporary}/${part}`,past,past);
  assert.equal(await cleanCorrectionTemporaries(db),1);
  assert.deepEqual((await readdir(temporary)).map(name=>name.includes(oldClaim.leaseToken!)),[true]);
  // Actual pg_dump wrapper executes copies only after its real snapshot. Version
  // inspection goes straight to the real client and cannot trigger the hook.
  await mkdir("/drill/bin",{recursive:true});
  const realDump=execFileSync("which",["pg_dump"],{encoding:"utf8"}).trim(); assert.match(realDump,/^\/usr\/bin\/pg_dump$/);
  await writeFile("/drill/bin/pg_dump",`#!/bin/sh\nset -eu\nif [ "$1" != "--format=custom" ]; then exec ${realDump} "$@"; fi\n${realDump} "$@"\nexec /app/node_modules/.bin/tsx /app/scripts/verify-correction-backup-window.ts\n`);
  await chmod("/drill/bin/pg_dump",0o700);
  const originalPath=process.env.PATH!; process.env.PATH=`/drill/bin:${originalPath}`;
  let backup: Awaited<ReturnType<typeof createBackup>>;
  try { backup=await createBackup(); } finally { process.env.PATH=originalPath; }
  await releasePreservedCorrectionPins(db);
  const archivedEvents=await db.correctionReviewEvent.findMany({orderBy:{id:"asc"}}),
    archivedEvidence=await db.correctionEvidence.findMany({orderBy:{id:"asc"}});
  const removed=await db.correctionExample.findFirstOrThrow({where:{ownerPlayerId:owners[1]}});
  await changeCorrectionExample(db,actors[1],owners[1],removed.id,"REMOVE"); await collectDeletedCorrectionBlobs(db);
  const keys=await db.correctionLibraryAccount.findMany({select:{ownerPlayerId:true,displayKey:true},orderBy:{ownerPlayerId:"asc"}});
  assert.equal((await restoreBackup(backup.path)).dryRun,true);
  assert.deepEqual(await db.correctionLibraryAccount.findMany({select:{ownerPlayerId:true,displayKey:true},orderBy:{ownerPlayerId:"asc"}}),keys);
  assert.equal(await db.correctionDeletionTombstone.count(),1);
  assert.equal((await db.correctionCaptureOutbox.findUniqueOrThrow({where:{id:oldClaim.id}})).status,"RUNNING");
  await restoreBackup(backup.path,{force:true,confirmation:"RESTORE"});
  assert.equal((await db.correctionCaptureOutbox.findUniqueOrThrow({where:{id:oldClaim.id}})).status,"PENDING");
  assert.equal(await db.correctionBackupGuard.count({where:{releasedAt:null}}),0);
  let called=false; assert.equal(await completeCorrectionCapture(db,oldClaim,async()=>{called=true;}),false); assert.equal(called,false);
  const restoredKeys=await db.correctionLibraryAccount.findMany({select:{ownerPlayerId:true,displayKey:true},orderBy:{ownerPlayerId:"asc"}});
  assert.ok(restoredKeys.every((key,i)=>key.displayKey!==keys[i].displayKey));
  assert.ok((await db.correctionExample.findUniqueOrThrow({where:{id:removed.id}})).deletedAt);
  assert.deepEqual(await db.correctionReviewEvent.findMany({orderBy:{id:"asc"}}),archivedEvents.filter(e=>e.ownerPlayerId!==owners[1]));
  assert.deepEqual(await db.correctionEvidence.findMany({orderBy:{id:"asc"}}),archivedEvidence.filter(e=>e.ownerPlayerId!==owners[1]));
  for(const photo of photos) assert.deepEqual(await readAcquisitionPhotoBytes(photo.id,"raw",photo.digest),photo.bytes);
  // Archive excludes live staging parts; pending records can attach a verified
  // independent destination even when their acquisition original later vanishes.
  const files=await readdir("/drill/uploads/correction-library-v1",{recursive:true}); assert.ok(files.every(file=>!String(file).endsWith(".part")));
  for(const photo of photos.filter(p=>p.owner===owners[0])) await removeAcquisitionPhotoBytes(photo.id);
  assert.equal((await runCorrectionCaptureOnce(db)).preserved,1); assert.equal((await runCorrectionCaptureOnce(db)).preserved,1);
  await collectDeletedCorrectionBlobs(db);
  const surviving=await db.correctionExample.findFirstOrThrow({where:{ownerPlayerId:owners[0],deletedAt:null}});
  const download=await readCorrectionExample(db,actors[0],owners[0],surviving.id); assert.ok(download.bytes.length);
  for(const account of await db.correctionLibraryAccount.findMany()) {
    const blobs=await db.correctionBlob.aggregate({where:{ownerPlayerId:account.ownerPlayerId,state:"PRESERVED"},_sum:{bytes:true}});
    assert.equal(account.preservedBytes,BigInt(blobs._sum.bytes??0)); assert.equal(account.reservedBytes,0n);
  }
  // Actual older schema archive then forward migration must preserve removal
  // intent even when every library table and source photo originally was absent.
  await restoreBackup(legacy.path,{force:true,confirmation:"RESTORE"});
  assert.equal((await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "CorrectionDeletionTombstone"`)[0].count,1n);
  deploy(); assert.equal(await db.correctionDeletionTombstone.count(),1); assert.equal(await db.correctionExample.count(),0);
  await restoreBackup(backup.path,{force:true,confirmation:"RESTORE"});
  assert.ok((await db.correctionExample.findUniqueOrThrow({where:{id:removed.id}})).deletedAt);
  assert.equal(await db.correctionReviewEvent.count({where:{ownerPlayerId:owners[1]}}),0);
  assert.equal(await db.inventoryItem.count(),0);
  console.log(JSON.stringify({correctionArchive:"PASS",killedBoundaries:["PREPARED","PUBLISHED_BEFORE_COMMIT"],
    realSnapshotWindow:true,realEnospcAndPermission:true,temporaryCleanupKeepsLiveLease:true,
    customUploadsCoverage:true,restoredPendingAndRunning:true,staleLeaseRejected:true,
    exactOriginals:true,eventOrderAndEvidence:true,ownerDedup:true,keysRotated:true,olderArchiveForwardMigration:true,
    removedExampleNotResurrected:true,inventoryUnchanged:true,elapsedMs:Date.now()-started}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
