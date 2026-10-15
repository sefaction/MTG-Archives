import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { claimCorrectionCapture, completeCorrectionCapture, failCorrectionCapture } from "../lib/acquisition-correction-worker";

// This verifier runs only in the existing disposable acquisition database suite.
// Explicitly dated fixtures remain unchanged while default application time skews.
async function withHostSkew<T>(offset: number, action: () => Promise<T>) {
  const RealDate = globalThis.Date;
  class SkewDate extends RealDate {
    constructor(value?: any) { super(value === undefined ? RealDate.now() + offset : value); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = SkewDate as DateConstructor;
  try { return await action(); } finally { globalThis.Date = RealDate; }
}
async function databaseNow(db: PrismaClient) {
  const [row] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row.now.getTime();
}
async function assertDelay(db: PrismaClient, value: Date | null, before: number, delay: number) {
  assert.ok(value);
  const after = await databaseNow(db);
  assert.ok(value.getTime() >= before + delay - 2 && value.getTime() <= after + delay + 2,
    `Persisted delay must use database time (${delay}ms)`);
}
export async function verifyCorrectionCaptureClock(db: PrismaClient) {
  const owner = `correction-clock-${randomUUID()}`;
  const blobId = randomUUID();
  try {
    await db.$transaction(tx => ensureCorrectionAccount(tx, owner));
    await db.correctionBlob.create({ data: { id: blobId, ownerPlayerId: owner, digest: "c".repeat(64), bytes: 100, mediaType: "image/jpeg" } });
    await db.correctionExample.create({ data: { ownerPlayerId: owner, blobId, sourcePhotoId: randomUUID(),
      sourceCandidateId: randomUUID(), sourceSessionId: randomUUID(), sourceGeneration: 1, physicalCopyGroup: randomUUID() } });
    const job = await db.correctionCaptureOutbox.create({ data: { blobId, availableAt: new Date(0) } });
    const before = await databaseNow(db);
    const first = await withHostSkew(3600000, () => claimCorrectionCapture(db));
    assert.ok(first); assert.equal(first.id, job.id);
    await assertDelay(db, first.leaseExpiresAt, before, 120000);
    assert.equal(await withHostSkew(3600000, () => claimCorrectionCapture(db)), null, "Fast host must not steal an unexpired database lease");
    let publish = 0;
    const publicationBefore = await databaseNow(db);
    assert.equal(await withHostSkew(-3600000, () => completeCorrectionCapture(db, first, async () => { publish++; })), true);
    assert.equal(publish, 1);
    const preserved = await db.correctionBlob.findUniqueOrThrow({ where: { id: blobId } });
    await assertDelay(db, preserved.preservedAt, publicationBefore, 0);
    let account = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
    assert.equal(account.preservedBytes, 100n); assert.equal(account.reservedBytes, 0n);
    // Start another turn on the same fixture, with all accounting reset exactly.
    await db.correctionBlob.update({ where: { id: blobId }, data: { state: "PENDING", reserved: false, preservedAt: null } });
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owner }, data: { preservedBytes: 0 } });
    await db.correctionCaptureOutbox.update({ where: { id: job.id }, data: { status: "PENDING", availableAt: new Date(0) } });
    const slowBefore = await databaseNow(db);
    const slow = await withHostSkew(-3600000, () => claimCorrectionCapture(db));
    assert.ok(slow); await assertDelay(db, slow.leaseExpiresAt, slowBefore, 120000);
    assert.equal(await withHostSkew(3600000, () => claimCorrectionCapture(db)), null, "Another fast worker cannot steal this active lease");
    const retryBefore = await databaseNow(db);
    assert.equal((await withHostSkew(3600000, () => failCorrectionCapture(db, slow, "SOURCE_MISSING"))).count, 1);
    const failed = await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(failed.status, "PENDING"); assert.equal(failed.errorCode, "SOURCE_MISSING");
    assert.equal(failed.leaseToken, null); await assertDelay(db, failed.availableAt, retryBefore, 60000);
    assert.equal(await withHostSkew(3600000, () => claimCorrectionCapture(db)), null, "Fast host must not bypass a future retry");
    await db.correctionCaptureOutbox.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    const expired = await claimCorrectionCapture(db); assert.ok(expired);
    await db.correctionCaptureOutbox.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date((await databaseNow(db)) - 5000) } });
    assert.equal((await withHostSkew(-3600000, () => failCorrectionCapture(db, expired, "SOURCE_MISSING"))).count, 0, "Slow host cannot renew expired authority");
    assert.equal(await completeCorrectionCapture(db, expired, async () => { publish++; }), false); assert.equal(publish, 1);
    const reclaimed = await withHostSkew(-3600000, () => claimCorrectionCapture(db)); assert.ok(reclaimed);
    assert.notEqual(reclaimed.leaseToken, expired.leaseToken);
    assert.equal((await failCorrectionCapture(db, expired, "SOURCE_MISSING")).count, 0, "Old token cannot revoke a replacement lease");
    assert.equal(await completeCorrectionCapture(db, expired, async () => { publish++; }), false); assert.equal(publish, 1);
    const completeBefore = await databaseNow(db);
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owner }, data: { limitBytes: 1 } });
    assert.equal(await withHostSkew(3600000, () => completeCorrectionCapture(db, reclaimed, async () => { publish++; })), false);
    assert.equal(publish, 1);
    const completeWaiting = await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(completeWaiting.status, "WAITING_FOR_SPACE");
    await assertDelay(db, completeWaiting.availableAt, completeBefore, 60000);
    await db.correctionCaptureOutbox.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owner }, data: { limitBytes: 1 } });
    const spaceBefore = await databaseNow(db);
    assert.equal(await withHostSkew(-3600000, () => claimCorrectionCapture(db)), null);
    const waiting = await db.correctionCaptureOutbox.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(waiting.status, "WAITING_FOR_SPACE"); await assertDelay(db, waiting.availableAt, spaceBefore, 60000);
    account = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
    assert.equal(account.reservedBytes, 100n); assert.equal(account.preservedBytes, 0n);
    assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: owner } }), 0);
    console.log(JSON.stringify({ correctionCaptureClock: "PASS", hostSkewMs: [-3600000, 3600000],
      leaseMs: 120000, retryMs: 60000, expiredAndSupersededFenced: true, originalsAndInventoryUntouched: true }));
  } finally {
    await db.correctionCaptureOutbox.deleteMany({ where: { blobId } });
    await db.correctionExample.deleteMany({ where: { ownerPlayerId: owner } });
    await db.correctionBlob.deleteMany({ where: { ownerPlayerId: owner } });
    await db.correctionLibraryAccount.deleteMany({ where: { ownerPlayerId: owner } });
  }
}