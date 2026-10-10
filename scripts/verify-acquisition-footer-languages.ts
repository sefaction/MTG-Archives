import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { completeAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { createCatalogReconciliationHandler, enqueueCatalogReconciliation } from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE, CATALOG_RESOLVER_VERSION } from "../lib/acquisition-catalog-status";
import { ACQUISITION_TEXT_RESOLVER_VERSION } from "../lib/acquisition-recognition";
import { getAcquisitionCardReview, type AcquisitionActor } from "../lib/acquisition-store";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import { type ScryfallCard } from "../lib/scryfall";
import { cardWriteData } from "../lib/card-import";
import { claimFixtureJobs } from "./acquisition-verification-queue";

// Synthetic saved OCR in a disposable database: reinterpret metadata without
// new native work, provider network access, human labels or Inventory writes.
async function verifyFooterLanguageObservation(db: PrismaClient, actor: AcquisitionActor,
  sessionId: string, templatePhotoId: string, templateJob: ClaimedAcquisitionJob, supplemental: boolean) {
  const name = `Paired footer ${randomUUID().slice(0, 8)}`;
  const ids = [0, 1, 2, 3].map(() => randomUUID()), keys = new Set<string>();
  const cards: ScryfallCard[] = ids.map((id, i) => ({ object: "card", id, name,
    set: i < 2 ? "paira" : "pairb", collector_number: "7", lang: i % 2 ? "fr" : "en",
    set_name: "Fixture", digital: false, type_line: "Creature", finishes: ["nonfoil"], rarity: "common", cmc: 1, color_identity: [] }));
  const template = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: templatePhotoId}});
  const candidateTemplate = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: templateJob.candidateId}});
  const stock = await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}});
  const slot = await db.acquisitionCaptureSlot.create({data: {runId: templateJob.runId, requestKey: randomUUID(), position: 2500, generation: 1}});
  let photoId: string | undefined, artifactId: string | undefined, candidateId: string | undefined;
  try {
    const local = [];
    for (const card of cards) local.push(await db.card.create({data: {...(cardWriteData(card) as Omit<Prisma.CardCreateManyInput, "scryfallId">), scryfallId: card.id, firstCachedAt: new Date()}}));
    const photo = await db.acquisitionPhoto.create({data: {runId: templateJob.runId, slotId: slot.id,
      uploadKey: randomUUID(), generation: 1, digest: template.digest, bytes: template.bytes, mediaType: template.mediaType,
      width: template.width, height: template.height, ready: true, readyAt: new Date()}}); photoId = photo.id;
    const artifact = await db.acquisitionArtifact.create({data: {runId: templateJob.runId, sourceId: photo.id, digest: photo.digest}}); artifactId = artifact.id;
    const candidate = await db.acquisitionCandidate.create({data: {runId: templateJob.runId, physicalId: slot.id,
      identityKind: candidateTemplate.identityKind, acquisitionOrder: 2500, spatialOrder: 0,
      expectedSides: candidateTemplate.expectedSides, provisional: candidateTemplate.provisional,
      uncertainty: candidateTemplate.uncertainty, revision: 0}}); candidateId = candidate.id;
    const text = supplemental
      ? {title: [name], footer: ["PAIRAFRARTIST", "PAIRB EN", "C 7"], footerSupplemental: ["PAIRA FR ARTIST", "PAIRB EN", "C 7"]}
      : {title: [name], footer: ["PAIRA FR", "PAIRB EN", "C 7"]};
    const native = {version: 1, descriptor: "a".repeat(64), descriptorDetails: {}, photoDigest: photo.digest,
      text, orientations: [{rotationDegrees: 0, text, lines: []}, {rotationDegrees: 180, text: {title: [], footer: []}, lines: []}],
      geometry: {status: "ACCEPTED"}, lines: [], milliseconds: 1, automaticAcceptance: false};
    const legacy = {version: 4, status: "REVIEW_REQUIRED", automaticAcceptance: false, finish: "UNKNOWN", condition: "UNKNOWN",
      catalogCoverage: "NOT_ESTABLISHED", evidence: {setCodes: ["paira", "pairb"], collectors: ["7"], languages: ["fr", "en"]},
      totalProposals: 4, truncated: false, proposals: local.map(card => ({card: {id: card.id, name, setCode: card.setCode,
        collectorNumber: "7", lang: card.lang}, nameDistance: null, reasons: ["SET_AND_COLLECTOR_TEXT", "TITLE_EXACT", "REVIEW_REQUIRED"]}))};
    const source = {version: 1, photoId: photo.id, native, versions: {catalog: "b".repeat(64), model: "a".repeat(64)}, proposals: legacy};
    const common = {runId: templateJob.runId, artifactId: artifact.id, candidateId: candidate.id, candidateRevision: 0,
      versionKey: randomUUID(), input: {photoId: photo.id, digest: photo.digest}, status: "COMPLETE" as const};
    const raw = await db.acquisitionProcessingJob.create({data: {...common, stage: "photo-recognition-v1", output: source as unknown as Prisma.InputJsonObject}});
    await db.acquisitionProcessingJob.create({data: {...common, versionKey: randomUUID(), stage: CATALOG_RECONCILIATION_STAGE,
      input: {...common.input, recognitionJobId: raw.id, resolverVersion: "catalog-reconciliation-photo-text-v7"},
      output: {...source, sourceRecognitionJobId: raw.id, versions: {...source.versions, resolver: "catalog-reconciliation-photo-text-v7"}} as unknown as Prisma.InputJsonObject}});
    assert.equal(await enqueueCatalogReconciliation(db, new Date(), false), 1, "old metadata policy is reinterpreted from its completed OCR");
    const [job] = await claimFixtureJobs(db, {workerId: "footer-pair-fixture", stages: [CATALOG_RECONCILIATION_STAGE]}, {candidateId: candidate.id});
    assert.equal(job?.candidateId, candidate.id);
    let calls = 0;
    const handler = createCatalogReconciliationHandler(db, async (query, signal) => {
      keys.add(catalogQueryKey(query));
      return resolveCachedAcquisitionCatalog(db, query, signal, async () => {
        calls++;
        if (query.kind === "printing") assert((query.set === "paira" && query.language === "fr") ||
          (query.set === "pairb" && query.language === "en"), "provider receives observed pairs only");
        return {status: "FOUND", cards: query.kind === "printing" ? cards.filter(card => card.set === query.set && card.lang === query.language) : cards,
          requestsMade: 1, printingCoverage: "CHECKED"};
      });
    });
    await assert.rejects(handler({...job, input: {...job.input as Prisma.InputJsonObject, resolverVersion: "catalog-reconciliation-photo-text-v7"}}, AbortSignal.timeout(30000)), /interpretation version superseded/);
    assert.equal(calls, 0);
    const output = await handler(job, AbortSignal.timeout(30000)), proposals = output.proposals as any;
    const supported = proposals.proposals.filter((p: any) => p.reasons.includes("SET_AND_COLLECTOR_TEXT"));
    assert.deepEqual(supported.map((p: any) => `${p.card.setCode}:${p.card.lang}`).sort(), ["paira:fr", "pairb:en"]);
    assert.equal(proposals.automaticAcceptance, false); assert.deepEqual(output.native, native);
    assert.equal((output.versions as Prisma.InputJsonObject).resolver, CATALOG_RESOLVER_VERSION);
    assert.equal((output.versions as Prisma.InputJsonObject).textResolver, ACQUISITION_TEXT_RESOLVER_VERSION);
    assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    const review = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    assert.equal(review.review, null); assert.equal(review.suggestions.length, 2);
    const warmCalls = calls; await handler(job, AbortSignal.timeout(30000)); assert.equal(calls, warmCalls);
    assert.equal(await enqueueCatalogReconciliation(db, new Date(), false), 0);
    assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: raw.id}})).output, source, "saved OCR and its historical proposal remain immutable");
    assert.equal(await db.acquisitionProcessingJob.count({where: {candidateId: candidate.id, stage: "photo-recognition-v1"}}), 1, "metadata policy does not rerun native OCR");
    assert.deepEqual(await db.inventoryItem.aggregate({_count: {_all: true}, _sum: {quantity: true}}), stock);
    if (supplemental) assert(proposals.proposals.every((p: any) => p.reasons.includes("RECOVERED_FOOTER_LAYOUT")), "newly recovered footer evidence requires review");
    console.log("PASS: paired footer metadata refresh, obsolete-version fence, provider pairing/cache reuse, immutable OCR and explicit Inventory boundary");
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

export async function verifyAcquisitionFooterLanguages(db: PrismaClient, actor: AcquisitionActor,
  sessionId: string, templatePhotoId: string, templateJob: ClaimedAcquisitionJob) {
  await verifyFooterLanguageObservation(db, actor, sessionId, templatePhotoId, templateJob, false);
  await verifyFooterLanguageObservation(db, actor, sessionId, templatePhotoId, templateJob, true);
}
