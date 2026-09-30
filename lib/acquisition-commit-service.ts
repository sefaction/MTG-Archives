import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  acquisitionTransaction,
  readAcquisitionRow,
  hydrateAcquisitionRow,
  type AcquisitionActor,
} from "./acquisition-store";
import {
  acquisitionCommitSelectionSchema,
  acquisitionCommitRequestSchema,
  type AcquisitionCommitSelection,
  type AcquisitionCommitPreview,
  type AcquisitionCommitReceipt,
} from "./acquisition-commit";
import { acquisitionReviewDecisionSchema } from "./acquisition-review";
import { candidateCommitReadiness, candidateKey } from "./acquisition-domain";
import { SCANNER_CAPTURE_PROVIDER } from "./scanner-run-protocol";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";
import { writeInventoryReceipt } from "./inventory-receipt";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Tx = Prisma.TransactionClient;
type Row = Awaited<ReturnType<typeof readAcquisitionRow>>;
async function lockedSession(
  tx: Tx,
  actor: AcquisitionActor,
  sessionId: string,
) {
  await readAcquisitionRow(tx, actor, sessionId);
  await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
  return readAcquisitionRow(tx, actor, sessionId);
}
async function prepare(
  tx: Tx,
  actor: AcquisitionActor,
  row: Row,
  selection: AcquisitionCommitSelection,
) {
  if (row.intent !== "ADD_NEW" || !["phone-photo-v1", SCANNER_CAPTURE_PROVIDER].includes(row.run!.providerId))
    throw new Error("Capture provider is not available for this commit method");
  if (!["STOPPING", "COMPLETE", "CANCELLED"].includes(row.phase))
    throw new Error("Capture must be stopped before adding reviewed cards");
  const owner = await tx.player.findUnique({
    where: { id: row.ownerPlayerId },
  });
  if (!owner?.active) throw new Error("Capture owner unavailable");
  const photos = await tx.acquisitionPhoto.findMany({
    where: { id: { in: selection.photoIds }, runId: row.run!.id },
    include: { slot: true },
  });
  if (photos.length !== selection.photoIds.length)
    throw new Error("Photo unavailable");
  // STOPPING permits unfinished, unselected uploads to drain. Each selected
  // physical slot must itself be settled, current and certain before this subset
  // can commit. We do not label the entire capture run complete.
  const session = hydrateAcquisitionRow(row).session;
  const chosen = photos
    .map((photo) => {
      const candidate = row.run!.candidates.find(
        (c) => c.physicalId === photo.slotId,
      );
      if (!candidate || candidate.receipt)
        throw new Error("Capture card is already committed or unavailable");
      if (
        !photo.ready ||
        photo.purgedAt ||
        photo.generation !== photo.slot.generation
      )
        throw new Error(
          "Photo changed or is still uploading; reload before confirming",
        );
      const readiness = candidateCommitReadiness(
        session,
        candidateKey(session.run.runId, candidate.physicalId),
      );
      const reasons = readiness.reasons.filter(
        (r) => !(r === "ACQUISITION_NOT_SETTLED" && row.phase === "STOPPING"),
      );
      if (reasons.length)
        throw new Error(
          "Choose reviewed cards with a confirmed physical count",
        );
      const parsed = acquisitionReviewDecisionSchema.safeParse(
        candidate.review && {
          cardId: (candidate.review as any).cardId,
          language: (candidate.review as any).language,
          finish: (candidate.review as any).finish,
          condition: (candidate.review as any).condition,
        },
      );
      if (!parsed.success)
        throw new Error(
          "Choose complete printing, finish, condition and language reviews",
        );
      return { candidate, photo, decision: parsed.data };
    })
    .sort((a, b) => a.photo.slot.position - b.photo.slot.position);
  if (new Set(chosen.map((c) => c.candidate.id)).size !== chosen.length)
    throw new Error("Choose each physical card once");
  const cards = await tx.card.findMany({
    where: { id: { in: chosen.map((c) => c.decision.cardId) } },
  });
  for (const { decision } of chosen) {
    const card = cards.find((c) => c.id === decision.cardId);
    if (
      !card ||
      card.digital ||
      (card.lang &&
        card.lang.toLowerCase() !== decision.language.toLowerCase()) ||
      (Array.isArray(card.finishes) &&
        card.finishes.length &&
        !card.finishes.includes(decision.finish.toLowerCase()))
    )
      throw new Error(
        "Choose an available paper printing and its supported attributes",
      );
  }
  // Global order for this service: session first, then destination. No external
  // I/O occurs while these locks are held. All occupancy writers share this row.
  const destination = await lockAndReadInventoryCapacity(tx, {
    locationId: selection.locationId,
    ownerPlayerId: row.ownerPlayerId,
    section: selection.section,
  });
  const facts = {
    version: 1,
    sessionId: row.id,
    sessionRevision: row.revision,
    actorId: actor.userId,
    ownerPlayerId: row.ownerPlayerId,
    destination,
    cards: chosen.map(({ candidate, photo, decision }) => {
      const card = cards.find((c) => c.id === decision.cardId)!;
      return {
        candidateId: candidate.id,
        candidateRevision: candidate.revision,
        physicalId: candidate.physicalId,
        photoId: photo.id,
        photoDigest: photo.digest,
        position: photo.slot.position,
        generation: photo.generation,
        review: candidate.review,
        decision,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
      };
    }),
  };
  const preview: AcquisitionCommitPreview = {
    token: digest(facts),
    count: chosen.length,
    destination,
    overfill:
      destination.remaining === null
        ? 0
        : Math.max(0, chosen.length - destination.remaining),
    cards: facts.cards.map((c) => ({
      photoId: c.photoId,
      position: c.position,
      name: c.name,
      setCode: c.setCode,
      collectorNumber: c.collectorNumber,
      ...c.decision,
    })),
  };
  return { preview, facts, chosen };
}
export async function previewAcquisitionCommit(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  raw: unknown,
) {
  const selection = acquisitionCommitSelectionSchema.parse(raw);
  return acquisitionTransaction(
    db,
    async (tx) =>
      (
        await prepare(
          tx,
          actor,
          await lockedSession(tx, actor, sessionId),
          selection,
        )
      ).preview,
  );
}
function receiptDto(
  row: { id: string; createdAt: Date; snapshot: Prisma.JsonValue },
  replay: boolean,
): AcquisitionCommitReceipt {
  const snapshot = row.snapshot as any;
  return {
    id: row.id,
    count: snapshot.cards.length,
    createdAt: row.createdAt.toISOString(),
    inventoryItemIds: snapshot.inventoryItemIds,
    locationId: snapshot.destination.locationId,
    section: snapshot.destination.section,
    replay,
  };
}
export async function commitAcquisitionCards(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  raw: unknown,
) {
  const input = acquisitionCommitRequestSchema.parse(raw);
  input.photoIds.sort();
  const requestDigest = digest({ actorId: actor.userId, ...input });
  return acquisitionTransaction(db, async (tx) => {
    const row = await lockedSession(tx, actor, sessionId);
    const existing = await tx.acquisitionCommit.findUnique({
      where: {
        runId_requestKey: { runId: row.run!.id, requestKey: input.requestKey },
      },
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest)
        throw new Error("Capture commit identity conflict");
      return receiptDto(existing, true);
    }
    const { preview, facts, chosen } = await prepare(tx, actor, row, input);
    if (preview.token !== input.previewToken)
      throw new Error(
        "Capture preview changed; reload and confirm the current destination and cards",
      );
    if (preview.overfill && !input.overfillReason)
      throw new Error(
        "Choose fewer cards, another destination, or confirm overfill with a reason",
      );
    if (!preview.overfill && input.overfillReason)
      throw new Error("Capture overfill changed; reload the preview");
    const commitId = randomUUID(),
      now = new Date();
    const groups = new Map<string, typeof chosen>();
    for (const card of chosen) {
      const key = JSON.stringify(card.decision);
      groups.set(key, [...(groups.get(key) ?? []), card]);
    }
    const memberships: Prisma.AcquisitionCommitMemberCreateManyInput[] = [];
    const inventoryItemIds: string[] = [];
    for (const group of groups.values()) {
      const d = group[0].decision;
      const result = await writeInventoryReceipt(tx, {
        merge: null,
        lot: {
          currentOwnerId: row.ownerPlayerId,
          originalOpenerId: null,
          cardId: d.cardId,
          quantity: group.length,
          foilStatus: d.finish,
          sourceType: "ACQUISITION",
          condition: d.condition,
          language: d.language,
          locationId: preview.destination.locationId,
          locationSection: preview.destination.section,
          acquiredFromPullId: null,
          roundId: null,
          notes: null,
        },
        audit: {
          action: "acquisition_committed",
          actingUserId: actor.userId,
          reason: input.overfillReason,
          metadata: {
            acquisitionCommitId: commitId,
            acquisitionSessionId: row.id,
            candidateIds: group.map((c) => c.candidate.id),
            capacityBefore: preview.destination,
            overfill: preview.overfill,
            originalOpenerKnown: false,
          },
        },
      });
      inventoryItemIds.push(result.inventory.id);
      for (const item of group)
        memberships.push({
          candidateId: item.candidate.id,
          runId: row.run!.id,
          commitId,
          inventoryItemId: result.inventory.id,
          snapshot: JSON.parse(
            JSON.stringify(
              facts.cards.find((c) => c.candidateId === item.candidate.id),
            ),
          ),
        });
    }
    const receipt = await tx.acquisitionCommit.create({
      data: {
        id: commitId,
        runId: row.run!.id,
        actorUserId: actor.userId,
        requestKey: input.requestKey,
        requestDigest,
        createdAt: now,
        snapshot: JSON.parse(
          JSON.stringify({
            ...facts,
            overfill: preview.overfill,
            overfillReason: input.overfillReason,
            inventoryItemIds,
          }),
        ),
      },
    });
    // Unique physical candidate membership is the final independent duplicate
    // fence, even with a new request key. A failure rolls back stock and audits.
    await tx.acquisitionCommitMember.createMany({ data: memberships });
    await tx.acquisitionPhoto.updateMany({
      where: {
        runId: row.run!.id,
        slotId: { in: chosen.map((c) => c.photo.slotId) },
      },
      data: { purgeAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
    });
    await tx.acquisitionProcessingJob.updateMany({
      where: {
        candidateId: { in: chosen.map((c) => c.candidate.id) },
        status: { in: ["PENDING", "RUNNING"] },
      },
      data: {
        status: "SUPERSEDED",
        errorCode: "COMMITTED",
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await tx.acquisitionSession.update({
      where: { id: row.id },
      data: { revision: { increment: 1 } },
    });
    return receiptDto(receipt, false);
  });
}
