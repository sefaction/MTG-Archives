import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand } from "../lib/acquisition-store";
import { getAcquisitionRerun, requestAcquisitionRerun, runAcquisitionRerunOnce } from "../lib/acquisition-rerun";
import { enqueueReadyRecognition } from "../lib/acquisition-recognition-worker";
import { completeAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";

export async function verifyAcquisitionRerun(db: PrismaClient) {
  // Global admin behavior needs a fresh disposable database, never an app snapshot.
  assert.equal(await db.acquisitionSession.count(), 0, "Rerun verification requires a fresh disposable database");
  const tag = `rerun-${randomUUID()}`;
  const actors = [];
  for (const name of ["owner", "other", "admin"]) {
    const id = `${tag}-${name}`;
    await db.player.create({data: {id, name: id, displayName: id}});
    await db.user.create({data: {id, username: id, displayName: name, passwordHash: "fixture-only",
      playerId: id, role: name === "admin" ? "ADMIN" : "PLAYER"}});
    await db.inventoryLocation.create({data: {id, name, normalizedName: name, ownerPlayerId: id,
      type: "Box", storageLayout: {capacity: 1000, sections: [{name: "A", capacity: 1000}]}}});
    actors.push({userId: id, adminMode: name === "admin"});
  }
  const [actor, other, admin] = actors;
  const sessions: string[] = [];
  async function batch(who = actor) {
    const saved = await createAcquisitionSession(db, who, {requestKey: randomUUID(), ownerPlayerId: who.userId,
      locationId: who.userId, section: "A", policy: {kind: "MANUAL", quantity: 1000},
      run: {providerId: "phone-photo-v1", runId: randomUUID(), enforcement: "NONE", controls: ["STOP"]}});
    await executeAcquisitionCommand(db, who, saved.session.id, {requestKey: "start", revision: 0, command: "START"});
    sessions.push(saved.session.id);
    return db.acquisitionRun.findUniqueOrThrow({where: {sessionId: saved.session.id}});
  }
  const run = await batch(), otherRun = await batch(other), cancelledRun = await batch(), trashRun = await batch();
  async function card(runId = run.id, position = 0) {
    const slot = await db.acquisitionCaptureSlot.create({data: {runId, position, generation: 1, requestKey: randomUUID()}});
    const photo = await db.acquisitionPhoto.create({data: {runId, slotId: slot.id, generation: 1, uploadKey: randomUUID(),
      ready: true, readyAt: new Date(), bytes: 500, mediaType: "image/png", width: 600, height: 840, digest: "a".repeat(64), inputKind: "CARD_SCAN"}});
    const candidate = await db.acquisitionCandidate.create({data: {runId, physicalId: slot.id, identityKind: "NATIVE",
      acquisitionOrder: position, spatialOrder: 0, expectedSides: ["FRONT"], provisional: false, uncertainty: [], revision: 0}});
    const artifact = await db.acquisitionArtifact.create({data: {runId, sourceId: photo.id, digest: photo.digest}});
    const prepared = await db.acquisitionProcessingJob.create({data: {runId, candidateId: candidate.id, artifactId: artifact.id,
      candidateRevision: 0, stage: "photo-canonical-v1", versionKey: "fixture", status: "COMPLETE",
      input: {photoId: photo.id, digest: photo.digest}, output: {photoId: photo.id}}});
    return {candidate, photo, artifact, prepared};
  }
  const own: Awaited<ReturnType<typeof card>>[] = [];
  for (let i = 0; i < 45; i++) own.push(await card(run.id, i));
  const theirs = await card(otherRun.id);
  const confirmed = await card(run.id, 50), excluded = await card(run.id, 51), purged = await card(run.id, 52),
    notReady = await card(run.id, 53), retaken = await card(run.id, 54), unprepared = await card(run.id, 55), committed = await card(run.id, 56);
  await card(cancelledRun.id); await card(trashRun.id);
  await db.acquisitionSession.update({where: {id: cancelledRun.sessionId}, data: {cancelledAt: new Date(), phase: "CANCELLED"}});
  await db.acquisitionSession.update({where: {id: trashRun.sessionId}, data: {trashedAt: new Date()}});
  const review = {cardId: "human", finish: "NONFOIL", condition: "NM", language: "en"};
  await db.acquisitionCandidate.update({where: {id: confirmed.candidate.id}, data: {review}});
  await db.acquisitionCandidate.update({where: {id: excluded.candidate.id}, data: {excluded: true}});
  await db.acquisitionPhoto.update({where: {id: purged.photo.id}, data: {purgedAt: new Date()}});
  await db.acquisitionPhoto.update({where: {id: notReady.photo.id}, data: {ready: false, readyAt: null}});
  await db.acquisitionCaptureSlot.update({where: {id: retaken.photo.slotId}, data: {generation: 2}});
  await db.acquisitionProcessingJob.update({where: {id: unprepared.prepared.id}, data: {status: "FAILED"}});
  await db.acquisitionCommit.create({data: {runId: run.id, actorUserId: actor.userId, requestKey: randomUUID(),
    requestDigest: "b".repeat(64), snapshot: {}, members: {create: {candidateId: committed.candidate.id,
      inventoryItemId: "retained-inventory-receipt", snapshot: {}}}}});
  const region = {version: 1, quad: [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]};
  await db.acquisitionCandidate.update({where: {id: own[0].candidate.id}, data: {manualAnalysis: {version: 1,
    requestKey: randomUUID(), photoId: own[0].photo.id, digest: own[0].photo.digest, generation: 1, candidateRevision: 0, region}}});
  const cardRow = await db.card.create({data: {name: tag, scryfallId: randomUUID(), typeLine: "Creature", setCode: "tst", collectorNumber: "1", rarity: "common"}});
  await db.inventoryItem.create({data: {currentOwnerId: actor.userId, cardId: cardRow.id, quantity: 7, condition: "NM"}});
  const inventory = await db.inventoryItem.findMany();
  const photos = await db.acquisitionPhoto.findMany({orderBy: {id: "asc"}});
  const receipts = await db.acquisitionCommitMember.findMany();
  const canonical = await db.acquisitionProcessingJob.findMany({where: {stage: "photo-canonical-v1"}, orderBy: {id: "asc"}});
  const old = await db.acquisitionProcessingJob.create({data: {runId: run.id, candidateId: own[1].candidate.id,
    artifactId: own[1].artifact.id, candidateRevision: 0, stage: "photo-recognition-v1", versionKey: "old",
    input: {photoId: own[1].photo.id, digest: own[1].photo.digest}, status: "RUNNING", attempts: 1,
    leaseToken: "fixture-live-lease", leaseExpiresAt: new Date(Date.now()+90000)}});
  try {
    for (const who of [actor, {...actor, adminMode: true}, {...admin, adminMode: false}])
      await assert.rejects(requestAcquisitionRerun(db, who, {scope: "ALL", requestKey: randomUUID()}), /unavailable/);
    await assert.rejects(requestAcquisitionRerun(db, actor, {scope: "MINE", requestKey: randomUUID(), ownerPlayerId: other.userId}));
    const requestKey = randomUUID();
    const admitted = await Promise.all([1,2].map(() => requestAcquisitionRerun(db, actor, {scope: "MINE", requestKey})));
    assert.equal(admitted[0].id, admitted[1].id);
    await assert.rejects(requestAcquisitionRerun(db, actor, {scope: "MINE", requestKey: randomUUID()}), /another recognition rerun/);
    await assert.rejects(requestAcquisitionRerun(db, admin, {scope: "ALL", requestKey: randomUUID()}), /another recognition rerun/);
    assert.equal(await getAcquisitionRerun(db, other, "MINE"), null);
    const future = await card(run.id, 57);
    const results = await Promise.all([runAcquisitionRerunOnce(db), runAcquisitionRerunOnce(db)]);
    assert.equal(results.reduce((n,r)=>n+r.queued,0),45);
    assert.equal((await getAcquisitionRerun(db, actor, "MINE"))?.status,"COMPLETE");
    assert.equal((await requestAcquisitionRerun(db, actor,{scope:"MINE",requestKey})).queued,45);
    assert.equal((await runAcquisitionRerunOnce(db)).queued,0);
    for (const entry of own) {
      const changed = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: entry.candidate.id}});
      assert.equal(changed.revision,1); assert.equal(changed.review,null); assert.equal(changed.countConfirmed,false);
      assert.equal((changed.manualAnalysis as {requestKey:string}).requestKey,admitted[0].id);
    }
    assert.deepEqual((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:own[0].candidate.id}})).manualAnalysis,
      {...(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:own[0].candidate.id}})).manualAnalysis as object,region});
    for (const entry of [theirs, confirmed, excluded, purged, notReady, retaken, unprepared, committed, future])
      assert.equal((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:entry.candidate.id}})).revision,0);
    assert.equal(await completeAcquisitionJob(db,old as ClaimedAcquisitionJob,{}),"SUPERSEDED");
    const native = await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:old.id}});
    assert.equal(native.output,null);
    assert.deepEqual(await db.acquisitionProcessingJob.findMany({where:{stage:"photo-canonical-v1"},orderBy:{id:"asc"}}),
      [...canonical, future.prepared].sort((a,b)=>a.id.localeCompare(b.id)));
    for (let i=0;i<3;i++) await enqueueReadyRecognition(db,"b".repeat(64),"c".repeat(64));
    const newJobs = await db.acquisitionProcessingJob.findMany({where:{runId:run.id,stage:"photo-recognition-v1",candidateRevision:1}});
    assert.equal(newJobs.length,45);
    assert.deepEqual((newJobs.find(j=>j.candidateId===own[0].candidate.id)?.input as {manualAnalysis:{region:unknown}}).manualAnalysis.region,region);
    // A user confirms after intake: recheck under the batch lock must preserve it.
    const all = await requestAcquisitionRerun(db,admin,{scope:"ALL",requestKey:randomUUID()});
    await db.acquisitionCandidate.update({where:{id:theirs.candidate.id},data:{review}});
    while ((await runAcquisitionRerunOnce(db)).active) { /* bounded continuation */ }
    assert.equal((await db.acquisitionRecognitionRerun.findUniqueOrThrow({where:{id:all.id}})).queued,46);
    assert.equal((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:theirs.candidate.id}})).revision,0);
    // Global requests do include another owner's unreviewed retained originals.
    await db.acquisitionCandidate.update({where:{id:theirs.candidate.id},data:{review:Prisma.DbNull}});
    await requestAcquisitionRerun(db,admin,{scope:"ALL",requestKey:randomUUID()});
    while ((await runAcquisitionRerunOnce(db)).active) { /* worker restart continuation */ }
    assert.equal((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:theirs.candidate.id}})).revision,1);
    await requestAcquisitionRerun(db,admin,{scope:"ALL",requestKey:randomUUID()});
    await db.user.update({where:{id:admin.userId},data:{role:"PLAYER"}});
    assert.equal((await runAcquisitionRerunOnce(db)).queued,0);
    await assert.rejects(getAcquisitionRerun(db,admin,"ALL"),/unavailable/);
    assert.deepEqual(await db.inventoryItem.findMany(),inventory);
    assert.deepEqual(await db.acquisitionCommitMember.findMany(),receipts);
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{id:{in:photos.map(p=>p.id)}},orderBy:{id:"asc"}}),photos);
    // Ordinary admission retires changed/purged canonical sources. Their source
    // observations stay immutable even when that existing lifecycle runs.
    const evidence = (rows: typeof canonical) => rows.map(({status: _status, errorCode: _error, updatedAt: _updated, ...row}) => row);
    assert.deepEqual(evidence(await db.acquisitionProcessingJob.findMany({where:{stage:"photo-canonical-v1"},orderBy:{id:"asc"}})),
      evidence([...canonical, future.prepared].sort((a,b)=>a.id.localeCompare(b.id))));
    assert.deepEqual((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:confirmed.candidate.id}})).review,review);
    console.log("PASS recognition rerun: ownership/admin checks, frozen replay, overlap, bounded concurrent/restarted workers, source cutoff, late review, stale native publication, OCR admission, manual region and Inventory/original/receipt conservation");
  } finally {
    await db.acquisitionSession.updateMany({where:{id:{in:sessions}},data:{cancelledAt:new Date(),phase:"CANCELLED"}});
    await db.acquisitionRecognitionRerun.updateMany({where:{actorUserId:{in:actors.map(a=>a.userId)},status:{in:["QUEUED","RUNNING"]}},data:{status:"CANCELLED",finishedAt:new Date()}});
    const runIds = (await db.acquisitionRun.findMany({where:{sessionId:{in:sessions}},select:{id:true}})).map(r=>r.id);
    const where = {runId:{in:runIds}}, ids = actors.map(a=>a.userId);
    await db.acquisitionCommitMember.deleteMany({where});
    await db.acquisitionCommit.deleteMany({where});
    await db.acquisitionProcessingJob.deleteMany({where});
    await db.acquisitionCommand.deleteMany({where});
    await db.acquisitionPhoto.deleteMany({where});
    await db.acquisitionCaptureSlot.deleteMany({where});
    await db.acquisitionCountCorrection.deleteMany({where});
    await db.acquisitionObservation.deleteMany({where});
    await db.acquisitionEvent.deleteMany({where});
    await db.acquisitionCandidate.deleteMany({where});
    await db.acquisitionArtifact.deleteMany({where});
    await db.acquisitionRun.deleteMany({where:{id:{in:runIds}}});
    await db.acquisitionSession.deleteMany({where:{id:{in:sessions}}});
    await db.acquisitionRecognitionRerun.deleteMany({where:{actorUserId:{in:ids}}});
    await db.inventoryItem.deleteMany({where:{currentOwnerId:{in:ids}}});
    await db.inventoryLocation.deleteMany({where:{ownerPlayerId:{in:ids}}});
    await db.user.deleteMany({where:{id:{in:ids}}});
    await db.player.deleteMany({where:{id:{in:ids}}});
    await db.card.delete({where:{id:cardRow.id}});
    assert.equal(await db.acquisitionSession.count(),0);
    assert.equal(await db.user.count(),0);
    assert.equal(await db.inventoryItem.count(),0);
  }
}
if (process.argv.includes("--run")) {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  if (process.env.MTG_LOCAL_PILOT_TEST !== "1" || !["localhost","127.0.0.1","[::1]"].includes(url.hostname) || !url.pathname.startsWith("/acquisition_"))
    throw new Error("Requires opt-in and a fresh disposable local acquisition_* database");
  const db = new PrismaClient();
  verifyAcquisitionRerun(db).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
}
