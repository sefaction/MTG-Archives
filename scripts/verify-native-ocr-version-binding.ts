/** Opt-in real CPU OCR qualification in an otherwise empty, isolated database. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import path from "node:path";
import {PrismaClient, type Prisma} from "@prisma/client";
import {AcquisitionNativeStream} from "../lib/acquisition-native-stream";
import {runAcquisitionNativeProcess} from "../lib/acquisition-native-process";
import {canonicalizeAcquisitionPhoto, inspectAcquisitionPhoto, readAcquisitionPhotoBytes, writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand, finalizeAcquisitionPhoto,
  getAcquisitionCardReview, reserveAcquisitionCaptureSlot, saveAcquisitionReview} from "../lib/acquisition-store";
import {claimAcquisitionJobs, completeAcquisitionJob, runAcquisitionJobsOnce, type ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {acquisitionRecognitionVersion, enqueueReadyRecognition, loadAcquisitionRecognitionSnapshot,
  recognizeAcquisitionPhoto, RECOGNITION_STAGE} from "../lib/acquisition-recognition-worker";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";

type NativeDescriptor = {digest:string;execution:string;models:Record<string,string>;runtime:Record<string,string>};
const url=new URL(process.env.DATABASE_URL??"http://invalid");
assert(process.platform==="linux"&&process.getuid?.()===0,"Use the canonical Linux worker identity");
assert.equal(process.env.MTG_NATIVE_OCR_VERSION_FIXTURE,"1");
assert.equal(url.hostname,"native304-pg");
assert.equal(url.pathname,"/acquisition_native304");

const db=new PrismaClient();
const tag=`native-ocr-${randomUUID()}`, owner=tag+"-owner", userId=tag+"-user", locationId=tag+"-box";
const actor={userId,adminMode:false};
const cardIds=[tag+"-card-0",tag+"-card-1"];
const native=new AcquisitionNativeStream("python",["/app/tools/acquisition-runtime/recognize.py","--stream","--prepare"]);
const report:Record<string,unknown>={version:1,scope:"real OCR version binding; synthetic source; no accuracy or Inventory acceptance"};
let root:string|undefined,sessionId:string|undefined,runId:string|undefined;
let baseline:Record<string,{rows:number;digest:string}>|undefined;
const previousUploads=process.env.UPLOADS_DATA_PATH;

async function fingerprints(){
  const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result:Record<string,{rows:number;digest:string}>={};
  for(const {tablename} of tables){
    const quoted='"'+tablename.replaceAll('"','""')+'"';
    const [row]=await db.$queryRawUnsafe<{rows:number;digest:string}[]>(`SELECT count(*)::int rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM ${quoted} t`);
    result[tablename]=row;
  }
  return result;
}

async function run(){
  assert.equal(await db.user.count(),0,"Never use an existing installation or populated fixture");
  assert.equal(await db.card.count(),0);
  assert.equal(await db.inventoryItem.count(),0);
  assert.equal(await db.acquisitionSession.count(),0);
  baseline=await fingerprints();
  await mkdir("/app/.local-data",{recursive:true});
  root=await mkdtemp("/app/.local-data/native-ocr-");
  process.env.UPLOADS_DATA_PATH=root;
  await db.player.create({data:{id:owner,name:owner,displayName:owner}});
  await db.user.create({data:{id:userId,username:userId,displayName:userId,playerId:owner,passwordHash:"not-a-login-hash"}});
  await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));
  await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
  await db.inventoryLocation.create({data:{id:locationId,ownerPlayerId:owner,name:"Native fixture",normalizedName:tag,type:"Box"}});
  await db.card.createMany({data:cardIds.map((id,i)=>({id,scryfallId:randomUUID(),name:i?"Unrelated Binding Test":"Native Binding Test",typeLine:"Artifact",setCode:"tst",collectorNumber:String(i+1),rarity:"common",lang:"en"}))});
  const created=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:owner,locationId,section:"A",policy:{kind:"MANUAL",quantity:2},run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
  sessionId=created.session.id;
  await executeAcquisitionCommand(db,actor,sessionId,{requestKey:randomUUID(),revision:0,command:"START"});
  // Pillow's bundled font makes readable synthetic pixels without external art.
  const bytes=execFileSync("python",["-c",`from PIL import Image,ImageDraw,ImageFont
import sys
image=Image.new('RGB',(1000,1400),'#dddddd')
draw=ImageDraw.Draw(image)
draw.rectangle((35,35,965,1365),fill='white',outline='black',width=7)
draw.text((80,110),'Native Binding Test',font=ImageFont.load_default(size=65),fill='black')
draw.rectangle((80,260,920,970),fill='#7799aa')
draw.text((80,1060),'Fixture data only',font=ImageFont.load_default(size=42),fill='black')
draw.text((80,1280),'TST 1 EN',font=ImageFont.load_default(size=38),fill='black')
image.save(sys.stdout.buffer,format='JPEG',quality=95)`]);
  const sourceDigest=createHash("sha256").update(bytes).digest("hex");
  const photos:string[]=[];
  for(let i=0;i<2;i++){
    const {slot}=await reserveAcquisitionCaptureSlot(db,actor,sessionId,`photo-${i}`);
    const photo=await beginAcquisitionPhoto(db,actor,sessionId,{slotId:slot.id,uploadKey:randomUUID(),generation:0,metadata:await inspectAcquisitionPhoto(bytes,"image/jpeg"),inputKind:"PHOTO"});
    runId=photo.runId;photos.push(photo.id);
    await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);
    await finalizeAcquisitionPhoto(db,actor,sessionId,photo.id);
  }
  for(let i=0;i<2;i++)assert.equal((await runAcquisitionJobsOnce(db,{"photo-canonical-v1":(job,signal)=>canonicalizeAcquisitionPhoto((job.input as {photoId:string}).photoId,(job.input as {digest:string}).digest,signal)},tag+"-canonical")).complete,1);
  const descriptor=await runAcquisitionNativeProcess("python",["/app/tools/acquisition-runtime/recognize.py","--describe"],Buffer.alloc(0),AbortSignal.timeout(30000)) as NativeDescriptor;
  assert.equal(descriptor.execution,"CPU");
  const lock=JSON.parse(await readFile("/app/tools/acquisition-runtime/models.lock.json","utf8"));
  const expected=Object.fromEntries(lock.models.flatMap((model:{name:string;files:Record<string,{sha256:string}>})=>Object.entries(model.files).map(([name,file])=>[model.name+"/"+name,file.sha256])));
  assert.deepEqual(descriptor.models,expected,"actual descriptor must identify the initialized locked files");
  // Only the model root changes in this process. The actual descriptor still
  // hashes real files with the unchanged production algorithm and packages.
  const changed=await runAcquisitionNativeProcess("python",["-c",`import json,sys
from pathlib import Path
sys.path.insert(0,'/app/tools/acquisition-runtime')
import model_store,recognize
recognize.ROOT=Path('/models-changed')/model_store.model_root().relative_to(model_store.CACHE)
print(json.dumps(recognize.descriptor()))`],Buffer.alloc(0),AbortSignal.timeout(30000)) as NativeDescriptor;
  assert.notEqual(descriptor.digest,changed.digest);
  const changedFiles=Object.keys(descriptor.models).filter(name=>descriptor.models[name]!==changed.models[name]);
  assert.equal(changedFiles.length,1);assert(changedFiles[0].endsWith("/inference.pdiparams"));
  assert.deepEqual({...changed,digest:descriptor.digest,models:descriptor.models},descriptor,"the corruption control changes model bytes only");
  const snapshotA=await loadAcquisitionRecognitionSnapshot(db);
  assert.equal(await enqueueReadyRecognition(db,snapshotA.digest,descriptor.digest),2);
  const initial=await db.acquisitionProcessingJob.findMany({where:{runId,stage:RECOGNITION_STAGE},orderBy:{id:"asc"}});
  assert.equal(initial.length,2);
  assert.equal(new Set(initial.map(j=>(j.input as {photoId:string}).photoId)).size,2,"equal pixels retain separate physical input identities");
  for(const job of initial){const input=job.input as {digest:string;versions:Record<string,string>};assert.equal(input.digest,sourceDigest);assert.equal(input.versions.model,descriptor.digest);assert.equal(input.versions.catalog,snapshotA.digest);assert.equal(job.versionKey,acquisitionRecognitionVersion(snapshotA.digest,descriptor.digest));}
  await db.card.update({where:{id:cardIds[1]},data:{name:"Revised Binding Metadata"}});
  const snapshotB=await loadAcquisitionRecognitionSnapshot(db);
  assert.notEqual(snapshotB.digest,snapshotA.digest);
  assert.equal(acquisitionRecognitionVersion(snapshotA.digest,descriptor.digest),acquisitionRecognitionVersion(snapshotB.digest,descriptor.digest));
  assert.equal(await enqueueReadyRecognition(db,snapshotB.digest,descriptor.digest),0,"catalogue changes reuse the raw OCR attempt");
  await native.prepare(descriptor.digest,AbortSignal.timeout(30000));
  let nativeRequests=0;
  const transport={request:(frame:Buffer,signal:AbortSignal,progress?: (value:unknown)=>void)=>{nativeRequests++;assert(frame.subarray(-bytes.length).equals(bytes),"real native frames retain exact source pixels");return native.request(frame,signal,progress);}} as unknown as AcquisitionNativeStream;
  let completed:ClaimedAcquisitionJob|undefined;
  let observed:Prisma.InputJsonObject|undefined;
  const first=await runAcquisitionJobsOnce(db,{[RECOGNITION_STAGE]:async(job,signal)=>{completed=job;observed=await recognizeAcquisitionPhoto(job,signal,snapshotB,descriptor.digest,transport);return observed;}},tag+"-native",{timeoutMs:45000,leaseMs:90000});
  assert.equal(first.complete,1);assert(completed&&observed);
  const evidence=observed as {versions:Record<string,string>;native:{descriptor:string;descriptorDetails:NativeDescriptor;photoDigest:string;orientations:{lines:unknown[]}[];photoText?:{readings:{text:string[]}[]}}};
  assert.equal(evidence.versions.catalog,snapshotB.digest);assert.equal(evidence.versions.index,snapshotB.digest);
  assert.equal(evidence.versions.model,descriptor.digest);assert.equal(evidence.native.descriptor,descriptor.digest);
  assert.deepEqual(evidence.native.descriptorDetails,descriptor);assert.equal(evidence.native.photoDigest,sourceDigest);
  const lines=evidence.native.orientations.reduce((n,x)=>n+x.lines.length,0)+(evidence.native.photoText?.readings.reduce((n,x)=>n+x.text.length,0)??0);
  assert(lines>0,"the real models must produce text evidence for the readable synthetic source");
  const saved=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:completed.id}});
  assert.equal(saved.status,"COMPLETE");assert.deepEqual(saved.input,initial.find(j=>j.id===completed!.id)!.input);
  assert.equal((saved.output as typeof evidence).native.descriptor,descriptor.digest);assert.equal((saved.output as typeof evidence).versions.catalog,snapshotB.digest);
  const [late]=await claimAcquisitionJobs(db,{workerId:tag+"-late",stages:[RECOGNITION_STAGE],leaseMs:90000});assert(late);
  const lateOutput=await recognizeAcquisitionPhoto(late,AbortSignal.timeout(45000),snapshotB,descriptor.digest,transport);
  const latePhoto=(late.input as {photoId:string}).photoId;
  const review=await getAcquisitionCardReview(db,actor,sessionId,latePhoto);
  await saveAcquisitionReview(db,actor,sessionId,{action:"accept",photoId:latePhoto,revision:review.revision,decision:{cardId:cardIds[0],language:"en",finish:"NONFOIL",condition:"NM"}});
  const human=await getAcquisitionCardReview(db,actor,sessionId,latePhoto);
  assert.equal(await completeAcquisitionJob(db,late,lateOutput),"SUPERSEDED");
  assert.deepEqual((await getAcquisitionCardReview(db,actor,sessionId,latePhoto)).review,human.review);
  const callsBeforeMismatch=nativeRequests;
  const refusalChecks={admission:false,output:false};
  assert.equal(await enqueueReadyRecognition(db,snapshotB.digest,changed.digest),1);
  const mismatch=await runAcquisitionJobsOnce(db,{[RECOGNITION_STAGE]:async(job,signal)=>{
    await assert.rejects(recognizeAcquisitionPhoto(job,signal,snapshotB,descriptor.digest,transport),/Processing version unavailable/);
    assert.equal(nativeRequests,callsBeforeMismatch,"another actual model generation is refused before native work");
    refusalChecks.admission=true;
    await assert.rejects(recognizeAcquisitionPhoto(job,signal,snapshotB,changed.digest,transport),/Processing input changed/);
    assert.equal(nativeRequests,callsBeforeMismatch+1,"an incompatible child produces real output which the parent refuses");
    refusalChecks.output=true;
    throw new Error("Expected mismatched model control");
  }},tag+"-wrong-model",{timeoutMs:45000,leaseMs:90000});
  assert.equal(mismatch.failed,1);
  assert.deepEqual(refusalChecks,{admission:true,output:true},"the worker must not swallow a failed refusal assertion");
  const refused=await db.acquisitionProcessingJob.findFirstOrThrow({where:{runId,stage:RECOGNITION_STAGE,versionKey:acquisitionRecognitionVersion(snapshotB.digest,changed.digest)}});
  assert.equal(refused.output,null);assert.equal(refused.status,"PENDING");assert.equal(refused.errorCode,"PROCESSING_FAILED");
  await assert.rejects(native.prepare(changed.digest,AbortSignal.timeout(30000)),/Processing native evidence invalid/);
  for(const photo of photos)assert.deepEqual(await readAcquisitionPhotoBytes(photo,"raw",sourceDigest),bytes);
  assert.equal(await db.inventoryItem.count(),0);assert.equal(await db.acquisitionCommit.count(),0);
  report.binding={sourceDigest,photoBytes:bytes.length,model:descriptor.digest,changedModel:changed.digest,changedFiles,catalogAtAdmission:snapshotA.digest,catalogAtResolution:snapshotB.digest,modelFiles:Object.keys(descriptor.models).length,runtime:descriptor.runtime};
  report.controls={nativeRequests,recognizedLines:lines,complete:first.complete,humanFence:"SUPERSEDED",mismatchedModel:mismatch.failed,returnedDescriptorRefused:refusalChecks.output,prepareDescriptorRefused:true,inventory:0,originalPhotos:2};
}

async function cleanupRows(){
  if(runId){const where={runId};await db.acquisitionCommitMember.deleteMany({where});await db.acquisitionCommit.deleteMany({where});await db.acquisitionProcessingJob.deleteMany({where});await db.acquisitionCommand.deleteMany({where});await db.acquisitionPhoto.deleteMany({where});await db.acquisitionCaptureSlot.deleteMany({where});await db.acquisitionCountCorrection.deleteMany({where});await db.acquisitionObservation.deleteMany({where});await db.acquisitionEvent.deleteMany({where});await db.acquisitionCandidate.deleteMany({where});await db.acquisitionArtifact.deleteMany({where});await db.acquisitionRun.deleteMany({where:{id:runId}});}
  if(sessionId)await db.acquisitionSession.deleteMany({where:{id:sessionId}});
  const owned={ownerPlayerId:owner};await db.correctionRetentionPin.deleteMany({where:owned});await db.correctionCaptureOutbox.deleteMany({where:{blob:owned}});await db.correctionExample.deleteMany({where:owned});await db.correctionReviewEvent.deleteMany({where:owned});await db.correctionEvidence.deleteMany({where:owned});await db.correctionLibraryAccess.deleteMany({where:owned});await db.correctionBlob.deleteMany({where:owned});await db.correctionDeletionTombstone.deleteMany({where:owned});await db.correctionLibraryAccount.deleteMany({where:owned});
  await db.inventoryLocation.deleteMany({where:{id:locationId}});await db.user.deleteMany({where:{id:userId}});await db.player.deleteMany({where:{id:owner}});await db.card.deleteMany({where:{id:{in:cardIds}}});
}

async function main(){
  let failed=false,primary:unknown,nativeStopped=false,rowsRestored=false;const errors:unknown[]=[];
  try{await run();}catch(error){failed=true;primary=error;}
  try{await native.shutdown();nativeStopped=true;}catch(error){errors.push(error);}
  if(nativeStopped){
    try{await cleanupRows();if(baseline){const after=await fingerprints();assert.deepEqual(after,baseline,"all original public table rows are restored");report.restoredTables=Object.keys(after).length;}rowsRestored=true;}catch(error){errors.push(error);}
    try{if(root&&rowsRestored)await rm(root,{recursive:true,force:true});}catch(error){errors.push(error);}
  }
  if(previousUploads===undefined)delete process.env.UPLOADS_DATA_PATH;
  else process.env.UPLOADS_DATA_PATH=previousUploads;
  try{await db.$disconnect();}catch(error){errors.push(error);}
  if(failed||errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],"Native OCR version qualification failed");
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
