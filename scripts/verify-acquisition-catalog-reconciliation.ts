import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  completeAcquisitionJob,
  claimAcquisitionJobs,
  type ClaimedAcquisitionJob,
} from "../lib/acquisition-jobs";
import {
  createCatalogReconciliationHandler,
  enqueueCatalogReconciliation,
} from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";
import {
  createAcquisitionRecognitionIndex,
  proposeOrientedAcquisitionPrintings,
} from "../lib/acquisition-recognition";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import {
  getAcquisitionCardReview,
  saveAcquisitionReview,
  searchAcquisitionPrintings,
  type AcquisitionActor,
} from "../lib/acquisition-store";
import { confirmStrongAcquisitionMatches } from "../lib/acquisition-auto-confirm";
import type { ScryfallCard } from "../lib/scryfall";
import { enqueueReadyVisual } from "../lib/acquisition-visual-worker";
import { VISUAL_STAGE } from "../lib/acquisition-visual";

export async function verifyAcquisitionCatalogReconciliation(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  photoId: string,
  rawJob: ClaimedAcquisitionJob,
) {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const keys = new Set<string>();
  const name = `Catalog reconcile ${randomUUID().slice(0, 8)}`;
  const cards: ScryfallCard[] = ids.slice(0, 2).map((id, index) => ({
    object: "card",
    id,
    name,
    set: index ? "plst" : "newset",
    set_name: "Fixture",
    collector_number: index ? "NEWSET-17" : "17",
    lang: "en",
    digital: false,
    type_line: "Creature",
    finishes: ["nonfoil"],
    rarity: "common",
    cmc: 1,
    color_identity: [],
  }));
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({
    where: { id: photoId },
  });
  const observations = [
    {
      rotationDegrees: 0,
      text: { title: [name], footer: ["NEWSET EN", "C 17"] },
      lines: [],
    },
    { rotationDegrees: 180, text: { title: [], footer: [] }, lines: [] },
  ];
  const native = {
    version: 1,
    descriptor: "a".repeat(64),
    descriptorDetails: {},
    photoDigest: photo.digest,
    text: observations[0].text,
    orientations: observations,
    geometry: { status: "ACCEPTED" },
    lines: [],
    milliseconds: 1,
    automaticAcceptance: false,
  };
  const source = {
    version: 1,
    photoId,
    native,
    versions: { catalog: "b".repeat(64), model: "a".repeat(64) },
    proposals: proposeOrientedAcquisitionPrintings(
      createAcquisitionRecognitionIndex([]),
      observations,
    ),
    catalog: { status: "CHECKING", printingCoverage: "UNRESOLVED" },
  };
  const stock = await db.inventoryItem.aggregate({
    _count: { _all: true },
    _sum: { quantity: true },
  });
  let providerCalls = 0;
  try {
    assert.equal(
      await completeAcquisitionJob(
        db,
        rawJob,
        source as unknown as Prisma.InputJsonObject,
      ),
      "COMPLETE",
    );
    const queued = await Promise.all([
      enqueueCatalogReconciliation(db),
      enqueueCatalogReconciliation(db),
    ]);
    assert.equal(
      queued.reduce((sum, n) => sum + n, 0),
      1,
    );
    assert.equal(await enqueueCatalogReconciliation(db), 0);
    const [job] = await claimAcquisitionJobs(db, {
      workerId: "catalog-fixture",
      stages: [CATALOG_RECONCILIATION_STAGE],
    });
    assert.equal(job.candidateId, rawJob.candidateId);
    const handler = createCatalogReconciliationHandler(
      db,
      async (query, signal) => {
        keys.add(catalogQueryKey(query));
        return resolveCachedAcquisitionCatalog(db, query, signal, async () => {
          providerCalls++;
          return {
            status: "FOUND",
            cards,
            requestsMade: 2,
            printingCoverage: "CHECKED",
          };
        });
      },
    );
    const output = await handler(job, AbortSignal.timeout(30000));
    assert.equal((output.catalog as any).status, "RESOLVED");
    assert.equal(
      (output.proposals as any).automaticAcceptance,
      false,
      "new List counterpart prevents false original confirmation",
    );
    assert.equal((output.proposals as any).proposals.length, 2);
    assert.ok(
      (output.proposals as any).proposals.every((p: any) =>
        p.reasons.includes("STAMP_UNVERIFIED"),
      ),
    );
    assert.equal(providerCalls, 1);
    assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    const review = await getAcquisitionCardReview(
      db,
      actor,
      sessionId,
      photoId,
    );
    assert.equal(review.catalog?.status, "RESOLVED");
    const manual = { ...cards[0], id: ids[2], name: `Manual ${name}` };
    const searched = await searchAcquisitionPrintings(
      db,
      actor,
      sessionId,
      { query: manual.name, set: "", number: "" },
      async (query, signal) => {
        keys.add(catalogQueryKey(query));
        return resolveCachedAcquisitionCatalog(db, query, signal, async () => ({
          status: "FOUND",
          cards: [manual],
          requestsMade: 2,
          printingCoverage: "CHECKED",
        }));
      },
    );
    assert.equal(searched[0].name, manual.name);
    await assert.rejects(
      searchAcquisitionPrintings(
        db,
        actor,
        sessionId,
        { query: "Catalog provider error fixture", set: "", number: "" },
        async () => ({
          status: "PROVIDER_ERROR",
          cards: [],
          printingCoverage: "UNRESOLVED",
          requestsMade: 1,
          cacheHit: false,
          lookupKey: "error-fixture",
          errorKind: "NETWORK",
        }),
      ),
      /Scryfall could not complete/,
    );
    assert.equal(review.suggestions.length, 2);
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    const retried = await handler(job, AbortSignal.timeout(30000));
    assert.equal(
      providerCalls,
      1,
      "saved metadata and refreshed snapshot survive repeated processing without HTTP or OCR",
    );
    assert.equal((retried.proposals as any).proposals.length, 2);
    // Independent image evidence can find a printing that is absent locally,
    // even when the saved text did not identify it. It uses the same shared
    // Scryfall cache, stable local Card identity and immutable result fence.
    assert.equal(
      await enqueueCatalogReconciliation(db, new Date(), true),
      0,
      "hybrid reconciliation waits for visual evidence",
    );
    await enqueueReadyVisual(db, "c".repeat(64));
    const queuedVisual = await db.acquisitionProcessingJob.findFirstOrThrow({
      where: { stage: VISUAL_STAGE, candidateId: rawJob.candidateId },
    });
    const visualClaim = await db.acquisitionProcessingJob.update({
      where: { id: queuedVisual.id },
      data: {
        status: "RUNNING",
        attempts: 1,
        leaseToken: "visual-fixture",
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    });
    const visualId = randomUUID();
    ids.push(visualId);
    const visualCard: ScryfallCard = {
      ...cards[0],
      id: visualId,
      name: `Image only ${name}`,
      set: "image",
      collector_number: "4",
    };
    const visualOutput = {
      version: 1,
      photoId,
      visual: {
        version: 1,
        descriptor: "c".repeat(64),
        photoDigest: photo.digest,
        referenceCount: 112472,
        unavailableCount: 899,
        inputRegion: "WHOLE_PHOTO",
        geometry: { status: "NEEDS_CROP" },
        milliseconds: 1,
        automaticAcceptance: false,
        candidates: [
          {
            scryfallId: visualId,
            referenceId: `${visualId}:0`,
            name: visualCard.name,
            setCode: "image",
            collectorNumber: "4",
            distance: 0.1,
            rotationDegrees: 270,
          },
        ],
      },
    };
    assert.equal(
      await completeAcquisitionJob(
        db,
        visualClaim as ClaimedAcquisitionJob,
        visualOutput as unknown as Prisma.InputJsonObject,
      ),
      "COMPLETE",
    );
    assert.equal(await enqueueCatalogReconciliation(db, new Date(), true), 1);
    const [hybridJob] = await claimAcquisitionJobs(db, {
      workerId: "hybrid-fixture",
      stages: [CATALOG_RECONCILIATION_STAGE],
    });
    let byIdCalls = 0;
    const hybridHandler = createCatalogReconciliationHandler(
      db,
      async (query, signal) => {
        keys.add(catalogQueryKey(query));
        return resolveCachedAcquisitionCatalog(db, query, signal, async () => {
          if (query.kind === "id") {
            assert.equal(query.id, visualId);
            byIdCalls++;
          }
          return {
            status: "FOUND",
            cards:
              query.kind === "id" ||
              (query.kind === "name" && query.name === visualCard.name)
                ? [visualCard]
                : cards,
            requestsMade: 1,
            printingCoverage: "CHECKED",
          };
        });
      },
    );
    await assert.rejects(
      hybridHandler(
        {
          ...hybridJob,
          input: {
            ...(hybridJob.input as Prisma.InputJsonObject),
            visualJobId: rawJob.id,
          },
        },
        AbortSignal.timeout(30000),
      ),
      /Visual recognition input changed/,
    );
    const hybrid = await hybridHandler(hybridJob, AbortSignal.timeout(30000));
    assert.equal(byIdCalls, 1, "missing visual identity is actually fetched");
    const stable = await db.card.findUniqueOrThrow({
      where: { scryfallId: visualId },
    });
    assert.notEqual(stable.id, visualId);
    assert(
      (hybrid.proposals as any).proposals.some(
        (p: any) =>
          p.card.id === stable.id && p.reasons.includes("VISUAL_MATCH"),
      ),
    );
    assert.equal((hybrid.proposals as any).automaticAcceptance, false);
    assert.equal(hybrid.sourceVisualJobId, visualClaim.id);
    assert.deepEqual(
      hybrid.native,
      native,
      "visual/cached metadata do not rerun or alter OCR",
    );
    assert.equal(
      await completeAcquisitionJob(db, hybridJob, hybrid),
      "COMPLETE",
    );
    const hybridReview = await getAcquisitionCardReview(
      db,
      actor,
      sessionId,
      photoId,
    );
    assert.equal(
      hybridReview.evidence?.imageMatches?.inputRegion,
      "WHOLE_PHOTO",
    );
    assert(hybridReview.suggestions.some((p) => p.printing.id === stable.id));
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    assert.equal(
      await enqueueCatalogReconciliation(db, new Date(), true),
      0,
      "same immutable visual/OCR pair does not duplicate reconciliation",
    );
    // A user can correct/confirm while another reconciliation is in flight.
    const running = await db.acquisitionProcessingJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        leaseToken: "late-catalog-fixture",
        leaseExpiresAt: new Date(Date.now() + 30000),
      },
    });
    await saveAcquisitionReview(db, actor, sessionId, {
      action: "accept",
      photoId,
      revision: review.revision,
      decision: {
        cardId: review.suggestions[0].printing.id,
        language: "en",
        finish: "NONFOIL",
        condition: "NM",
      },
    });
    const saved = await getAcquisitionCardReview(db, actor, sessionId, photoId);
    assert.equal(
      await completeAcquisitionJob(
        db,
        running as ClaimedAcquisitionJob,
        output,
      ),
      "SUPERSEDED",
    );
    assert.deepEqual(
      (await getAcquisitionCardReview(db, actor, sessionId, photoId)).review,
      saved.review,
    );
    assert.equal(
      await enqueueCatalogReconciliation(
        db,
        new Date(Date.now() + 2 * 86400000),
      ),
      0,
      "reviewed cards stay excluded on refresh",
    );
    assert.deepEqual(
      await db.inventoryItem.aggregate({
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      stock,
    );
    console.log(
      "PASS: missing catalog reconciliation, new stamped counterpart, no OCR rerun, cache reuse, owner review preservation and explicit Inventory boundary",
    );
  } finally {
    await db.acquisitionCatalogLookup.deleteMany({
      where: { key: { in: [...keys] } },
    });
    await db.card.deleteMany({ where: { scryfallId: { in: ids } } });
  }
}
