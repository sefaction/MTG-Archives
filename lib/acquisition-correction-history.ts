import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AcquisitionActor } from "./acquisition-store";
import { authorizeCorrectionLibrary, lockCorrectionOwner } from "./acquisition-correction-library";
import { correctionHistoryEntry } from "./acquisition-correction-history-dto";

export async function getCorrectionReviewHistory(db: PrismaClient, actor: AcquisitionActor,
  ownerPlayerId: string, exampleId: string, cursor?: string) {
  z.string().uuid().parse(exampleId);
  if (cursor) z.string().uuid().parse(cursor);
  return db.$transaction(async tx => {
    await authorizeCorrectionLibrary(tx, actor, ownerPlayerId, "READ_REVIEW_HISTORY", exampleId);
    await lockCorrectionOwner(tx, ownerPlayerId);
    const example = await tx.correctionExample.findFirst({ where: { id: exampleId, ownerPlayerId, deletedAt: null },
      select: { sourcePhotoId: true } });
    if (!example) throw new Error("Capture correction history unavailable");
    const scope = { ownerPlayerId, sourcePhotoId: example.sourcePhotoId };
    const after = cursor ? await tx.correctionReviewEvent.findFirst({ where: { ...scope, id: cursor },
      select: { candidateRevision: true, id: true } }) : null;
    if (cursor && !after) throw new Error("Capture correction history page unavailable");
    // Saved revisions, not wall-clock timestamps, establish the review sequence.
    const events = await tx.correctionReviewEvent.findMany({ where: { ...scope, ...(after ? { OR: [
      { candidateRevision: { lt: after.candidateRevision } },
      { candidateRevision: after.candidateRevision, id: { lt: after.id } },
    ] } : {}) }, orderBy: [{ candidateRevision: "desc" }, { id: "desc" }], take: 21,
      select: { id: true, candidateRevision: true, createdAt: true, origin: true, classification: true, payload: true } });
    return { entries: events.slice(0, 20).map(correctionHistoryEntry), nextCursor: events.length > 20 ? events[19].id : null };
  });
}
