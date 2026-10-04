import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, getAcquisitionPhoto,
  type AcquisitionActor, type CreateAcquisitionInput } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { manageAcquisitionBatch } from "../lib/acquisition-batch-lifecycle";
import { getAcquisitionBatchDashboard } from "../lib/acquisition-batch-dashboard";
import { claimAcquisitionJobs, completeAcquisitionJob, failAcquisitionJob, heartbeatAcquisitionJob } from "../lib/acquisition-jobs";
import { purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import { PRINTING_STAGE } from "../lib/acquisition-printing";

export async function verifyAcquisitionBatchManagement(db: PrismaClient, actor: AcquisitionActor, stranger: AcquisitionActor,
  base: CreateAcquisitionInput, admin: AcquisitionActor) {
  const parent = path.resolve(".local-data"); await mkdir(parent, {recursive: true});
  const root = await mkdtemp(path.join(parent, "batch-management-db-")), oldRoot = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const start = new Date(), bytes = await sharp({create: {width: 100, height: 140, channels: 3, background: "white"}}).png().toBuffer();
  const inventoryBefore = await db.inventoryItem.aggregate({_sum: {quantity: true}});
  try {
    const capture = await createAcquisitionSession(db, actor, {...base, requestKey: randomUUID(), policy: {kind: "MANUAL", quantity: 2},
      run: {...base.run, providerId: "phone-photo-v1", runId: randomUUID()}});
    const id = capture.session.id, run = await db.acquisitionRun.findUniqueOrThrow({where: {sessionId: id}});
    await executeAcquisitionCommand(db, actor, id, {requestKey: "start", revision: 0, command: "START"});
    const photoIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const {slot} = await reserveAcquisitionCaptureSlot(db, actor, id, randomUUID());
      const photo = await beginAcquisitionPhoto(db, actor, id, {slotId: slot.id, uploadKey: randomUUID(), generation: 0,
        metadata: await inspectAcquisitionPhoto(bytes, "image/png")});
      await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
      await finalizeAcquisitionPhoto(db, actor, id, photo.id); photoIds.push(photo.id);
    }
    const jobs = await claimAcquisitionJobs(db, {workerId: "batch-test", stages: ["photo-canonical-v1"], limit: 2});
    const owned = jobs.filter(job => job.runId === run.id);
    // Other fixture jobs may precede this batch. Claim the owned jobs through
    // unique fixture stages to exercise the same real lease predicates.
    await db.acquisitionProcessingJob.updateMany({where: {runId: run.id, stage: "photo-canonical-v1"}, data: {stage: "batch-fixture-stage", status: "PENDING", leaseToken: null, leaseExpiresAt: null}});
    const [accepted] = await claimAcquisitionJobs(db, {workerId: "batch-test", stages: ["batch-fixture-stage"]});
    assert.ok(accepted);
    await assert.rejects(manageAcquisitionBatch(db, stranger, id, "trash"), /unavailable/);
    assert.equal((await getAcquisitionBatchDashboard(db, stranger, {view: "all", q: String(capture.batchNumber)})).total, 0);
    const emptyPage = await getAcquisitionBatchDashboard(db, stranger, {view: "all", q: String(capture.batchNumber), page: 999});
    assert.equal(emptyPage.page, 1); assert.equal(emptyPage.pages, 1); assert.equal(emptyPage.rows.length, 0);
    // The parent suite deliberately demoted this fixture admin earlier. A
    // remembered Admin Mode flag must not survive that live role change.
    assert.equal((await getAcquisitionBatchDashboard(db, admin, {view: "all", q: String(capture.batchNumber)})).total, 0);
    await db.user.update({where: {id: admin.userId}, data: {role: "ADMIN"}});
    try {
      assert.equal((await getAcquisitionBatchDashboard(db, admin, {view: "all", q: String(capture.batchNumber)})).rows[0].id, id);
    } finally {await db.user.update({where: {id: admin.userId}, data: {role: "PLAYER"}});}
    await manageAcquisitionBatch(db, actor, id, "cancel", start);
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where: {id}})).phase, "CANCELLED");
    assert.equal((await claimAcquisitionJobs(db, {workerId: "late", stages: ["batch-fixture-stage"]})).length, 0);
    assert.equal(await heartbeatAcquisitionJob(db, accepted), false);
    assert.equal(await completeAcquisitionJob(db, accepted, {late: true}), "STALE_LEASE");
    assert.equal(await failAcquisitionJob(db, accepted), false);
    const cancelled = await db.acquisitionProcessingJob.findMany({where: {runId: run.id}});
    assert.ok(cancelled.every(job => job.status === "SUPERSEDED" && job.errorCode === "BATCH_STOPPED"));
    await manageAcquisitionBatch(db, actor, id, "trash", start);
    const trashed = await db.acquisitionSession.findUniqueOrThrow({where: {id}});
    assert.equal(trashed.trashExpiresAt!.getTime() - start.getTime(), 7 * 86400000);
    await manageAcquisitionBatch(db, actor, id, "trash", new Date(start.getTime() + 1000));
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where: {id}})).trashExpiresAt!.getTime(), trashed.trashExpiresAt!.getTime());
    await assert.rejects(getAcquisitionPhoto(db, actor, id, photoIds[0]), /unavailable/);
    assert.equal((await getAcquisitionBatchDashboard(db, actor, {view: "all", q: String(capture.batchNumber)})).total, 0);
    assert.equal((await getAcquisitionBatchDashboard(db, actor, {view: "trash", q: String(capture.batchNumber)})).rows[0].captured, 2);
    await purgeTrashedAcquisitionPhotos(db, new Date(start.getTime() + 6 * 86400000));
    assert.ok((await readAcquisitionPhotoBytes(photoIds[0], "raw")).equals(bytes));
    await manageAcquisitionBatch(db, actor, id, "restore", new Date(start.getTime() + 6 * 86400000));
    assert.equal((await db.acquisitionSession.findUniqueOrThrow({where: {id}})).phase, "CANCELLED");
    await manageAcquisitionBatch(db, actor, id, "resume-processing");
    const [newAttempt] = await claimAcquisitionJobs(db, {workerId: "new", stages: ["batch-fixture-stage"]});
    assert.notEqual(newAttempt.leaseToken, accepted.leaseToken);
    assert.equal(await completeAcquisitionJob(db, accepted, {late: true}), "STALE_LEASE");
    assert.equal(await completeAcquisitionJob(db, newAttempt, {current: true}), "COMPLETE");
    const candidate = await db.acquisitionCandidate.findFirstOrThrow({where: {runId: run.id}});
    const artifact = await db.acquisitionArtifact.findFirstOrThrow({where: {runId: run.id, observations: {some: {candidateId: candidate.id}}}});
    await db.acquisitionProcessingJob.create({data: {runId: run.id, candidateId: candidate.id, candidateRevision: candidate.revision,
      artifactId: artifact.id, stage: PRINTING_STAGE, versionKey: "batch-evaluation", input: {}, status: "COMPLETE"}});
    let dashboard = await getAcquisitionBatchDashboard(db, actor, {view: "all", q: String(capture.batchNumber)});
    assert.equal(dashboard.rows[0].captured, 2); assert.equal(dashboard.rows[0].evaluated, 1);
    assert.equal(dashboard.rows[0].assigned, 2); assert.equal(dashboard.rows[0].confirmed, 0); assert.equal(dashboard.rows[0].added, 0);
    const stalePage = await getAcquisitionBatchDashboard(db, actor, {view: "all", q: String(capture.batchNumber), page: 999});
    assert.equal(stalePage.page, 1); assert.equal(stalePage.pages, 1); assert.equal(stalePage.rows[0].id, id);
    // A newer check replaces completion without creating another physical card.
    await db.acquisitionProcessingJob.create({data: {runId: run.id, candidateId: candidate.id, candidateRevision: candidate.revision,
      artifactId: artifact.id, stage: PRINTING_STAGE, versionKey: "batch-newer-evaluation", input: {}, createdAt: new Date(Date.now() + 1000)}});
    dashboard = await getAcquisitionBatchDashboard(db, actor, {view: "all", q: String(capture.batchNumber)});
    assert.equal(dashboard.rows[0].evaluated, 0); assert.equal(dashboard.rows[0].captured, 2);
    await manageAcquisitionBatch(db, actor, id, "trash", start);
    await assert.rejects(manageAcquisitionBatch(db, actor, id, "restore", new Date(start.getTime() + 7 * 86400000)), /expired/);
    const expiry = new Date(start.getTime() + 7 * 86400000);
    const markingFault = db.$extends({query: {acquisitionPhoto: {async update() {throw new Error("injected Trash marking failure");}}}}) as unknown as PrismaClient;
    assert.equal((await purgeTrashedAcquisitionPhotos(markingFault, expiry)).failed, 2);
    assert.equal(await db.acquisitionPhoto.count({where: {runId: run.id, purgedAt: null}}), 2);
    // Missing files after unlink-before-mark are retried without resurrecting
    // restore rights or deleting Inventory/receipts.
    const expired = await purgeTrashedAcquisitionPhotos(db, expiry);
    assert.equal(expired.purged, 2);
    await assert.rejects(readAcquisitionPhotoBytes(photoIds[0], "raw"));
    assert.ok((await db.acquisitionSession.findUniqueOrThrow({where: {id}})).deletedAt);
    assert.equal((await getAcquisitionBatchDashboard(db, actor, {view: "trash", q: String(capture.batchNumber)})).total, 0);
    await assert.rejects(manageAcquisitionBatch(db, actor, id, "restore"), /expired/);
    assert.deepEqual(await db.inventoryItem.aggregate({_sum: {quantity: true}}), inventoryBefore);
    assert.equal(await db.acquisitionCandidate.count({where: {runId: run.id}}), 2);
    for (const job of jobs.filter(job => !owned.includes(job))) await failAcquisitionJob(db, job);
    console.log("PASS: batch cancellation/replayed Trash, private dashboard, current evaluation counts, lease retirement/late results, explicit restoration and seven-day byte expiry; Inventory conserved");
  } finally {
    if (oldRoot === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = oldRoot;
    if (path.dirname(root) !== parent || !path.basename(root).startsWith("batch-management-db-")) throw new Error("Fixture root escaped");
    await rm(root, {recursive: true, force: true});
  }
}
