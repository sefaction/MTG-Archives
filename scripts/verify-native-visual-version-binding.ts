/** Opt-in actual CPU visual model/index integration, never optical accuracy. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import {PrismaClient} from "@prisma/client";
import {AcquisitionNativeGeneration} from "../lib/acquisition-native-generation";
import {AcquisitionNativeStream} from "../lib/acquisition-native-stream";
import {runAcquisitionNativeProcess} from "../lib/acquisition-native-process";
import {canonicalizeAcquisitionPhoto, inspectAcquisitionPhoto, readAcquisitionPhotoBytes, writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {beginAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand, finalizeAcquisitionPhoto,
  getAcquisitionCardReview, reserveAcquisitionCaptureSlot, saveAcquisitionReview} from "../lib/acquisition-store";
import {claimAcquisitionJobs, completeAcquisitionJob, runAcquisitionJobsOnce, type ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {enqueueReadyVisual, retrieveAcquisitionVisual} from "../lib/acquisition-visual-worker";
import {VISUAL_STAGE, type VisualObservation} from "../lib/acquisition-visual";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";

type Descriptor={digest:string;manifest:string;execution:string;indexSha256:string;catalogSha256:string;
  referenceCount:number;unavailableCount:number;codeSha256:string;encoder:Record<string,string>};
type VisualOutput={photoId:string;visual:VisualObservation;visualReuse:{key:string;descriptor:string;photoDigest:string};
  visualExecution:{reused:boolean;inferenceRequests:number;observationJobId?:string}};
type Fixture={cards:{id:string;name:string;set:string;collector_number:string;lang:string;digital:boolean}[];
  partial:{sha256:string;manifest:{downloadComplete:boolean}};a:{sha256:string;manifest:{source:{catalogSha256:string}}};
  b:{sha256:string;manifest:{source:{catalogSha256:string}}};encoder:Record<string,string>;
  partialRefused:boolean;damagedModelRefused:boolean;queries:string[]};
const url=new URL(process.env.DATABASE_URL??"http://invalid");
assert(process.platform==="linux"&&process.getuid?.()===0,"Canonical isolated Linux worker only");
assert.equal(process.env.MTG_NATIVE_VISUAL_VERSION_FIXTURE,"1");
assert.equal(url.hostname,"nativevisual304-pg");assert.equal(url.pathname,"/acquisition_native_visual304");
const db=new PrismaClient(),tag="native-visual-"+randomUUID(),owner=tag+"-owner",userId=tag+"-user",locationId=tag+"-box",stockId=tag+"-stock";
const actor={userId,adminMode:false},program="/app/tools/acquisition-runtime/visual.py";
const events:{event:string;digest?:string}[]=[];
const generation=new AcquisitionNativeGeneration<Descriptor>(
  async()=>await runAcquisitionNativeProcess("python",[program,"--describe"],Buffer.alloc(0),AbortSignal.timeout(30000)) as Descriptor,
  descriptor=>new AcquisitionNativeStream("python",[program,"--stream","--manifest",descriptor.manifest]),
  (event,descriptor)=>events.push({event,digest:descriptor?.digest}));
const report:Record<string,unknown>={version:1,scope:"actual visual input/model/index/output binding; complete synthetic fixture, not installation/full-catalogue/held-out accuracy"};
let root:string|undefined,sessionId:string|undefined,runId:string|undefined;
let baseline:Record<string,{rows:number;digest:string}>|undefined;
const originals=new Map<string,Buffer>(),initialInputs=new Map<string,unknown>(),cardIds:string[]=[];
const previousUploads=process.env.UPLOADS_DATA_PATH;
function hash(bytes:Buffer){return createHash("sha256").update(bytes).digest("hex");}
function currentGeneration(){const current=generation.current;assert(current,"Verified native generation required");return current;}
function activate(name:"a"|"b"){
  execFileSync("python",["/app/scripts/prepare-native-visual-binding.py","--activate",name],
    {env:{PATH:process.env.PATH,NODE_ENV:"production",MTG_NATIVE_VISUAL_VERSION_FIXTURE:"1"},timeout:30000});
}
async function fingerprints(){
  const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result:Record<string,{rows:number;digest:string}>={};
  for(const {tablename} of tables){const quoted='"'+tablename.replaceAll('"','""')+'"';
    const [row]=await db.$queryRawUnsafe<{rows:number;digest:string}[]>(`SELECT count(*)::int rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM ${quoted} t`);result[tablename]=row;}
  return result;
}
async function run(){
  assert.equal(await db.user.count(),0);assert.equal(await db.card.count(),0);
  assert.equal(await db.inventoryItem.count(),0);assert.equal(await db.acquisitionSession.count(),0);
  baseline=await fingerprints();
  const fixture=JSON.parse(await readFile("/visual/fixture.json","utf8")) as Fixture;
  assert.equal(fixture.cards.length,6);assert.equal(fixture.cards.filter(c=>!c.digital).length,5);
  assert.equal(fixture.partialRefused,true);assert.equal(fixture.damagedModelRefused,true);
  assert.equal(fixture.partial.manifest.downloadComplete,false);
  assert.equal(hash(await readFile("/visual/index/index.json")),fixture.partial.sha256);
  assert.equal(await generation.refresh(true),false,"production generation refuses actual partial producer publication");
  assert.equal(generation.current,null);assert.deepEqual(events,[{event:"unavailable",digest:undefined}]);
  activate("a");assert.equal(await generation.refresh(true),true);
  const {descriptor:a,native:nativeA}=currentGeneration();
  assert.equal(a.execution,"CPU");assert.equal(a.indexSha256,fixture.a.sha256);
  assert.equal(a.catalogSha256,fixture.a.manifest.source.catalogSha256);
  assert.equal(a.referenceCount,6);assert.equal(a.unavailableCount,0);
  assert.deepEqual(a.encoder,fixture.encoder);assert.equal(a.encoder.name,"vgg16");
  assert.equal(a.encoder.weightsSha256,"397923af8e79cdbb6a7127f12361acd7a2f83e06b05044ddf496e83de57a5bf0");
  assert.equal(a.codeSha256,hash(await readFile(program)));
  assert.equal(a.encoder.encoderSha256,hash(await readFile("/eval/image_encoder.py")));
  await mkdir("/app/.local-data",{recursive:true});root=await mkdtemp("/app/.local-data/native-visual-");process.env.UPLOADS_DATA_PATH=root;
  await db.player.create({data:{id:owner,name:owner,displayName:owner}});
  await db.user.create({data:{id:userId,username:userId,displayName:userId,playerId:owner,passwordHash:"not-a-login-hash"}});
  await db.$transaction(tx=>ensureCorrectionAccount(tx,owner));
  await db.correctionLibraryAccount.update({where:{ownerPlayerId:owner},data:{sampleBasisPoints:0}});
  await db.inventoryLocation.create({data:{id:locationId,ownerPlayerId:owner,name:"Visual fixture",normalizedName:tag,type:"Box"}});
  cardIds.push(...fixture.cards.map(c=>c.id));
  await db.card.createMany({data:fixture.cards.map(c=>({id:c.id,scryfallId:c.id,name:c.name,typeLine:"Artifact",setCode:c.set,
    collectorNumber:c.collector_number,rarity:"common",lang:c.lang,digital:c.digital}))});
  await db.inventoryItem.create({data:{id:stockId,currentOwnerId:owner,cardId:cardIds[0],quantity:2,condition:"NM",locationId,locationSection:"untouched"}});
  const stock=await db.inventoryItem.findMany(),audits=await db.inventoryAuditLog.findMany();
  const created=await createAcquisitionSession(db,actor,{requestKey:randomUUID(),ownerPlayerId:owner,locationId,section:"A",policy:{kind:"MANUAL",quantity:3},
    run:{providerId:"phone-photo-v1",runId:randomUUID(),enforcement:"LOGICAL_ALLOCATION",controls:["STOP","CANCEL"]}});
  sessionId=created.session.id;await executeAcquisitionCommand(db,actor,sessionId,{requestKey:randomUUID(),revision:0,command:"START"});
  let requests=0;
  const transport=(native:Pick<AcquisitionNativeStream,"request">)=>({request:(frame:Buffer,signal:AbortSignal)=>{
    requests++;assert([...originals.values()].some(bytes=>frame.subarray(-bytes.length).equals(bytes)),"native frame retains actual original bytes");
    return native.request(frame,signal);
  }});
  async function upload(bytes:Buffer,model:string){
    const {slot}=await reserveAcquisitionCaptureSlot(db,actor,sessionId!,randomUUID());
    const photo=await beginAcquisitionPhoto(db,actor,sessionId!,{slotId:slot.id,uploadKey:randomUUID(),generation:0,metadata:await inspectAcquisitionPhoto(bytes,"image/jpeg"),inputKind:"PHOTO"});
    runId=photo.runId;originals.set(photo.id,bytes);await writeAcquisitionPhotoBytes(photo.id,bytes,"raw",photo.digest);await finalizeAcquisitionPhoto(db,actor,sessionId!,photo.id);
    assert.equal((await runAcquisitionJobsOnce(db,{"photo-canonical-v1":(job,signal)=>canonicalizeAcquisitionPhoto((job.input as {photoId:string}).photoId,(job.input as {digest:string}).digest,signal)},tag+"-canonical")).complete,1);
    assert.equal(await enqueueReadyVisual(db,model),1);
    const job=await db.acquisitionProcessingJob.findFirstOrThrow({where:{runId,stage:VISUAL_STAGE,input:{path:["photoId"],equals:photo.id}}});
    assert.equal(job.versionKey,hash(Buffer.from(`${VISUAL_STAGE}:${model}`)));
    assert.deepEqual(job.input,{photoId:photo.id,digest:photo.digest,model,manualAnalysis:null});initialInputs.set(job.id,job.input);
    return {photo,job};
  }
  function check(output:VisualOutput,photoId:string,descriptor:Descriptor){
    assert.equal(output.photoId,photoId);assert.equal(output.visual.photoDigest,hash(originals.get(photoId)!));
    assert.equal(output.visual.descriptor,descriptor.digest);assert.equal(output.visualReuse.descriptor,descriptor.digest);
    assert.equal(output.visualReuse.photoDigest,output.visual.photoDigest);assert.equal(output.visual.automaticAcceptance,false);
    assert.equal(output.visual.referenceCount,6);assert.equal(output.visual.unavailableCount,0);
    assert.deepEqual(new Set(output.visual.candidates.map(c=>c.scryfallId)),new Set(fixture.cards.filter(c=>!c.digital).map(c=>c.id)));
    assert(output.visual.geometricCandidates);assert.equal(output.visual.geometricCandidates.length,5);
    assert(output.visual.geometricCandidates.some(c=>c.inliers>20),"real SIFT/homography produces image evidence");
  }
  const bytes=await readFile(fixture.queries[0]),first=await upload(bytes,a.digest);
  let firstOutput:VisualOutput|undefined;
  assert.equal((await runAcquisitionJobsOnce(db,{[VISUAL_STAGE]:async(job,signal)=>{
    assert.equal(job.id,first.job.id);const out=await retrieveAcquisitionVisual(db,job,signal,a.digest,transport(nativeA));firstOutput=out as unknown as VisualOutput;return out;
  }},tag+"-first",{timeoutMs:120000,leaseMs:180000})).complete,1);
  assert(firstOutput);check(firstOutput,first.photo.id,a);assert.equal(firstOutput.visualExecution.reused,false);assert.equal(requests,1);
  assert.equal(firstOutput.visual.candidates[0].scryfallId,cardIds[0]);
  assert.equal(firstOutput.visual.geometricCandidates![0].scryfallId,cardIds[0]);
  assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:first.job.id}})).output,
    JSON.parse(JSON.stringify(firstOutput)),"persist every JSON output field; undefined optional properties have no JSON representation");
  const second=await upload(bytes,a.digest);assert.notEqual(first.photo.id,second.photo.id);assert.notEqual(first.job.id,second.job.id);
  let reused:VisualOutput|undefined;
  assert.equal((await runAcquisitionJobsOnce(db,{[VISUAL_STAGE]:async(job,signal)=>{
    assert.equal(job.id,second.job.id);const out=await retrieveAcquisitionVisual(db,job,signal,a.digest,transport(nativeA));reused=out as unknown as VisualOutput;return out;
  }},tag+"-reuse",{timeoutMs:120000,leaseMs:180000})).complete,1);
  assert(reused);check(reused,second.photo.id,a);assert.deepEqual(reused.visual,firstOutput.visual);
  assert.equal(reused.visualExecution.reused,true);assert.equal(reused.visualExecution.inferenceRequests,0);
  assert.equal(reused.visualExecution.observationJobId,first.job.id);assert.equal(requests,1);
  const third=await upload(await readFile(fixture.queries[1]),a.digest);
  const [late]=await claimAcquisitionJobs(db,{workerId:tag+"-late",stages:[VISUAL_STAGE],leaseMs:180000});assert(late);assert.equal(late.id,third.job.id);
  const lateOutput=await retrieveAcquisitionVisual(db,late,AbortSignal.timeout(120000),a.digest,transport(nativeA));
  check(lateOutput as unknown as VisualOutput,third.photo.id,a);assert.equal(requests,2);
  assert.equal((lateOutput as unknown as VisualOutput).visual.candidates[0].scryfallId,cardIds[1]);
  const review=await getAcquisitionCardReview(db,actor,sessionId,third.photo.id);
  await saveAcquisitionReview(db,actor,sessionId,{action:"accept",photoId:third.photo.id,revision:review.revision,
    decision:{cardId:cardIds[1],language:"en",finish:"NONFOIL",condition:"NM"}});
  const human=await getAcquisitionCardReview(db,actor,sessionId,third.photo.id);
  assert.equal(await completeAcquisitionJob(db,late,lateOutput),"SUPERSEDED");
  assert.deepEqual((await getAcquisitionCardReview(db,actor,sessionId,third.photo.id)).review,human.review);
  assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:late.id}})).output,null);

  activate("b");
  const b=await runAcquisitionNativeProcess("python",[program,"--describe"],Buffer.alloc(0),AbortSignal.timeout(30000)) as Descriptor;
  assert.notEqual(b.digest,a.digest);assert.equal(b.indexSha256,fixture.b.sha256);assert.equal(b.catalogSha256,fixture.b.manifest.source.catalogSha256);
  assert.deepEqual(b.encoder,a.encoder);assert.equal(b.referenceCount,a.referenceCount);
  assert.equal(await enqueueReadyVisual(db,b.digest),2,"reviewed third photo is not re-enqueued");
  const refusal={admission:false,returnedDescriptor:false},beforeMismatch=requests;
  let mismatchId:string|undefined;
  const mismatch=await runAcquisitionJobsOnce(db,{[VISUAL_STAGE]:async(job,signal)=>{
    mismatchId=job.id;
    await assert.rejects(retrieveAcquisitionVisual(db,job,signal,a.digest,transport(nativeA)),/Visual index version superseded/);
    assert.equal(requests,beforeMismatch);refusal.admission=true;
    await assert.rejects(retrieveAcquisitionVisual(db,job,signal,b.digest,transport(nativeA)),/Visual processing identity changed/);
    assert.equal(requests,beforeMismatch+1);refusal.returnedDescriptor=true;
    throw new Error("Expected actual old-generation native output refusal");
  }},tag+"-mismatch",{timeoutMs:120000,leaseMs:180000});
  assert.equal(mismatch.failed,1);assert.deepEqual(refusal,{admission:true,returnedDescriptor:true});assert(mismatchId);
  const refused=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:mismatchId}});
  assert.equal(refused.status,"PENDING");assert.equal(refused.errorCode,"PROCESSING_FAILED");assert.equal(refused.output,null);
  assert.equal(await generation.refresh(true),true,"actual generation closes old native before changing descriptor");
  const currentB=currentGeneration();assert.deepEqual(currentB.descriptor,b);
  let finalOutput:VisualOutput|undefined;
  assert.equal((await runAcquisitionJobsOnce(db,{[VISUAL_STAGE]:async(job,signal)=>{
    const out=await retrieveAcquisitionVisual(db,job,signal,b.digest,transport(currentB.native));finalOutput=out as unknown as VisualOutput;return out;
  }},tag+"-generation-b",{timeoutMs:120000,leaseMs:180000})).complete,1);
  assert(finalOutput);check(finalOutput,finalOutput.photoId,b);assert.equal(finalOutput.visualExecution.reused,false);
  assert.equal(requests,4);assert.equal(finalOutput.visual.candidates.find(c=>c.scryfallId===cardIds[3])?.name,"Synthetic revised metadata");
  for(const [id,input] of initialInputs)assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id}})).input,input);
  for(const [id,original] of originals)assert.deepEqual(await readAcquisitionPhotoBytes(id,"raw",hash(original)),original);
  assert.deepEqual(await db.inventoryItem.findMany(),stock);assert.deepEqual(await db.inventoryAuditLog.findMany(),audits);assert.equal(await db.acquisitionCommit.count(),0);
  assert.deepEqual(events.map(e=>e.event),["unavailable","ready","ready"]);
  report.binding={descriptorA:a,descriptorB:b,originalPhotos:originals.size,referenceCount:6,sourceRecords:6,paperCards:5};
  report.controls={actualNativeRequests:requests,durableReuse:true,partialRefused:true,damagedModelRefused:true,
    humanFence:"SUPERSEDED",refusal,indexGenerationRefresh:true,inventoryQuantity:2,commits:0,events};
}
async function cleanupRows(){
  if(runId){const where={runId};await db.acquisitionCommitMember.deleteMany({where});await db.acquisitionCommit.deleteMany({where});await db.acquisitionProcessingJob.deleteMany({where});await db.acquisitionCommand.deleteMany({where});await db.acquisitionPhoto.deleteMany({where});await db.acquisitionCaptureSlot.deleteMany({where});await db.acquisitionCountCorrection.deleteMany({where});await db.acquisitionObservation.deleteMany({where});await db.acquisitionEvent.deleteMany({where});await db.acquisitionCandidate.deleteMany({where});await db.acquisitionArtifact.deleteMany({where});await db.acquisitionRun.deleteMany({where:{id:runId}});}
  if(sessionId)await db.acquisitionSession.deleteMany({where:{id:sessionId}});
  const owned={ownerPlayerId:owner};await db.correctionRetentionPin.deleteMany({where:owned});await db.correctionCaptureOutbox.deleteMany({where:{blob:owned}});await db.correctionExample.deleteMany({where:owned});await db.correctionReviewEvent.deleteMany({where:owned});await db.correctionEvidence.deleteMany({where:owned});await db.correctionLibraryAccess.deleteMany({where:owned});await db.correctionBlob.deleteMany({where:owned});await db.correctionDeletionTombstone.deleteMany({where:owned});await db.correctionLibraryAccount.deleteMany({where:owned});
  await db.inventoryItem.deleteMany({where:{id:stockId,currentOwnerId:owner}});await db.inventoryLocation.deleteMany({where:{id:locationId}});await db.user.deleteMany({where:{id:userId}});await db.player.deleteMany({where:{id:owner}});await db.card.deleteMany({where:{id:{in:cardIds}}});
}
async function main(){
  let failed=false,primary:unknown,nativeStopped=false,rowsRestored=false;const errors:unknown[]=[];
  try{await run();}catch(error){failed=true;primary=error;}
  try{await generation.shutdown();nativeStopped=true;}catch(error){errors.push(error);}
  if(nativeStopped){
    try{await cleanupRows();if(baseline){const after=await fingerprints();assert.deepEqual(after,baseline,"all original public table rows restored");report.restoredTables=Object.keys(after).length;}rowsRestored=true;}catch(error){errors.push(error);}
    try{if(root&&rowsRestored)await rm(root,{recursive:true,force:true});}catch(error){errors.push(error);}
  }
  if(previousUploads===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previousUploads;
  try{await db.$disconnect();}catch(error){errors.push(error);}
  console.log(JSON.stringify({event:"native-visual-fixture-cleanup",nativeStopped,rowsRestored,
    restoredTables:report.restoredTables,primaryFailed:failed,cleanupFailures:errors.length}));
  if(failed||errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],"Native visual binding qualification failed");
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
