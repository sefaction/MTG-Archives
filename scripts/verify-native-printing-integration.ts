/** Staged opt-in controller; actual unchanged worker entrypoints do the work. */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {access, readFile, rename, writeFile} from "node:fs/promises";
import {PrismaClient, type Prisma} from "@prisma/client";
import {cardWriteData} from "../lib/card-import";
import type {ScryfallCard} from "../lib/scryfall";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";
import {inspectAcquisitionPhoto, readAcquisitionPhotoBytes, writeAcquisitionPhotoBytes, removeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot, beginAcquisitionPhoto,
  finalizeAcquisitionPhoto, getAcquisitionCardReview, saveAcquisitionReview} from "../lib/acquisition-store";
import {CATALOG_RECONCILIATION_STAGE} from "../lib/acquisition-catalog-status";
import {RECOGNITION_STAGE, loadAcquisitionRecognitionSnapshot} from "../lib/acquisition-recognition-worker";
import {VISUAL_STAGE, type VisualObservation} from "../lib/acquisition-visual";
import {PRINTING_STAGE, PRINTING_POLICY_VERSION, type PrintingObservation} from "../lib/acquisition-printing";
import {enqueueReadyPrinting, observeAcquisitionPrinting} from "../lib/acquisition-printing-worker";
import {runAcquisitionJobsOnce} from "../lib/acquisition-jobs";
import {AcquisitionNativeGeneration} from "../lib/acquisition-native-generation";
import {AcquisitionNativeStream} from "../lib/acquisition-native-stream";
import {runAcquisitionNativeProcess} from "../lib/acquisition-native-process";

const CANONICAL="photo-canonical-v1",stateFile="/fixture/state.json",uploads="/uploads";
const stages={canonical:CANONICAL,ocr:RECOGNITION_STAGE,visual:VISUAL_STAGE,catalog:CATALOG_RECONCILIATION_STAGE,printing:PRINTING_STAGE};
type Phase=keyof typeof stages;
type Fingerprints=Record<string,{rows:number;digest:string}>;
type SavedJob={id:string;input:Prisma.JsonValue;output:Prisma.JsonValue;status:string};
type Photo={id:string;target:string;digest:string;source:string;jobs:Partial<Record<Phase,SavedJob>>};
type State={version:1;owner:string;userId:string;locationId:string;stockId:string;baseline:Fingerprints;
  sessionId?:string;runId?:string;photos:Photo[];stock?:Prisma.JsonValue;audits?:Prisma.JsonValue;
  late?:{jobId:string;output:Prisma.JsonValue;review:Prisma.JsonValue;requests:number};
  publicCards?:Prisma.JsonValue;publicLookups?:Prisma.JsonValue;finished?:boolean;cleaned?:boolean};
type Descriptor={digest:string;manifest:string;details?:{annotationsSha256:string;symbolAssets:Record<string,string>;indexSha256:string}};
type Spec={cards:ScryfallCard[];queries:{path:string;sha256:string;target:string;bytes:number}[];
  indexSha256:string;annotationsSha256:string;symbolAssets:Record<string,string>};
type Output={photoId:string;versions:Record<string,string>;native:{photoDigest:string;descriptor:string;
  orientations:{lines:unknown[]}[];photoText?:{readings:{text:string[]}[]}};
  visual?:VisualObservation;visualExecution?:{reused:boolean;inferenceRequests:number};
  sourceRecognitionJobId?:string;sourceVisualJobId?:string;sourceCatalogJobId?:string;
  proposals?:{automaticAcceptance:boolean;proposals:{card:{id:string}}[]};
  catalog?:{status:string;requestsMade:number;printingCoverage:string};
  printingNative?:PrintingObservation&{descriptor:string;photoDigest:string};
  printingExecution?:{reused:boolean;inferenceRequests:number;observationJobId?:string}};
const url=new URL(process.env.DATABASE_URL??"http://invalid");
assert.equal(process.env.MTG_NATIVE_PRINTING_FIXTURE,"1");
assert(process.platform==="linux"&&process.getuid?.()===0);
assert.equal(url.hostname,"nativeprinting304-pg");assert.equal(url.pathname,"/acquisition_native_printing304");
assert.equal(process.env.UPLOADS_DATA_PATH,uploads);
const db=new PrismaClient();
const json=(value:unknown):Prisma.JsonValue=>JSON.parse(JSON.stringify(value));
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function fingerprints():Promise<Fingerprints>{
  const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const values:Fingerprints={};
  for(const {tablename} of tables){const quoted='"'+tablename.replaceAll('"','""')+'"';
    const [row]=await db.$queryRawUnsafe<{rows:number;digest:string}[]>(`SELECT count(*)::int rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM ${quoted} t`);values[tablename]=row;}
  return values;
}
async function state(){const value=JSON.parse(await readFile(stateFile,"utf8")) as State;
  assert.equal(value.version,1);assert(value.owner.startsWith("native-printing-")&&value.userId===value.owner+"-user");return value;}
async function save(value:State){await writeFile(stateFile+".partial",JSON.stringify(value));await rename(stateFile+".partial",stateFile);}
async function spec(){return JSON.parse(await readFile("/visual/integration.json","utf8")) as Spec;}
async function descriptors(){return JSON.parse(await readFile("/fixture/descriptors.json","utf8")) as {ocr:Descriptor;visual:Descriptor;printing:Descriptor};}
async function conservation(s:State){
  assert.deepEqual(json(await db.inventoryItem.findMany({orderBy:{id:"asc"}})),s.stock);
  assert.deepEqual(json(await db.inventoryAuditLog.findMany({orderBy:{id:"asc"}})),s.audits);
  assert.equal(await db.acquisitionCommit.count(),0);
  for(const p of s.photos){assert.equal(hash(await readAcquisitionPhotoBytes(p.id,"raw",p.digest)),p.digest);
    for(const saved of Object.values(p.jobs)){const current=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:saved.id}});
      assert.deepEqual(current.input,saved.input);assert.deepEqual(current.output,saved.output);assert.equal(current.status,saved.status);}}
}
async function setup(){
  await assert.rejects(access(stateFile),{code:"ENOENT"},"Never overwrite a prior fixture journal");
  const baseline=await fingerprints();
  // Fresh migrations seed exactly these eight standard types. Validate their
  // whole identity and preserve their complete timestamp-bearing fingerprints.
  const seededNames=["Binder","Box","Bulk","Case","Deckbox","Other","Shelf","Unassigned"];
  const types=await db.locationType.findMany({orderBy:{id:"asc"}});
  assert.deepEqual(types.map(({createdAt,updatedAt,...row})=>{assert.equal(createdAt.getTime(),updatedAt.getTime());return row;}),
    seededNames.map(name=>({id:"loc-type-"+name.toLowerCase(),name,normalizedName:name.toLowerCase(),description:null,
      active:true,createdByUserId:null,defaultStorageLayout:null})),"Only the exact standard migration seeds are allowed");
  for(const [name,value] of Object.entries(baseline))if(!["_prisma_migrations","LocationType"].includes(name))assert.equal(value.rows,0,"Fresh disposable table required: "+name);
  const owner="native-printing-"+randomUUID(),s:State={version:1,owner,userId:owner+"-user",locationId:owner+"-box",stockId:owner+"-stock",baseline,photos:[]};
  await save(s);
  const input=await spec();assert.equal(input.cards.length,2);assert.equal(input.queries.length,2);
  await db.player.create({data:{id:owner,name:owner,displayName:owner}});
  await db.user.create({data:{id:s.userId,username:s.userId,displayName:s.userId,playerId:owner,passwordHash:"not-a-login-hash"}});
  await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));
  await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
  await db.inventoryLocation.create({data:{id:s.locationId,ownerPlayerId:owner,name:"Native integration fixture",normalizedName:owner,type:"Box"}});
  for(const card of input.cards)await db.card.create({data:{...cardWriteData(card),id:card.id,scryfallId:card.id} as Prisma.CardCreateInput});
  await db.inventoryItem.create({data:{id:s.stockId,currentOwnerId:owner,cardId:input.cards[0].id,quantity:2,condition:"NM",locationId:s.locationId,locationSection:"untouched"}});
  s.stock=json(await db.inventoryItem.findMany({orderBy:{id:"asc"}}));s.audits=json(await db.inventoryAuditLog.findMany({orderBy:{id:"asc"}}));
  const actor={userId:s.userId,adminMode:false};
  const created=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:owner,locationId:s.locationId,section:"A",policy:{kind:"MANUAL",quantity:3},
    run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
  s.sessionId=created.session.id;await save(s);
  await executeAcquisitionCommand(db,actor,s.sessionId,{requestKey:randomUUID(),revision:0,command:"START"});
  console.log(JSON.stringify({event:"printing-integration-setup",tables:Object.keys(baseline).length,initialInventoryQuantity:2}));
}
async function upload(index:number){
  const s=await state(),input=await spec();assert(s.sessionId);assert.equal(s.photos.length,index);
  const source=input.queries[index===2?1:0],bytes=await readFile(source.path);assert.equal(hash(bytes),source.sha256);
  const actor={userId:s.userId,adminMode:false},slot=await reserveAcquisitionCaptureSlot(db,actor,s.sessionId,randomUUID());
  const p=await beginAcquisitionPhoto(db,actor,s.sessionId,{slotId:slot.slot.id,uploadKey:randomUUID(),generation:0,inputKind:"PHOTO",metadata:await inspectAcquisitionPhoto(bytes,"image/jpeg")});
  s.runId=p.runId;s.photos.push({id:p.id,target:source.target,digest:p.digest,source:source.path,jobs:{}});await save(s);
  await writeAcquisitionPhotoBytes(p.id,bytes,"raw",p.digest);await finalizeAcquisitionPhoto(db,actor,s.sessionId,p.id);
  assert.equal(await db.acquisitionProcessingJob.count({where:{runId:s.runId,stage:CANONICAL,status:"PENDING"}}),1);
  await conservation(s);console.log(JSON.stringify({event:"printing-integration-upload",photo:index,digest:p.digest}));
}
async function check(phase:Phase){
  const s=await state(),input=await spec(),expected=await descriptors(),p=s.photos.at(-1);assert(p&&s.runId&&s.sessionId);
  const jobs=await db.acquisitionProcessingJob.findMany({where:{runId:s.runId,stage:stages[phase],input:{path:["photoId"],equals:p.id}}});
  assert.equal(jobs.length,1,"Exactly one actual worker job per phase/photo");const job=jobs[0];assert.equal(job.status,"COMPLETE");assert(job.output);
  const out=job.output as unknown as Output;assert.equal((job.input as {digest:string}).digest,p.digest);
  if(phase!=="canonical")assert.equal(out.photoId,p.id);
  if(phase==="ocr"){
    assert.equal(out.native.photoDigest,p.digest);assert.equal(out.native.descriptor,expected.ocr.digest);assert.equal(out.versions.model,expected.ocr.digest);
    const lines=out.native.orientations.reduce((n,o)=>n+o.lines.length,0)+(out.native.photoText?.readings.reduce((n,r)=>n+r.text.length,0)??0);assert(lines>0,"Actual Paddle models must produce text");
  }
  if(phase==="visual"){
    assert(out.visual&&out.visualExecution);assert.equal(out.visual.photoDigest,p.digest);assert.equal(out.visual.descriptor,expected.visual.digest);
    assert.equal(out.visual.referenceCount,2);assert.equal(out.visual.candidates[0].scryfallId,p.target);assert.equal(out.visual.automaticAcceptance,false);
    assert(out.visual.geometricCandidates?.some(c=>c.scryfallId===p.target&&c.inliers>20));
    assert.equal(out.visualExecution.reused,s.photos.length===2);assert.equal(out.visualExecution.inferenceRequests,s.photos.length===2?0:1);
    if(s.photos.length===2){const first=s.photos[0].jobs.visual?.output as unknown as Output;assert.deepEqual(out.visual,first.visual);}
  }
  if(phase==="catalog"){
    assert.equal(out.sourceRecognitionJobId,p.jobs.ocr?.id);assert.equal(out.sourceVisualJobId,p.jobs.visual?.id);
    assert.deepEqual(out.native,(p.jobs.ocr!.output as unknown as Output).native);assert.deepEqual(out.visual,(p.jobs.visual!.output as unknown as Output).visual);
    assert(out.catalog);assert.equal(out.catalog.status,"RESOLVED");assert.equal(out.catalog.printingCoverage,"CHECKED");
    assert.equal(out.versions.catalog,(await loadAcquisitionRecognitionSnapshot(db)).digest);
    if(s.photos.length===2)assert.equal(out.catalog.requestsMade,0,"Repeated public queries must use actual persisted complete cache without egress");
    assert.equal(out.proposals?.automaticAcceptance,false);
  }
  if(phase==="printing"){
    assert.equal(out.sourceCatalogJobId,p.jobs.catalog?.id);assert.deepEqual(out.native,(p.jobs.catalog!.output as unknown as Output).native);
    assert.deepEqual(out.visual,(p.jobs.catalog!.output as unknown as Output).visual);assert(out.printingNative&&out.printingExecution);
    assert.equal(out.versions.printing,expected.printing.digest);assert.equal(out.versions.printingPolicy,PRINTING_POLICY_VERSION);
    assert.equal(out.printingNative.descriptor,expected.printing.digest);assert.equal(out.printingNative.photoDigest,p.digest);
    assert.equal(out.printingNative.observedStamp,"PRESENT");assert.equal(out.printingNative.automaticAcceptance,false);assert.equal(out.proposals?.automaticAcceptance,false);
    assert(out.printingNative.candidates.some(c=>c.scryfallId===p.target&&c.referenceStampState==="PRESENT"&&c.alignment.status==="ALIGNED"));
    assert(expected.printing.details);assert.equal(expected.printing.details.annotationsSha256,input.annotationsSha256);assert.deepEqual(expected.printing.details.symbolAssets,input.symbolAssets);
    assert.equal(expected.printing.details.indexSha256,input.indexSha256);
    assert.equal(out.printingExecution.reused,s.photos.length===2);assert.equal(out.printingExecution.inferenceRequests,s.photos.length===2?0:1);
    if(s.photos.length===2){const first=s.photos[0].jobs.printing!.output as unknown as Output;assert.deepEqual(out.printingNative,first.printingNative);assert.equal(out.printingExecution.observationJobId,s.photos[0].jobs.printing!.id);}
    const view=await getAcquisitionCardReview(db,{userId:s.userId,adminMode:false},s.sessionId,p.id);
    assert.equal(view.printingStatus,"COMPLETE");assert.equal(view.review,null);assert.equal(view.evidence?.printing?.observedStamp,"PRESENT");
  }
  p.jobs[phase]={id:job.id,input:job.input,output:job.output,status:job.status};await save(s);await conservation(s);
  console.log(JSON.stringify({event:"printing-integration-checked",photo:s.photos.length-1,phase,job:job.id,
    native:phase==="ocr"?out.native.descriptor:phase==="visual"?out.visual?.descriptor:phase==="printing"?out.printingNative?.descriptor:undefined,
    reused:phase==="visual"?out.visualExecution?.reused:phase==="printing"?out.printingExecution?.reused:undefined,
    publicRequests:out.catalog?.requestsMade,stamp:out.printingNative?.observedStamp}));
}
async function late(){
  const s=await state(),expected=await descriptors(),p=s.photos.at(-1);assert(p&&s.sessionId&&s.photos.length===3&&p.jobs.catalog);
  const program="/app/tools/acquisition-runtime/printing_worker.py";
  const generation=new AcquisitionNativeGeneration<Descriptor>(async()=>await runAcquisitionNativeProcess("python",[program,"--describe"],Buffer.alloc(0),AbortSignal.timeout(30000)) as Descriptor,
    descriptor=>new AcquisitionNativeStream("python",[program,"--stream","--manifest",descriptor.manifest],10*1024*1024+65536),()=>{});
  let failed=false,primary:unknown,observed=false,requests=0;
  try{
    assert.equal(await generation.refresh(true),true);const current=generation.current;assert(current);assert.equal(current.descriptor.digest,expected.printing.digest);
    assert.equal(await enqueueReadyPrinting(db,current.descriptor.digest),1);
    const result=await runAcquisitionJobsOnce(db,{[PRINTING_STAGE]:async(job,signal)=>{
      assert.equal((job.input as {photoId:string}).photoId,p.id);
      const output=await observeAcquisitionPrinting(db,job,signal,current.descriptor.digest,{request:(frame,requestSignal)=>{requests++;return current.native.request(frame,requestSignal);}});
      const raw=output as unknown as Output;assert(raw.printingNative);assert.equal(raw.printingNative.observedStamp,"PRESENT");assert.equal(raw.printingNative.photoDigest,p.digest);
      const actor={userId:s.userId,adminMode:false},view=await getAcquisitionCardReview(db,actor,s.sessionId!,p.id);
      await saveAcquisitionReview(db,actor,s.sessionId!,{action:"accept",photoId:p.id,revision:view.revision,
        decision:{cardId:p.target,language:"en",finish:"NONFOIL",condition:"NM"}});
      const human=await getAcquisitionCardReview(db,actor,s.sessionId!,p.id);
      s.late={jobId:job.id,output:json(output),review:json(human.review),requests};await save(s);observed=true;return output;
    }},s.owner+"-late",{timeoutMs:120000,leaseMs:180000});
    assert.deepEqual(result,{claimed:1,complete:0,failed:0,superseded:1});assert(observed&&s.late);assert.equal(requests,1);
    assert.deepEqual(json((await getAcquisitionCardReview(db,{userId:s.userId,adminMode:false},s.sessionId,p.id)).review),s.late.review);
    const job=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:s.late.jobId}});assert.equal(job.status,"SUPERSEDED");assert.equal(job.output,null);
    await conservation(s);console.log(JSON.stringify({event:"printing-integration-late",nativeRequests:requests,status:job.status,humanPreserved:true}));
  }catch(error){failed=true;primary=error;}
  try{await generation.shutdown();}catch(error){throw new AggregateError([...(failed?[primary]:[]),error],"Printing fixture and native shutdown failed");}
  if(failed)throw primary;
}
async function finish(){
  const s=await state();assert.equal(s.photos.length,3);assert(s.late);await conservation(s);
  assert.equal(await db.acquisitionPhoto.count({where:{runId:s.runId}}),3);assert.equal(await db.acquisitionCandidate.count({where:{runId:s.runId}}),3);
  assert.equal(await db.acquisitionProcessingJob.count({where:{runId:s.runId}}),15,"Five real stages for each physical photo");
  assert.equal(await db.acquisitionProcessingJob.count({where:{runId:s.runId,status:"COMPLETE"}}),14);
  assert.equal(await db.acquisitionProcessingJob.count({where:{runId:s.runId,status:"SUPERSEDED"}}),1);
  s.publicCards=json(await db.card.findMany({orderBy:{id:"asc"}}));s.publicLookups=json(await db.acquisitionCatalogLookup.findMany({orderBy:{key:"asc"}}));
  s.finished=true;await save(s);console.log(JSON.stringify({event:"printing-integration-finished",physicalPhotos:3,completeStages:14,supersededLateStage:1,originalInputsExact:true,inventoryQuantity:2,commits:0}));
}
async function cleanup(){
  assert.equal(process.env.MTG_PRINTING_FIXTURE_CHILDREN_TERMINAL,"1","Host must verify every actual worker container terminal before cleanup");
  const s=await state(),failures:unknown[]=[];
  // Recover even a setup/journal interruption by the exact synthetic owner.
  const sessions=await db.acquisitionSession.findMany({where:{ownerPlayerId:s.owner,createdByUserId:s.userId},include:{run:true}});
  const runs=sessions.flatMap(v=>v.run?[v.run.id]:[]),photos=await db.acquisitionPhoto.findMany({where:{runId:{in:runs}}});
  for(const p of photos)try{await removeAcquisitionPhotoBytes(p.id);}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,"Preserve failed private file cleanup before deleting fixture rows");
  const where={runId:{in:runs}};
  await db.acquisitionCommitMember.deleteMany({where});await db.acquisitionCommit.deleteMany({where});await db.acquisitionProcessingJob.deleteMany({where});await db.acquisitionCommand.deleteMany({where});await db.acquisitionPhoto.deleteMany({where});await db.acquisitionCaptureSlot.deleteMany({where});await db.acquisitionCountCorrection.deleteMany({where});await db.acquisitionObservation.deleteMany({where});await db.acquisitionEvent.deleteMany({where});await db.acquisitionCandidate.deleteMany({where});await db.acquisitionArtifact.deleteMany({where});await db.acquisitionRun.deleteMany({where:{id:{in:runs}}});
  await db.acquisitionSession.deleteMany({where:{id:{in:sessions.map(v=>v.id)}}});
  const owned={ownerPlayerId:s.owner};await db.correctionRetentionPin.deleteMany({where:owned});await db.correctionCaptureOutbox.deleteMany({where:{blob:owned}});await db.correctionExample.deleteMany({where:owned});await db.correctionReviewEvent.deleteMany({where:owned});await db.correctionEvidence.deleteMany({where:owned});await db.correctionLibraryAccess.deleteMany({where:owned});await db.correctionBlob.deleteMany({where:owned});await db.correctionDeletionTombstone.deleteMany({where:owned});await db.correctionLibraryAccount.deleteMany({where:owned});
  await db.inventoryItem.deleteMany({where:{id:s.stockId,currentOwnerId:s.owner}});await db.inventoryLocation.deleteMany({where:{id:s.locationId}});await db.user.deleteMany({where:{id:s.userId}});await db.player.deleteMany({where:{id:s.owner}});
  // Setup proved these application tables empty in this exclusive disposable
  // database; standard LocationType seeds/migrations are never removed.
  const lookups=await db.acquisitionCatalogLookup.findMany({select:{key:true}}),cards=await db.card.findMany({select:{id:true}});
  await db.acquisitionCatalogLookup.deleteMany({where:{key:{in:lookups.map(v=>v.key)}}});await db.card.deleteMany({where:{id:{in:cards.map(v=>v.id)}}});
  const after=await fingerprints();assert.deepEqual(after,s.baseline,"Restore all original public-table rows including migrations");
  s.cleaned=true;await save(s);console.log(JSON.stringify({event:"printing-integration-cleanup",rowsRestored:true,restoredTables:Object.keys(after).length,finished:s.finished===true}));
}
async function main(){
  const [action]=process.argv.slice(2);let failed=false,primary:unknown;
  try{
    if(action==="setup")await setup();else if(/^upload:[012]$/.test(action??""))await upload(Number(action.split(":")[1]));
    else if(action?.startsWith("check:")&&Object.hasOwn(stages,action.slice(6)))await check(action.slice(6) as Phase);
    else if(action==="late")await late();else if(action==="finish")await finish();else if(action==="cleanup")await cleanup();
    else throw new Error("Use setup, upload:0/1/2, check:canonical/ocr/visual/catalog/printing, late, finish or cleanup");
  }catch(error){failed=true;primary=error;}
  try{await db.$disconnect();}catch(error){throw new AggregateError([...(failed?[primary]:[]),error],"Printing fixture/disconnect failed");}
  if(failed)throw primary;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
