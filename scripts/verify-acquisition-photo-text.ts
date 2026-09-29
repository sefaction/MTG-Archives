import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { completeAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { createCatalogReconciliationHandler, enqueueCatalogReconciliation } from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import { createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { UNLOCALIZED_NAME_HINT } from "../lib/acquisition-photo-text";
import { VISUAL_STAGE } from "../lib/acquisition-visual";
import { confirmStrongAcquisitionMatches } from "../lib/acquisition-auto-confirm";
import { getAcquisitionCardReview, saveAcquisitionReview, type AcquisitionActor } from "../lib/acquisition-store";
import { claimFixtureJobs } from "./acquisition-verification-queue";
import type { ScryfallCard } from "../lib/scryfall";

// Disposable-database proof: whole-photo names absent locally must still reach
// the existing metadata cache when an unrelated image match is also FOUND.
export async function verifyAcquisitionPhotoText(db: PrismaClient, actor: AcquisitionActor,
  sessionId: string, templatePhotoId: string, templateJob: ClaimedAcquisitionJob) {
  const name = `Unlocalized name ${randomUUID().slice(0, 8)}`;
  const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const keys = new Set<string>();
  const cards: ScryfallCard[] = ids.map((id, i) => ({ object: "card", id,
    name: i === 2 ? `Unrelated image ${name}` : name, set: i === 1 ? "plst" : "hint",
    set_name: "Fixture", collector_number: i === 1 ? "HINT-7" : `${7+i}`,
    lang: "en", digital: false, type_line: "Creature", finishes: ["nonfoil"],
    rarity: "common", cmc: 1, color_identity: [],
  }));
  const template = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: templatePhotoId}});
  const candidateTemplate = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: templateJob.candidateId}});
  const stock = await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}});
  const slot = await db.acquisitionCaptureSlot.create({data: {runId: templateJob.runId,
    requestKey: randomUUID(), position: 2000, generation: 1}});
  let photoId: string | undefined, artifactId: string | undefined, candidateId: string | undefined;
  try {
    const photo = await db.acquisitionPhoto.create({data: {runId: templateJob.runId, slotId: slot.id,
      uploadKey: randomUUID(), generation: 1, digest: template.digest, bytes: template.bytes,
      mediaType: template.mediaType, width: template.width, height: template.height, ready: true, readyAt: new Date()}});
    photoId = photo.id;
    const artifact = await db.acquisitionArtifact.create({data: {runId: templateJob.runId,
      sourceId: photo.id, digest: photo.digest}});
    artifactId = artifact.id;
    const candidate = await db.acquisitionCandidate.create({data: {runId: templateJob.runId, physicalId: slot.id,
      identityKind: candidateTemplate.identityKind, acquisitionOrder: 2000, spatialOrder: 0,
      expectedSides: candidateTemplate.expectedSides, provisional: candidateTemplate.provisional,
      uncertainty: candidateTemplate.uncertainty, revision: 0}});
    candidateId = candidate.id;
    const observations = [0, 180].map(rotationDegrees => ({rotationDegrees,
      text: {title: [], footer: []}, lines: []}));
    const native = {version: 1, descriptor: "a".repeat(64), descriptorDetails: {}, photoDigest: photo.digest,
      text: observations[0].text, orientations: observations, geometry: {status: "NEEDS_CROP"}, lines: [],
      milliseconds: 1, automaticAcceptance: false,
      photoText: {version: 1, scope: "WHOLE_PHOTO", status: "PARTIAL",
        readings: [{rotationDegrees: 90, text: [name], truncated: false}]}};
    const common = {runId: templateJob.runId, artifactId: artifact.id, candidateId: candidate.id,
      candidateRevision: 0, versionKey: randomUUID(), input: {photoId: photo.id, digest: photo.digest}, status: "COMPLETE" as const};
    const raw = await db.acquisitionProcessingJob.create({data: {...common, stage: "photo-recognition-v1",
      output: {version: 1, photoId: photo.id, native, versions: {catalog: "b".repeat(64), model: "a".repeat(64)},
        proposals: proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([]), observations)} as unknown as Prisma.InputJsonObject}});
    await db.acquisitionProcessingJob.create({data: {...common, stage: VISUAL_STAGE,
      output: {version: 1, photoId: photo.id, visual: {version: 1, descriptor: "c".repeat(64),
        photoDigest: photo.digest, referenceCount: 112472, unavailableCount: 899, inputRegion: "WHOLE_PHOTO",
        geometry: {status: "NEEDS_CROP"}, milliseconds: 1, automaticAcceptance: false,
        candidates: [{scryfallId: ids[2], referenceId: `${ids[2]}:0`, name: cards[2].name,
          setCode: "hint", collectorNumber: "9", distance: 0.1, rotationDegrees: 270}]}}}});
    assert.equal(await enqueueCatalogReconciliation(db, new Date(), true), 1);
    const [job] = await claimFixtureJobs(db, {workerId: "photo-text-fixture", stages: [CATALOG_RECONCILIATION_STAGE]});
    assert.equal(job?.candidateId, candidate.id);
    const requests: string[] = [];
    const handler = createCatalogReconciliationHandler(db, async (query, signal) => {
      keys.add(catalogQueryKey(query));
      return resolveCachedAcquisitionCatalog(db, query, signal, async () => {
        requests.push(query.kind);
        assert(query.kind === "id" || (query.kind === "name" &&
          [name, cards[2].name].includes(query.name) && !query.fuzzy),
          "unlocalized text must not become a set/collector or fuzzy lookup");
        return {status: "FOUND", cards: query.kind === "name" && query.name === name ? cards.slice(0, 2) : [cards[2]],
          requestsMade: 1, printingCoverage: "CHECKED"};
      });
    });
    const output = await handler(job, AbortSignal.timeout(30000));
    assert.deepEqual(requests, ["name", "id", "name"],
      "missing-local name precedes unrelated visual identity and its ordinary printing-coverage lookup");
    const local = await db.card.findMany({where: {scryfallId: {in: ids}}, orderBy: {scryfallId: "asc"}});
    assert.equal(local.length, 3);
    assert(local.every(card => !ids.includes(card.id)), "provider identities retain separate stable local IDs");
    const proposals = output.proposals as any;
    assert.equal(proposals.automaticAcceptance, false);
    assert.equal(proposals.proposals[0].card.name, name);
    const hints = proposals.proposals.filter((p: any) => p.card.name === name);
    assert.equal(hints.length, 2, "original and stamped printings remain separate review choices");
    assert(hints.every((p: any) => p.reasons.includes(UNLOCALIZED_NAME_HINT) &&
      !p.reasons.some((r: string) => ["TITLE_EXACT", "SET_AND_COLLECTOR_TEXT", "STRONG_EXACT_PRINTING"].includes(r))));
    assert.deepEqual(proposals.evidence, {setCodes: [], collectors: [], languages: []});
    assert.deepEqual(output.native, native, "canonical evidence and unlocalized readings remain immutable");
    assert.equal(output.sourceRecognitionJobId, raw.id);
    assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    const review = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    assert.deepEqual(review.evidence?.photoText, native.photoText);
    assert.equal(review.evidence?.geometry.status, "NEEDS_CROP");
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    await handler(job, AbortSignal.timeout(30000));
    assert.deepEqual(requests, ["name", "id", "name"], "retry reuses the existing shared cache");
    const running = await db.acquisitionProcessingJob.update({where: {id: job.id},
      data: {status: "RUNNING", leaseToken: "late-photo-text", leaseExpiresAt: new Date(Date.now()+30000)}});
    await saveAcquisitionReview(db, actor, sessionId, {action: "accept", photoId: photo.id, revision: review.revision,
      decision: {cardId: hints[0].card.id, language: "en", finish: "NONFOIL", condition: "LP"}});
    const saved = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    assert.equal(await completeAcquisitionJob(db, running as ClaimedAcquisitionJob, output), "SUPERSEDED");
    assert.deepEqual((await getAcquisitionCardReview(db, actor, sessionId, photo.id)).review, saved.review);
    assert.deepEqual(await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}}), stock);
    console.log("PASS: missing-local whole-photo name fallback, independent visual identity, immutable unlocalized evidence, cache reuse, saved review and zero Inventory");
  } finally {
    if (candidateId) await db.acquisitionProcessingJob.deleteMany({where: {candidateId}});
    if (photoId) await db.acquisitionPhoto.deleteMany({where: {id: photoId}});
    if (candidateId) await db.acquisitionCandidate.deleteMany({where: {id: candidateId}});
    if (artifactId) await db.acquisitionArtifact.deleteMany({where: {id: artifactId}});
    await db.acquisitionCaptureSlot.deleteMany({where: {id: slot.id}});
    await db.acquisitionCatalogLookup.deleteMany({where: {key: {in: [...keys]}}});
    await db.card.deleteMany({where: {scryfallId: {in: ids}}});
  }
}
