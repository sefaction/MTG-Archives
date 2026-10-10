import { acquisitionManualAnalysisSchema, sameAcquisitionManualRegion } from "./acquisition-manual-region";
import { acquisitionAnalysisForPhoto, acquisitionAnalysisReadySql } from "./acquisition-analysis-scope";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { acquisitionImageInputKindSchema, acquisitionNativePhotoInput } from "./acquisition-image-input";
import {
  createAcquisitionRecognitionIndex,
  proposeOrientedAcquisitionPrintings,
  type RecognitionCard,
  ACQUISITION_TEXT_RESOLVER_VERSION,
} from "./acquisition-recognition";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { runAcquisitionNativeProcess } from "./acquisition-native-process";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import type { ClaimedAcquisitionJob } from "./acquisition-jobs";
import { acquisitionReadingZonesSchema } from "./acquisition-reading-zones";
import { ACQUISITION_FOOTER_PARSER_VERSION } from "./acquisition-footer";
import { acquisitionPhotoTextSchema, needsAcquisitionPhotoText, readAcquisitionPhotoText,
  combineAcquisitionPhotoText } from "./acquisition-photo-text";
import { acquisitionHandoffQuery } from "./acquisition-handoff";

export const RECOGNITION_STAGE = "photo-recognition-v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const textSchema = z.object({
  title: z.array(z.string().max(2000)).max(100),
  footer: z.array(z.string().max(2000)).max(100),
  footerSupplemental: z.array(z.string().max(2000)).max(100).optional(),
});
const linesSchema = z
  .array(
    z.object({
      text: z.string().max(2000),
      score: z.number().finite(),
      polygon: z.array(z.array(z.number().finite()).length(2)).max(8),
    }),
  )
  .max(100);
export const nativeSchema = z.object({
  version: z.literal(1),
  descriptor: digest,
  descriptorDetails: z.record(z.unknown()),
  photoDigest: digest,
  text: textSchema,
  readingZones: acquisitionReadingZonesSchema.optional(),
  orientations: z
    .array(
      z.object({
        rotationDegrees: z.union([z.literal(0), z.literal(180)]),
        text: textSchema,
        lines: linesSchema,
        footerLines: linesSchema.optional(),
      }),
    )
    .max(2),
  geometry: z.object({ status: z.string() }).passthrough(),
  lines: linesSchema,
  milliseconds: z.number().nonnegative().finite(),
  automaticAcceptance: z.literal(false),
  photoText: acquisitionPhotoTextSchema.optional(),
});
export type RecognitionSnapshot = Awaited<
  ReturnType<typeof loadAcquisitionRecognitionSnapshot>
>;
export async function loadAcquisitionRecognitionSnapshot(db: PrismaClient) {
  // A single SELECT has one PostgreSQL statement snapshot. Hash exactly the
  // projection used by retrieval, rather than a mutable bulk-refresh job ID.
  const rows = await db.card.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      scryfallId: true,
      name: true,
      printedName: true,
      cardFaces: true,
      setCode: true,
      collectorNumber: true,
      lang: true,
      digital: true,
    },
  });
  const cards: RecognitionCard[] = rows.map(({ cardFaces, ...card }) => ({
    ...card,
    faceNames: Array.isArray(cardFaces)
      ? cardFaces.flatMap((f) => {
          const face = f as { name?: unknown; printed_name?: unknown };
          return [face?.name, face?.printed_name].filter(
            (v): v is string => typeof v === "string",
          );
        })
      : [],
  }));
  return {
    digest: createHash("sha256").update(JSON.stringify(cards)).digest("hex"),
    index: createAcquisitionRecognitionIndex(cards),
    byScryfallId: new Map(rows.map((row, i) => [row.scryfallId, cards[i]])),
  };
}
export function acquisitionRecognitionVersion(_catalog: string, model: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pipeline: RECOGNITION_STAGE,
        model,
        resolver: "metadata-card-orientation-catalog-v5",
      }),
    )
    .digest("hex");
}
// A generation change can leave older attempts queued behind their replacement.
// Require a strictly newer, identical-input current-version attempt. Attempt
// order protects newer work, and a live lease keeps its authority.
export async function retireReplacedRecognition(
  db: PrismaClient,
  versionKey: string,
  now = new Date(),
) {
  digest.parse(versionKey);
  return db.$executeRaw`
    UPDATE "AcquisitionProcessingJob" old SET status='SUPERSEDED',
      "leaseToken"=NULL, "leaseExpiresAt"=NULL,
      "errorCode"='GENERATION_REPLACED', "updatedAt"=${now}
    WHERE old.stage=${RECOGNITION_STAGE} AND old."versionKey"<>${versionKey}
      AND (old.status='PENDING' OR (old.status='RUNNING' AND old."leaseExpiresAt"<=${now}))
      AND EXISTS (
        SELECT 1 FROM "AcquisitionProcessingJob" current
        WHERE current.stage=old.stage AND current."versionKey"=${versionKey}
          AND current."runId"=old."runId" AND current."artifactId"=old."artifactId"
          AND current."candidateId"=old."candidateId"
          AND current."candidateRevision"=old."candidateRevision"
          AND current."createdAt">old."createdAt"
          AND current.status IN ('PENDING','RUNNING','COMPLETE','FAILED')
          AND current.input->>'photoId'=old.input->>'photoId'
          AND current.input->>'digest'=old.input->>'digest'
      )`;
}

export async function enqueueReadyRecognition(
  db: PrismaClient,
  catalog: string,
  model: string,
) {
  const versionKey = acquisitionRecognitionVersion(catalog, model);
  // A durable handoff can be retried after canonical-worker or OCR-worker exit.
  // Existing attempts for this exact version are not silently retried forever.
  const eligible = await db.$queryRaw<{ id: string }[]>(acquisitionHandoffQuery(RECOGNITION_STAGE, Prisma.sql`
    SELECT j.id, j."runId", j."createdAt" FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id = j."candidateId"
    JOIN "AcquisitionRun" r ON r.id = j."runId"
    JOIN "AcquisitionSession" s ON s.id = r."sessionId"
    JOIN "Player" p ON p.id = s."ownerPlayerId"
    JOIN "User" u ON u.id = s."createdByUserId"
    WHERE j.stage = 'photo-canonical-v1' AND j.status = 'COMPLETE'
      AND ${acquisitionAnalysisReadySql()}
      AND s.phase NOT IN ('DRAFT', 'CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
      AND p.active = true AND u."isActive" = true AND u."forcePasswordChange" = false
      AND NOT EXISTS (
        SELECT 1 FROM "AcquisitionProcessingJob" other
        WHERE other."artifactId" = j."artifactId" AND other."candidateId" = c.id
          AND other."candidateRevision" = c.revision
          AND other.stage = ${RECOGNITION_STAGE} AND other."versionKey" = ${versionKey}
      )
  `));
  const ready = await db.acquisitionProcessingJob.findMany({
    where: { id: { in: eligible.map((j) => j.id) } },
    orderBy: { createdAt: "asc" },
    take: 32,
    include: { candidate: true, artifact: true },
  });
  let added = 0;
  for (const job of ready) {
    if (job.candidate.excluded) continue;
    const input = z
      .object({ photoId: z.string().uuid(), digest })
      .parse(job.input);
    const photo = await db.acquisitionPhoto.findUnique({
      where: { id: input.photoId },
      include: { slot: true },
    });
    if (
      !photo ||
      !photo.ready ||
      photo.purgedAt ||
      photo.digest !== input.digest ||
      photo.generation !== photo.slot.generation
    ) {
      await db.acquisitionProcessingJob.updateMany({
        where: { id: job.id, status: "COMPLETE" },
        data: { status: "SUPERSEDED", errorCode: "INPUT_CHANGED" },
      });
      continue;
    }
    const manualAnalysis = acquisitionAnalysisForPhoto(job.candidate, photo);
    if (job.candidate.review !== null && manualAnalysis?.candidateRevision !== job.candidate.revision) continue;
    const result = await db.acquisitionProcessingJob.createMany({
      skipDuplicates: true,
      data: [
        {
          runId: job.runId,
          artifactId: job.artifactId,
          candidateId: job.candidateId,
          candidateRevision: job.candidate.revision,
          stage: RECOGNITION_STAGE,
          versionKey,
          input: {
            version: 1,
            ...input,
            inputKind: photo.inputKind,
            manualAnalysis,
            versions: {
              pipeline: RECOGNITION_STAGE,
              runtime: "paddle-cpu-subprocess-v1",
              model,
              catalog,
              index: catalog,
              execution: "CPU",
            },
          },
        },
      ],
    });
    added += result.count;
  }
  await retireReplacedRecognition(db, versionKey);
  return added;
}
export async function recognizeAcquisitionPhoto(
  job: ClaimedAcquisitionJob,
  signal: AbortSignal,
  snapshot: RecognitionSnapshot,
  model: string,
  nativeWorker?: AcquisitionNativeStream,
) {
  const input = z
    .object({
      photoId: z.string().uuid(),
      digest,
      inputKind: acquisitionImageInputKindSchema.default("PHOTO"),
      versions: z.object({ catalog: digest, model: digest }),
      manualAnalysis: acquisitionManualAnalysisSchema.nullable().optional(),
    })
    .parse(job.input);
  // Catalog-only changes are handled by reconciliation of saved OCR. The raw
  // job identity depends on its photo/revision/model, not metadata refreshes.
  if (input.versions.model !== model)
    throw new Error(
      "Processing version unavailable; restart with its catalog/model",
    );
  const bytes = await readAcquisitionPhotoBytes(
    input.photoId,
    "raw",
    input.digest,
  );
  const nativeStarted = Date.now();
  const requestNative = (frame: Buffer, attemptSignal: AbortSignal, progress?: (value: unknown) => void) => nativeWorker
    ? nativeWorker.request(frame, attemptSignal, progress)
    : runAcquisitionNativeProcess("python", ["/app/tools/acquisition-runtime/recognize.py"], frame, attemptSignal);
  const native = nativeSchema.parse(
    await requestNative(acquisitionNativePhotoInput(bytes, input.inputKind, undefined, input.manualAnalysis?.region ?? undefined), signal),
  );
  if (
    native.photoDigest !== input.digest ||
    native.descriptor !== model ||
    signal.aborted
  )
    throw new Error("Processing input changed");
  if (!sameAcquisitionManualRegion(native.geometry.manualRegion, input.manualAnalysis?.region))
    throw new Error("Recognition region changed");
  let proposals = proposeOrientedAcquisitionPrintings(
    snapshot.index,
    native.orientations,
  );
  if (!input.manualAnalysis?.region && needsAcquisitionPhotoText(proposals)) {
    native.photoText = await readAcquisitionPhotoText(requestNative, bytes, input.inputKind,
      { photoDigest: input.digest, descriptor: model }, signal,
      Math.min(32000, 35000 - (Date.now() - nativeStarted)));
    proposals = combineAcquisitionPhotoText(snapshot.index, proposals, native.photoText);
  }
  if (input.manualAnalysis?.region) {
    proposals.automaticAcceptance = false;
    if (proposals.status === "STRONG_MATCH") proposals.status = "REVIEW_REQUIRED";
  }
  signal.throwIfAborted();
  return {
    version: 1,
    photoId: input.photoId,
    versions: {
      ...input.versions,
      catalog: snapshot.digest,
      index: snapshot.digest,
      footerParser: ACQUISITION_FOOTER_PARSER_VERSION,
      textResolver: ACQUISITION_TEXT_RESOLVER_VERSION,
    },
    execution: "CPU",
    manualAnalysis: input.manualAnalysis ?? null,
    native,
    proposals,
    catalog: { status: "CHECKING", printingCoverage: "UNRESOLVED" },
  } as unknown as Prisma.InputJsonObject;
}
