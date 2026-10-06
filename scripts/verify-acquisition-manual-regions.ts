import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, getAcquisitionCardReview, saveAcquisitionReview,
  type AcquisitionActor, type CreateAcquisitionInput } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, readAcquisitionPhotoBytes } from "../lib/acquisition-files";

// Called only by the existing disposable PostgreSQL acquisition verification.
// Private originals live in its owned temporary directory, never in app storage.
export async function verifyAcquisitionManualRegions(db: PrismaClient, actor: AcquisitionActor,
  stranger: AcquisitionActor, base: CreateAcquisitionInput, bytes: Buffer) {
  const locationId = `manual-region-${randomUUID()}`;
  await db.inventoryLocation.create({data: {id: locationId, name: locationId, normalizedName: locationId,
    ownerPlayerId: base.ownerPlayerId, type: "Box", storageLayout: {capacity: 2, sections: [{name: "A", capacity: 2}]}}});
  const capture = await createAcquisitionSession(db, actor, {...base, locationId, requestKey: randomUUID(),
    policy: {kind: "MANUAL", quantity: 1}, run: {...base.run, providerId: "phone-photo-v1", runId: randomUUID()}});
  const sessionId = capture.session.id;
  await executeAcquisitionCommand(db, actor, sessionId, {requestKey: "start", revision: 0, command: "START"});
  const {slot} = await reserveAcquisitionCaptureSlot(db, actor, sessionId, "one");
  const metadata = await inspectAcquisitionPhoto(bytes, "image/jpeg");
  const photo = await beginAcquisitionPhoto(db, actor, sessionId, {slotId: slot.id, generation: 0,
    uploadKey: randomUUID(), metadata, inputKind: "PHOTO"});
  await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
  await finalizeAcquisitionPhoto(db, actor, sessionId, photo.id);
  const card = await db.card.create({data: {scryfallId: randomUUID(), name: "Manual region reviewed fixture",
    setCode: "rfx", collectorNumber: "1", typeLine: "Creature", rarity: "common", lang: "en", finishes: ["nonfoil"], digital: false}});
  const stock = () => db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}});
  const stockBefore = await stock();
  try {
    let state = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    await saveAcquisitionReview(db, actor, sessionId, {action: "accept", photoId: photo.id, revision: state.revision,
      decision: {cardId: card.id, finish: "NONFOIL", condition: "LP", language: "en"}});
    state = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    const review = structuredClone(state.review);
    const candidate = await db.acquisitionCandidate.findUniqueOrThrow({where: {runId_physicalId: {runId: photo.runId, physicalId: slot.id}}});
    const physical = {id: candidate.id, physicalId: candidate.physicalId, acquisitionOrder: candidate.acquisitionOrder,
      spatialOrder: candidate.spatialOrder, expectedSides: candidate.expectedSides, provisional: candidate.provisional,
      countConfirmed: candidate.countConfirmed, uncertainty: candidate.uncertainty, excluded: candidate.excluded};
    const region = {version: 1, quad: [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]};
    const request = {action: "region", photoId: photo.id, revision: state.revision, requestKey: randomUUID(), region};
    await assert.rejects(saveAcquisitionReview(db, stranger, sessionId, request), /unavailable/);
    const concurrent = await Promise.all([1, 2].map(() => saveAcquisitionReview(db, actor, sessionId, request)));
    assert.equal(concurrent.filter(result => result.replay === true).length, 1);
    assert.equal(concurrent.filter(result => result.replay === false).length, 1);
    assert.equal(await db.acquisitionCommand.count({where: {runId: photo.runId, requestKey: `manual-region:${request.requestKey}`}}), 1);
    state = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    assert.equal(state.revision, request.revision + 1);
    assert.deepEqual(state.manualRegion, region);
    assert.deepEqual(state.review, review);
    await assert.rejects(saveAcquisitionReview(db, actor, sessionId, {...request, region: null}), /request changed/);
    await assert.rejects(saveAcquisitionReview(db, actor, sessionId, {...request, requestKey: randomUUID()}), /card changed/);

    const beforeFault = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: candidate.id}});
    const fault = db.$extends({query: {acquisitionCommand: {async create() {throw new Error("injected repair history failure");}}}}) as unknown as PrismaClient;
    await assert.rejects(saveAcquisitionReview(fault, actor, sessionId, {...request, revision: state.revision,
      requestKey: randomUUID(), region: null}), /injected repair/);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where: {id: candidate.id}}), beforeFault);

    const races = await Promise.allSettled([region, null].map(next => saveAcquisitionReview(db, actor, sessionId,
      {...request, revision: state.revision, requestKey: randomUUID(), region: next})));
    assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(races.filter(result => result.status === "rejected").length, 1);
    state = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    await saveAcquisitionReview(db, actor, sessionId, {...request, revision: state.revision, requestKey: randomUUID(), region: null});
    state = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    assert.equal(state.manualRegion, null);
    assert.deepEqual(state.review, review);

    const fresh = () => ({...request, revision: state.revision, requestKey: randomUUID()});
    await db.acquisitionCaptureSlot.update({where: {id: slot.id}, data: {generation: photo.generation + 1}});
    await assert.rejects(saveAcquisitionReview(db, actor, sessionId, fresh()), /Photo changed/);
    await db.acquisitionCaptureSlot.update({where: {id: slot.id}, data: {generation: photo.generation}});
    await db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: new Date()}});
    await assert.rejects(saveAcquisitionReview(db, actor, sessionId, fresh()), /Photo changed/);
    await db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: null}});
    await db.acquisitionSession.update({where: {id: sessionId}, data: {phase: "CANCELLED", cancelledAt: new Date()}});
    await assert.rejects(saveAcquisitionReview(db, actor, sessionId, fresh()), /cancelled/);

    const final = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: candidate.id}});
    for (const [key, value] of Object.entries(physical)) assert.deepEqual(final[key as keyof typeof final], value);
    assert.deepEqual(final.review, review);
    assert.equal(await db.acquisitionCandidate.count({where: {runId: photo.runId}}), 1);
    assert.equal(await db.acquisitionCaptureSlot.count({where: {runId: photo.runId}}), 1);
    assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest), bytes);
    assert.deepEqual(await stock(), stockBefore);
    console.log("PASS: manual repair intent owner/source guards, atomic history, replay/races, saved review/physical count/original-byte conservation");
  } finally {
    await db.acquisitionSession.update({where: {id: sessionId}, data: {phase: "CANCELLED", cancelledAt: new Date()}});
    await db.card.delete({where: {id: card.id}});
  }
}
