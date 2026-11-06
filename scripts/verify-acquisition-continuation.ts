import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, writeFile, link, readFile, rm} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {PrismaClient} from "@prisma/client";
import {createScannerPairing, claimScannerPairing, recordScannerPulse} from "../lib/scanner-store";
import {scannerSecret} from "../lib/scanner-protocol";
import {scannerSiteEpoch} from "../lib/scanner-control-files";
import {COUNTED_SCANNER_DEVICE, COUNTED_SCANNER_BACKEND, countedScannerSettings} from "../lib/scanner-counted-profile";
import {createScannerBatch, claimScannerRun, receiveScannerImage, finishScannerRun, getScannerBatch, stopScannerBatch,
  refillScannerBatch, endScannerBatch} from "../lib/scanner-runs";
import {getAcquisitionProgress, getAcquisitionPhoto, saveAcquisitionReview, getAcquisitionCardReview} from "../lib/acquisition-store";
import {readAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {ensureCorrectionAccount} from "../lib/acquisition-correction-library";
import {previewAcquisitionCommit, commitAcquisitionCards} from "../lib/acquisition-commit-service";
import {purgeAcquisitionPhotosUnderPressure} from "../lib/acquisition-photo-pressure";

export async function acquisitionContinuationSnapshot(db: PrismaClient) {
  const tables = await db.$queryRaw<{tablename: string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, unknown> = {};
  for (const {tablename} of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename)) throw Error("Unexpected table");
    result[tablename] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(j::text),'' ORDER BY md5(j::text)),'')) AS hash FROM (SELECT to_jsonb(x) AS j FROM "${tablename}" x) rows`);
  }
  return result;
}

/** Disposable SQL fixture only. Prehistory is seeded explicitly; every later
 * transfer/finish/replay runs the real server functions, with no native device. */
export async function verifyAcquisitionContinuation(db: PrismaClient, options: {largeOriginal?: boolean; retain?: boolean} = {}) {
  const before = await acquisitionContinuationSnapshot(db);
  const tag = "continuous-" + randomUUID(), foreign = tag + "-foreign", locationId = tag + "-box";
  const parent = path.resolve(".local-data"); await mkdir(parent, {recursive: true});
  const root = await mkdtemp(path.join(parent, "continuous-photos-")), oldRoot = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const actor = {userId: tag, adminMode: false}, agentId = randomUUID();
  const device = {id: COUNTED_SCANNER_DEVICE, name: "Continuation fixture; no hardware", backend: COUNTED_SCANNER_BACKEND,
    source: "Twain", qualification: "KnownWorking"};
  let passed = false;
  try {
    for (const id of [tag, foreign]) {
      await db.player.create({data: {id, name: id, displayName: id}});
      await db.user.create({data: {id, username: id, displayName: id, playerId: id, passwordHash: "fixture-not-login"}});
    }
    await db.$transaction(tx => ensureCorrectionAccount(tx, tag));
    await db.correctionLibraryAccount.update({where: {ownerPlayerId: tag}, data: {sampleBasisPoints: 0}});
    await db.inventoryLocation.create({data: {id: locationId, name: tag, normalizedName: tag, ownerPlayerId: tag,
      type: "Box", storageLayout: {capacity: null, sections: []}}});
    const card = await db.card.create({data: {scryfallId: tag, name: tag, setCode: "tst", collectorNumber: "1",
      typeLine: "Creature", rarity: "common", lang: "en", digital: false, finishes: ["nonfoil"]}});
    const pair = await createScannerPairing(db, tag), secret = scannerSecret();
    await claimScannerPairing(db, {version: 1, pairCode: pair.code, agentId, secret, name: "Continuation fixture"});
    const authorization = "Bearer " + agentId + "." + secret;
    const pulse = () => recordScannerPulse(db, authorization, {version: 1, agentVersion: "fixture", devices: [device]});
    await pulse(); const epoch = await scannerSiteEpoch();
    const initial = await createScannerBatch(db, actor, {requestKey: randomUUID(), agentId, deviceId: device.id, locationId,
      section: "", quantity: null, loadedCount: null, settings: countedScannerSettings, operatorLoadedSimplexFronts: true}, epoch);
    assert.equal(initial.logicalTarget, null); assert.equal(initial.physicalTarget, 500);
    const run = await db.acquisitionRun.findUniqueOrThrow({where: {sessionId: initial.sessionId}});
    const noise = Buffer.alloc(1280 * 1280 * 3);
    let state = 123456789;
    for (let i = 0; i < noise.length; i++) {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; noise[i] = state & 255;}
    const bytes = options.largeOriginal
      ? await sharp(noise, {raw: {width: 1280, height: 1280, channels: 3}}).jpeg({quality: 94}).toBuffer()
      : await sharp({create: {width: 75, height: 105, channels: 3, background: "white"}}).jpeg().toBuffer();
    const width = options.largeOriginal ? 1280 : 75, height = options.largeOriginal ? 1280 : 105;
    if (options.largeOriginal) assert(bytes.length * 4500 > 4 * 1024 ** 3);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await mkdir(path.join(root, "acquisition-v1")); await writeFile(path.join(root, "source.jpg"), bytes);
    const claim = async (runId: string) => {
      await pulse(); const input = {version: 1, runId, epoch, executionId: randomUUID()};
      assert.equal((await claimScannerRun(db, authorization, input, epoch)).feedAuthorized, true); return input;
    };
    const finish = (input: Awaited<ReturnType<typeof claim>>, imageCount: number, empty = false) =>
      finishScannerRun(db, authorization, {...input, outcome: {outcome: empty ? "SOURCE_EXHAUSTED" : "COMPLETED", imageCount,
        elapsedMs: 1000, knownPhysicalItems: null, sourceExhausted: empty ? "REPORTED_EMPTY" : "UNKNOWN", nativeError: null}}, epoch);
    let current = await getScannerBatch(db, tag, initial.runId);
    // Seed nine completed internal feeds, retaining exact synthetic originals.
    // Hard links share fixture bytes only; every physical identity stays distinct.
    for (let chunk = 0; chunk < 9; chunk++) {
      const input = await claim(current.runId);
      const rows = Array.from({length: 500}, (_, i) => ({slot: randomUUID(), photo: randomUUID(), artifact: randomUUID(), candidate: randomUUID(), position: chunk * 500 + i}));
      await db.acquisitionCaptureSlot.createMany({data: rows.map(r => ({id: r.slot, runId: run.id, requestKey: r.photo, position: r.position, generation: 1}))});
      await db.acquisitionPhoto.createMany({data: rows.map(r => ({id: r.photo, runId: run.id, slotId: r.slot, uploadKey: r.photo,
        generation: 1, digest, bytes: bytes.length, mediaType: "image/jpeg", width, height, ready: true, readyAt: new Date(),
        inputKind: "CARD_SCAN", sourceMetadata: {runId: current.runId}}))});
      await db.acquisitionArtifact.createMany({data: rows.map(r => ({id: r.artifact, runId: run.id, sourceId: r.photo, digest}))});
      await db.acquisitionCandidate.createMany({data: rows.map(r => ({id: r.candidate, runId: run.id, physicalId: r.slot,
        identityKind: "DETECTION", acquisitionOrder: r.position, spatialOrder: 0, expectedSides: ["UNKNOWN"], provisional: true,
        uncertainty: [], revision: 0, countConfirmed: true}))});
      await db.acquisitionObservation.createMany({data: rows.map(r => ({runId: run.id, sourceId: r.photo, artifactId: r.artifact, candidateId: r.candidate, side: "UNKNOWN"}))});
      for (const r of rows) await link(path.join(root, "source.jpg"), path.join(root, "acquisition-v1", r.photo + ".original"));
      await finish(input, 500); current = await getScannerBatch(db, tag, initial.runId);
      assert.equal(current.sequenceOffset, (chunk + 1) * 500); assert.equal(current.sessionId, initial.sessionId);
    }
    const accepted: string[] = [];
    for (const count of [500, 500, 1]) {
      const input = await claim(current.runId);
      for (let sequence = 1; sequence <= count; sequence++) {
        if (sequence % 100 === 0) await pulse();
        const transfer = {...input, artifactId: randomUUID(), sequence, timestamp: new Date().toISOString(), side: "UNKNOWN", physicalBoundary: "UNKNOWN"};
        const receipt = await receiveScannerImage(db, authorization, transfer, epoch, bytes, "image/jpeg"); accepted.push(receipt.photoId);
        if (sequence === 1) assert.equal((await receiveScannerImage(db, authorization, transfer, epoch, bytes, "image/jpeg")).photoId, receipt.photoId);
      }
      await finish(input, count, count === 1);
      const next = await getScannerBatch(db, tag, initial.runId);
      await finish(input, count, count === 1);
      assert.equal((await getScannerBatch(db, tag, initial.runId)).runId, next.runId);
      current = next;
    }
    assert.equal(current.phase, "PAUSED");
    assert.equal(await db.acquisitionPhoto.count({where: {runId: run.id}}), 5501);
    const positions = await db.acquisitionCaptureSlot.findMany({where: {runId: run.id}, select: {position: true}, orderBy: {position: "asc"}});
    assert.deepEqual(positions.map(s => s.position), Array.from({length: 5501}, (_, i) => i));
    const all = new Set<string>();
    for (let page = 0; page < 56; page++) {
      const progress = await getAcquisitionProgress(db, actor, initial.sessionId, page);
      assert.equal(progress.reservedSlots, 5501); assert(progress.slots.length <= 100);
      for (const slot of progress.slots) {assert(!all.has(slot.id)); all.add(slot.id);}
      assert(progress.photoMatches.every(match => match.count === 5501));
    }
    assert.equal(all.size, 5501);
    await assert.rejects(getAcquisitionProgress(db, {userId: foreign, adminMode: false}, initial.sessionId));
    const photoId = accepted.at(-1)!;
    assert.equal((await getAcquisitionPhoto(db, actor, initial.sessionId, photoId)).digest, digest);
    assert.deepEqual(await readAcquisitionPhotoBytes(photoId, "raw", digest), bytes);
    const beforePressure = await acquisitionContinuationSnapshot(db); await purgeAcquisitionPhotosUnderPressure(db);
    assert.deepEqual(await acquisitionContinuationSnapshot(db), beforePressure, "pending originals/reviews/jobs must survive pressure cleanup");
    // A real empty hopper requires an explicit refill. Cancelling its queued
    // continuation through the original batch identity prevents another START.
    const refill = await refillScannerBatch(db, tag, {runId: current.runId, requestKey: randomUUID(), loadedCount: null,
      operatorLoadedSimplexFronts: true}, epoch);
    await stopScannerBatch(db, tag, initial.runId);
    assert.equal((await getScannerBatch(db, tag, initial.runId)).runId, refill.runId);
    await assert.rejects(claim(refill.runId));
    const review = await getAcquisitionCardReview(db, actor, initial.sessionId, photoId);
    await saveAcquisitionReview(db, actor, initial.sessionId, {action: "accept", photoId, revision: review.revision,
      decision: {cardId: card.id, language: "en", finish: "NONFOIL", condition: "NM"}});
    const selection = {photoIds: [photoId], locationId, section: ""};
    // A one-card page cannot make a globally overflowing card allocated.
    const originalSession = await db.acquisitionSession.findUniqueOrThrow({where: {id: initial.sessionId}});
    await db.acquisitionSession.update({where: {id: initial.sessionId}, data: {target: 100}});
    try {
      assert((await getAcquisitionProgress(db, actor, initial.sessionId, 55)).slots[0].physicalReadiness.reasons.includes("OVERFLOW"));
      const bounded = await acquisitionContinuationSnapshot(db);
      await assert.rejects(previewAcquisitionCommit(db, actor, initial.sessionId, selection), /confirmed physical count/);
      assert.deepEqual(await acquisitionContinuationSnapshot(db), bounded, "overflow refusal must not mutate any public table");
    } finally {
      await db.acquisitionSession.update({where: {id: initial.sessionId}, data: {target: originalSession.target, updatedAt: originalSession.updatedAt}});
    }
    const preview = await previewAcquisitionCommit(db, actor, initial.sessionId, selection);
    const request = {...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null};
    const receipt = await commitAcquisitionCards(db, actor, initial.sessionId, request);
    assert.equal((await commitAcquisitionCards(db, actor, initial.sessionId, request)).id, receipt.id);
    assert.equal(await db.inventoryItem.count({where: {currentOwnerId: tag, quantity: 1}}), 1);
    assert.equal(await db.acquisitionCommitMember.count({where: {runId: run.id}}), 1);
    console.log(JSON.stringify({pass: true, seeded: 4500, actualTransfers: accepted.length, saved: all.size,
      originalBytes: bytes.length, logicalRetainedBytes: bytes.length * 5501, pages: 56, physicalFeeds: 0,
      sessionId: initial.sessionId, userId: tag, root}));
    passed = true;
  } finally {
    if (passed && !options.retain) {
      const owners = {ownerPlayerId: {in: [tag, foreign]}}, w = {run: {session: {createdByUserId: tag}}};
      await db.correctionRetentionPin.deleteMany({where: owners}); await db.correctionCaptureOutbox.deleteMany({where: {blob: owners}});
      for (const model of ["correctionExample", "correctionReviewEvent", "correctionEvidence", "correctionLibraryAccess", "correctionBlob", "correctionDeletionTombstone", "correctionLibraryAccount"] as const)
        await (db[model].deleteMany as (arg: unknown) => Promise<unknown>)({where: owners});
      await db.scannerRun.deleteMany({where: {agentId}});
      await db.acquisitionCommitMember.deleteMany({where: {commit: w}}); await db.acquisitionCommit.deleteMany({where: w});
      for (const model of ["acquisitionProcessingJob", "acquisitionProcessingTurn", "acquisitionPhoto", "acquisitionObservation", "acquisitionCountCorrection", "acquisitionCandidate", "acquisitionArtifact", "acquisitionCaptureSlot", "acquisitionCommand", "acquisitionEvent"] as const)
        await (db[model].deleteMany as (arg: unknown) => Promise<unknown>)({where: w});
      await db.acquisitionRun.deleteMany({where: {session: {createdByUserId: tag}}}); await db.acquisitionSession.deleteMany({where: {createdByUserId: tag}});
      await db.scannerPairing.deleteMany({where: {userId: tag}}); await db.scannerAgent.deleteMany({where: {id: agentId}});
      await db.inventoryAuditLog.deleteMany({where: {changedByUserId: tag}}); await db.inventoryItem.deleteMany({where: {currentOwnerId: tag}});
      await db.card.deleteMany({where: {scryfallId: tag}}); await db.inventoryLocation.deleteMany({where: {id: locationId}});
      await db.user.deleteMany({where: {id: {in: [tag, foreign]}}}); await db.player.deleteMany({where: {id: {in: [tag, foreign]}}});
      if (path.dirname(root) !== parent || !path.basename(root).startsWith("continuous-photos-")) throw Error("Fixture path escaped");
      await rm(root, {recursive: true, force: true});
      assert.deepEqual(await acquisitionContinuationSnapshot(db), before, "all public tables must conserve after fixture cleanup");
      console.log("PASS continuation cleanup: all public table counts and full-row fingerprints restored");
    } else console.log("Retained isolated continuation evidence for review", {passed, root, tag});
    if (oldRoot === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = oldRoot;
  }
}
