import { Prisma, type PrismaClient, type AcquisitionRecognitionRerun } from "@prisma/client";
import { z } from "zod";
import { isAdminUser } from "./auth-policy";
import type { AcquisitionActor } from "./acquisition-store";
import { acquisitionAnalysisForPhoto } from "./acquisition-analysis-scope";

export const acquisitionRerunInput = z.object({
  scope: z.enum(["MINE", "ALL"]), requestKey: z.string().uuid(),
}).strict();
export type AcquisitionRerunScope = z.infer<typeof acquisitionRerunInput>["scope"];
export type AcquisitionRerunStatus = {
  id: string; status: string; queued: number; createdAt: string; finishedAt: string | null;
};
const activeStatuses = ["QUEUED", "RUNNING"];
class RerunAuthorizationError extends Error {}
// One short, durable admission operation at a time across all web/worker replicas.
// Native inference continues on its existing fair queues and leases.
const lock = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT pg_advisory_xact_lock(1057, 20261120)::text`;
function dto(row: AcquisitionRecognitionRerun): AcquisitionRerunStatus {
  return {id: row.id, status: row.status, queued: row.queued,
    createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null};
}
async function authorized(tx: Prisma.TransactionClient, actor: AcquisitionActor, scope: AcquisitionRerunScope) {
  const user = await tx.user.findUnique({where: {id: actor.userId}, include: {player: true}});
  if (!user?.isActive || user.forcePasswordChange ||
      (scope === "ALL" ? !(actor.adminMode && isAdminUser(user, user.player)) : !user.player?.active))
    throw new RerunAuthorizationError("Capture recognition rerun unavailable");
  return user;
}
export async function getAcquisitionRerun(db: PrismaClient, actor: AcquisitionActor, scope: AcquisitionRerunScope) {
  return db.$transaction(async tx => {
    await authorized(tx, actor, scope);
    const row = await tx.acquisitionRecognitionRerun.findFirst({
      where: {actorUserId: actor.userId, scope}, orderBy: [{createdAt: "desc"}, {id: "desc"}],
    });
    return row ? dto(row) : null;
  });
}
export async function requestAcquisitionRerun(db: PrismaClient, actor: AcquisitionActor, raw: unknown) {
  const input = acquisitionRerunInput.parse(raw);
  return db.$transaction(async tx => {
    await lock(tx);
    const user = await authorized(tx, actor, input.scope);
    const previous = await tx.acquisitionRecognitionRerun.findUnique({
      where: {actorUserId_requestKey: {actorUserId: actor.userId, requestKey: input.requestKey}},
    });
    if (previous) {
      if (previous.scope !== input.scope) throw new Error("Capture rerun request changed; retry its original scope");
      return dto(previous);
    }
    const running = await tx.acquisitionRecognitionRerun.findFirst({where: {status: {in: activeStatuses}}});
    if (running) {
      // Only the exact persisted key can replay. Coalescing a different key
      // without recording an alias would repeat work if its reply were lost.
      throw new Error("Processing another recognition rerun request. Wait for it to finish queueing, then retry.");
    }
    return dto(await tx.acquisitionRecognitionRerun.create({data: {
      actorUserId: actor.userId, ownerPlayerId: input.scope === "MINE" ? user.playerId : null,
      scope: input.scope, requestKey: input.requestKey,
    }}));
  }, {timeout: 15000});
}

// Source eligibility is checked again under the same session lock used by
// confirmation, commit, retake and publication. Nothing resets evidence or leases.
function eligible(request: AcquisitionRecognitionRerun) {
  return Prisma.sql`s."trashedAt" IS NULL AND s."deletedAt" IS NULL AND s."cancelledAt" IS NULL
    AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
    AND (${request.scope === "ALL"} OR s."ownerPlayerId"=${request.ownerPlayerId})
    AND NOT c.excluded AND (c.review IS NULL OR c.review='null'::jsonb)
    AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
    AND photo.ready AND photo."purgedAt" IS NULL AND photo.generation=slot.generation
    AND photo."createdAt"<=${request.createdAt}
    AND EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" prepared
      WHERE prepared."candidateId"=c.id AND prepared.stage='photo-canonical-v1' AND prepared.status='COMPLETE'
        AND prepared.input->>'photoId'=photo.id AND prepared.input->>'digest'=photo.digest)`;
}
const joins = Prisma.sql`FROM "AcquisitionCandidate" c
  JOIN "AcquisitionRun" r ON r.id=c."runId"
  JOIN "AcquisitionSession" s ON s.id=r."sessionId"
  JOIN "Player" p ON p.id=s."ownerPlayerId" JOIN "User" u ON u.id=s."createdByUserId"
  JOIN "AcquisitionCaptureSlot" slot ON slot.id=c."physicalId" AND slot."runId"=c."runId"
  JOIN "AcquisitionPhoto" photo ON photo."slotId"=slot.id AND photo."runId"=c."runId" AND photo.generation=slot.generation`;
export async function runAcquisitionRerunOnce(db: PrismaClient) {
  return db.$transaction(async tx => {
    await lock(tx);
    const request = await tx.acquisitionRecognitionRerun.findFirst({where: {status: {in: activeStatuses}}});
    if (!request) return {queued: 0, active: false};
    try {
      const user = await authorized(tx, {userId: request.actorUserId, adminMode: request.scope === "ALL"},
        request.scope as AcquisitionRerunScope);
      if (request.scope === "MINE" && user.playerId !== request.ownerPlayerId)
        throw new RerunAuthorizationError("Capture owner changed");
    } catch (error) {
      if (!(error instanceof RerunAuthorizationError)) throw error;
      await tx.acquisitionRecognitionRerun.update({where: {id: request.id}, data: {status: "CANCELLED", finishedAt: new Date()}});
      return {queued: 0, active: false};
    }
    const candidates = await tx.$queryRaw<{id: string; sessionId: string}[]>`
      SELECT c.id, s.id AS "sessionId" ${joins}
      WHERE c.id>${request.cursor} AND ${eligible(request)} ORDER BY c.id LIMIT 40`;
    let queued = 0;
    // Acquire batch locks in a consistent order; all writes roll back together
    // if a conflicting retake/commit wins. Cursor advancement is in this transaction.
    for (const sessionId of [...new Set(candidates.map(c => c.sessionId))].sort()) {
      await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${sessionId} FOR UPDATE`;
      let changed = 0;
      for (const target of candidates.filter(c => c.sessionId === sessionId)) {
        const [source] = await tx.$queryRaw<{id: string; revision: number; manualAnalysis: Prisma.JsonValue;
          photoId: string; digest: string; generation: number}[]>`
          SELECT c.id,c.revision,c."manualAnalysis",photo.id AS "photoId",photo.digest,photo.generation ${joins}
          WHERE c.id=${target.id} AND ${eligible(request)}`;
        if (!source) continue;
        const previous = acquisitionAnalysisForPhoto(source, {id: source.photoId, digest: source.digest, generation: source.generation});
        await tx.acquisitionCandidate.update({where: {id: source.id}, data: {
          revision: {increment: 1}, manualAnalysis: {version: 1, requestKey: request.id,
            photoId: source.photoId, digest: source.digest, generation: source.generation,
            candidateRevision: source.revision + 1, region: previous?.region ?? null},
        }});
        changed++;
      }
      if (changed) await tx.acquisitionSession.update({where: {id: sessionId}, data: {revision: {increment: 1}}});
      queued += changed;
    }
    await tx.acquisitionRecognitionRerun.update({where: {id: request.id}, data: {
      queued: {increment: queued}, cursor: candidates.at(-1)?.id ?? request.cursor,
      status: candidates.length === 40 ? "RUNNING" : "COMPLETE",
      ...(candidates.length < 40 ? {finishedAt: new Date()} : {}),
    }});
    return {queued, active: candidates.length === 40};
  }, {timeout: 15000});
}
