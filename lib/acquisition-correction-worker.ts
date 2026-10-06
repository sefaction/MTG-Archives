import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { lockCorrectionOwner } from "./acquisition-correction-library";
import { prepareCorrectionBlob, readCorrectionBlob, removeCorrectionBlob,
  staleCorrectionTemporaries, removeCorrectionTemporary } from "./acquisition-correction-files";
type Tx = Prisma.TransactionClient;
const LEASE_MS = 120000;
export async function correctionMaintenanceGate(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(762881)`;
}
export const correctionBackupActive = async (tx: Tx) => (await tx.correctionBackupGuard.count({ where: { releasedAt: null } })) > 0;

export async function claimCorrectionCapture(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    const [selected] = await tx.$queryRaw<{ id: string; ownerPlayerId: string }[]>`
      SELECT o.id,b."ownerPlayerId" FROM "CorrectionCaptureOutbox" o JOIN "CorrectionBlob" b ON b.id=o."blobId"
      WHERE b.state='PENDING' AND ((o.status IN ('PENDING','WAITING_FOR_SPACE') AND o."availableAt"<=${now})
        OR (o.status='RUNNING' AND o."leaseExpiresAt"<=${now}))
        AND EXISTS (SELECT 1 FROM "CorrectionExample" e WHERE e."blobId"=b.id AND e."deletedAt" IS NULL)
      ORDER BY o."availableAt",o."createdAt",o.id LIMIT 1`;
    if (!selected) return null;
    await lockCorrectionOwner(tx, selected.ownerPlayerId);
    const job = await tx.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: selected.id }, include: { blob: true } });
    const account = await tx.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: selected.ownerPlayerId } });
    if (!["PENDING", "WAITING_FOR_SPACE", "RUNNING"].includes(job.status) ||
      !await tx.correctionExample.count({ where: { blobId: job.blobId, deletedAt: null } })) return null;
    if (job.blob.state !== "PENDING" || job.status === "RUNNING" && job.leaseExpiresAt && job.leaseExpiresAt > now ||
      job.status !== "RUNNING" && job.availableAt > now) return null;
    const required = account.preservedBytes + account.reservedBytes + account.evidenceBytes +
      (job.blob.reserved ? 0n : BigInt(job.blob.bytes));
    if (required > account.limitBytes) {
      await tx.correctionCaptureOutbox.update({ where: { id: job.id }, data: { status: "WAITING_FOR_SPACE",
        errorCode: "WAITING_FOR_SPACE", availableAt: new Date(now.getTime() + 60000), leaseToken: null, leaseExpiresAt: null } });
      return null;
    }
    if (!job.blob.reserved) {
      await tx.correctionBlob.update({ where: { id: job.blob.id }, data: { reserved: true } });
      await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: account.ownerPlayerId }, data: { reservedBytes: { increment: job.blob.bytes } } });
    }
    return tx.correctionCaptureOutbox.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 },
      leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + LEASE_MS), errorCode: null }, include: { blob: true } });
  });
}
export type CorrectionCaptureClaim = NonNullable<Awaited<ReturnType<typeof claimCorrectionCapture>>>;

export async function completeCorrectionCapture(db: PrismaClient, claim: CorrectionCaptureClaim,
  publish: () => Promise<void>, now = new Date()) {
  return db.$transaction(async tx => {
    await correctionMaintenanceGate(tx);
    await lockCorrectionOwner(tx, claim.blob.ownerPlayerId);
    const [authority] = await tx.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM "CorrectionCaptureOutbox" o JOIN "CorrectionBlob" b ON b.id=o."blobId"
      WHERE o.id=${claim.id} AND o.status='RUNNING' AND o."leaseToken"=${claim.leaseToken}
        AND o."leaseExpiresAt">clock_timestamp() AND b.state='PENDING'
        AND EXISTS (SELECT 1 FROM "CorrectionExample" e WHERE e."blobId"=b.id AND e."deletedAt" IS NULL)`;
    if (!authority) return false;
    const account = await tx.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: claim.blob.ownerPlayerId } });
    if (account.preservedBytes + account.reservedBytes + account.evidenceBytes > account.limitBytes) {
      await tx.correctionCaptureOutbox.update({ where: { id: claim.id }, data: { status: "WAITING_FOR_SPACE",
        errorCode: "WAITING_FOR_SPACE", availableAt: new Date(now.getTime() + 60000), leaseToken: null, leaseExpiresAt: null } });
      return false;
    }
    // Publication and attachment share the current lease and owner/blob lock.
    // A rollback leaves an immutable verified object for a retry to attach.
    await publish();
    await tx.correctionBlob.update({ where: { id: claim.blob.id }, data: { state: "PRESERVED", preservedAt: now, reserved: false } });
    await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: account.ownerPlayerId }, data: {
      reservedBytes: { decrement: claim.blob.bytes }, preservedBytes: { increment: claim.blob.bytes },
    } });
    await tx.correctionCaptureOutbox.update({ where: { id: claim.id }, data: { status: "COMPLETE", errorCode: null,
      leaseToken: null, leaseExpiresAt: null } });
    // A backup snapshot with PENDING records must retain its original source
    // throughout archiving, even when this copy completes after the database dump.
    if (!await correctionBackupActive(tx)) await tx.correctionRetentionPin.updateMany({
      where: { blobId: claim.blob.id, releasedAt: null }, data: { releasedAt: now },
    });
    return true;
  }, { timeout: 30000 });
}

export async function failCorrectionCapture(db: PrismaClient, claim: CorrectionCaptureClaim, code: string, now = new Date()) {
  return db.correctionCaptureOutbox.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken,
    leaseExpiresAt: { gt: now } }, data: { status: "PENDING", leaseToken: null, leaseExpiresAt: null,
    availableAt: new Date(now.getTime() + 60000), errorCode: code } });
}
export async function runCorrectionCaptureOnce(db: PrismaClient) {
  const claim = await claimCorrectionCapture(db);
  if (!claim) return { claimed: 0, preserved: 0, failed: 0 };
  let staged: Awaited<ReturnType<typeof prepareCorrectionBlob>> | undefined;
  try {
    let existing = false;
    try { await readCorrectionBlob(claim.blob.ownerPlayerId, claim.blob.digest, claim.blob.bytes); existing = true; }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    if (!existing) {
      const pins = await db.correctionRetentionPin.findMany({ where: { blobId: claim.blob.id, releasedAt: null }, orderBy: { id: "asc" }, take: 25 });
      let bytes: Buffer | undefined;
      for (const pin of pins) {
        try { bytes = await readAcquisitionPhotoBytes(pin.photoId, "raw", claim.blob.digest); break; }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      if (!bytes || bytes.length !== claim.blob.bytes) throw Object.assign(new Error("Source missing"), { code: "SOURCE_MISSING" });
      staged = await prepareCorrectionBlob(claim.blob.ownerPlayerId, claim.blob.digest, bytes, claim.leaseToken!);
    }
    const published = await completeCorrectionCapture(db, claim, staged ? staged.publish :
      async () => { await readCorrectionBlob(claim.blob.ownerPlayerId, claim.blob.digest, claim.blob.bytes); });
    return { claimed: 1, preserved: Number(published), failed: 0 };
  } catch (error: any) {
    const code = ["ENOSPC", "EACCES", "EPERM", "SOURCE_MISSING"].includes(error.code) ? error.code : "ORIGINAL_COPY_FAILED";
    await failCorrectionCapture(db, claim, code);
    return { claimed: 1, preserved: 0, failed: 1 };
  } finally { await staged?.cleanup(); }
}

export async function releasePreservedCorrectionPins(db: PrismaClient, now = new Date()) {
  const pins = await db.correctionRetentionPin.findMany({ where: { releasedAt: null, blob: { state: "PRESERVED" } },
    distinct: ["blobId"], orderBy: { id: "asc" }, take: 4, include: { blob: true } });
  let released = 0;
  for (const pin of pins) released += await db.$transaction(async tx => {
    await correctionMaintenanceGate(tx);
    if (await correctionBackupActive(tx)) return 0;
    await lockCorrectionOwner(tx, pin.ownerPlayerId);
    const blob = await tx.correctionBlob.findUniqueOrThrow({ where: { id: pin.blobId } });
    if (blob.state !== "PRESERVED") return 0;
    await readCorrectionBlob(blob.ownerPlayerId, blob.digest, blob.bytes);
    return (await tx.correctionRetentionPin.updateMany({ where: { blobId: blob.id, releasedAt: null }, data: { releasedAt: now } })).count;
  }, { timeout: 30000 });
  return released;
}

// Explicit removal is the only reason for raw-library GC. Two durable phases
// ensure a retry cannot attach or resurrect a deletion-claimed object.
export async function collectDeletedCorrectionBlobs(db: PrismaClient, now = new Date()) {
  const blobs = await db.correctionBlob.findMany({ where: { OR: [
    { state: "DELETING" }, { state: { not: "DELETED" }, examples: { none: { deletedAt: null } } },
  ] },
    orderBy: { id: "asc" }, take: 4 });
  let removed = 0;
  for (const original of blobs) {
    const claimed = await db.$transaction(async tx => {
      await correctionMaintenanceGate(tx);
      if (await correctionBackupActive(tx)) return false;
      await lockCorrectionOwner(tx, original.ownerPlayerId);
      const current = await tx.correctionBlob.findUnique({ where: { id: original.id } });
      if (!current || current.state === "DELETED") return false;
      // Resume an already durable deletion claim even if a new membership or
      // backup arrived between phases of the previous maintenance pass.
      if (current.state === "DELETING") return true;
      if (await tx.correctionExample.count({ where: { blobId: original.id, deletedAt: null } })) return false;
      await tx.correctionBlob.update({ where: { id: original.id }, data: { state: "DELETING", deleteClaimedAt: now } });
      await tx.correctionCaptureOutbox.updateMany({ where: { blobId: original.id }, data: { status: "REMOVED", leaseToken: null, leaseExpiresAt: null } });
      await tx.correctionRetentionPin.updateMany({ where: { blobId: original.id, releasedAt: null }, data: { releasedAt: now } });
      return true;
    });
    if (!claimed) continue;
    removed += await db.$transaction(async tx => {
      await correctionMaintenanceGate(tx);
      if (await correctionBackupActive(tx)) return 0;
      await lockCorrectionOwner(tx, original.ownerPlayerId);
      const blob = await tx.correctionBlob.findUniqueOrThrow({ where: { id: original.id } });
      if (blob.state !== "DELETING") return 0;
      if (await tx.correctionExample.count({ where: { blobId: blob.id, deletedAt: null } })) {
        // A different physical copy may arrive after a deletion claim. Its pin
        // remains protected while the independent capture queue rechecks bytes.
        await tx.correctionBlob.update({ where: { id: blob.id }, data: { state: "PENDING", preservedAt: null, deleteClaimedAt: null } });
        if (blob.preservedAt) await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: blob.ownerPlayerId },
          data: { preservedBytes: { decrement: blob.bytes }, reservedBytes: { increment: blob.bytes } } });
        await tx.correctionBlob.update({ where: { id: blob.id }, data: { reserved: blob.reserved || !!blob.preservedAt } });
        await tx.correctionCaptureOutbox.updateMany({ where: { blobId: blob.id }, data: { status: "PENDING", availableAt: now, errorCode: null } });
        return 0;
      }
      await removeCorrectionBlob(blob.ownerPlayerId, blob.digest);
      await tx.correctionBlob.update({ where: { id: blob.id }, data: { state: "DELETED", reserved: false, preservedAt: null } });
      await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: blob.ownerPlayerId }, data: {
        ...(blob.preservedAt ? { preservedBytes: { decrement: blob.bytes } } : {}),
        ...(blob.reserved ? { reservedBytes: { decrement: blob.bytes } } : {}),
      } });
      return 1;
    }, { timeout: 30000 });
  }
  return removed;
}

export async function cleanCorrectionTemporaries(db: PrismaClient, now = new Date()) {
  const accounts = await db.correctionLibraryAccount.findMany({ orderBy: [{ lastCleanupAt: "asc" }, { ownerPlayerId: "asc" }], take: 2 });
  let removed = 0;
  for (const account of accounts) {
    const candidates = await staleCorrectionTemporaries(account.ownerPlayerId, new Date(now.getTime() - 3600000));
    for (const temporary of candidates) {
      removed += await db.$transaction(async tx => {
        await lockCorrectionOwner(tx, account.ownerPlayerId);
        // Claim and publication also hold this owner lock. An expired worker's
        // part cannot become authoritative after this check.
        if (await tx.correctionCaptureOutbox.count({ where: { status: "RUNNING", leaseToken: temporary.leaseToken,
          leaseExpiresAt: { gt: now }, blob: { ownerPlayerId: account.ownerPlayerId } } })) return 0;
        await removeCorrectionTemporary(account.ownerPlayerId, temporary.name);
        return 1;
      });
    }
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: account.ownerPlayerId }, data: { lastCleanupAt: now } });
  }
  return removed;
}
