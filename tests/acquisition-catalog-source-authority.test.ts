import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createCatalogReconciliationHandler } from "../lib/acquisition-catalog-reconciliation";
import { CATALOG_RECONCILIATION_STAGE, CATALOG_RESOLVER_VERSION } from "../lib/acquisition-catalog-status";
import { catalogQueryKey } from "../lib/acquisition-catalog-queries";
import type { CachedCatalogResult } from "../lib/acquisition-catalog-cache";
import type { ClaimedAcquisitionJob } from "../lib/acquisition-jobs";

const coverage = { kind: "BULK_SNAPSHOT" as const, version: 1 as const, sourceDigest: "d".repeat(64),
  sourceUpdatedAt: "2026-10-31T21:06:29.482Z", language: "en" as const };
async function reconcile(options: { explicitFrench?: boolean; frenchUnavailable?: boolean; laterEnglish?: boolean } = {}) {
  const ids = { photo: randomUUID(), raw: randomUUID(), run: randomUUID(), artifact: randomUUID(), candidate: randomUUID() };
  const digest = "a".repeat(64), name = "Scope Sentinel";
  const english = { id: "scope-en", scryfallId: randomUUID(), name, printedName: null, cardFaces: [],
    setCode: "tst", collectorNumber: options.laterEnglish ? "6" : "7", lang: "en", digital: false };
  const alternative = { ...english, id: "scope-other", scryfallId: randomUUID(), collectorNumber: "7",
    lang: options.laterEnglish ? "en" : "fr" };
  const text = { title: [name], footer: ["C 7", options.explicitFrench ? "TST FR" : "TST"] };
  const native = { version: 1, descriptor: "b".repeat(64), descriptorDetails: {}, photoDigest: digest, text,
    orientations: [{ rotationDegrees: 0, text, lines: [] }, { rotationDegrees: 180, text: { title: [], footer: [] }, lines: [] }],
    geometry: { status: "ACCEPTED" }, lines: [], milliseconds: 1, automaticAcceptance: false };
  const common = { runId: ids.run, artifactId: ids.artifact, candidateId: ids.candidate, candidateRevision: 0 };
  const raw = { ...common, id: ids.raw, stage: "photo-recognition-v1", status: "COMPLETE", input: { photoId: ids.photo, digest },
    output: { photoId: ids.photo, native, versions: { model: "b".repeat(64), catalog: "c".repeat(64) },
      proposals: { proposals: [{ card: { id: english.id, name }, reasons: ["TITLE_EXACT"] }] } } };
  const db = { acquisitionProcessingJob: { findUniqueOrThrow: async () => raw },
    acquisitionPhoto: { findUniqueOrThrow: async () => ({ id: ids.photo, ready: true, purgedAt: null, generation: 1,
      slot: { generation: 1 }, runId: ids.run, digest }) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ card: { findMany: async () => [english, alternative] } }),
  } as unknown as PrismaClient;
  const asRaw = (card: typeof english) => ({ object: "card" as const, id: card.scryfallId, name,
    set: "tst", set_name: "Test", collector_number: card.collectorNumber, lang: card.lang, digital: false,
    games: ["paper"], cmc: 0, color_identity: [], rarity: "common" });
  const handler = createCatalogReconciliationHandler(db, async (query): Promise<CachedCatalogResult> => {
    if (query.kind === "printing" && query.language === "fr") {
      if (options.frenchUnavailable) return { status: "PROVIDER_ERROR", cards: [], requestsMade: 1,
        printingCoverage: "UNRESOLVED", errorKind: "NETWORK", cacheHit: false, lookupKey: catalogQueryKey(query) };
      return { status: "FOUND", cards: [asRaw(alternative)], requestsMade: 1,
        printingCoverage: "CHECKED", cacheHit: false, lookupKey: catalogQueryKey(query) };
    }
    return { status: "FOUND", cards: [asRaw(english)], requestsMade: 0, printingCoverage: "CHECKED",
      sourceCoverage: coverage, cacheHit: true, lookupKey: catalogQueryKey(query) };
  });
  const before = structuredClone(raw);
  const now = new Date();
  const job: ClaimedAcquisitionJob = { ...common, id: randomUUID(), stage: CATALOG_RECONCILIATION_STAGE,
    versionKey: randomUUID(), input: { photoId: ids.photo, digest, recognitionJobId: ids.raw, resolverVersion: CATALOG_RESOLVER_VERSION },
    status: "RUNNING", attempts: 1, maxAttempts: 3, availableAt: now, leaseToken: randomUUID(),
    leaseExpiresAt: new Date(now.getTime() + 60000), output: null, errorCode: null, createdAt: now, updatedAt: now };
  const output = await handler(job, AbortSignal.timeout(10000));
  assert.deepEqual(raw, before, "Coverage policy never rewrites saved OCR");
  return output as unknown as { catalog: { status: string; printingCoverage: string; sourceCoverage: unknown[] };
    proposals: { automaticAcceptance: boolean; proposals: { card: { id: string; lang: string }; reasons: string[] }[] };
    batchLanguageProposals?: { options: { language: string; proposals: { automaticAcceptance: boolean } }[] } };
}

test("English snapshot coverage cannot authorize automatic French batch-language projections", async () => {
  const result = await reconcile();
  assert.equal(result.catalog.status, "RESOLVED");
  assert.deepEqual(result.catalog.sourceCoverage, [coverage]);
  assert.equal(result.proposals.automaticAcceptance, false);
  assert.deepEqual(result.proposals.proposals.map(proposal => proposal.card.lang).sort(), ["en", "fr"],
    "Unsupported automatic language does not remove manual printing suggestions");
  assert.deepEqual(result.batchLanguageProposals?.options.map(option => option.language), ["en"]);
});

test("a later local English printing outside snapshot membership cannot inherit checked coverage", async () => {
  const result = await reconcile({ laterEnglish: true });
  assert.equal(result.catalog.status, "RESOLVED");
  assert.equal(result.proposals.automaticAcceptance, false);
  assert.equal(result.batchLanguageProposals, undefined);
  assert.ok(result.proposals.proposals.some(proposal => proposal.card.id === "scope-other"),
    "A newer local printing remains available for explicit manual review");
});

test("an explicitly checked French provider printing retains valid automatic authority", async () => {
  const result = await reconcile({ explicitFrench: true });
  assert.equal(result.catalog.status, "RESOLVED");
  assert.equal(result.proposals.automaticAcceptance, true);
  const strong = result.proposals.proposals.filter(proposal => proposal.reasons.includes("STRONG_EXACT_PRINTING"));
  assert.deepEqual(strong.map(proposal => proposal.card.lang), ["fr"]);
});

test("an unavailable French lookup remains an explicit provider failure", async () => {
  const result = await reconcile({ explicitFrench: true, frenchUnavailable: true });
  assert.equal(result.catalog.status, "PROVIDER_ERROR");
  assert.equal(result.catalog.printingCoverage, "UNRESOLVED");
  assert.equal(result.proposals.automaticAcceptance, false);
});
