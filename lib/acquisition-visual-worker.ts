import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { acquisitionNativePhotoInput } from "./acquisition-image-input";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import { AcquisitionJobSupersededError, type ClaimedAcquisitionJob } from "./acquisition-jobs";
import { VISUAL_STAGE, visualNativeSchema } from "./acquisition-visual";
import { acquisitionHandoffQuery } from "./acquisition-handoff";

const inputSchema = z.object({
  photoId: z.string().uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().regex(/^[a-f0-9]{64}$/),
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
      AND c.review IS NULL AND NOT c.excluded
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" v
        WHERE v.stage=${VISUAL_STAGE} AND v."artifactId"=j."artifactId"
          AND v."candidateId"=c.id AND v."candidateRevision"=c.revision AND v."versionKey"=${versionKey})
  `));
  let added = 0;
  for (const row of rows) {
    const source = await db.acquisitionProcessingJob.findUniqueOrThrow({
      where: { id: row.id },
      include: { candidate: true },
    });
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
    const result = await db.acquisitionProcessingJob.createMany({
      skipDuplicates: true,
      data: [
        {
          runId: source.runId,
          artifactId: source.artifactId,
          candidateId: source.candidateId,
          candidateRevision: source.candidate.revision,
          stage: VISUAL_STAGE,
          versionKey,
          input: { ...input, model },
        },
      ],
    });
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
    throw new Error("Visual photo input changed");
  const bytes = await readAcquisitionPhotoBytes(
    input.photoId,
    "raw",
    input.digest,
  );
  const visual = visualNativeSchema.parse(
    await nativeWorker.request(acquisitionNativePhotoInput(bytes, photo.inputKind), signal),
  );
  if (
    visual.photoDigest !== input.digest ||
    visual.descriptor !== model ||
    signal.aborted
  )
    throw new Error("Visual processing input changed");
  return {
    version: 1,
    photoId: photo.id,
    visual,
  } as unknown as Prisma.InputJsonObject;
}
