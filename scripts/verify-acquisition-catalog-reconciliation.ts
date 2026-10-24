import {verifyCatalogReadiness} from "./verify-acquisition-catalog-readiness";
import {verifyAcquisitionClaimTrace} from "./verify-acquisition-claim-trace";
import {verifyImmediateCatalogClaims} from "./verify-acquisition-immediate-catalog-claims";
import {verifyAutoConfirmRetirement} from "./verify-acquisition-auto-confirm-retirement";
import {verifyAcquisitionClaimRetirement} from "./verify-acquisition-claim-retirement";
import {verifyRetiredHandoffParents} from "./verify-acquisition-retired-parents";
import {verifyDeletedHandoffSource} from "./verify-acquisition-deleted-handoff";
import { verifyAcquisitionClaimDiagnostics } from "./verify-acquisition-claim-diagnostics";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  completeAcquisitionJob,
  type ClaimedAcquisitionJob,
} from "../lib/acquisition-jobs";
import { claimFixtureJobs as claimAcquisitionJobs } from "./acquisition-verification-queue";
import {
  createCatalogReconciliationHandler,
  enqueueCatalogReconciliation,
} from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE, CATALOG_RESOLVER_VERSION } from "../lib/acquisition-catalog-status";
import {
  createAcquisitionRecognitionIndex,
  proposeOrientedAcquisitionPrintings,
} from "../lib/acquisition-recognition";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import { fetchAcquisitionCatalogQuery } from "../lib/acquisition-catalog-provider";
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
import { verifyAcquisitionVisualReuse } from "./verify-acquisition-visual-reuse";
import { verifyAcquisitionPrinting } from "./verify-acquisition-printing";
import { verifyAcquisitionPhotoText } from "./verify-acquisition-photo-text";
import { verifyAcquisitionFooterLanguages } from "./verify-acquisition-footer-languages";
import { verifyAcquisitionUnicodeNames } from "./verify-acquisition-unicode-names";

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
      text: { title: [name], footer: ["00017", "NEWSET • ENARTIST NAME"] },
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
    geometry: { status: "ACCEPTED", normalizedBoundary: [
      [0.022283614160397525, 0.016075611114501953],
      [0.1296570897102356, 0.9777163858396025],
    ] },
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
  const inventoryBeforeAdmission = await db.inventoryItem.findMany({orderBy: {id: "asc"}});
  let providerCalls = 0;
  let responseMode: "invalid" | "interrupted" | "complete" = "invalid";
  const httpRequests: string[] = [];
  // Substitute only HTTP responses. Query construction, provider validation,
  // pagination, durable cache publication and proposal refresh are production.
  async function throughProvider<T>(operation: () => Promise<T>): Promise<T> {
    const previousFetch = globalThis.fetch;
    const settings = {
      SCRYFALL_API_BASE_URL: "https://catalog-admission.invalid",
      SCRYFALL_MIN_REQUEST_INTERVAL_MS: "0",
      SCRYFALL_MAX_RETRIES: "0",
    };
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    Object.assign(process.env, settings);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      httpRequests.push(url.href);
      assert.equal(url.origin, settings.SCRYFALL_API_BASE_URL);
      assert.equal(init?.body, undefined, "metadata lookup sends no photo/account payload");
      if (url.pathname === "/cards/newset/17/en") {
        assert.equal(url.search, "");
      } else if (url.pathname === "/cards/named") {
        assert.equal(url.searchParams.get("exact"), name);
        assert.deepEqual([...url.searchParams.keys()], ["exact"]);
      } else {
        assert.equal(url.pathname, "/cards/search", "provider next_page URLs are never followed");
        assert.deepEqual(Object.fromEntries(url.searchParams), {
          q: `!"${name}" game:paper lang:en`, unique: "prints", order: "set",
          include_extras: "true", include_variations: "true", include_multilingual: "true",
          page: url.searchParams.get("page"),
        });
        assert(["1", "2"].includes(url.searchParams.get("page")!));
      }
      if (responseMode === "invalid") return Response.json({...cards[0], id: "not-a-uuid"});
      if (url.pathname !== "/cards/search") return Response.json(cards[0]);
      if (url.searchParams.get("page") === "1") return Response.json({
        object: "list", data: [cards[0]], total_cards: 2, has_more: true,
        next_page: "https://untrusted.invalid/private?must-not-follow=1",
      });
      if (responseMode === "interrupted") return Response.json({object: "error"}, {status: 503});
      return Response.json({object: "list", data: [cards[1]], total_cards: 2, has_more: false});
    }) as typeof fetch;
    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
      for (const key of Object.keys(settings)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }
  try {
    assert.equal(await db.card.count({where: {scryfallId: {in: ids}}}), 0,
      "new provider identities start absent from the real catalog");
    assert.equal(
      await completeAcquisitionJob(
        db,
        rawJob,
        source as unknown as Prisma.InputJsonObject,
      ),
      "COMPLETE",
    );
    assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: rawJob.id}})).output,
      JSON.parse(JSON.stringify(source)), "job publication must preserve every finite native geometry value");
    const [sourceText] = await db.$queryRaw<{output: string}[]>`
      SELECT output::text FROM "AcquisitionProcessingJob" WHERE id=${rawJob.id}`;
    assert.deepEqual(JSON.parse(sourceText.output), JSON.parse(JSON.stringify(source)), "PostgreSQL must retain the exact JSON observation");
    await verifyAcquisitionClaimDiagnostics(db, rawJob);
    await verifyAcquisitionClaimTrace(db,rawJob);
    await verifyImmediateCatalogClaims(db,rawJob);
    await verifyCatalogReadiness(db,rawJob);
    await verifyAutoConfirmRetirement(db,rawJob);
    await verifyAcquisitionClaimRetirement(db,rawJob);
    await verifyDeletedHandoffSource(db,rawJob.id,CATALOG_RECONCILIATION_STAGE,
      client=>enqueueCatalogReconciliation(client,new Date(),false));
    await verifyRetiredHandoffParents(db,rawJob.id,CATALOG_RECONCILIATION_STAGE,
      client=>enqueueCatalogReconciliation(client,new Date(),false));
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
    }, { candidateId: rawJob.candidateId });
    assert(job, "the initial catalog job must be claimable");
    assert.equal(job.candidateId, rawJob.candidateId);
    const handler = createCatalogReconciliationHandler(
      db,
      async (query, signal) => {
        keys.add(catalogQueryKey(query));
        return resolveCachedAcquisitionCatalog(db, query, signal, async (q, s) => {
          providerCalls++;
          return fetchAcquisitionCatalogQuery(q, s);
        });
      },
    );
    for (const resolverVersion of [undefined,"obsolete-footer-policy"])
      await assert.rejects(handler({...job,input:{...job.input as Prisma.InputJsonObject,resolverVersion}},
        AbortSignal.timeout(30000)),/Catalog interpretation version superseded/);
    assert.equal(providerCalls,0,"obsolete resolver must not spend provider calls or mutate cached metadata");
    const rejected = await throughProvider(() => handler(job, AbortSignal.timeout(30000)));
    assert.equal((rejected.catalog as any).status, "PROVIDER_ERROR");
    assert.equal((rejected.catalog as any).printingCoverage, "UNRESOLVED");
    assert.equal((rejected.proposals as any).automaticAcceptance, false);
    assert.equal(await db.card.count({where: {scryfallId: {in: ids}}}), 0,
      "invalid upstream identity is rejected before Card publication");
    assert.equal(httpRequests.length, 2, "only observed printing and exact-name fallback are queried");
    assert.deepEqual(await db.inventoryItem.findMany({orderBy: {id: "asc"}}), inventoryBeforeAdmission);
    await db.acquisitionCatalogLookup.updateMany({where: {key: {in: [...keys]}}, data: {expiresAt: new Date(0)}});
    responseMode = "interrupted";
    const interrupted = await throughProvider(() => handler(job, AbortSignal.timeout(30000)));
    assert.equal((interrupted.catalog as any).status, "PROVIDER_ERROR");
    assert.equal((interrupted.catalog as any).printingCoverage, "UNRESOLVED");
    assert.equal((interrupted.proposals as any).automaticAcceptance, false);
    assert((interrupted.proposals as any).proposals.every((p: any) =>
      p.reasons.includes("REVIEW_REQUIRED") && !p.reasons.includes("STRONG_EXACT_PRINTING")),
      "a partial page cannot establish printing uniqueness");
    assert.equal(await db.card.count({where: {scryfallId: {in: ids}}}), 1);
    const partialCard = await db.card.findUniqueOrThrow({where: {scryfallId: ids[0]}});
    assert.equal(httpRequests.length, 8, "two bounded lookups each stop at the failed second page without HTTP retries");
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    assert.deepEqual(await db.inventoryItem.findMany({orderBy: {id: "asc"}}), inventoryBeforeAdmission);
    await db.acquisitionCatalogLookup.updateMany({where: {key: {in: [...keys]}}, data: {expiresAt: new Date(0)}});
    responseMode = "complete";
    const output = await throughProvider(() => handler(job, AbortSignal.timeout(30000)));
    assert.equal(httpRequests.length, 11);
    assert.equal((output.catalog as any).requestsMade, 3);
    assert.equal((output.catalog as any).printingCoverage, "CHECKED");
    assert.equal(await db.card.count({where: {scryfallId: {in: ids}}}), 2);
    assert.equal((await db.card.findUniqueOrThrow({where: {scryfallId: ids[0]}})).id, partialCard.id,
      "retry preserves the local identity already published from the valid first page");
    assert((output.proposals as any).proposals.some((p: any) => p.card.id === partialCard.id),
      "the refreshed proposal uses the newly published local Card identity");
    assert.deepEqual(output.native, native, "catalog admission never rewrites or reruns OCR");
    assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: rawJob.id}})).output,
      source, "saved recognition evidence and its original empty proposal remain immutable");
    assert.equal((output.versions as Prisma.InputJsonObject).resolver,CATALOG_RESOLVER_VERSION);
    assert.deepEqual((output.proposals as {evidence:unknown}).evidence,
      {setCodes:["newset"],collectors:["17"],languages:["en"]});
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
    assert.equal(providerCalls, 5);
    assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: job.id}})).output,
      JSON.parse(JSON.stringify(output)), "catalog publication must preserve the complete handler output");
    const review = await getAcquisitionCardReview(
      db,
      actor,
      sessionId,
      photoId,
    );
    assert.equal(review.catalog?.status, "RESOLVED");
    const manual = { ...cards[0], id: ids[2], name: `Manual ${name}` };
    const manualList = { ...manual, id: randomUUID(), set: "plst", collector_number: "NEWSET-17" };
    ids.push(manualList.id);
    let manualProviderCalls = 0;
    const searched = await searchAcquisitionPrintings(
      db,
      actor,
      sessionId,
      { query: manual.name, set: "", number: "" },
      async (query, signal) => {
        keys.add(catalogQueryKey(query));
        return resolveCachedAcquisitionCatalog(db, query, signal, async (q, s) => {
          manualProviderCalls++;
          return fetchAcquisitionCatalogQuery(q, s, {
            card: async () => ({ ok: true, data: { ...manual, id: randomUUID(), digital: true },
              correlationId: "manual-digital-first", requestsMade: 1 }),
            printings: async () => ({ ok: true, data: { object: "list", data: [manual, manualList],
              has_more: false, total_cards: 2 }, correlationId: "manual-paper-editions", requestsMade: 1 }),
          });
        });
      },
    );
    assert.equal(searched[0].name, manual.name);
    assert.equal(searched.length, 2);
    assert.ok(searched.some(card => card.setCode === "plst"));
    assert.equal(manualProviderCalls, 1);
    assert.equal(await db.card.count({ where: { name: manual.name } }), 2,
      "digital named identity must not be imported with the paper editions");
    const cachedManual = await searchAcquisitionPrintings(db, actor, sessionId,
      { query: manual.name, set: "", number: "" }, async () => {
        throw new Error("Imported paper metadata should satisfy the repeated manual search");
      });
    assert.deepEqual(cachedManual, searched);
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
    const retried = await throughProvider(() => handler(job, AbortSignal.timeout(30000)));
    assert.equal(
      providerCalls,
      5,
      "saved metadata and refreshed snapshot survive repeated processing without HTTP or OCR",
    );
    assert.equal((retried.proposals as any).proposals.length, 2);
    assert.equal(httpRequests.length, 11, "warm durable metadata requires no further HTTP request");
    assert.equal((retried.catalog as any).requestsMade, 0);
    assert.deepEqual(await db.inventoryItem.findMany({orderBy: {id: "asc"}}), inventoryBeforeAdmission);
    console.log("PASS: production HTTP query/validation/pagination -> real Card publication -> same manual proposal; invalid identity, interrupted coverage, stable retry and no-network cache reuse");
    // Independent image evidence can find a printing that is absent locally,
    // even when the saved text did not identify it. It uses the same shared
    // Scryfall cache, stable local Card identity and immutable result fence.
    assert.equal(
      await enqueueCatalogReconciliation(db, new Date(), true),
      0,
      "hybrid reconciliation waits for visual evidence",
    );
    const canonical=await db.acquisitionProcessingJob.findFirstOrThrow({where:{
      artifactId:rawJob.artifactId,candidateId:rawJob.candidateId,stage:"photo-canonical-v1",status:"COMPLETE"}});
    await verifyDeletedHandoffSource(db,canonical.id,VISUAL_STAGE,
      client=>enqueueReadyVisual(client,"c".repeat(64)));
    await verifyRetiredHandoffParents(db,canonical.id,VISUAL_STAGE,
      client=>enqueueReadyVisual(client,"c".repeat(64)));
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
    await verifyAcquisitionVisualReuse(db, visualClaim as ClaimedAcquisitionJob,
      visualOutput.visual as unknown as Prisma.InputJsonObject);
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
    assert(hybridJob, "the newly queued hybrid catalog job must be claimable");
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
    await verifyAcquisitionPrinting(db, actor, sessionId, photoId, hybridJob);
    await verifyAcquisitionPhotoText(db, actor, sessionId, photoId, rawJob);
    await verifyAcquisitionFooterLanguages(db, actor, sessionId, photoId, rawJob);
    await verifyAcquisitionUnicodeNames(db, actor, sessionId, photoId, rawJob);
    await verifyAcquisitionUnicodeNames(db, actor, sessionId, photoId, rawJob, true);
    // Thirty-two older rows whose old visual result completed but whose latest
    // version failed must not occupy the bounded queue ahead of one ready row.
    // Database-only queue fixtures: no recognition or Inventory claim is made.
    const queuePhotos: string[] = [], queueCandidates: string[] = [], queueArtifacts: string[] = [], queueSlots: string[] = [];
    try {
      const template = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: rawJob.candidateId}});
      for (let n=0; n<33; n++) {
        const createdAt = new Date(Date.UTC(2000, 0, 1, 0, 0, n));
        const slot = await db.acquisitionCaptureSlot.create({data: {runId: rawJob.runId, requestKey: `queue-${randomUUID()}`, position: 1000+n, generation: 1}});
        queueSlots.push(slot.id);
        const clone = await db.acquisitionPhoto.create({data: {runId: rawJob.runId, slotId: slot.id, uploadKey: randomUUID(),
          generation: 1, digest: photo.digest, bytes: photo.bytes, mediaType: photo.mediaType, width: photo.width, height: photo.height, ready: true, readyAt: new Date()}});
        queuePhotos.push(clone.id);
        const artifact = await db.acquisitionArtifact.create({data: {runId: rawJob.runId, sourceId: clone.id, digest: clone.digest}});
        queueArtifacts.push(artifact.id);
        const candidate = await db.acquisitionCandidate.create({data: {runId: rawJob.runId, physicalId: slot.id,
          identityKind: template.identityKind, acquisitionOrder: 1000+n, spatialOrder: 0, expectedSides: template.expectedSides,
          provisional: template.provisional, uncertainty: template.uncertainty, revision: 0}});
        queueCandidates.push(candidate.id);
        const common = {runId: rawJob.runId, artifactId: artifact.id, candidateId: candidate.id, candidateRevision: 0,
          versionKey: randomUUID(), input: {photoId: clone.id, digest: clone.digest}};
        await db.acquisitionProcessingJob.create({data: {...common, createdAt, stage: 'photo-recognition-v1', status: 'COMPLETE',
          output: {...source, photoId: clone.id} as unknown as Prisma.InputJsonObject}});
        await db.acquisitionProcessingJob.create({data: {...common, createdAt: new Date(createdAt.getTime()+100), stage: VISUAL_STAGE,
          status: 'COMPLETE', output: {...visualOutput, photoId: clone.id} as unknown as Prisma.InputJsonObject}});
        if (n<32) await db.acquisitionProcessingJob.create({data: {...common, versionKey: randomUUID(),
          createdAt: new Date(createdAt.getTime()+200), stage: VISUAL_STAGE, status: 'FAILED'}});
      }
      assert.equal(await enqueueCatalogReconciliation(db, new Date(), true), 1,
        'the ready33rd row advances past32 rows whose latest visual generation failed');
      assert.equal(await db.acquisitionProcessingJob.count({where: {stage: CATALOG_RECONCILIATION_STAGE,
        candidateId: queueCandidates[32], status: 'PENDING'}}), 1);
      console.log('PASS: bounded catalog queue ignores stale visual completions before LIMIT32');
    } finally {
      await db.acquisitionProcessingJob.deleteMany({where: {candidateId: {in: queueCandidates}}});
      await db.acquisitionPhoto.deleteMany({where: {id: {in: queuePhotos}}});
      await db.acquisitionCandidate.deleteMany({where: {id: {in: queueCandidates}}});
      await db.acquisitionArtifact.deleteMany({where: {id: {in: queueArtifacts}}});
      await db.acquisitionCaptureSlot.deleteMany({where: {id: {in: queueSlots}}});
    }
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
