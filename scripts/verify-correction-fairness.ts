import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { claimCorrectionCapture } from "../lib/acquisition-correction-worker";

// Independent persisted library queue; no app snapshot, files, scanner or models.
export async function verifyCorrectionFairness(db: PrismaClient) {
  const tag = `correction-fair-${randomUUID()}`, owners = [0,1,2,3].map(i => `${tag}-${i}`);
  const counts = [1500, 3, 2, 2], started = performance.now();
  const pending = owners.flatMap((ownerPlayerId, owner) => Array.from({ length: counts[owner] }, (_, position) => ({
    id: randomUUID(), ownerPlayerId, digest: createHash("sha256").update(`${ownerPlayerId}:${position}`).digest("hex"),
    bytes: 100, mediaType: "image/jpeg", createdAt: new Date((owner ? Date.UTC(2020,0,1) : Date.UTC(2000,0,1)) + position),
    sourcePhotoId: randomUUID(), sourceSessionId: randomUUID(),
  })));
  try {
    for (const owner of owners) await db.$transaction(tx => ensureCorrectionAccount(tx, owner));
    await db.correctionBlob.createMany({ data: pending.map(({ sourcePhotoId, sourceSessionId, ...blob }) => blob) });
    await db.correctionExample.createMany({ data: pending.map(blob => ({ ownerPlayerId: blob.ownerPlayerId, blobId: blob.id,
      sourcePhotoId: blob.sourcePhotoId, sourceCandidateId: randomUUID(), sourceSessionId: blob.sourceSessionId,
      sourceGeneration: 1, physicalCopyGroup: randomUUID() })) });
    await db.correctionRetentionPin.createMany({ data: pending.map(blob => ({ ownerPlayerId: blob.ownerPlayerId,
      blobId: blob.id, photoId: blob.sourcePhotoId, sessionId: blob.sourceSessionId })) });
    await db.correctionCaptureOutbox.createMany({ data: pending.map(blob => ({ blobId: blob.id, availableAt: blob.createdAt, createdAt: blob.createdAt })) });
    // A single global FIFO would choose the busy owner's first 1,500 rows.
    const first = [];
    const claimStart = performance.now();
    for (let i=0;i<4;i++) { const claim = await claimCorrectionCapture(db); assert.ok(claim); first.push(claim); }
    assert.deepEqual(new Set(first.map(c => c.blob.ownerPlayerId)), new Set(owners));
    assert.equal(first.find(c => c.blob.ownerPlayerId === owners[0])?.blob.id, pending[0].id);
    const reconnect = new PrismaClient();
    try {
      const next = await Promise.all([0,1,2,3].map(() => claimCorrectionCapture(reconnect)));
      assert.ok(next.every(c => c !== null));
      assert.deepEqual(new Set(next.map(c => c!.blob.ownerPlayerId)), new Set(owners));
      assert.equal(new Set([...first, ...next].map(c => c!.id)).size, 8);
      assert.equal(next.find(c => c!.blob.ownerPlayerId === owners[0])?.blob.id, pending[1].id);
    } finally { await reconnect.$disconnect(); }
    const claimElapsedMs = performance.now() - claimStart;
    // A full allowance consumes only that owner's turn; it does not monopolize
    // admission or release its original pin. The next owner still gets served.
    await db.correctionLibraryAccount.updateMany({ where: { ownerPlayerId: { in: owners } }, data: { lastCaptureAt: new Date(1) } });
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[0] }, data: { lastCaptureAt: null, limitBytes: 1 } });
    assert.equal(await claimCorrectionCapture(db), null);
    const waiting = await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { blobId: pending[2].id } });
    assert.equal(waiting.status, "WAITING_FOR_SPACE");
    assert.equal(await db.correctionRetentionPin.count({ where: { blobId: pending[2].id, releasedAt: null } }), 1);
    const other = await claimCorrectionCapture(db); assert.ok(other); assert.equal(other.blob.ownerPlayerId, owners[1]);
    for (const owner of owners) {
      const account = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
      const blobs = await db.correctionBlob.aggregate({ where: { ownerPlayerId: owner, reserved: true }, _sum: { bytes: true } });
      assert.equal(account.reservedBytes, BigInt(blobs._sum.bytes ?? 0));
      assert.equal(account.preservedBytes, 0n);
    }
    assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: { in: owners } } }), 0);
    console.log(JSON.stringify({ correctionFairness: "PASS", backlog: counts, concurrentClaims: 4,
      reconnected: true, fifoWithinOwner: true, blockedOwnerSkipped: true, claimElapsedMs: Math.round(claimElapsedMs), elapsedMs: Math.round(performance.now()-started) }));
  } finally {
    const where = { ownerPlayerId: { in: owners } };
    await db.correctionRetentionPin.deleteMany({ where });
    await db.correctionCaptureOutbox.deleteMany({ where: { blob: where } });
    await db.correctionExample.deleteMany({ where });
    await db.correctionBlob.deleteMany({ where });
    await db.correctionLibraryAccount.deleteMany({ where });
  }
}
