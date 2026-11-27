import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  acquisitionTransaction,
  readAcquisitionRow,
  type AcquisitionActor,
} from "./acquisition-store";
import {
  pairedDecisionSchema,
  pairedSourceFingerprint,
} from "./paired-scan-policy";
import { isPairedProfile } from "./paired-scan-profile";
import { resolvePairedCardIdentity } from "./paired-scan-identities";
import { acquisitionReviewDecisionSchema } from "./acquisition-review";
import { requireVisibleAcquisitionBatch } from "./acquisition-batch-policy";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const pairedReviewInput = z
  .object({
    requestKey: z.string().uuid(),
    slotId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    decision: pairedDecisionSchema,
    attributes: acquisitionReviewDecisionSchema.omit({ cardId: true }),
  })
  .strict();
export async function confirmPairedScan(
  db: PrismaClient,
  actor: AcquisitionActor,
  batchId: string,
  raw: unknown,
) {
  const input = pairedReviewInput.parse(raw);
  const payload = JSON.stringify(input);
  return acquisitionTransaction(
    db,
    async (tx) => {
      await readAcquisitionRow(tx, actor, batchId, {});
      await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${batchId} FOR UPDATE`;
      const row = await readAcquisitionRow(tx, actor, batchId, {
        slotId: input.slotId,
      });
      requireVisibleAcquisitionBatch(row);
      if (
        !isPairedProfile(row.scanProfile) ||
        row.scanProfile !== input.decision.profile
      )
        throw Error("This decision does not match the batch scan profile.");
      const commandKey = "paired-review:" + input.requestKey;
      const previous = await tx.acquisitionCommand.findUnique({
        where: {
          runId_requestKey: { runId: row.run!.id, requestKey: commandKey },
        },
      });
      if (previous) {
        if (previous.payload !== payload)
          throw Error("Paired confirmation identity conflict.");
        return { replay: true };
      }
      const scanner = await tx.scannerRun.findFirst({
        where: { acquisitionRunId: row.run!.id },
        orderBy: { segment: "desc" },
      });
      if (
        !scanner?.reconciliation ||
        ["QUEUED", "STARTED"].includes(scanner.status)
      )
        throw Error(
          "Capture must finish and its transport be reconciled before confirming pairs.",
        );
      const candidate = row.run!.candidates.find(
        (c) => c.physicalId === input.slotId,
      );
      if (
        !candidate ||
        candidate.excluded ||
        candidate.ignored ||
        candidate.receipt
      )
        throw Error(
          "Physical item is unavailable or already saved to Inventory.",
        );
      if (candidate.revision !== input.revision)
        throw Error("The pair changed. Refresh before confirming.");
      const slot = await tx.acquisitionCaptureSlot.findUniqueOrThrow({
        where: { id: input.slotId },
        include: { photos: true },
      });
      if (slot.runId !== row.run!.id) throw Error("Pair is not in this batch.");
      const fingerprint = pairedSourceFingerprint(
        row.scanProfile,
        slot.generation,
        slot.pairingEvidence,
        slot.photos,
      );
      if (fingerprint !== input.sourceFingerprint)
        throw Error("Source images changed. Review both current sides.");
      const card = await resolvePairedCardIdentity(tx, input.decision);
      if (
        card.lang &&
        card.lang.toLowerCase() !== input.attributes.language.toLowerCase()
      )
        throw Error(
          "Choose the language of the selected face printings; mixed-language faces use MUL.",
        );
      if (
        !Array.isArray(card.finishes) ||
        !card.finishes.includes(input.attributes.finish.toLowerCase())
      )
        throw Error("Choose a compatible finish for this physical item.");
      if (
        input.attributes.openerPlayerId &&
        !(await tx.player.findUnique({
          where: { id: input.attributes.openerPlayerId },
        }))
      )
        throw Error("Choose an existing original opener or Unknown.");
      const review = {
        ...input.attributes,
        cardId: card.id,
        actorId: actor.userId,
      };
      await tx.acquisitionCandidate.update({
        where: { id: candidate.id },
        data: {
          review: json(review),
          revision: { increment: 1 },
          countConfirmed: true,
          pairedReview: json({
            version: 1,
            sourceFingerprint: fingerprint,
            pairingConfirmation: "USER_CONFIRMED_BOTH_SIDES",
            pairingEvidence: slot.pairingEvidence,
            sources: slot.photos
              .filter((p) => p.generation === slot.generation)
              .map((p) => ({
                id: p.id,
                side: p.side,
                generation: p.generation,
                digest: p.digest,
              })),
            decision: input.decision,
            cardId: card.id,
            actorId: actor.userId,
            requestKey: input.requestKey,
          }),
        },
      });
      await tx.acquisitionSession.update({
        where: { id: row.id },
        data: { revision: { increment: 1 } },
      });
      await tx.acquisitionCommand.create({
        data: { runId: row.run!.id, requestKey: commandKey, payload },
      });
      return { replay: false, cardId: card.id };
    },
    true,
  ); // A first shared application identity may race another batch's upsert.
}
export async function requirePairedCommit(
  tx: Prisma.TransactionClient,
  session: { scanProfile: string; run: { id: string } | null },
  candidate: {
    physicalId: string;
    pairedReview: Prisma.JsonValue;
    review: Prisma.JsonValue;
  },
) {
  if (!isPairedProfile(session.scanProfile)) return;
  const slot = await tx.acquisitionCaptureSlot.findUniqueOrThrow({
    where: { id: candidate.physicalId },
    include: { photos: true },
  });
  if (slot.runId !== session.run?.id)
    throw Error("Physical pair is not in this batch.");
  const saved = z
    .object({
      version: z.literal(1),
      sourceFingerprint: z.string(),
      cardId: z.string(),
      decision: pairedDecisionSchema,
    })
    .passthrough()
    .parse(candidate.pairedReview);
  const review = z
    .object({ cardId: z.string() })
    .passthrough()
    .parse(candidate.review);
  if (
    saved.cardId !== review.cardId ||
    saved.decision.profile !== session.scanProfile ||
    saved.sourceFingerprint !==
      pairedSourceFingerprint(
        session.scanProfile,
        slot.generation,
        slot.pairingEvidence,
        slot.photos,
      )
  )
    throw Error("Review both current sides before adding this physical item.");
}
