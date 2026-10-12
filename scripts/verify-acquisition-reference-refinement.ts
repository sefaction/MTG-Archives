import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Prisma, PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, type AcquisitionActor,
  type CreateAcquisitionInput } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { admitAcquisitionReferenceRefinement, type AcquisitionReferenceVersions } from "../lib/acquisition-reference-jobs";
import { REFERENCE_REFINEMENT_STAGE, type AcquisitionReferenceLineageInput } from "../lib/acquisition-reference-lineage";
import { claimAcquisitionJobs, completeAcquisitionJob, AcquisitionJobSupersededError, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";
import { correctionHash } from "../lib/acquisition-correction-policy";
import { recognizeAcquisitionReferenceRefinement } from "../lib/acquisition-reference-worker";
import { createAcquisitionRecognitionIndex } from "../lib/acquisition-recognition";

// This verifier is called only by the existing opt-in disposable acquisition_*
// PostgreSQL runner. Synthetic native evidence tests persistence and authority,
// not recognition accuracy or the ordinary native worker/UI integration.
export async function verifyAcquisitionReferenceRefinement(db: PrismaClient,
  actor: AcquisitionActor, base: CreateAcquisitionInput) {
  await mkdir(path.resolve(".local-data"), { recursive: true });
  const root = await mkdtemp(path.resolve(".local-data/reference-db-"));
  const previousUploads = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const bytes = await sharp({ create: { width: 1180, height: 1537, channels: 3,
    background: "#334455" } }).jpeg().toBuffer();
  const metadata = await inspectAcquisitionPhoto(bytes, "image/jpeg");
  const location = await db.inventoryLocation.create({ data: { ownerPlayerId: base.ownerPlayerId,
    name: randomUUID(), normalizedName: randomUUID(), type: "Box" } });
  const capture = await createAcquisitionSession(db, actor, { ...base, requestKey: randomUUID(),
    locationId: location.id, section: "", policy: { kind: "MANUAL", quantity: 40 },
    run: { ...base.run, providerId: "phone-photo-v1", runId: randomUUID() } });
  await executeAcquisitionCommand(db, actor, capture.session.id, { requestKey: "start",
    revision: capture.revision, command: "START" });
  const versions: AcquisitionReferenceVersions = { model: "b".repeat(64), catalog: "c".repeat(64),
    referenceModel: "d".repeat(64), primaryVersion: "e".repeat(64), catalogResolver: "fixture-resolver" };
  const referenceId = randomUUID();
  const printingNative = { version: "registered-printing-runtime-v1", observedStamp: "UNREADABLE",
    conflictingObservations: false, automaticAcceptance: false, sourceSize: [1180,1537],
    candidates: [{ scryfallId: referenceId, referenceId: referenceId+":0", referenceStampState: "UNKNOWN",
      relation: "UNRESOLVED", alignment: { status: "ALIGNED", quad: [[80,60],[1079,60],[1079,1456],[80,1456]],
        inliers: 80, matches: 100, sourceCardWidth: 999, supportFraction: .7, medianReprojectionPixels: 1,
        footerVisible: true }, stamp: { status: "UNREADABLE", reason: "NO_TEMPLATES" } }] };
  let count = 0;
  async function fixture() {
    const { slot } = await reserveAcquisitionCaptureSlot(db, actor, capture.session.id, `reference-${count++}`);
    const photo = await beginAcquisitionPhoto(db, actor, capture.session.id, { slotId: slot.id,
      uploadKey: randomUUID(), generation: 0, metadata, inputKind: "CARD_SCAN" });
    await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
    await finalizeAcquisitionPhoto(db, actor, capture.session.id, photo.id);
    const canonical = await db.acquisitionProcessingJob.findFirstOrThrow({ where: {
      runId: photo.runId, artifact: { sourceId: photo.id }, stage: "photo-canonical-v1" } });
    const context = { runId: canonical.runId, artifactId: canonical.artifactId,
      candidateId: canonical.candidateId, candidateRevision: canonical.candidateRevision };
    const ids = [randomUUID(),randomUUID(),randomUUID()];
    const input = { photoId: photo.id, digest: photo.digest };
    const primaryOutput = { photoId: photo.id, native: { version:1, descriptorDetails:{},
      photoDigest: photo.digest, descriptor: versions.model,
      geometry: { status: "PROPOSED", method: "declared-card-scan" },
      text: { title: ["Island"], footer: ["002","BBB EN"] },
      orientations:[{rotationDegrees:0,text:{title:["Island"],footer:["002","BBB EN"]},lines:[]},
        {rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],lines:[],milliseconds:0,automaticAcceptance:false } };
    const catalogOutput = { photoId: photo.id, sourceRecognitionJobId: ids[0],
      versions: { catalog: versions.catalog, resolver: versions.catalogResolver } };
    const printingOutput = { ...catalogOutput, sourceCatalogJobId: ids[1], printingNative,
      versions: { ...catalogOutput.versions, printing: versions.referenceModel } };
    for (const [n, stage, jobInput, output] of [
      [0,"photo-recognition-v1",{...input,inputKind:"CARD_SCAN"},primaryOutput],
      [1,CATALOG_RECONCILIATION_STAGE,{...input,recognitionJobId:ids[0],resolverVersion:versions.catalogResolver},catalogOutput],
      [2,"photo-printing-evidence-v1",{...input,catalogJobId:ids[1],model:versions.referenceModel},printingOutput],
    ] as const) await db.$executeRaw`INSERT INTO "AcquisitionProcessingJob"
      (id,"runId","artifactId","candidateId","candidateRevision",stage,"versionKey",input,status,output,"updatedAt")
      VALUES (${ids[n]},${context.runId},${context.artifactId},${context.candidateId},${context.candidateRevision},
        ${stage},${versions.primaryVersion},${JSON.stringify(jobInput)}::jsonb,'COMPLETE',${JSON.stringify(output)}::jsonb,clock_timestamp())`;
    return { photo, slot, context, ids, primaryOutput, catalogOutput, printingOutput };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function claim(f: Fixture) {
    const job = await db.acquisitionProcessingJob.findFirstOrThrow({ where: {
      ...f.context, stage: REFERENCE_REFINEMENT_STAGE } });
    const claimed = await claimAcquisitionJobs(db, { workerId: "reference-db-guards",
      stages: [REFERENCE_REFINEMENT_STAGE], leaseMs: 90000 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, job.id);
    return claimed[0];
  }
  function result(job: ClaimedAcquisitionJob) {
    const input = job.input as unknown as AcquisitionReferenceLineageInput;
    return { photoId: input.photoId, referenceRefinement: input,
      versions:{model:input.model,catalog:input.catalog,index:input.catalog},native: {
      version: 1, descriptorDetails: {}, text: { title: [], footer: [] }, orientations: [], lines: [], milliseconds: 0,
      photoDigest: input.digest, descriptor: input.model, automaticAcceptance: false,
      geometry: { status: "PROPOSED", method: "reference-anchor-region-v1", boundaryVerified: false,
        referenceRegion: input.reference.region } },
      proposals: { status: "NO_MATCH", totalProposals: 0, truncated: false, proposals: [],
        automaticAcceptance: false, finish: "UNKNOWN", condition: "UNKNOWN" },
    } as unknown as Prisma.InputJsonObject;
  }
  const inventoryBefore = await db.inventoryItem.aggregate({ _sum: { quantity: true }, _count: { _all: true } });
  try {
    const first = await fixture();
    const primaryBefore = await db.acquisitionProcessingJob.findUniqueOrThrow({ where: { id: first.ids[0] } });
    const firstEvidence={version:1,jobId:first.ids[0],stage:primaryBefore.stage,outputHash:correctionHash(primaryBefore.output)};
    await db.acquisitionPhoto.update({where:{id:first.photo.id},data:{firstMachineEvidence:firstEvidence}});
    const admitted = await Promise.all([1,2,3,4].map(() => admitAcquisitionReferenceRefinement(db,first.ids[2],versions)));
    assert.equal(admitted.reduce((a,b)=>a+b,0),1,"concurrent admission creates one durable pass");
    let job = await claim(first);
    const input = job.input as unknown as AcquisitionReferenceLineageInput;
    const expectedQuad = printingNative.candidates[0].alignment.quad.map(([x,y]) => [x/1179,y/1536]);
    assert.deepEqual(input.reference.region.quad, expectedQuad,"coordinates survive canonical PostgreSQL JSON text exactly");
    await db.acquisitionProcessingJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
    assert.equal(await completeAcquisitionJob(db,job,result(job)),"STALE_LEASE");
    job = await claim(first);
    assert.equal(job.attempts,2,"restart/crash reclaims existing attempt, never a new job");
    assert.equal(await completeAcquisitionJob(db,job,result(job)),"COMPLETE");
    const published = await db.acquisitionProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(correctionHash(published.output),correctionHash(result(job)),"exact publication JSON round trip");
    assert.deepEqual(await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:first.ids[0]}}),primaryBefore);
    assert.deepEqual((await db.acquisitionPhoto.findUniqueOrThrow({where:{id:first.photo.id}})).firstMachineEvidence,firstEvidence);
    assert.deepEqual(await readAcquisitionPhotoBytes(first.photo.id,"raw",first.photo.digest),bytes);
    const restarted = new PrismaClient();
    try { assert.equal(await admitAcquisitionReferenceRefinement(restarted,first.ids[2],versions),0); }
    finally { await restarted.$disconnect(); }
    // A count/revision refresh and fresh parent IDs must not manufacture a new
    // lineage. Re-seed at the new revision, retaining the exact photo/model key.
    await db.acquisitionCandidate.update({where:{id:first.context.candidateId},data:{revision:{increment:1}}});
    const refreshedRevision=first.context.candidateRevision+1;
    const refreshedIds=[randomUUID(),randomUUID(),randomUUID()];
    for(let n=0;n<3;n++){
      const parent=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:first.ids[n]}});
      const refreshedInput={...(parent.input as object),...(n===1?{recognitionJobId:refreshedIds[0]}:n===2?{catalogJobId:refreshedIds[1]}:{})};
      const refreshedOutput={...(parent.output as object),...(n===1?{sourceRecognitionJobId:refreshedIds[0]}:n===2?
        {sourceRecognitionJobId:refreshedIds[0],sourceCatalogJobId:refreshedIds[1]}:{})};
      await db.$executeRaw`INSERT INTO "AcquisitionProcessingJob"
        (id,"runId","artifactId","candidateId","candidateRevision",stage,"versionKey",input,status,output,"updatedAt")
        VALUES (${refreshedIds[n]},${parent.runId},${parent.artifactId},${parent.candidateId},${refreshedRevision},${parent.stage},${parent.versionKey},
          ${JSON.stringify(refreshedInput)}::jsonb,'COMPLETE',${JSON.stringify(refreshedOutput)}::jsonb,clock_timestamp())`;
    }
    assert.equal(await admitAcquisitionReferenceRefinement(db,refreshedIds[2],versions),0);
    await assert.rejects(db.acquisitionProcessingJob.create({data:{...first.context,candidateRevision:refreshedRevision,
      stage:REFERENCE_REFINEMENT_STAGE,versionKey:job.versionKey,input:job.input as Prisma.InputJsonObject}}),
      error=>error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002","DB unique index spans revisions");
    assert.deepEqual(await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:first.ids[0]}}),primaryBefore);
    assert.equal(await db.acquisitionProcessingJob.count({where:{runId:first.context.runId,stage:REFERENCE_REFINEMENT_STAGE,
      input:{path:["photoId"],equals:first.photo.id}}}),1);

    const admissionVetoes: [string,(f:Fixture)=>Promise<unknown>][] = [
      ["review",f=>db.acquisitionCandidate.update({where:{id:f.context.candidateId},data:{review:{saved:"human"}}})],
      ["manual",f=>db.acquisitionCandidate.update({where:{id:f.context.candidateId},data:{manualAnalysis:{region:null}}})],
      ["PHOTO",f=>db.acquisitionPhoto.update({where:{id:f.photo.id},data:{inputKind:"PHOTO"}})],
      ["retake",f=>db.acquisitionCaptureSlot.update({where:{id:f.slot.id},data:{generation:{increment:1}}})],
      ["purged",f=>db.acquisitionPhoto.update({where:{id:f.photo.id},data:{purgedAt:new Date()}})],
      ["clipped",f=>db.$executeRaw`UPDATE "AcquisitionProcessingJob" SET output=jsonb_set(output,'{native,geometry,framing}','"CLIPPED"') WHERE id=${f.ids[0]}`],
      ["conflicting references",f=>db.$executeRaw`UPDATE "AcquisitionProcessingJob" SET output=jsonb_set(output,'{printingNative,conflictingObservations}','true') WHERE id=${f.ids[2]}`],
      ["source dimensions",f=>db.acquisitionPhoto.update({where:{id:f.photo.id},data:{width:1200}})],
    ];
    for(const [name,mutate] of admissionVetoes){const f=await fixture();await mutate(f);
      assert.equal(await admitAcquisitionReferenceRefinement(db,f.ids[2],versions),0,name+" admission veto");}
    const staleVersions=await fixture();
    for(const key of ["model","catalog","referenceModel","primaryVersion","catalogResolver"] as const)
      assert.equal(await admitAcquisitionReferenceRefinement(db,staleVersions.ids[2],{...versions,
        [key]:key==="catalogResolver"?"new-resolver":"f".repeat(64)}),0,"current "+key+" required");

    const publicationVetoes: [string,(f:Fixture)=>Promise<unknown>][] = [
      ...admissionVetoes.slice(0,5),
      ["excluded",f=>db.acquisitionCandidate.update({where:{id:f.context.candidateId},data:{excluded:true}})],
      ["revision",f=>db.acquisitionCandidate.update({where:{id:f.context.candidateId},data:{revision:{increment:1}}})],
      ["parent output",f=>db.$executeRaw`UPDATE "AcquisitionProcessingJob" SET output=output||'{"changed":true}'::jsonb WHERE id=${f.ids[1]}`],
    ];
    for(const [name,mutate] of publicationVetoes){const f=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,f.ids[2],versions),1);
      const claimJob=await claim(f);await mutate(f);assert.equal(await completeAcquisitionJob(db,claimJob,result(claimJob)),"SUPERSEDED",name+" publication veto");}
    for(const n of [0,1,2]){
      const f=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,f.ids[2],versions),1);
      const claimJob=await claim(f),parent=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:f.ids[n]}});
      await db.acquisitionProcessingJob.create({data:{...f.context,stage:parent.stage,versionKey:randomUUID(),input:parent.input as Prisma.InputJsonObject,
        status:"PENDING",createdAt:new Date(Date.now()+1000)}});
      assert.equal(await completeAcquisitionJob(db,claimJob,result(claimJob)),"SUPERSEDED","newer parent"+n+" veto");
    }
    const tampered=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,tampered.ids[2],versions),1);
    const tamperedJob=await claim(tampered),bad={...result(tamperedJob),
      proposals:{automaticAcceptance:true,finish:"UNKNOWN",condition:"UNKNOWN"}};
    assert.equal(await completeAcquisitionJob(db,tamperedJob,bad),"SUPERSEDED","automatic acceptance cannot publish");
    assert.equal(await admitAcquisitionReferenceRefinement(db,tampered.ids[2],versions),0,"retired attempt consumes same lineage");

    const delayed=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,delayed.ids[2],versions),1);
    const delayedJob=await claim(delayed);
    await db.acquisitionProcessingJob.update({where:{id:delayedJob.id},data:{leaseExpiresAt:new Date(Date.now()+250)}});
    let signalLocked!:()=>void;const locked=new Promise<void>(resolve=>{signalLocked=resolve;});
    const holder=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${capture.session.id} FOR UPDATE`;
      signalLocked();await new Promise(resolve=>setTimeout(resolve,450));});
    await locked;
    assert.equal(await completeAcquisitionJob(db,delayedJob,result(delayedJob),new Date(0)),"STALE_LEASE",
      "DB clock after waiting for lock wins over caller clock");
    await holder;
    // End its owned attempt; no later fixture may accidentally claim it.
    await db.acquisitionProcessingJob.update({where:{id:delayedJob.id},data:{status:"FAILED",leaseToken:null,leaseExpiresAt:null}});
    for(const [name,change,restore] of [
      ["owner disabled",()=>db.player.update({where:{id:base.ownerPlayerId},data:{active:false}}),
        ()=>db.player.update({where:{id:base.ownerPlayerId},data:{active:true}})],
      ["creator disabled",()=>db.user.update({where:{id:actor.userId},data:{isActive:false}}),
        ()=>db.user.update({where:{id:actor.userId},data:{isActive:true}})],
      ["password reset",()=>db.user.update({where:{id:actor.userId},data:{forcePasswordChange:true}}),
        ()=>db.user.update({where:{id:actor.userId},data:{forcePasswordChange:false}})],
      ["trashed",()=>db.acquisitionSession.update({where:{id:capture.session.id},data:{trashedAt:new Date()}}),
        ()=>db.acquisitionSession.update({where:{id:capture.session.id},data:{trashedAt:null}})],
      ["cancelled",()=>db.acquisitionSession.update({where:{id:capture.session.id},data:{cancelledAt:new Date()}}),
        ()=>db.acquisitionSession.update({where:{id:capture.session.id},data:{cancelledAt:null}})],
    ] as const){
      const f=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,f.ids[2],versions),1);
      const claimed=await claim(f);await change();
      try{assert.equal(await completeAcquisitionJob(db,claimed,result(claimed)),"SUPERSEDED",name);}
      finally{await restore();}
    }
    const committed=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,committed.ids[2],versions),1);
    const committedJob=await claim(committed),receipt=await db.acquisitionCommit.create({data:{runId:committed.context.runId,
      actorUserId:actor.userId,requestKey:randomUUID(),requestDigest:"f".repeat(64),snapshot:{synthetic:true}}});
    await db.acquisitionCommitMember.create({data:{candidateId:committed.context.candidateId,runId:committed.context.runId,
      commitId:receipt.id,inventoryItemId:"synthetic-reference-no-stock",snapshot:{synthetic:true}}});
    assert.equal(await completeAcquisitionJob(db,committedJob,result(committedJob)),"SUPERSEDED","receipt fence");
    assert.equal(await admitAcquisitionReferenceRefinement(db,committed.ids[2],versions),0);

    const cards=[{id:"reference-first",name:"Forest",setCode:"aaa",collectorNumber:"1",lang:"en"},
      {id:"reference-second",name:"Island",setCode:"bbb",collectorNumber:"2",lang:"en"}];
    const snapshot={digest:versions.catalog,index:createAcquisitionRecognitionIndex(cards),byScryfallId:new Map()};
    const handlerFixture=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,handlerFixture.ids[2],versions),1);
    const handlerJob=await claim(handlerFixture);let nativeRequests=0;
    const nativeWorker={request:async(frame:Buffer)=>{
      nativeRequests++;const hintLength=frame.readUInt32BE(0),hint=JSON.parse(frame.subarray(4,4+hintLength).toString());
      assert.equal(hint.inputKind,"CARD_SCAN");assert.deepEqual(frame.subarray(4+hintLength),bytes);
      const fake=result(handlerJob).native as Prisma.InputJsonObject;
      return {...fake,text:{title:["Forest"],footer:["001","AAA EN"]},orientations:[
        {rotationDegrees:0,text:{title:["Forest"],footer:["001","AAA EN"]},lines:[]},
        {rotationDegrees:180,text:{title:[],footer:[]},lines:[]}]};
    }};
    const output=await recognizeAcquisitionReferenceRefinement(db,handlerJob,new AbortController().signal,snapshot,versions,nativeWorker);
    assert.equal(nativeRequests,1,"one native request; no additional fallback");
    assert.equal((output.proposals as {status:string}).status,"CONFLICT","primary contradiction retained");
    assert.equal(await completeAcquisitionJob(db,handlerJob,output),"COMPLETE");
    const late=await fixture();assert.equal(await admitAcquisitionReferenceRefinement(db,late.ids[2],versions),1);
    const lateJob=await claim(late);let lateRequests=0;
    await assert.rejects(recognizeAcquisitionReferenceRefinement(db,lateJob,new AbortController().signal,snapshot,
      {...versions,model:"f".repeat(64)},{request:async()=>{lateRequests++;return {};}}),AcquisitionJobSupersededError);
    assert.equal(lateRequests,0,"stale model rejected before pixels");
    await assert.rejects(recognizeAcquisitionReferenceRefinement(db,lateJob,new AbortController().signal,snapshot,versions,
      {request:async()=>{lateRequests++;await db.acquisitionCandidate.update({where:{id:late.context.candidateId},data:{review:{saved:"during inference"}}});
        return result(lateJob).native;}}),AcquisitionJobSupersededError);
    assert.equal(lateRequests,1);const saved=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:late.context.candidateId}});
    assert.equal(await completeAcquisitionJob(db,lateJob,result(lateJob)),"SUPERSEDED");
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:late.context.candidateId}}),saved);
    assert.equal(await db.acquisitionCandidate.count({where:{runId:first.context.runId}}),count,"one copy per original, no refinement copies");
    assert.deepEqual(await db.inventoryItem.aggregate({_sum:{quantity:true},_count:{_all:true}}),inventoryBefore);
    console.log("PASS:reference refinement PostgreSQL one-pass/concurrency/restart, exact coordinate/observation JSON, authority/parent/model fences and database-clock lease expiry; original bytes/primary evidence and zero Inventory conserved");
  } finally {
    await db.acquisitionSession.update({where:{id:capture.session.id},data:{phase:"CANCELLED"}});
    if(previousUploads===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previousUploads;
    await rm(root,{recursive:true,force:true});
  }
}
