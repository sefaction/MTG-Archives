import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { type PrismaClient } from "@prisma/client";
import { createScannerPairing, claimScannerPairing, recordScannerPulse, revokeScannerAgent } from "../lib/scanner-store";
import { scannerSecret } from "../lib/scanner-protocol";
import { createScannerBatch, claimScannerRun, pollScannerRun, receiveScannerImage,
  finishScannerRun, reconcileScannerBatch, getScannerBatch, stopScannerBatch } from "../lib/scanner-runs";
import { scannerSiteEpoch } from "../lib/scanner-control-files";
import { getAcquisitionSession } from "../lib/acquisition-store";
import { captureSummary } from "../lib/acquisition-domain";
import { readAcquisitionPhotoBytes, photoDigest } from "../lib/acquisition-files";

// Called only by the opt-in disposable acquisition_* database runner. Transfers
// are generated fixtures: no scanner hardware or recognition accuracy claim.
export async function verifyScannerRuns(db: PrismaClient) {
  const tag = `scanner-runs-${randomUUID()}`, other = `${tag}-other`, locationId = `${tag}-box`;
  const ids = [tag, other], prior = process.env.UPLOADS_DATA_PATH;
  const parent = path.resolve(".local-data"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "scanner-run-db-"));
  process.env.UPLOADS_DATA_PATH = root;
  const actor = { userId: tag, adminMode: false }, epoch = await scannerSiteEpoch();
  const settings = { dpi: 300, widthInches: 2.6, heightInches: 3.6, horizontalPlacement: "Start", duplex: false,
    color: "RGB", autoCrop: false, deskew: false, removeBlank: false };
  const bytes = await sharp({ create: { width: 75, height: 105, channels: 3, background: "white" } }).png().toBuffer();
  const source = { id: "fixture-wia", name: "Fixture source", backend: "fixture", source: "Wia", qualification: "GenericUnqualified" };
  try {
    for (const id of ids) {
      await db.player.create({ data: { id, name: id, displayName: id } });
      await db.user.create({ data: { id, username: id, displayName: id, playerId: id, passwordHash: "fixture-not-login" } });
    }
    await db.inventoryLocation.create({ data: { id: locationId, name: tag, normalizedName: tag, ownerPlayerId: tag, type: "BOX" } });
    async function enroll() {
      const pair = await createScannerPairing(db, tag), agentId = randomUUID(), secret = scannerSecret();
      await claimScannerPairing(db, { version: 1, pairCode: pair.code, agentId, secret, name: "Run fixture" });
      const token = `Bearer ${agentId}.${secret}`;
      await recordScannerPulse(db, token, { version: 1, agentVersion: "fixture", devices: [source] });
      return { agentId, token };
    }
    const first = await enroll();
    const input = { requestKey: randomUUID(), agentId: first.agentId, deviceId: source.id, locationId, section: "",
      quantity: 2, loadedCount: 2, operatorLoadedSimplexFronts: true, settings };
    await assert.rejects(createScannerBatch(db, { userId: other, adminMode: false }, input, epoch));
    await assert.rejects(createScannerBatch(db, actor, { ...input, loadedCount: 3 }, epoch));
    const run = await createScannerBatch(db, actor, input, epoch);
    assert.equal(run.physicalTarget, 2);
    assert.equal((await createScannerBatch(db, actor, input, epoch)).runId, run.runId);
    assert.equal((await pollScannerRun(db, first.token, epoch)).run?.runId, run.runId);
    await assert.rejects(createScannerBatch(db, actor, { ...input, requestKey: randomUUID() }, epoch));
    await assert.rejects(getScannerBatch(db, other, run.runId));
    const executionId = randomUUID(), claim = { version: 1, runId: run.runId, epoch, executionId };
    assert.equal((await claimScannerRun(db, first.token, claim, epoch)).feedAuthorized, true);
    assert.equal((await claimScannerRun(db, first.token, claim, epoch)).replay, true);
    await assert.rejects(claimScannerRun(db, first.token, { ...claim, executionId: randomUUID() }, epoch));
    await assert.rejects(claimScannerRun(db, first.token, { ...claim, epoch: randomUUID() }, epoch));
    const otherAgent = await enroll();
    await assert.rejects(claimScannerRun(db, otherAgent.token, claim, epoch));
    const transfer = (sequence: number) => ({ ...claim, artifactId: randomUUID(), sequence,
      timestamp: new Date().toISOString(), side: "UNKNOWN", physicalBoundary: "UNKNOWN" });
    // Out-of-order delivery still preserves the scanner's sequence; ACK loss
    // reuses the same slot/photo/job and source metadata rather than new copies.
    const t2 = transfer(2), t1 = transfer(1);
    const ack2 = await receiveScannerImage(db, first.token, t2, epoch, bytes, "image/png");
    const ack1 = await receiveScannerImage(db, first.token, t1, epoch, bytes, "image/png");
    assert.deepEqual(await receiveScannerImage(db, first.token, t2, epoch, bytes, "image/png"), ack2);
    assert.equal(ack1.digest, photoDigest(bytes));
    assert.deepEqual(await readAcquisitionPhotoBytes(ack1.photoId, "raw", ack1.digest), bytes);
    await assert.rejects(receiveScannerImage(db, first.token, { ...t2, sequence: 3 }, epoch, bytes, "image/png"));
    await assert.rejects(receiveScannerImage(db, first.token, { ...t2, timestamp: "2026-01-01T00:00:00Z" }, epoch, bytes, "image/png"));
    await assert.rejects(receiveScannerImage(db, otherAgent.token, t1, epoch, bytes, "image/png"));
    await assert.rejects(receiveScannerImage(db, first.token, t1, randomUUID(), bytes, "image/png"));
    const stored = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: ack1.photoId } });
    assert.equal(stored.inputKind, "CARD_SCAN");
    assert.equal((stored.sourceMetadata as { backend: string }).backend, "fixture");
    assert.equal(await db.acquisitionProcessingJob.count({ where: { run: { sessionId: run.sessionId }, stage: "photo-canonical-v1" } }), 2);
    const outcome = { outcome: "COMPLETED", imageCount: 2, elapsedMs: 1000, knownPhysicalItems: null,
      sourceExhausted: "UNKNOWN", nativeError: null };
    await assert.rejects(finishScannerRun(db, first.token, { ...claim, outcome: { ...outcome, imageCount: 3 } }, epoch));
    await finishScannerRun(db, first.token, { ...claim, outcome }, epoch);
    assert.equal((await finishScannerRun(db, first.token, { ...claim, outcome }, epoch)).status, "DRAINED");
    let state = await getAcquisitionSession(db, actor, run.sessionId);
    assert.equal(captureSummary(state.session).confirmedCandidates, 0);
    assert.ok(state.session.candidates.every(c=>c.input.provisional && c.observations[0].side === "UNKNOWN"));
    const observation = { runId: run.runId, cardsEmitted: 2, feederEmpty: true, transportEmpty: true,
      eachImageIsOneCardFront: true, noJamOrDouble: true };
    await assert.rejects(reconcileScannerBatch(db, other, observation));
    await assert.rejects(reconcileScannerBatch(db, tag, { ...observation, cardsEmitted: 1 }));
    await reconcileScannerBatch(db, tag, observation);
    assert.equal((await reconcileScannerBatch(db, tag, observation)).replay, true);
    state = await getAcquisitionSession(db, actor, run.sessionId);
    assert.equal(captureSummary(state.session).confirmedCandidates, 2);
    assert.equal(state.session.corrections.length, 2);
    assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: tag } }), 0);
    // New batch is allowed only after physical reconciliation. Extra captures
    // remain durable provisional overflow; the software does not truncate them.
    const extraInput = { ...input, requestKey: randomUUID() };
    const extra = await createScannerBatch(db, actor, extraInput, epoch);
    const extraClaim = { ...claim, runId: extra.runId, executionId: randomUUID() };
    await claimScannerRun(db, first.token, extraClaim, epoch);
    await stopScannerBatch(db, tag, extra.runId);
    assert.equal((await pollScannerRun(db, first.token, epoch)).run?.stopRequested, true);
    for (let sequence=1;sequence<=3;sequence++) await receiveScannerImage(db, first.token, {
      ...extraClaim, artifactId: randomUUID(), sequence, timestamp: new Date().toISOString(), side: "UNKNOWN", physicalBoundary: "UNKNOWN",
    }, epoch, bytes, "image/png");
    await finishScannerRun(db, first.token, { ...extraClaim, outcome: { ...outcome, outcome: "DRAINED_AFTER_UNSUPPORTED_STOP", imageCount: 3 } }, epoch);
    const overflow = captureSummary((await getAcquisitionSession(db, actor, extra.sessionId)).session);
    assert.equal(overflow.physicalCandidates, 3); assert.equal(overflow.overflow.length, 1);
    await assert.rejects(reconcileScannerBatch(db, tag, { ...observation, runId: extra.runId, cardsEmitted: 3 }));
    // Roll back DB START state while keeping independent durable evidence.
    const rolled = await createScannerBatch(db, actor, { ...input, agentId: otherAgent.agentId, requestKey: randomUUID() }, epoch);
    const rolledClaim = { ...claim, runId: rolled.runId, executionId: randomUUID() };
    await claimScannerRun(db, otherAgent.token, rolledClaim, epoch);
    await db.scannerRun.update({ where: { id: rolled.runId }, data: { status: "QUEUED", executionId: null } });
    const fenced = await claimScannerRun(db, otherAgent.token, rolledClaim, epoch);
    assert.equal(fenced.feedAuthorized, false); assert.equal(fenced.reconciliationRequired, true);
    await revokeScannerAgent(db, tag, first.agentId);
    await assert.rejects(receiveScannerImage(db, first.token, t1, epoch, bytes, "image/png"));
    console.log("PASS: native run claim/replay/restore-marker fencing, scoped originals/sequence/ACK replay, ordinary pipeline jobs, retained overflow and operator count reconciliation; no motor or Inventory");
  } finally {
    // Include orphan DRAFT sessions from explicitly rejected/retry creation.
    const where = { run: { session: { createdByUserId: { in: ids } } } };
    await db.scannerRun.deleteMany({ where: { agent: { userId: { in: ids } } } });
    await db.acquisitionProcessingJob.deleteMany({ where });
    await db.acquisitionPhoto.deleteMany({ where });
    await db.acquisitionObservation.deleteMany({ where });
    await db.acquisitionCountCorrection.deleteMany({ where });
    await db.acquisitionCandidate.deleteMany({ where });
    await db.acquisitionArtifact.deleteMany({ where });
    await db.acquisitionCaptureSlot.deleteMany({ where });
    await db.acquisitionCommand.deleteMany({ where });
    await db.acquisitionEvent.deleteMany({ where });
    await db.acquisitionRun.deleteMany({ where: { session: { createdByUserId: { in: ids } } } });
    await db.acquisitionSession.deleteMany({ where: { createdByUserId: { in: ids } } });
    await db.scannerPairing.deleteMany({ where: { userId: { in: ids } } });
    await db.scannerAgent.deleteMany({ where: { userId: { in: ids } } });
    await db.inventoryLocation.deleteMany({ where: { id: locationId } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.player.deleteMany({ where: { id: { in: ids } } });
    if (prior === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = prior;
    // Verified mkdtemp path is confined to this repository's private fixture root.
    if (path.dirname(root) !== parent || !path.basename(root).startsWith("scanner-run-db-")) throw new Error("Fixture path escaped");
    await rm(root, { recursive: true, force: true });
  }
}
