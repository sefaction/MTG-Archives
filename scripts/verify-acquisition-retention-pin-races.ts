import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, type AcquisitionActor, type CreateAcquisitionInput } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, readAcquisitionPhotoBytes,
  canonicalizeAcquisitionPhoto } from "../lib/acquisition-files";
import { manageAcquisitionBatch } from "../lib/acquisition-batch-lifecycle";
import { ensureCorrectionExample } from "../lib/acquisition-correction-library";
import { beginCorrectionBackup } from "../lib/acquisition-correction-backup";
import { claimCorrectionCapture, completeCorrectionCapture, releasePreservedCorrectionPins } from "../lib/acquisition-correction-worker";
import { prepareCorrectionBlob, readCorrectionBlob } from "../lib/acquisition-correction-files";
import { purgeCommittedAcquisitionPhotos, purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";

/** Real SQL and files; adapters only insert a committed peer operation after
 * the actual selection query, before the existing locked recheck. Seeded aged
 * receipt membership qualifies retention, not the Inventory commit writer. */
export async function verifyAcquisitionRetentionPinRaces(db: PrismaClient, actor: AcquisitionActor, base: CreateAcquisitionInput) {
  const parent = path.resolve(".local-data");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "acq-retention-pin-races-"));
  const old = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const guards: Awaited<ReturnType<typeof beginCorrectionBackup>>[] = [];
  const guardIds: string[] = [];
  const sessionIds: string[] = [];
  const staged: Awaited<ReturnType<typeof prepareCorrectionBlob>>[] = [];
  const stock = await db.inventoryItem.findMany({ orderBy: { id: "asc" } });
  const audits = await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } });
  const account = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: base.ownerPlayerId } });
  let failure: unknown;
  try {
    // Fail clearly rather than interfere with another fixture's retained work.
    assert.equal(await db.correctionBackupGuard.count({ where: { releasedAt: null } }), 0);
    assert.equal(await db.correctionRetentionPin.count({ where: { releasedAt: null } }), 0);
    assert.equal(await db.correctionBlob.count({ where: { ownerPlayerId: base.ownerPlayerId } }), 0);
    for (const [index, kind] of (["committed", "trash"] as const).entries()) {
      const now = new Date(), past = new Date(now.getTime() - 8 * 86400000);
      const bytes = await sharp({ create: { width: 80, height: 120, channels: 3,
        background: index ? "#916237" : "#276391" } }).png().toBuffer();
      const session = await createAcquisitionSession(db, actor, { ...base, requestKey: randomUUID(),
        policy: { kind: "MANUAL", quantity: 1 }, run: { ...base.run, providerId: "phone-photo-v1" } });
      const id = session.session.id;
      sessionIds.push(id);
      await executeAcquisitionCommand(db, actor, id, { requestKey: "start", revision: 0, command: "START" });
      const { slot } = await reserveAcquisitionCaptureSlot(db, actor, id, "one");
      const photo = await beginAcquisitionPhoto(db, actor, id, { slotId: slot.id, uploadKey: randomUUID(),
        generation: 0, metadata: await inspectAcquisitionPhoto(bytes, "image/png") });
      await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
      await finalizeAcquisitionPhoto(db, actor, id, photo.id);
      const preview = await canonicalizeAcquisitionPhoto(photo.id, photo.digest, new AbortController().signal);
      const previewBytes = await readAcquisitionPhotoBytes(photo.id, "preview", preview.previewDigest);
      const candidate = await db.acquisitionCandidate.findFirstOrThrow({ where: { runId: photo.runId, physicalId: slot.id } });
      await manageAcquisitionBatch(db, actor, id, "cancel");
      if (kind === "trash") await manageAcquisitionBatch(db, actor, id, "trash", past);
      else {
        const receipt = await db.acquisitionCommit.create({ data: { runId: photo.runId, actorUserId: actor.userId,
          requestKey: randomUUID(), requestDigest: photo.digest, snapshot: {}, createdAt: past } });
        assert.ok(stock[0]);
        await db.acquisitionCommitMember.create({ data: { candidateId: candidate.id, runId: photo.runId,
          commitId: receipt.id, inventoryItemId: stock[0].id, snapshot: {} } });
        await db.acquisitionPhoto.update({ where: { id: photo.id }, data: { purgeAfter: past } });
      }
      const graph = () => Promise.all([
        db.acquisitionArtifact.findMany({ where: { runId: photo.runId }, orderBy: { id: "asc" } }),
        db.acquisitionCandidate.findMany({ where: { runId: photo.runId }, orderBy: { id: "asc" } }),
        db.acquisitionProcessingJob.findMany({ where: { runId: photo.runId }, orderBy: { id: "asc" } }),
        db.acquisitionCommit.findMany({ where: { runId: photo.runId }, orderBy: { id: "asc" }, include: { members: true } }),
      ]);
      const immutable = await graph();
      const beforeSession = await db.acquisitionSession.findUniqueOrThrow({ where: { id } });
      const beforePhoto = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } });
      let selected = 0;
      const selection = new Proxy(db, { get(target, key) {
        if (key === "$queryRaw") return async (...args: unknown[]) => {
          const rows = await Reflect.apply(target.$queryRaw, target, args) as { id: string }[];
          if (!selected && rows.some(row => row.id === (kind === "trash" ? id : photo.id))) {
            selected++;
            // Same lock order as real review/publication: session, owner, blob.
            await db.$transaction(async tx => {
              await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${id} FOR UPDATE`;
              const source = await tx.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } });
              assert.ok(await ensureCorrectionExample(tx, base.ownerPlayerId, id, source, candidate.id));
            });
          }
          return rows;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const purge = (client: PrismaClient) => kind === "trash"
        ? purgeTrashedAcquisitionPhotos(client, now) : purgeCommittedAcquisitionPhotos(client, now);
      const skipped = await purge(selection);
      assert.equal(selected, 1, "real retention selection must precede the committed pin");
      assert.equal(skipped.purged, 0); assert.equal(skipped.failed, 0);
      assert.deepEqual(await db.acquisitionSession.findUniqueOrThrow({ where: { id } }), beforeSession);
      assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } }), beforePhoto);
      const pin = await db.correctionRetentionPin.findFirstOrThrow({ where: { photoId: photo.id, releasedAt: null } });
      assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest), bytes);
      assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "preview", preview.previewDigest), previewBytes);
      assert.deepEqual(await graph(), immutable);

      // Begin backup after the actual raw copy is staged but before its real
      // completion transaction. Publication may finish; source pins must stay.
      const claim = await claimCorrectionCapture(db);
      assert.ok(claim); assert.equal(claim.blob.id, pin.blobId);
      const copy = await prepareCorrectionBlob(base.ownerPlayerId, photo.digest,
        await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest), claim.leaseToken!);
      staged.push(copy);
      const backup = await beginCorrectionBackup(); guards.push(backup);
      assert.ok(backup.id);
      guardIds.push(backup.id);
      assert.equal(await completeCorrectionCapture(db, claim, copy.publish), true);
      assert.equal((await db.correctionBlob.findUniqueOrThrow({ where: { id: pin.blobId } })).state, "PRESERVED");
      assert.equal((await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: claim.id } })).status, "COMPLETE");
      assert.equal((await db.correctionRetentionPin.findUniqueOrThrow({ where: { id: pin.id } })).releasedAt, null);
      assert.deepEqual(await readCorrectionBlob(base.ownerPlayerId, photo.digest, bytes.length), bytes);
      assert.equal(await releasePreservedCorrectionPins(db), 0);
      assert.equal((await purge(db)).purged, 0);
      await backup.release(); guards.splice(guards.indexOf(backup), 1);

      // A new backup wins after release enumerates preserved pins, before its
      // maintenance-gate transaction. Recheck the new guard under that gate.
      let releaseSelected = 0;
      const releaseRace = db.$extends({ query: { correctionRetentionPin: {
        async findMany({ args, query }) {
          const rows = await query(args);
          if (!releaseSelected && rows.some(row => row.id === pin.id)) {
            releaseSelected++;
            const nextBackup = await beginCorrectionBackup(); guards.push(nextBackup);
            assert.ok(nextBackup.id);
            guardIds.push(nextBackup.id);
          }
          return rows;
        },
      } } }) as unknown as PrismaClient;
      assert.equal(await releasePreservedCorrectionPins(releaseRace), 0);
      assert.equal(releaseSelected, 1);
      assert.equal((await db.correctionRetentionPin.findUniqueOrThrow({ where: { id: pin.id } })).releasedAt, null);
      assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest), bytes);
      assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "preview", preview.previewDigest), previewBytes);
      assert.equal((await purge(db)).purged, 0);
      await guards[0].release(); guards.shift();
      assert.equal(await releasePreservedCorrectionPins(db), 1);
      assert.ok((await db.correctionRetentionPin.findUniqueOrThrow({ where: { id: pin.id } })).releasedAt);
      assert.equal((await purge(db)).purged, 1);
      await assert.rejects(readAcquisitionPhotoBytes(photo.id, "raw"), { code: "ENOENT" });
      await assert.rejects(readAcquisitionPhotoBytes(photo.id, "preview"), { code: "ENOENT" });
      assert.ok((await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } })).purgedAt);
      assert.equal((await purge(db)).purged, 0);
      assert.equal(await releasePreservedCorrectionPins(db), 0);
      assert.deepEqual(await readCorrectionBlob(base.ownerPlayerId, photo.digest, bytes.length), bytes);
      assert.deepEqual(await graph(), immutable);
      assert.deepEqual(await db.inventoryItem.findMany({ orderBy: { id: "asc" } }), stock);
      assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
      console.log(`PASS: ${kind} retention selection/new-pin race and staged-copy/new-backup + selected-release/new-backup interleavings retain exact source/library bytes; legitimate release then purge/replay preserves evidence and Inventory`);
    }
  } catch (error) { failure = error; } finally {
    const failures: unknown[] = failure ? [failure] : [];
    for (const guard of guards) try { await guard.release(); } catch (error) { failures.push(error); }
    for (const copy of staged) try { await copy.cleanup(); } catch (error) { failures.push(error); }
    // Only this function's guard IDs; no blanket cleanup of backup authority.
    try { if (guardIds.length) {
      await db.correctionBackupGuard.deleteMany({ where: { id: { in: guardIds }, releasedAt: { not: null } } });
      assert.equal(await db.correctionBackupGuard.count({ where: { id: { in: guardIds } } }), 0);
    } } catch (error) { failures.push(error); }
    try {
      const runs = await db.acquisitionRun.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true } });
      const where = { runId: { in: runs.map(run => run.id) } };
      const photos = await db.acquisitionPhoto.findMany({ where, select: { id: true } });
      const sources = { sourcePhotoId: { in: photos.map(photo => photo.id) } };
      const examples = await db.correctionExample.findMany({ where: sources, select: { blobId: true } });
      const blobIds = examples.map(example => example.blobId);
      await db.correctionReviewEvent.deleteMany({ where: sources });
      await db.correctionEvidence.deleteMany({ where: sources });
      await db.correctionExample.deleteMany({ where: sources });
      await db.correctionRetentionPin.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await db.correctionCaptureOutbox.deleteMany({ where: { blobId: { in: blobIds } } });
      await db.correctionBlob.deleteMany({ where: { id: { in: blobIds } } });
      await db.acquisitionCommitMember.deleteMany({ where });
      await db.acquisitionCommit.deleteMany({ where });
      await db.acquisitionProcessingJob.deleteMany({ where });
      await db.acquisitionCommand.deleteMany({ where });
      await db.acquisitionPhoto.deleteMany({ where });
      await db.acquisitionCaptureSlot.deleteMany({ where });
      await db.acquisitionCountCorrection.deleteMany({ where });
      await db.acquisitionObservation.deleteMany({ where });
      await db.acquisitionEvent.deleteMany({ where });
      await db.acquisitionCandidate.deleteMany({ where });
      await db.acquisitionArtifact.deleteMany({ where });
      await db.acquisitionRun.deleteMany({ where: { id: { in: runs.map(run => run.id) } } });
      await db.acquisitionSession.deleteMany({ where: { id: { in: sessionIds } } });
      // This serial disposable fixture began with no blobs for this owner.
      // Restore the account's exact pre-fixture byte accounting/queue turn.
      await db.correctionLibraryAccount.update({ where: { ownerPlayerId: base.ownerPlayerId }, data: {
        preservedBytes: account.preservedBytes, reservedBytes: account.reservedBytes,
        evidenceBytes: account.evidenceBytes, lastCaptureAt: account.lastCaptureAt, updatedAt: account.updatedAt,
      } });
      assert.deepEqual(await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: base.ownerPlayerId } }), account);
      assert.equal(await db.acquisitionSession.count({ where: { id: { in: sessionIds } } }), 0);
      assert.equal(await db.acquisitionRun.count({ where: { id: { in: runs.map(run => run.id) } } }), 0);
      assert.equal(await db.correctionBlob.count({ where: { id: { in: blobIds } } }), 0);
      assert.deepEqual(await db.inventoryItem.findMany({ orderBy: { id: "asc" } }), stock);
      assert.deepEqual(await db.inventoryAuditLog.findMany({ orderBy: { id: "asc" } }), audits);
      console.log("PASS: retention race fixture removes only owned graph/guards/files and restores exact prior library accounting/turn, Inventory and audits");
    } catch (error) { failures.push(error); }
    if (old === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = old;
    try {
      if (path.dirname(root) !== parent || !path.basename(root).startsWith("acq-retention-pin-races-")) throw new Error("Unsafe retention fixture cleanup");
      await rm(root, { recursive: true, force: true });
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Retention fixture and cleanup failed", { cause: failures[0] });
  }
}
