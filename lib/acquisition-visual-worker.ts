import { acquisitionManualAnalysisSchema } from "./acquisition-manual-region";
import { acquisitionAnalysisForPhoto, acquisitionAnalysisReadySql, acquisitionAnalysisJobSql } from "./acquisition-analysis-scope";
import {admitAcquisitionHandoff} from "./acquisition-handoff-admission";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { acquisitionNativePhotoInput } from "./acquisition-image-input";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import { AcquisitionJobSupersededError, type ClaimedAcquisitionJob } from "./acquisition-jobs";
import { VISUAL_STAGE } from "./acquisition-visual";
import { acquisitionHandoffQuery } from "./acquisition-handoff";
import { checkedVisualNative, visualReuseIdentity, reusableVisualNative } from "./acquisition-visual-reuse";

const inputSchema = z.object({
  photoId: z.string().uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().regex(/^[a-f0-9]{64}$/),
  manualAnalysis: acquisitionManualAnalysisSchema.nullable().optional(),
});

export async function enqueueReadyVisual(db: PrismaClient, model: string) {
  const versionKey = createHash("sha256")
    .update(`${VISUAL_STAGE}:${model}`)
    .digest("hex");
  const rows = await db.$queryRaw<{ id: string }[]>(acquisitionHandoffQuery(VISUAL_STAGE, Prisma.sql`
    SELECT j.id, j."runId", j."createdAt" FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    JOIN "Player" p ON p.id=s."ownerPlayerId"
    JOIN "User" u ON u.id=s."createdByUserId"
    WHERE j.stage='photo-canonical-v1' AND j.status='COMPLETE'
      AND ${acquisitionAnalysisReadySql()}
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" v
        WHERE v.stage=${VISUAL_STAGE} AND v."artifactId"=j."artifactId"
          AND v."candidateId"=c.id AND v."candidateRevision"=c.revision AND v."versionKey"=${versionKey})
  `));
  let added = 0;
  for (const row of rows) {
    const source = await db.acquisitionProcessingJob.findUnique({
      where: { id: row.id },
      include: { candidate: true },
    });
    // Admission IDs are a snapshot; cancelled/removed runs can disappear here.
    if (!source) continue;
    const input = z
      .object({ photoId: z.string().uuid(), digest: z.string() })
      .parse(source.input);
    const photo = await db.acquisitionPhoto.findUnique({
      where: { id: input.photoId },
      include: { slot: true },
    });
    if (
      !photo?.ready ||
      photo.purgedAt ||
      photo.digest !== input.digest ||
      photo.runId !== source.runId ||
      photo.generation !== photo.slot.generation
    )
      continue;
    const manualAnalysis = acquisitionAnalysisForPhoto(source.candidate, photo);
    if (source.candidate.review !== null && manualAnalysis?.candidateRevision !== source.candidate.revision) continue;
    const result = await admitAcquisitionHandoff(db,source,()=>db.acquisitionProcessingJob.createMany({
      skipDuplicates: true,
      data: [
        {
          runId: source.runId,
          artifactId: source.artifactId,
          candidateId: source.candidateId,
          candidateRevision: source.candidate.revision,
          stage: VISUAL_STAGE,
          versionKey,
          input: { ...input, model, manualAnalysis },
        },
      ],
    }));
    added += result.count;
  }
  return added;
}

export async function retrieveAcquisitionVisual(
  db: PrismaClient,
  job: ClaimedAcquisitionJob,
  signal: AbortSignal,
  model: string,
  nativeWorker: Pick<AcquisitionNativeStream, "request">,
): Promise<Prisma.InputJsonObject> {
  const input = inputSchema.parse(job.input);
  if (input.model !== model)
    throw new AcquisitionJobSupersededError("Visual index version superseded");
  const run = await db.acquisitionRun.findUniqueOrThrow({where: {id: job.runId},
    select: {session: {select: {ownerPlayerId: true}}}});
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({
    where: { id: input.photoId },
    include: { slot: true },
  });
  const candidate = await db.acquisitionCandidate.findUniqueOrThrow({
    where: { id: job.candidateId },
    select: { physicalId: true },
  });
  if (
    !photo.ready ||
    photo.purgedAt ||
    photo.digest !== input.digest ||
    photo.runId !== job.runId ||
    photo.slotId !== candidate.physicalId ||
    photo.generation !== photo.slot.generation
  )
    throw new AcquisitionJobSupersededError("Visual photo input superseded");
  async function requireCurrentInput() {
    const [live] = await db.$queryRaw<{id: string}[]>`
      SELECT j.id FROM "AcquisitionProcessingJob" j
      JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
      JOIN "AcquisitionRun" r ON r.id=j."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "Player" p ON p.id=s."ownerPlayerId"
      JOIN "User" u ON u.id=s."createdByUserId"
      JOIN "AcquisitionPhoto" photo ON photo.id=${input.photoId} AND photo."runId"=j."runId"
      JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
      WHERE j.id=${job.id} AND j.status='RUNNING' AND j."leaseToken"=${job.leaseToken}
        AND j.stage=${VISUAL_STAGE} AND j."candidateRevision"=${job.candidateRevision}
        AND j."runId"=${job.runId} AND j."candidateId"=${job.candidateId} AND j."artifactId"=${job.artifactId}
        AND j.input=${JSON.stringify(job.input)}::jsonb AND j."leaseExpiresAt">clock_timestamp()
        AND c.revision=${job.candidateRevision} AND ${acquisitionAnalysisJobSql()}
        AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
        AND s."ownerPlayerId"=${run.session.ownerPlayerId}
        AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${input.digest}
        AND photo."inputKind"::text=${photo.inputKind}
        AND photo."slotId"=c."physicalId" AND photo.generation=slot.generation
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)`;
    if (!live || signal.aborted) throw new AcquisitionJobSupersededError("Visual input superseded");
  }
  await requireCurrentInput();
  const started = performance.now();
  const bytes = await readAcquisitionPhotoBytes(
    input.photoId,
    "raw",
    input.digest,
  );
  signal.throwIfAborted();
  const reuse = visualReuseIdentity({version: 1, ownerPlayerId: run.session.ownerPlayerId,
    photoDigest: input.digest, descriptor: model, inputKind: photo.inputKind,
    manualRegion: input.manualAnalysis?.region ?? undefined});
  // Retained completed jobs are the durable observation store. One indexed
  // exact-key lookup reads bounded evidence; no duplicate private pixel cache.
  const [previous] = await db.$queryRaw<{id: string; output: Prisma.JsonValue}[]>`
    SELECT j.id, j.output FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    WHERE j.stage='photo-visual-retrieval-v1' AND j.status='COMPLETE'
      AND j.output->'visualReuse'->>'key'=${reuse.key}
      AND s."ownerPlayerId"=${reuse.ownerPlayerId}
    ORDER BY j."createdAt" DESC, j.id DESC LIMIT 1`;
  let visual = previous ? reusableVisualNative(previous.output, reuse) : null;
  const reused = visual !== null;
  if (!visual) visual = checkedVisualNative(await nativeWorker.request(
    acquisitionNativePhotoInput(bytes, photo.inputKind, undefined, input.manualAnalysis?.region ?? undefined), signal), reuse);
  signal.throwIfAborted();
  await requireCurrentInput();
  return {
    version: 1,
    photoId: photo.id,
    visual,
    manualAnalysis: input.manualAnalysis ?? null,
    visualReuse: reuse,
    visualExecution: {reused, milliseconds: Math.round(performance.now() - started),
      inferenceRequests: reused ? 0 : 1, ...(reused ? {observationJobId: previous.id} : {})},
  } as unknown as Prisma.InputJsonObject;
}
