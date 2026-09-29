import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  acquisitionCatalogQueries,
  catalogQueryKey,
  type CatalogQuery,
} from "./acquisition-catalog-queries";
import {
  resolveCachedAcquisitionCatalog,
  type CachedCatalogResult,
} from "./acquisition-catalog-cache";
import {
  CATALOG_RECONCILIATION_STAGE,
  CATALOG_RESOLVER_VERSION,
  type AcquisitionCatalogStatus,
} from "./acquisition-catalog-status";
import {
  loadAcquisitionRecognitionSnapshot,
  nativeSchema,
  type RecognitionSnapshot,
} from "./acquisition-recognition-worker";
import { proposeOrientedAcquisitionPrintings } from "./acquisition-recognition";
import type { ClaimedAcquisitionJob } from "./acquisition-jobs";

const sourceSchema = z.object({
  photoId: z.string().uuid(),
  versions: z.record(z.string()),
  native: nativeSchema,
  proposals: z.object({
    proposals: z
      .array(
        z.object({
          card: z.object({ id: z.string(), name: z.string() }),
          reasons: z.array(z.string()),
        }),
      )
      .max(12),
  }),
});
const inputSchema = z.object({
  recognitionJobId: z.string().uuid(),
  photoId: z.string().uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function enqueueCatalogReconciliation(
  db: PrismaClient,
  now = new Date(),
) {
  const hourly = new Date(now.getTime() - 3600000);
  const daily = new Date(now.getTime() - 86400000);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT j.id FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    JOIN "Player" p ON p.id=s."ownerPlayerId"
    JOIN "User" u ON u.id=s."createdByUserId"
    WHERE j.stage='photo-recognition-v1' AND j.status='COMPLETE'
      AND j."candidateRevision"=c.revision AND c.review IS NULL AND NOT c.excluded
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer WHERE newer.stage=j.stage
        AND newer."candidateId"=c.id AND newer."candidateRevision"=c.revision AND newer."createdAt">j."createdAt")
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" f
        WHERE f.stage=${CATALOG_RECONCILIATION_STAGE}
          AND f.input->>'recognitionJobId'=j.id AND f.input->>'resolverVersion'=${CATALOG_RESOLVER_VERSION}
          AND (f.status IN ('PENDING','RUNNING') OR f."createdAt">${hourly}
            OR (f.status='COMPLETE' AND f.output->'catalog'->>'status'='UNREADABLE')
            OR (f.status='COMPLETE' AND f.output->'catalog'->>'status'='RESOLVED' AND f."createdAt">${daily})))
    ORDER BY j."createdAt",j.id LIMIT 32`;
  let added = 0;
  for (const { id } of rows) {
    const source = await db.acquisitionProcessingJob.findUniqueOrThrow({
      where: { id },
    });
    const input = z
      .object({ photoId: z.string().uuid(), digest: z.string() })
      .parse(source.input);
    const versionKey = createHash("sha256")
      .update(
        JSON.stringify({
          source: id,
          resolver: CATALOG_RESOLVER_VERSION,
          epoch: Math.floor(now.getTime() / 3600000),
        }),
      )
      .digest("hex");
    const result = await db.acquisitionProcessingJob.createMany({
      skipDuplicates: true,
      data: [
        {
          runId: source.runId,
          artifactId: source.artifactId,
          candidateId: source.candidateId,
          candidateRevision: source.candidateRevision,
          stage: CATALOG_RECONCILIATION_STAGE,
          versionKey,
          input: {
            ...input,
            recognitionJobId: id,
            resolverVersion: CATALOG_RESOLVER_VERSION,
          },
        },
      ],
    });
    added += result.count;
  }
  return added;
}

type Lookup = (
  query: CatalogQuery,
  signal: AbortSignal,
) => Promise<CachedCatalogResult>;

export function createCatalogReconciliationHandler(
  db: PrismaClient,
  lookup: Lookup = (query, signal) =>
    resolveCachedAcquisitionCatalog(db, query, signal),
) {
  let snapshot: RecognitionSnapshot | undefined;
  let snapshotAt = 0;
  return async (
    job: ClaimedAcquisitionJob,
    signal: AbortSignal,
  ): Promise<Prisma.InputJsonObject> => {
    const input = inputSchema.parse(job.input);
    const source = await db.acquisitionProcessingJob.findUniqueOrThrow({
      where: { id: input.recognitionJobId },
    });
    if (
      source.stage !== "photo-recognition-v1" ||
      source.status !== "COMPLETE" ||
      source.runId !== job.runId ||
      source.artifactId !== job.artifactId ||
      source.candidateId !== job.candidateId ||
      source.candidateRevision !== job.candidateRevision
    )
      throw new Error("Recognition input changed");
    const observed = sourceSchema.parse(source.output);
    const photo = await db.acquisitionPhoto.findUniqueOrThrow({
      where: { id: input.photoId },
      include: { slot: true },
    });
    if (
      !photo.ready ||
      photo.purgedAt ||
      photo.generation !== photo.slot.generation ||
      photo.runId !== job.runId ||
      photo.digest !== input.digest ||
      observed.photoId !== photo.id ||
      observed.native.photoDigest !== photo.digest
    )
      throw new Error("Photo input changed");
    const queries = acquisitionCatalogQueries(observed.native.orientations);
    const completed: Exclude<CachedCatalogResult, { status: "PENDING" }>[] = [];
    const attempted = new Set<string>();
    async function run(query: CatalogQuery) {
      const key = catalogQueryKey(query);
      if (attempted.has(key)) return;
      attempted.add(key);
      for (;;) {
        signal.throwIfAborted();
        const result = await lookup(query, signal);
        if (result.status !== "PENDING") {
          completed.push(result);
          return;
        }
        await setTimeout(500, undefined, { signal });
      }
    }
    // Full-name lookups also reconcile missing stamped counterparts. They are
    // shared by repeated copies, rather than one provider call for every photo.
    const exactNames = [
      ...new Set(
        observed.proposals.proposals
          .filter((p) => p.reasons.includes("TITLE_EXACT"))
          .map((p) => p.card.name),
      ),
    ].slice(0, 2);
    for (const name of exactNames) await run({ kind: "name", name });
    // Check readable identifiers even if a name produced a different printing.
    for (const query of queries.printings) await run(query);
    if (!completed.some((r) => r.status === "FOUND")) {
      for (const query of queries.names) {
        await run(query);
        if (
          completed.some(
            (r) => r.status === "FOUND" || r.status === "PROVIDER_ERROR",
          )
        )
          break;
      }
    }
    if (
      !completed.some(
        (r) => r.status === "FOUND" || r.status === "PROVIDER_ERROR",
      ) &&
      queries.names[0]?.kind === "name"
    )
      await run({ ...queries.names[0], fuzzy: true });

    signal.throwIfAborted();
    const refresh =
      !snapshot ||
      Date.now() - snapshotAt > 30000 ||
      completed.some((r) => !r.cacheHit && r.cards.length);
    if (refresh) {
      snapshot = await loadAcquisitionRecognitionSnapshot(db);
      snapshotAt = Date.now();
    }
    const proposals = proposeOrientedAcquisitionPrintings(
      snapshot!.index,
      observed.native.orientations,
    );
    const found = completed.some(
      (r) => r.status === "FOUND" && r.printingCoverage === "CHECKED",
    );
    const status: AcquisitionCatalogStatus["status"] = completed.some(
      (r) => r.status === "PROVIDER_ERROR",
    )
      ? "PROVIDER_ERROR"
      : completed.some((r) => r.status === "INCOMPLETE")
        ? "INCOMPLETE"
        : found
          ? "RESOLVED"
          : attempted.size
            ? "NOT_FOUND"
            : "UNREADABLE";
    // A generic image/name match is not proof that the lower-left stamp is
    // absent. Until stamp verification is integrated, any returned same-name
    // stamped family keeps the exact-printing decision in review.
    const stampedNames = new Set(
      completed.flatMap((r) =>
        r.cards
          .filter((c) => ["plst", "mb1", "fmb1", "mb2"].includes(c.set))
          .map((c) => c.name),
      ),
    );
    const stampUnverified = proposals.proposals.some(
      (p) =>
        p.reasons.includes("SET_AND_COLLECTOR_TEXT") &&
        stampedNames.has(p.card.name),
    );
    if (status !== "RESOLVED" || stampUnverified) {
      if (proposals.status === "STRONG_MATCH")
        proposals.status = "REVIEW_REQUIRED";
      proposals.automaticAcceptance = false;
      for (const proposal of proposals.proposals) {
        proposal.reasons = proposal.reasons.filter(
          (r) => r !== "STRONG_EXACT_PRINTING",
        );
        if (!proposal.reasons.includes("REVIEW_REQUIRED"))
          proposal.reasons.push("REVIEW_REQUIRED");
        if (
          stampUnverified &&
          stampedNames.has(proposal.card.name) &&
          !proposal.reasons.includes("STAMP_UNVERIFIED")
        )
          proposal.reasons.push("STAMP_UNVERIFIED");
      }
    }
    return {
      version: 1,
      photoId: photo.id,
      sourceRecognitionJobId: source.id,
      native: observed.native,
      versions: {
        ...observed.versions,
        catalog: snapshot!.digest,
        resolver: CATALOG_RESOLVER_VERSION,
      },
      proposals,
      catalog: {
        status,
        printingCoverage:
          found && status === "RESOLVED" ? "CHECKED" : "UNRESOLVED",
        lookups: attempted.size,
        requestsMade: completed.reduce(
          (sum, r) => sum + (r.cacheHit ? 0 : r.requestsMade),
          0,
        ),
        checkedAt: new Date().toISOString(),
      },
    } as unknown as Prisma.InputJsonObject;
  };
}
