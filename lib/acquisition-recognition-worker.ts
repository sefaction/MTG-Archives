import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  createAcquisitionRecognitionIndex,
  proposeAcquisitionPrintings,
  type RecognitionCard,
} from "./acquisition-recognition";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { runAcquisitionNativeProcess } from "./acquisition-native-process";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import type { ClaimedAcquisitionJob } from "./acquisition-jobs";

export const RECOGNITION_STAGE = "photo-recognition-v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nativeSchema = z.object({
  version: z.literal(1),
  descriptor: digest,
  descriptorDetails: z.record(z.unknown()),
  photoDigest: digest,
  text: z.object({
    title: z.array(z.string().max(2000)).max(100),
    footer: z.array(z.string().max(2000)).max(100),
  }),
  geometry: z.object({ status: z.string() }).passthrough(),
  lines: z
    .array(
      z.object({
        text: z.string().max(2000),
        score: z.number().finite(),
        polygon: z.array(z.array(z.number().finite()).length(2)).max(8),
      }),
    )
    .max(100),
  milliseconds: z.number().nonnegative().finite(),
  automaticAcceptance: z.literal(false),
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
  if (!cards.length) throw new Error("Recognition catalog unavailable");
  return {
    digest: createHash("sha256").update(JSON.stringify(cards)).digest("hex"),
    index: createAcquisitionRecognitionIndex(cards),
  };
}
export function acquisitionRecognitionVersion(catalog: string, model: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pipeline: RECOGNITION_STAGE,
        catalog,
        model,
        resolver: "metadata-proposals-v1",
      }),
    )
    .digest("hex");
}
export async function enqueueReadyRecognition(
  db: PrismaClient,
  catalog: string,
  model: string,
) {
  const versionKey = acquisitionRecognitionVersion(catalog, model);
  // A durable handoff can be retried after canonical-worker or OCR-worker exit.
  // Existing attempts for this exact version are not silently retried forever.
  const eligible = await db.$queryRaw<{ id: string }[]>`
    SELECT j.id FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id = j."candidateId"
    JOIN "AcquisitionRun" r ON r.id = j."runId"
    JOIN "AcquisitionSession" s ON s.id = r."sessionId"
    JOIN "Player" p ON p.id = s."ownerPlayerId"
    JOIN "User" u ON u.id = s."createdByUserId"
    WHERE j.stage = 'photo-canonical-v1' AND j.status = 'COMPLETE'
      AND c.excluded = false AND c.review IS NULL
      AND s.phase NOT IN ('DRAFT', 'CANCELLED')
      AND p.active = true AND u."isActive" = true AND u."forcePasswordChange" = false
      AND NOT EXISTS (
        SELECT 1 FROM "AcquisitionProcessingJob" other
        WHERE other."artifactId" = j."artifactId" AND other."candidateId" = c.id
          AND other."candidateRevision" = c.revision
          AND other.stage = ${RECOGNITION_STAGE} AND other."versionKey" = ${versionKey}
      )
    ORDER BY j."createdAt", j.id LIMIT 32
  `;
  const ready = await db.acquisitionProcessingJob.findMany({
    where: { id: { in: eligible.map((j) => j.id) } },
    orderBy: { createdAt: "asc" },
    take: 32,
    include: { candidate: true, artifact: true },
  });
  let added = 0;
  for (const job of ready) {
    if (job.candidate.review !== null || job.candidate.excluded) continue;
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
      versions: z.object({ catalog: digest, model: digest }),
    })
    .parse(job.input);
  if (
    input.versions.catalog !== snapshot.digest ||
    input.versions.model !== model
  )
    throw new Error(
      "Processing version unavailable; restart with its catalog/model",
    );
  const bytes = await readAcquisitionPhotoBytes(
    input.photoId,
    "raw",
    input.digest,
  );
  const native = nativeSchema.parse(
    nativeWorker
      ? await nativeWorker.request(bytes, signal)
      : await runAcquisitionNativeProcess(
          "python",
          ["/app/tools/acquisition-runtime/recognize.py"],
          bytes,
          signal,
        ),
  );
  if (
    native.photoDigest !== input.digest ||
    native.descriptor !== model ||
    signal.aborted
  )
    throw new Error("Processing input changed");
  const proposals = proposeAcquisitionPrintings(snapshot.index, native.text);
  return {
    version: 1,
    photoId: input.photoId,
    versions: input.versions,
    execution: "CPU",
    native,
    proposals,
  } as unknown as Prisma.InputJsonObject;
}
