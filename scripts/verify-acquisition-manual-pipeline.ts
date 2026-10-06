import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {Prisma, type PrismaClient} from "@prisma/client";
import {claimFixtureJobs} from "./acquisition-verification-queue";
import {completeAcquisitionJob, type ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {enqueueReadyRecognition, loadAcquisitionRecognitionSnapshot, recognizeAcquisitionPhoto, RECOGNITION_STAGE} from "../lib/acquisition-recognition-worker";
import {enqueueReadyVisual, retrieveAcquisitionVisual} from "../lib/acquisition-visual-worker";
import {enqueueCatalogReconciliation, createCatalogReconciliationHandler} from "../lib/acquisition-catalog-reconciliation";
import {enqueueReadyPrinting, observeAcquisitionPrinting} from "../lib/acquisition-printing-worker";
import {CATALOG_RECONCILIATION_STAGE} from "../lib/acquisition-catalog-status";
import {VISUAL_STAGE} from "../lib/acquisition-visual";
import {PRINTING_STAGE} from "../lib/acquisition-printing";
import {getAcquisitionCardReview, saveAcquisitionReview, type AcquisitionActor} from "../lib/acquisition-store";
import type {AcquisitionNativeStream} from "../lib/acquisition-native-stream";
import type {AcquisitionManualRegion} from "../lib/acquisition-manual-region";

// Actual SQL admission, claims, transport, catalog and publication. Native
// outputs are explicitly synthetic; geometry/accuracy have separate checks.
export async function verifyAcquisitionManualPipeline(db: PrismaClient, actor: AcquisitionActor,
  sessionId: string, photoId: string, candidateId: string, card: {name: string; scryfallId: string}, bytes: Buffer) {
  const model = createHash("sha256").update(randomUUID()).digest("hex");
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: photoId}});
  const snapshot = await loadAcquisitionRecognitionSnapshot(db);
  const reviewed = structuredClone((await getAcquisitionCardReview(db, actor, sessionId, photoId)).review);
  const claim = async (stage: string) => {
    const [job] = await claimFixtureJobs(db, {workerId: "manual-region-fixture", stages: [stage]}, {candidateId});
    assert(job, `explicit repair must admit ${stage}`); assert.equal(job.candidateId, candidateId); return job;
  };
  const canonical = await claim("photo-canonical-v1");
  assert.equal(await completeAcquisitionJob(db, canonical, {fixtureCanonical: true}), "COMPLETE");
  let nativeRequests = 0;
  function photoFrame(frame: Buffer, region: AcquisitionManualRegion | null) {
    if (region === null && frame.equals(bytes)) return;
    const length = frame.readUInt32BE();
    assert.deepEqual(JSON.parse(frame.subarray(4,4+length).toString()), {inputKind: "PHOTO", ...(region ? {manualRegion: region} : {})});
    assert.deepEqual(frame.subarray(4+length), bytes, "worker retains exact source bytes");
  }
  function geometry(region: AcquisitionManualRegion | null) {
    return {status: "PROPOSED", method: region ? "manual-card-region-v1" : "full-frame",
      quad: [[0,0],[99,0],[99,139],[0,139]], ...(region ? {manualRegion: region, boundaryVerified: false} : {})};
  }
  const recognition = async (job: ClaimedAcquisitionJob, region: AcquisitionManualRegion | null) => {
    const worker = {request: async (frame: Buffer) => {
      nativeRequests++; photoFrame(frame, region);
      const text = {title: [card.name], footer: ["rfx 1 en"]};
      return {version: 1, descriptor: model, descriptorDetails: {}, photoDigest: photo.digest,
        text, geometry: geometry(region), orientations: [{rotationDegrees: 0,text,lines: []},
          {rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],
        lines: [], milliseconds: 1, automaticAcceptance: false};
    }} as unknown as AcquisitionNativeStream;
    const output = await recognizeAcquisitionPhoto(job, AbortSignal.timeout(30000), snapshot, model, worker);
    assert.equal(nativeRequests, 1, "selected region never requests whole-photo text fallback");
    nativeRequests = 0;
    return output;
  };
  const enqueueRaw = async () => {
    await Promise.all([enqueueReadyRecognition(db, snapshot.digest, model), enqueueReadyRecognition(db, snapshot.digest, model)]);
    const revision = (await getAcquisitionCardReview(db,actor,sessionId,photoId)).revision;
    assert.equal(await db.acquisitionProcessingJob.count({where: {candidateId, stage: RECOGNITION_STAGE,
      candidateRevision: revision, versionKey: {not: "ordinary-review-fixture"}}}), 1);
  };
  const start = await getAcquisitionCardReview(db, actor, sessionId, photoId);
  const ordinary = await db.acquisitionProcessingJob.create({data: {runId: canonical.runId,
    artifactId: canonical.artifactId, candidateId, candidateRevision: start.revision,
    stage: RECOGNITION_STAGE, versionKey: "ordinary-review-fixture", input: {photoId, digest: photo.digest}}});
  await enqueueRaw();
  const obsolete = await claim(RECOGNITION_STAGE);
  assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:ordinary.id}})).status, "SUPERSEDED",
    "reviewed cards do not gain general refresh authority");
  const oldOutput = await recognition(obsolete, start.manualRegion ?? null);
  const nextRegion: AcquisitionManualRegion = {version: 1, quad: [[.08,.08],[.92,.08],[.92,.92],[.08,.92]]};
  await saveAcquisitionReview(db,actor,sessionId,{action:"region",photoId,revision:start.revision,requestKey:randomUUID(),region:nextRegion});
  assert.equal(await completeAcquisitionJob(db,obsolete,oldOutput), "SUPERSEDED", "late old-crop work cannot publish");
  const waiting = await getAcquisitionCardReview(db,actor,sessionId,photoId);
  assert.equal(waiting.evidence,null); assert.deepEqual(waiting.review,reviewed);

  async function pipeline(region: AcquisitionManualRegion | null, expectReuse: boolean) {
    await enqueueRaw();
    const raw = await claim(RECOGNITION_STAGE), rawOutput = await recognition(raw,region);
    assert.equal(await completeAcquisitionJob(db,raw,rawOutput),"COMPLETE");
    await enqueueReadyVisual(db,model);
    const visualJob = await claim(VISUAL_STAGE);
    let visualRequests=0;
    const visual = await retrieveAcquisitionVisual(db,visualJob,AbortSignal.timeout(30000),model,{request:async frame=>{
      visualRequests++; photoFrame(frame,region);
      return {version:1,descriptor:model,photoDigest:photo.digest,referenceCount:1,unavailableCount:0,
        geometry:geometry(region),inputRegion:"CARD",candidates:[],milliseconds:1,automaticAcceptance:false};
    }});
    assert.equal(visualRequests,expectReuse?0:1);
    assert.equal(await completeAcquisitionJob(db,visualJob,visual),"COMPLETE");
    await enqueueCatalogReconciliation(db,new Date(),true);
    const catalogJob = await claim(CATALOG_RECONCILIATION_STAGE);
    const handler=createCatalogReconciliationHandler(db,async()=>({status:"NOT_FOUND",cards:[],requestsMade:0,
      printingCoverage:"UNRESOLVED",cacheHit:true,lookupKey:"manual-fixture"}));
    const catalog=await handler(catalogJob,AbortSignal.timeout(30000));
    assert.equal(await completeAcquisitionJob(db,catalogJob,catalog),"COMPLETE");
    await enqueueReadyPrinting(db,model);
    const printingJob=await claim(PRINTING_STAGE);
    let printingRequests=0;
    const printing=await observeAcquisitionPrinting(db,printingJob,AbortSignal.timeout(30000),model,{request:async frame=>{
      printingRequests++; const length=frame.readUInt32BE(), metadata=JSON.parse(frame.subarray(4,4+length).toString());
      assert.deepEqual(metadata.manualRegion ?? null,region); assert.deepEqual(frame.subarray(4+length),bytes);
      return {version:"registered-printing-runtime-v1",descriptor:model,photoDigest:photo.digest,milliseconds:1,
        ...(region?{manualRegion:region}:{}),observedStamp:"UNREADABLE",conflictingObservations:false,
        automaticAcceptance:false,candidates:[]};
    }});
    assert.equal(printingRequests,expectReuse?0:1);
    assert.equal(await completeAcquisitionJob(db,printingJob,printing),"COMPLETE");
    const current=await getAcquisitionCardReview(db,actor,sessionId,photoId);
    assert.deepEqual(current.review,reviewed); assert.deepEqual(current.manualRegion,region);
    assert.equal(current.printingStatus,"COMPLETE"); assert(current.evidence,"selected geometry reaches review evidence");
    assert.equal(current.evidence.geometry.method,region?"manual-card-region-v1":"full-frame");
    return current;
  }
  let current=await pipeline(nextRegion,false);
  await saveAcquisitionReview(db,actor,sessionId,{action:"region",photoId,revision:current.revision,requestKey:randomUUID(),region:nextRegion});
  current=await pipeline(nextRegion,true);
  await saveAcquisitionReview(db,actor,sessionId,{action:"region",photoId,revision:current.revision,requestKey:randomUUID(),region:null});
  current=await pipeline(null,false);
  // A later human review closes the explicit reviewed-analysis permission.
  await saveAcquisitionReview(db,actor,sessionId,{action:"accept",photoId,revision:current.revision,decision:{
    cardId:reviewed!.cardId,finish:reviewed!.finish,condition:reviewed!.condition,language:reviewed!.language}});
  await enqueueReadyVisual(db,model);
  assert.equal(await db.acquisitionProcessingJob.count({where:{candidateId,stage:VISUAL_STAGE,
    candidateRevision:current.revision+1}}),0);
  console.log("PASS: reviewed manual/reset pipeline, original transport, late-crop fence, crop-specific reuse, evidence projection and later-human-review fence");
}
