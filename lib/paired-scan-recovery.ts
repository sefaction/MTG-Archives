import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  acquisitionTransaction,
  readAcquisitionRow,
  type AcquisitionActor,
} from "./acquisition-store";
import { requireVisibleAcquisitionBatch } from "./acquisition-batch-policy";
import {
  isPairedProfile,
  operatorPairEvidenceSchema,
} from "./paired-scan-profile";
import { pairedMetadataHash } from "./paired-scan-policy";
const stamp = z
  .object({
    photoId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const pairedRecoverySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("link"),
      requestKey: z.string().uuid(),
      front: stamp,
      back: stamp,
      reason: z.string().trim().min(1).max(500),
      samePhysicalItem: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(["unpair", "ignore", "restore", "pending"]),
      requestKey: z.string().uuid(),
      source: stamp,
    })
    .strict(),
  z
    .object({
      action: z.literal("settle"),
      requestKey: z.string().uuid(),
      transportAndHopperClear: z.literal(true),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function recoverPairedScan(
  db: PrismaClient,
  actor: AcquisitionActor,
  batchId: string,
  raw: unknown,
) {
  const input = pairedRecoverySchema.parse(raw),
    payload = JSON.stringify(input);
  return acquisitionTransaction(db, async (tx) => {
    await readAcquisitionRow(tx, actor, batchId, {});
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${batchId} FOR UPDATE`;
    const row = await readAcquisitionRow(tx, actor, batchId, {});
    requireVisibleAcquisitionBatch(row);
    if (!isPairedProfile(row.scanProfile))
      throw Error("Use ordinary scan controls for this batch.");
    const runId = row.run!.id,
      requestKey = "paired-recovery:" + input.requestKey;
    const old = await tx.acquisitionCommand.findUnique({
      where: { runId_requestKey: { runId, requestKey } },
    });
    if (old) {
      if (
        JSON.stringify(
          JSON.parse(old.payload).input ?? JSON.parse(old.payload),
        ) !== payload
      )
        throw Error("Capture recovery request identity conflict.");
      return { replay: true };
    }
    const scanner = await tx.scannerRun.findFirstOrThrow({
      where: { acquisitionRunId: runId },
      orderBy: { segment: "desc" },
    });
    if (
      ["QUEUED", "STARTED"].includes(scanner.status) ||
      (!scanner.outcome && scanner.status !== "CANCELLED_BEFORE_START")
    )
      throw Error(
        "Capture is still active. Wait for the helper to finish before repairing pairs.",
      );
    const before: unknown[] = [];
    if (input.action === "settle") {
      // A transport acknowledgement releases the device, never asserts an image count.
      await tx.scannerRun.update({
        where: { id: scanner.id },
        data: {
          reconciliation: json({
            mode: "PAIRED_OPERATOR_TRANSPORT_CLEAR",
            actorUserId: actor.userId,
            observedAt: new Date().toISOString(),
            reason: input.reason,
            requestKey: input.requestKey,
            transportAndHopperClear: true,
          }),
        },
      });
      await tx.acquisitionSession.update({
        where: { id: batchId },
        data: { phase: "COMPLETE", revision: { increment: 1 } },
      });
    } else {
      if (!scanner.reconciliation)
        throw Error(
          "Capture transport needs to be cleared and acknowledged first.",
        );
      const get = async (source: z.infer<typeof stamp>) => {
        const photo = await tx.acquisitionPhoto.findUnique({
          where: { id: source.photoId },
          include: { slot: true },
        });
        if (
          !photo ||
          photo.runId !== runId ||
          photo.generation !== photo.slot.generation ||
          !photo.ready ||
          photo.purgedAt ||
          photo.digest !== source.digest
        )
          throw Error(
            "Capture source changed. Refresh before repairing the pair.",
          );
        const candidate = await tx.acquisitionCandidate.findUniqueOrThrow({
          where: { runId_physicalId: { runId, physicalId: photo.slotId } },
          include: { receipt: true },
        });
        if (
          candidate.excluded ||
          candidate.receipt ||
          candidate.revision !== source.revision
        )
          throw Error(
            "Capture item changed or is already saved. Refresh before continuing.",
          );
        before.push({
          photo: {
            id: photo.id,
            slotId: photo.slotId,
            generation: photo.generation,
            side: photo.side,
            digest: photo.digest,
            captureSlotId: photo.captureSlotId,
            captureGeneration: photo.captureGeneration,
          },
          slotEvidence: photo.slot.pairingEvidence,
          candidate: {
            id: candidate.id,
            revision: candidate.revision,
            review: candidate.review,
            pairedReview: candidate.pairedReview,
            ignored: candidate.ignored,
            excluded: candidate.excluded,
            countConfirmed: candidate.countConfirmed,
          },
        });
        return { photo, candidate };
      };
      const a = await get(input.action === "link" ? input.front : input.source);
      const clear = {
        review: Prisma.DbNull,
        pairedReview: Prisma.DbNull,
        countConfirmed: false,
        revision: { increment: 1 },
      };
      if (
        input.action === "ignore" ||
        input.action === "restore" ||
        input.action === "pending"
      ) {
        await tx.acquisitionCandidate.update({
          where: { id: a.candidate.id },
          data: {
            ...clear,
            ...(input.action === "pending"
              ? {}
              : { ignored: input.action === "ignore" }),
          },
        });
      } else if (input.action === "link") {
        const b = await get(input.back);
        if (
          a.photo.id === b.photo.id ||
          a.candidate.ignored ||
          b.candidate.ignored
        )
          throw Error("Choose two different available source images.");
        const current = await tx.acquisitionPhoto.findMany({
          where: {
            slotId: { in: [a.photo.slotId, b.photo.slotId] },
            OR: [
              { slotId: a.photo.slotId, generation: a.photo.generation },
              { slotId: b.photo.slotId, generation: b.photo.generation },
            ],
          },
        });
        if (current.length !== 2)
          throw Error(
            "Use Unpair first. Linking must not strand another source image.",
          );
        // Avoid unique-side collisions while swapping current FRONT/BACK assignments.
        await tx.acquisitionPhoto.update({
          where: { id: a.photo.id },
          data: { side: "UNKNOWN" },
        });
        await tx.acquisitionPhoto.update({
          where: { id: b.photo.id },
          data: {
            slotId: a.photo.slotId,
            generation: a.photo.generation,
            side: "BACK",
          },
        });
        await tx.acquisitionPhoto.update({
          where: { id: a.photo.id },
          data: { side: "FRONT" },
        });
        const evidence = operatorPairEvidenceSchema.parse({
          version: 1,
          kind: "OPERATOR_PAIR",
          operatorUserId: actor.userId,
          requestKey: input.requestKey,
          reason: input.reason,
          confirmedAt: new Date().toISOString(),
          sources: [a.photo, b.photo].map((p, index) => ({
            photoId: p.id,
            digest: p.digest,
            side: index === 0 ? "FRONT" : "BACK",
            captureSlotId: p.captureSlotId ?? p.slotId,
            captureGeneration: p.captureGeneration ?? p.generation,
            metadataHash: pairedMetadataHash(p.sourceMetadata),
          })),
        });
        await tx.acquisitionCaptureSlot.update({
          where: { id: a.photo.slotId },
          data: { pairingEvidence: json(evidence) },
        });
        await tx.acquisitionCandidate.update({
          where: { id: a.candidate.id },
          data: {
            ...clear,
            expectedSides: ["FRONT", "BACK"],
            provisional: false,
          },
        });
        if (a.candidate.id !== b.candidate.id)
          await tx.acquisitionCandidate.update({
            where: { id: b.candidate.id },
            data: { ...clear, excluded: true, ignored: true },
          });
        for (const [index, p] of [a.photo, b.photo].entries()) {
          const artifact = await tx.acquisitionArtifact.findUniqueOrThrow({
            where: { runId_sourceId: { runId, sourceId: p.id } },
          });
          await tx.acquisitionObservation.create({
            data: {
              runId,
              sourceId: `operator:${input.requestKey}:${index}`,
              artifactId: artifact.id,
              candidateId: a.candidate.id,
              side: index === 0 ? "FRONT" : "BACK",
            },
          });
        }
      } else {
        if (a.candidate.ignored)
          throw Error("Use Restore before unpairing this item.");
        const photos = await tx.acquisitionPhoto.findMany({
          where: { slotId: a.photo.slotId, generation: a.photo.generation },
          orderBy: { side: "desc" },
        });
        if (photos.length !== 2)
          throw Error("Capture item is already unpaired.");
        const last = await tx.acquisitionCaptureSlot.aggregate({
            where: { runId },
            _max: { position: true },
          }),
          position = (last._max.position ?? -1) + 1;
        const second = photos.find((p) => p.id !== a.photo.id)!,
          id = randomUUID();
        await tx.acquisitionCaptureSlot.create({
          data: {
            id,
            runId,
            requestKey: "operator-unpair:" + input.requestKey,
            position,
            generation: 1,
            pairingEvidence: json({
              kind: "OPERATOR_UNPAIRED",
              requestKey: input.requestKey,
              from: a.photo.slotId,
              actorUserId: actor.userId,
            }),
          },
        });
        await tx.acquisitionPhoto.update({
          where: { id: second.id },
          data: { slotId: id, generation: 1, side: "UNKNOWN" },
        });
        await tx.acquisitionPhoto.update({
          where: { id: a.photo.id },
          data: { side: "UNKNOWN" },
        });
        await tx.acquisitionCaptureSlot.update({
          where: { id: a.photo.slotId },
          data: {
            pairingEvidence: json({
              kind: "OPERATOR_UNPAIRED",
              requestKey: input.requestKey,
              actorUserId: actor.userId,
            }),
          },
        });
        await tx.acquisitionCandidate.update({
          where: { id: a.candidate.id },
          data: { ...clear, provisional: true },
        });
        const created = await tx.acquisitionCandidate.create({
          data: {
            runId,
            physicalId: id,
            identityKind: "DETECTION",
            acquisitionOrder: position,
            spatialOrder: 0,
            expectedSides: ["FRONT", "BACK"],
            provisional: true,
            uncertainty: [],
            revision: 0,
          },
        });
        const artifact = await tx.acquisitionArtifact.findUniqueOrThrow({
          where: { runId_sourceId: { runId, sourceId: second.id } },
        });
        await tx.acquisitionObservation.create({
          data: {
            runId,
            sourceId: "operator-unpair:" + input.requestKey,
            artifactId: artifact.id,
            candidateId: created.id,
            side: "UNKNOWN",
          },
        });
      }
      await tx.acquisitionSession.update({
        where: { id: batchId },
        data: { revision: { increment: 1 } },
      });
    }
    if (input.action === "link" || input.action === "unpair") {
      const ids =
        input.action === "link"
          ? [input.front.photoId, input.back.photoId]
          : await tx.acquisitionPhoto
              .findMany({
                where: {
                  OR: [
                    { id: input.source.photoId },
                    {
                      slot: {
                        runId,
                        requestKey: "operator-unpair:" + input.requestKey,
                      },
                    },
                  ],
                },
                select: { id: true },
              })
              .then((p) => p.map((p) => p.id));
      const photos = await tx.acquisitionPhoto.findMany({
        where: { id: { in: ids } },
        include: { slot: true },
      });
      const affected = [
        ...new Set([
          ...photos.map((p) => p.slotId),
          ...before.map(
            (item) => (item as { photo: { slotId: string } }).photo.slotId,
          ),
        ]),
      ];
      await tx.acquisitionProcessingJob.updateMany({
        where: {
          runId,
          candidate: { physicalId: { in: affected } },
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "SUPERSEDED",
          errorCode: "PAIRED_ASSOCIATION_CHANGED",
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      for (const photo of photos) {
        const candidate = await tx.acquisitionCandidate.findUniqueOrThrow({
          where: { runId_physicalId: { runId, physicalId: photo.slotId } },
        });
        const artifact = await tx.acquisitionArtifact.findUniqueOrThrow({
          where: { runId_sourceId: { runId, sourceId: photo.id } },
        });
        const canonical = await tx.acquisitionProcessingJob.findFirst({
          where: { artifactId: artifact.id, stage: "photo-canonical-v1" },
          orderBy: { createdAt: "desc" },
        });
        if (!canonical)
          throw Error(
            "Capture preparation evidence is unavailable. Retain the originals.",
          );
        await tx.acquisitionProcessingJob.createMany({
          skipDuplicates: true,
          data: [
            {
              runId,
              artifactId: artifact.id,
              candidateId: candidate.id,
              candidateRevision: candidate.revision,
              stage: canonical.stage,
              versionKey: canonical.versionKey,
              input: canonical.input as Prisma.InputJsonValue,
              ...(canonical.status === "COMPLETE"
                ? {
                    status: "COMPLETE" as const,
                    output: canonical.output as Prisma.InputJsonValue,
                  }
                : {}),
            },
          ],
        });
      }
    }
    await tx.acquisitionCommand.create({
      data: {
        runId,
        requestKey,
        payload: JSON.stringify({
          input,
          actorUserId: actor.userId,
          observedAt: new Date().toISOString(),
          before,
        }),
      },
    });
    return { replay: false };
  });
}
