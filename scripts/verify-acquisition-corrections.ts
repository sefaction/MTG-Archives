import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, getAcquisitionCardReview, saveAcquisitionReview } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, removeAcquisitionPhotoBytes, readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { ensureCorrectionAccount, selectCorrectionControl, correctionDisplayToken, ensureCorrectionExample,
  captureCorrectionPublication } from "../lib/acquisition-correction-library";
import { claimCorrectionCapture, completeCorrectionCapture, runCorrectionCaptureOnce,
  releasePreservedCorrectionPins, collectDeletedCorrectionBlobs } from "../lib/acquisition-correction-worker";
import { getCorrectionLibrary, changeCorrectionExample, readCorrectionExample } from "../lib/acquisition-correction-access";
import { readCorrectionBlob } from "../lib/acquisition-correction-files";
import { beginCorrectionBackup, buildCorrectionRemovalPrelude, buildCorrectionRestoreFence } from "../lib/acquisition-correction-backup";
import { purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";

export async function verifyAcquisitionCorrections(db: PrismaClient) {
  const tag = `corrections-${randomUUID()}`, owners = [0,1,2,3].map(i => `${tag}-${i}`);
  const actors = owners.map(userId => ({ userId, adminMode: false }));
  const schemas = `correction_${randomUUID().replaceAll("-", "")}`;
  const quote = `"${schemas}"`;
  const oldUploads = process.env.UPLOADS_DATA_PATH;
  await mkdir(path.resolve(".local-data"), { recursive: true });
  const root = await mkdtemp(path.resolve(".local-data/correction-db-"));
  process.env.UPLOADS_DATA_PATH = root;
  const sessions: string[] = [], photoIds: string[][] = owners.map(() => []);
  const cards = await Promise.all([0,1].map(i => db.card.create({ data: { id: `${tag}-card-${i}`, scryfallId: randomUUID(),
    name: `Correction fixture ${i}`, setCode: "crx", collectorNumber: String(i), typeLine: "Land", rarity: "common", lang: "en", finishes: ["nonfoil"] } })));
  const inventoryBefore = await db.inventoryItem.count();
  let guard: Awaited<ReturnType<typeof beginCorrectionBackup>> | undefined;
  const guardIds: string[] = [];
  async function prioritizeOwner(index: number) {
    // Recovery assertions name a particular source. Establish an explicit queue
    // precondition without bypassing production owner rotation or lease checks.
    await db.correctionLibraryAccount.updateMany({ where: { ownerPlayerId: { in: owners } }, data: { lastCaptureAt: new Date(1) } });
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[index] }, data: { lastCaptureAt: null } });
  }
  try {
    for (const [i, owner] of owners.entries()) {
      await db.player.create({ data: { id: owner, name: owner, displayName: owner } });
      await db.user.create({ data: { id: owner, username: owner, displayName: owner, playerId: owner, passwordHash: "fixture-only", role: i === 3 ? "ADMIN" : "PLAYER" } });
      await db.inventoryLocation.create({ data: { id: owner, ownerPlayerId: owner, name: owner, normalizedName: owner, type: "Box",
        storageLayout: { capacity: 100, sections: [{ name: "A", capacity: 100 }] } } });
      await db.$transaction(tx => ensureCorrectionAccount(tx, owner));
      await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owner }, data: { sampleBasisPoints: 0 } });
    }
    // Threshold and cap are decided before recognition; concurrent admissions
    // cannot exceed the cohort's cap or relabel earlier sampling decisions.
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[0] }, data: { sampleBasisPoints: 200 } });
    assert.equal((await db.$transaction(tx => selectCorrectionControl(tx, owners[0], () => 199))).correctionControl, true);
    assert.equal((await db.$transaction(tx => selectCorrectionControl(tx, owners[0], () => 200))).correctionControl, false);
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[0] }, data: { selectedControls: 198 } });
    const sample = await Promise.all([0,1,2].map(() => db.$transaction(tx => selectCorrectionControl(tx, owners[0], () => 0))));
    assert.equal(sample.filter(s => s.correctionControl).length, 2);
    assert.equal((await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owners[0] } })).selectedControls, 200);
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[0] }, data: { sampleBasisPoints: 0 } });
    const bytes = await sharp({ create: { width: 100, height: 140, channels: 3, background: "#778899" } }).jpeg().toBuffer();
    const metadata = await inspectAcquisitionPhoto(bytes, "image/jpeg");
    for (const [i, owner] of owners.entries()) {
      const session = await createAcquisitionSession(db, actors[i], { requestKey: randomUUID(), ownerPlayerId: owner,
        locationId: owner, section: "A", policy: { kind: "MANUAL", quantity: i === 0 ? 2 : 1 },
        run: { providerId: "phone-photo-v1", runId: randomUUID(), enforcement: "LOGICAL_ALLOCATION", controls: ["STOP", "CANCEL", "PAUSE", "RESUME"] } });
      sessions.push(session.session.id);
      await executeAcquisitionCommand(db, actors[i], sessions[i], { requestKey: "start", revision: 0, command: "START" });
      for (let n = 0; n < (i === 0 ? 2 : 1); n++) {
        const { slot } = await reserveAcquisitionCaptureSlot(db, actors[i], sessions[i], randomUUID());
        const input = { slotId: slot.id, uploadKey: randomUUID(), generation: 0, metadata, inputKind: "CARD_SCAN" as const };
        const photo = await beginAcquisitionPhoto(db, actors[i], sessions[i], input);
        const replay = await beginAcquisitionPhoto(db, actors[i], sessions[i], input);
        assert.equal(photo.correctionControl, replay.correctionControl);
        assert.equal(photo.correctionCohortId, replay.correctionCohortId);
        photoIds[i].push(photo.id);
        await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", metadata.digest);
        await finalizeAcquisitionPhoto(db, actors[i], sessions[i], photo.id);
        const state = await getAcquisitionCardReview(db, actors[i], sessions[i], photo.id);
        const candidate = await db.acquisitionCandidate.findFirstOrThrow({ where: { physicalId: slot.id } });
        const jobs = await db.acquisitionProcessingJob.findMany({ where: { candidateId: candidate.id } });
        const token = await db.$transaction(tx => correctionDisplayToken(tx, owner, actors[i], photo,
          { id: candidate.id, revision: state.revision }, jobs, cards, "PENDING"));
        assert.ok(token);
        // A job finishing after display must not replace the pending-at-display
        // snapshot, even though its save-time evidence now exists.
        await db.acquisitionProcessingJob.update({ where: { id: jobs[0].id }, data: { status: "COMPLETE", output: { previewDigest: metadata.digest }, updatedAt: new Date() } });
        const inputReview = { action: "accept", photoId: photo.id, revision: state.revision,
          decision: { cardId: cards[1].id, language: "en", finish: "NONFOIL", condition: "NM" },
          evidenceTokens: { initial: token, edit: token, current: token, displayed: [token] } };
        if (i === 0 && n === 0) {
          const fault = db.$extends({ query: { correctionReviewEvent: { async create() { throw new Error("injected correction rollback"); } } } }) as unknown as PrismaClient;
          await assert.rejects(saveAcquisitionReview(fault, actors[i], sessions[i], inputReview), /injected correction rollback/);
          assert.equal((await getAcquisitionCardReview(db, actors[i], sessions[i], photo.id)).review, null);
          assert.equal(await db.correctionExample.count({ where: { sourcePhotoId: photo.id } }), 0);
        }
        const saved = await Promise.all([0,1].map(() => saveAcquisitionReview(db, actors[i], sessions[i], inputReview)));
        assert.equal(saved.filter(result => "replay" in result && result.replay).length, 1);
        const events = await db.correctionReviewEvent.findMany({ where: { ownerPlayerId: owner, sourcePhotoId: photo.id } });
        assert.equal(events.length, 1); assert.equal(events[0].classification, "OFFERED_ALTERNATIVE_SELECTED");
        const snapshots = await db.correctionEvidence.findMany({ where: { ownerPlayerId: owner, sourcePhotoId: photo.id } });
        const recorded = snapshots.map(s => s.payload as any).filter(s => s.role === "SOURCE_JOB").map(s => s.job);
        assert.ok(recorded.some(job => job.status === "PENDING" && job.output === null));
        assert.ok(recorded.some(job => job.status === "COMPLETE" && job.output.previewDigest === metadata.digest));
      }
    }
    assert.equal(await db.correctionBlob.count({ where: { ownerPlayerId: { in: owners } } }), 4);
    assert.equal(await db.correctionExample.count({ where: { ownerPlayerId: owners[0] } }), 2);
    await assert.rejects(getCorrectionLibrary(db, actors[1], owners[0]), /unavailable/);
    await assert.rejects(getCorrectionLibrary(db, actors[3], owners[0]), /unavailable/);
    await getCorrectionLibrary(db, { ...actors[3], adminMode: true }, owners[0]);
    assert.equal(await db.correctionLibraryAccess.count({ where: { ownerPlayerId: owners[0], actorId: owners[3], action: "LIST" } }), 1);
    const reviewedPhoto = photoIds[0][0];
    let review = await getAcquisitionCardReview(db, actors[0], sessions[0], reviewedPhoto);
    const metadataEdit = { action: "accept", photoId: reviewedPhoto, revision: review.revision,
      decision: { cardId: cards[1].id, language: "en", finish: "NONFOIL", condition: "LP" },
      evidenceTokens: { initial: "invalid.signature", displayed: [] } };
    await saveAcquisitionReview(db, actors[0], sessions[0], metadataEdit);
    const latestEvent = () => db.correctionReviewEvent.findFirstOrThrow({ where: { sourcePhotoId: reviewedPhoto }, orderBy: { candidateRevision: "desc" } });
    assert.equal((await latestEvent()).classification, "METADATA_ONLY");
    await assert.rejects(saveAcquisitionReview(db, actors[0], sessions[0], { ...metadataEdit, decision: { ...metadataEdit.decision, condition: "HP" } }), /changed/);
    review = await getAcquisitionCardReview(db, actors[0], sessions[0], reviewedPhoto);
    await saveAcquisitionReview(db, actors[0], sessions[0], { ...metadataEdit, revision: review.revision, decision: { ...metadataEdit.decision, cardId: cards[0].id } });
    assert.equal((await latestEvent()).classification, "LABEL_REVISED");
    review = await getAcquisitionCardReview(db, actors[0], sessions[0], reviewedPhoto);
    await saveAcquisitionReview(db, actors[0], sessions[0], { action: "pending", photoId: reviewedPhoto, revision: review.revision });
    assert.equal((await latestEvent()).classification, "RETURNED_TO_PENDING");
    review = await getAcquisitionCardReview(db, actors[0], sessions[0], reviewedPhoto);
    await saveAcquisitionReview(db, actors[0], sessions[0], { ...metadataEdit, revision: review.revision });
    assert.equal((await latestEvent()).classification, "DISPLAY_IDENTITY_UNKNOWN");
    const machineOutput = { proposals: { status: "NO_MATCH", automaticAcceptance: false, totalProposals: 0,
      truncated: false, proposals: [] }, native: { runtime: "synthetic-fixture", elapsedMs: 1 } };
    async function publishFixture(photoId: string, version: string) {
      const canonical = await db.acquisitionProcessingJob.findFirstOrThrow({ where: { artifact: { sourceId: photoId }, stage: "photo-canonical-v1" } });
      const job = await db.acquisitionProcessingJob.create({ data: { runId: canonical.runId, artifactId: canonical.artifactId,
        candidateId: canonical.candidateId, candidateRevision: canonical.candidateRevision, stage: "photo-recognition-v1",
        versionKey: version, status: "COMPLETE", input: { photoId, digest: metadata.digest }, output: machineOutput } });
      await db.$transaction(tx => captureCorrectionPublication(tx, job, machineOutput));
      return job;
    }
    const firstPublication = await publishFixture(reviewedPhoto, "fixture-first");
    const earliest = (await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: reviewedPhoto } })).firstMachineEvidence as any;
    assert.equal(earliest.jobId, firstPublication.id);
    await publishFixture(reviewedPhoto, "fixture-later");
    assert.deepEqual((await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: reviewedPhoto } })).firstMachineEvidence, earliest);
    const firstFrames = await db.correctionEvidence.findMany({ where: { ownerPlayerId: owners[0], sourcePhotoId: reviewedPhoto } });
    assert.ok(firstFrames.some(frame => (frame.payload as any).role === "EARLIEST_PUBLISHED" && (frame.payload as any).identity.jobId === firstPublication.id));
    await db.acquisitionPhoto.update({ where: { id: photoIds[1][0] }, data: { correctionCohortId: null, firstMachineEvidence: Prisma.DbNull } });
    await publishFixture(photoIds[1][0], "fixture-historical-later");
    assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photoIds[1][0] } })).firstMachineEvidence, null);

    // Leases are publication authority, including after expiry and restoration.
    await prioritizeOwner(0);
    const stale = await claimCorrectionCapture(db); assert.ok(stale);
    await db.correctionCaptureOutbox.update({ where: { id: stale.id }, data: { leaseExpiresAt: new Date(0) } });
    let called = false;
    assert.equal(await completeCorrectionCapture(db, stale, async () => { called = true; }), false); assert.equal(called, false);
    await prioritizeOwner(0);
    const fresh = await claimCorrectionCapture(db); assert.ok(fresh); assert.equal(fresh.id, stale.id); assert.notEqual(fresh.leaseToken, stale.leaseToken);
    await db.$executeRawUnsafe(buildCorrectionRestoreFence("public"));
    assert.equal(await completeCorrectionCapture(db, fresh, async () => { called = true; }), false);
    assert.equal((await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: fresh.id } })).errorCode, "RESTORE_INTERRUPTED");
    await db.correctionCaptureOutbox.updateMany({ where: { blob: { ownerPlayerId: owners[0] } }, data: { availableAt: new Date(0) } });
    await prioritizeOwner(0);

    // An active archive window preserves pending source pins even after a copy.
    guard = await beginCorrectionBackup();
    if (guard.id) guardIds.push(guard.id);
    assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);
    const example = await db.correctionExample.findFirstOrThrow({ where: { ownerPlayerId: owners[0] }, orderBy: { createdAt: "asc" } });
    assert.equal(await db.correctionRetentionPin.count({ where: { blobId: example.blobId, releasedAt: null } }), 2);
    await releasePreservedCorrectionPins(db);
    assert.equal(await db.correctionRetentionPin.count({ where: { blobId: example.blobId, releasedAt: null } }), 2);
    await guard.release(); guard = undefined;
    await releasePreservedCorrectionPins(db);
    assert.equal(await db.correctionRetentionPin.count({ where: { blobId: example.blobId, releasedAt: null } }), 0);
    assert.deepEqual(await readCorrectionBlob(owners[0], metadata.digest, metadata.bytes), bytes);
    const preserved = await readCorrectionExample(db, actors[0], owners[0], example.id); assert.deepEqual(preserved.bytes, bytes);
    await assert.rejects(readCorrectionExample(db, actors[1], owners[0], example.id), /unavailable/);

    // No missing or over-allowance copy is marked preserved; source pins persist.
    await removeAcquisitionPhotoBytes(photoIds[1][0]);
    assert.equal((await runCorrectionCaptureOnce(db)).failed, 1);
    assert.equal(await db.correctionRetentionPin.count({ where: { ownerPlayerId: owners[1], releasedAt: null } }), 1);
    await writeAcquisitionPhotoBytes(photoIds[1][0], bytes, "raw", metadata.digest);
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[2] }, data: { limitBytes: 1 } });
    assert.equal((await runCorrectionCaptureOnce(db)).claimed, 0);
    const waiting = await db.correctionCaptureOutbox.findFirstOrThrow({ where: { blob: { ownerPlayerId: owners[2] } } });
    assert.equal(waiting.status, "WAITING_FOR_SPACE");
    assert.equal(await db.correctionRetentionPin.count({ where: { ownerPlayerId: owners[2], releasedAt: null } }), 1);
    const old = new Date(Date.now() - 10 * 86400000);
    await db.acquisitionSession.update({ where: { id: sessions[2] }, data: { trashedAt: old, trashExpiresAt: old } });
    await purgeTrashedAcquisitionPhotos(db);
    assert.deepEqual(await readAcquisitionPhotoBytes(photoIds[2][0], "raw", metadata.digest), bytes);
    await db.acquisitionSession.update({ where: { id: sessions[2] }, data: { trashedAt: null, trashExpiresAt: null } });
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[2] }, data: { limitBytes: 64000000000n } });
    await db.correctionCaptureOutbox.updateMany({ where: { blob: { ownerPlayerId: { in: owners } }, status: { not: "COMPLETE" } }, data: { availableAt: new Date(0) } });
    for (let i=0;i<3;i++) assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);
    const beforeWithdrawal = await db.correctionEvidence.count({ where: { sourcePhotoId: example.sourcePhotoId } });
    await changeCorrectionExample(db, actors[0], owners[0], example.id, "WITHDRAW_LABEL");
    assert.equal((await db.correctionExample.findUniqueOrThrow({ where: { id: example.id } })).labelState, "WITHDRAWN");
    assert.equal(await db.correctionEvidence.count({ where: { sourcePhotoId: example.sourcePhotoId } }), beforeWithdrawal);
    // Resume a durable DELETING claim that gained a live physical membership
    // before a backup/process interruption prevented its second phase.
    await db.correctionBlob.update({ where: { id: example.blobId }, data: { state: "DELETING", deleteClaimedAt: new Date() } });
    await db.correctionCaptureOutbox.update({ where: { blobId: example.blobId }, data: { status: "REMOVED" } });
    await db.correctionRetentionPin.updateMany({ where: { blobId: example.blobId }, data: { releasedAt: null } });
    assert.equal(await collectDeletedCorrectionBlobs(db), 0);
    const resumed = await db.correctionBlob.findUniqueOrThrow({ where: { id: example.blobId } });
    assert.equal(resumed.state, "PENDING"); assert.equal(resumed.reserved, true);
    await db.correctionCaptureOutbox.update({ where: { blobId: example.blobId }, data: { availableAt: new Date(0) } });
    await prioritizeOwner(0);
    assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);

    // Keep an older library projection, then remove the live example. Restoring
    // that projection must reapply current tombstones before analysis can read it.
    await db.$executeRawUnsafe(`CREATE SCHEMA ${quote}`);
    for (const name of ["CorrectionLibraryAccount","CorrectionExample","CorrectionReviewEvent","CorrectionEvidence","CorrectionRetentionPin","CorrectionCaptureOutbox","CorrectionBackupGuard","CorrectionDeletionTombstone"]) {
      await db.$executeRawUnsafe(`CREATE TABLE ${quote}."${name}" (LIKE public."${name}" INCLUDING ALL)`);
      await db.$executeRawUnsafe(`INSERT INTO ${quote}."${name}" SELECT * FROM public."${name}"`);
    }
    await changeCorrectionExample(db, actors[0], owners[0], example.id, "REMOVE");
    await assert.rejects(readCorrectionExample(db, actors[0], owners[0], example.id), /unavailable/);
    assert.equal(await collectDeletedCorrectionBlobs(db), 0); // Other physical membership keeps shared bytes.
    assert.deepEqual(await readCorrectionBlob(owners[0], metadata.digest, metadata.bytes), bytes);
    const source = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: example.sourcePhotoId } });
    assert.equal(await db.$transaction(tx => ensureCorrectionExample(tx, owners[0], sessions[0], source, example.sourceCandidateId)), null);
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(buildCorrectionRemovalPrelude("public"));
      await tx.$executeRawUnsafe(buildCorrectionRestoreFence(schemas));
    });
    const [restored] = await db.$queryRawUnsafe<any[]>(`SELECT "labelState","deletedAt","label","sourceMetadata" FROM ${quote}."CorrectionExample" WHERE id='${example.id}'`);
    assert.equal(restored.labelState, "REMOVED"); assert.ok(restored.deletedAt); assert.equal(restored.label, null); assert.equal(restored.sourceMetadata, null);
    const sibling = await db.correctionExample.findFirstOrThrow({ where: { ownerPlayerId: owners[0], deletedAt: null } });
    await changeCorrectionExample(db, actors[0], owners[0], sibling.id, "REMOVE");
    assert.equal(await collectDeletedCorrectionBlobs(db), 1);
    await assert.rejects(readCorrectionBlob(owners[0], metadata.digest, metadata.bytes), /ENOENT/);
    // Same digest in another owner's namespace remains readable and charged there.
    assert.deepEqual(await readCorrectionBlob(owners[1], metadata.digest, metadata.bytes), bytes);
    for (const owner of owners) {
      const account = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
      const [events,evidence,examples,blobs] = await Promise.all([
        db.correctionReviewEvent.aggregate({ where: { ownerPlayerId: owner }, _sum: { bytes: true } }),
        db.correctionEvidence.aggregate({ where: { ownerPlayerId: owner }, _sum: { bytes: true } }),
        db.correctionExample.aggregate({ where: { ownerPlayerId: owner }, _sum: { metadataBytes: true } }),
        db.correctionBlob.aggregate({ where: { ownerPlayerId: owner, state: "PRESERVED" }, _sum: { bytes: true } }),
      ]);
      assert.equal(account.evidenceBytes, BigInt((events._sum.bytes ?? 0) + (evidence._sum.bytes ?? 0) + (examples._sum.metadataBytes ?? 0)));
      assert.equal(account.preservedBytes, BigInt(blobs._sum.bytes ?? 0)); assert.equal(account.reservedBytes, 0n);
    }
    assert.equal(await db.inventoryItem.count(), inventoryBefore);
    console.log("PASS: correction sampling/cap, atomic saves/replay/rollback/stale/metadata/reversal, pending display identity, owner isolation/dedup, copy/quota/missing-source pins, backup guards, stale/restored leases, withdrawal/removal/GC-resume and older-restore tombstones; Inventory unchanged");
  } catch (error) {
    console.error("Correction fixture failed before cleanup:", error);
    throw error;
  } finally {
    await guard?.release();
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote} CASCADE`);
    const where = { ownerPlayerId: { in: owners } };
    await db.correctionRetentionPin.deleteMany({ where });
    await db.correctionCaptureOutbox.deleteMany({ where: { blob: where } });
    await db.correctionExample.deleteMany({ where });
    await db.correctionReviewEvent.deleteMany({ where });
    await db.correctionEvidence.deleteMany({ where });
    await db.correctionLibraryAccess.deleteMany({ where });
    await db.correctionBlob.deleteMany({ where });
    await db.correctionDeletionTombstone.deleteMany({ where });
    await db.correctionLibraryAccount.deleteMany({ where });
    await db.correctionBackupGuard.deleteMany({ where: { id: { in: guardIds } } });
    const runWhere = { run: { sessionId: { in: sessions } } };
    await db.acquisitionProcessingJob.deleteMany({ where: runWhere });
    await db.acquisitionCommand.deleteMany({ where: runWhere });
    await db.acquisitionPhoto.deleteMany({ where: runWhere });
    await db.acquisitionCaptureSlot.deleteMany({ where: runWhere });
    await db.acquisitionCountCorrection.deleteMany({ where: runWhere });
    await db.acquisitionObservation.deleteMany({ where: runWhere });
    await db.acquisitionEvent.deleteMany({ where: runWhere });
    await db.acquisitionCandidate.deleteMany({ where: runWhere });
    await db.acquisitionArtifact.deleteMany({ where: runWhere });
    await db.acquisitionRun.deleteMany({ where: { sessionId: { in: sessions } } });
    await db.acquisitionSession.deleteMany({ where: { id: { in: sessions } } });
    await db.inventoryLocation.deleteMany({ where });
    await db.user.deleteMany({ where: { id: { in: owners } } });
    await db.player.deleteMany({ where: { id: { in: owners } } });
    await db.card.deleteMany({ where: { id: { in: cards.map(c => c.id) } } });
    if (oldUploads === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = oldUploads;
    await rm(root, { recursive: true, force: true });
  }
}
