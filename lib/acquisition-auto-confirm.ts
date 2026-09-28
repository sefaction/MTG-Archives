import { Prisma, type PrismaClient } from "@prisma/client";
import { acquisitionRecognitionDto } from "./acquisition-recognition-dto";
import {
  acquisitionDefaultsSchema,
  acquisitionReviewDecisionSchema,
} from "./acquisition-review";

// Worker-only, bounded reconciliation. Completed evidence stays immutable;
// attempt/history commands make retries durable and avoid starving later jobs.
export async function confirmStrongAcquisitionMatches(db: PrismaClient) {
  const jobs = await db.$queryRaw<{ id: string }[]>`
    SELECT j.id FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id = j."candidateId"
    JOIN "AcquisitionRun" r ON r.id = j."runId"
    JOIN "AcquisitionSession" s ON s.id = r."sessionId"
    JOIN "Player" p ON p.id = s."ownerPlayerId"
    JOIN "User" u ON u.id = s."createdByUserId"
    WHERE j.stage = 'photo-recognition-v1' AND j.status = 'COMPLETE'
      AND j.output->'proposals'->>'status' = 'STRONG_MATCH'
      AND j.output->'proposals'->>'version' = '4'
      AND j."candidateRevision" = c.revision AND c.review IS NULL AND NOT c.excluded
      AND r."providerId" = 'phone-photo-v1'
      AND s.phase NOT IN ('DRAFT', 'CANCELLED')
      AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND s."reviewDefaults"->>'finish' IN ('NONFOIL', 'FOIL', 'ETCHED')
      AND s."reviewDefaults"->>'condition' IN ('NM', 'LP', 'MP', 'HP', 'DMG')
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommand" cmd WHERE cmd."runId" = r.id
        AND cmd."requestKey" = 'auto-confirm:' || j.id || ':' || s."defaultsRevision"::text)
    ORDER BY j."createdAt", j.id LIMIT 25
  `;
  let confirmed = 0;
  for (const { id } of jobs) {
    confirmed += await db.$transaction(async (tx) => {
      const job = await tx.acquisitionProcessingJob.findUniqueOrThrow({
        where: { id },
        include: { run: true },
      });
      await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${job.run.sessionId} FOR UPDATE`;
      const session = await tx.acquisitionSession.findUniqueOrThrow({
        where: { id: job.run.sessionId },
        include: { ownerPlayer: true, createdByUser: true },
      });
      const candidate = await tx.acquisitionCandidate.findUniqueOrThrow({
        where: { id: job.candidateId },
        include: { receipt: true },
      });
      if (
        candidate.review !== null ||
        candidate.receipt ||
        candidate.excluded ||
        candidate.revision !== job.candidateRevision ||
        job.status !== "COMPLETE" ||
        ["DRAFT", "CANCELLED"].includes(session.phase) ||
        !session.ownerPlayer.active ||
        !session.createdByUser.isActive ||
        session.createdByUser.forcePasswordChange
      )
        return 0;
      const requestKey = `auto-confirm:${job.id}:${session.defaultsRevision}`;
      if (
        await tx.acquisitionCommand.findUnique({
          where: { runId_requestKey: { runId: job.runId, requestKey } },
        })
      )
        return 0;
      const input = job.input as { photoId?: string; digest?: string };
      const photo = input.photoId
        ? await tx.acquisitionPhoto.findUnique({
            where: { id: input.photoId },
            include: { slot: true },
          })
        : null;
      const result = acquisitionRecognitionDto("COMPLETE", job.output).result;
      const exact =
        result?.proposals.filter((p) =>
          p.reasons.includes("SET_AND_COLLECTOR_TEXT"),
        ) ?? [];
      const proposal = exact.length === 1 ? exact[0] : null;
      const defaults = acquisitionDefaultsSchema.safeParse(
        session.reviewDefaults,
      );
      const card = proposal
        ? await tx.card.findUnique({ where: { id: proposal.card.id } })
        : null;
      const human = await tx.acquisitionCommand.findMany({
        where: {
          runId: job.runId,
          requestKey: { startsWith: `review:${candidate.id}:` },
        },
        select: { payload: true },
      });
      const humanChangedPhoto = human.some(
        (cmd) => JSON.parse(cmd.payload).photoId === photo?.id,
      );
      const decision = acquisitionReviewDecisionSchema.safeParse({
        cardId: card?.id,
        language: card?.lang,
        finish: defaults.success ? defaults.data.finish : "UNKNOWN",
        condition: defaults.success ? defaults.data.condition : null,
      });
      const evidenceVersion = (
        job.output as { proposals?: { version?: number } }
      )?.proposals?.version;
      const eligible =
        evidenceVersion === 4 &&
        photo &&
        photo.ready &&
        !photo.purgedAt &&
        photo.runId === job.runId &&
        photo.slotId === candidate.physicalId &&
        photo.generation === photo.slot.generation &&
        photo.digest === input.digest &&
        result?.status === "STRONG_MATCH" &&
        result.automaticAcceptance &&
        proposal?.reasons.includes("STRONG_EXACT_PRINTING") &&
        proposal.reasons.includes("TITLE_EXACT") &&
        !proposal.reasons.includes("STAMP_UNVERIFIED") &&
        !proposal.reasons.includes("ORIENTATION_UNCERTAIN") &&
        !humanChangedPhoto &&
        card &&
        !card.digital &&
        card.name === proposal.card.name &&
        card.setCode === proposal.card.setCode &&
        card.collectorNumber === proposal.card.collectorNumber &&
        card.lang === proposal.card.lang &&
        decision.success &&
        Array.isArray(card.finishes) &&
        card.finishes.includes(decision.data.finish.toLowerCase());
      const review =
        eligible && decision.success
          ? {
              ...decision.data,
              actorId: "system:acquisition",
              source: "AUTO_STRONG_MATCH" as const,
            }
          : null;
      await tx.acquisitionCommand.create({
        data: {
          runId: job.runId,
          requestKey,
          payload: JSON.stringify({
            version: 1,
            action: "AUTO_CONFIRM_STRONG_MATCH",
            photoId: photo?.id,
            jobId: job.id,
            defaultsRevision: session.defaultsRevision,
            outcome: review ? "CONFIRMED" : "REVIEW_REQUIRED",
            after: review,
          }),
        },
      });
      if (!review) return 0;
      await tx.acquisitionCandidate.update({
        where: { id: candidate.id },
        data: {
          review: review as Prisma.InputJsonObject,
          revision: { increment: 1 },
        },
      });
      await tx.acquisitionSession.update({
        where: { id: session.id },
        data: { revision: { increment: 1 } },
      });
      return 1;
    });
  }
  return confirmed;
}
