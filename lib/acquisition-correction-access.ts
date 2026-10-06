import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AcquisitionActor } from "./acquisition-store";
import { authorizeCorrectionLibrary, ensureCorrectionAccount, lockCorrectionOwner } from "./acquisition-correction-library";
import { correctionMaintenanceGate, correctionBackupActive } from "./acquisition-correction-worker";
import { correctionCanonical } from "./acquisition-correction-policy";
import { readCorrectionBlob } from "./acquisition-correction-files";
type Tx = Prisma.TransactionClient;

export async function correctionUsage(tx: Tx, ownerPlayerId: string) {
  const account = await tx.correctionLibraryAccount.findUnique({ where: { ownerPlayerId }, select: {
    limitBytes: true, preservedBytes: true, reservedBytes: true, evidenceBytes: true,
    selectedControls: true, sampleCap: true, sampleBasisPoints: true,
  } });
  if (!account) return null;
  const pending = await tx.correctionBlob.aggregate({ where: { ownerPlayerId,
    state: { in: ["PENDING", "DELETING"] }, examples: { some: { deletedAt: null } } },
    _count: { _all: true }, _sum: { bytes: true }, _min: { createdAt: true } });
  const failures = await tx.correctionCaptureOutbox.groupBy({ by: ["errorCode"], where: {
    errorCode: { not: null }, blob: { ownerPlayerId, examples: { some: { deletedAt: null } } },
  }, _count: { _all: true } });
  return { limitBytes: String(account.limitBytes), preservedBytes: String(account.preservedBytes),
    reservedBytes: String(account.reservedBytes), evidenceBytes: String(account.evidenceBytes),
    pendingBytes: String(pending._sum.bytes ?? 0), pendingCount: pending._count._all,
    oldestPendingAt: pending._min.createdAt?.toISOString() ?? null,
    selectedControls: account.selectedControls, sampleCap: account.sampleCap,
    sampleBasisPoints: account.sampleBasisPoints,
    warnings: failures.map(failure => ({ code: failure.errorCode!, count: failure._count._all })) };
}
export async function getCorrectionLibrary(db: PrismaClient, actor: AcquisitionActor, ownerPlayerId: string, cursor?: string) {
  if (cursor) z.string().uuid().parse(cursor);
  return db.$transaction(async tx => {
    await authorizeCorrectionLibrary(tx, actor, ownerPlayerId, "LIST");
    const after = cursor ? await tx.correctionExample.findFirst({ where: { id: cursor, ownerPlayerId }, select: { createdAt: true, id: true } }) : null;
    if (cursor && !after) throw new Error("Capture correction page unavailable");
    const examples = await tx.correctionExample.findMany({ where: { ownerPlayerId, deletedAt: null,
      ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: {
        id: true, createdAt: true, label: true, labelState: true, normalControl: true,
        blob: { select: { bytes: true, state: true, preservedAt: true,
          _count: { select: { examples: { where: { deletedAt: null } } } } } },
      } });
    return { usage: await correctionUsage(tx, ownerPlayerId), examples: examples.slice(0, 50),
      nextCursor: examples.length > 50 ? examples[49].id : null };
  });
}
export async function readCorrectionExample(db: PrismaClient, actor: AcquisitionActor, ownerPlayerId: string, exampleId: string) {
  z.string().uuid().parse(exampleId);
  return db.$transaction(async tx => {
    await correctionMaintenanceGate(tx);
    await authorizeCorrectionLibrary(tx, actor, ownerPlayerId, "READ_ORIGINAL", exampleId);
    await lockCorrectionOwner(tx, ownerPlayerId);
    const example = await tx.correctionExample.findFirst({ where: { id: exampleId, ownerPlayerId, deletedAt: null }, include: { blob: true } });
    if (!example || example.blob.state !== "PRESERVED") throw new Error("Photo correction original unavailable");
    return { bytes: await readCorrectionBlob(ownerPlayerId, example.blob.digest, example.blob.bytes), mediaType: example.blob.mediaType };
  }, { timeout: 30000 });
}
export async function changeCorrectionExample(db: PrismaClient, actor: AcquisitionActor, ownerPlayerId: string,
  exampleId: string, action: "WITHDRAW_LABEL" | "REMOVE") {
  z.string().uuid().parse(exampleId);
  return db.$transaction(async tx => {
    await correctionMaintenanceGate(tx);
    await authorizeCorrectionLibrary(tx, actor, ownerPlayerId, action, exampleId);
    await ensureCorrectionAccount(tx, ownerPlayerId);
    const example = await tx.correctionExample.findFirst({ where: { id: exampleId, ownerPlayerId } });
    if (!example) throw new Error("Capture correction example unavailable");
    if (example.deletedAt) return { removed: true };
    if (action === "WITHDRAW_LABEL") {
      const bytes = Buffer.byteLength(correctionCanonical({ sourceMetadata: example.sourceMetadata, label: null }));
      await tx.correctionExample.update({ where: { id: exampleId }, data: { label: Prisma.DbNull, labelState: "WITHDRAWN", metadataBytes: bytes } });
      await tx.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: { evidenceBytes: { increment: bytes - example.metadataBytes } } });
      await tx.correctionLibraryAccess.create({ data: { ownerPlayerId, actorId: actor.userId, action: "LABEL_WITHDRAWN", exampleId } });
      return { removed: false };
    }
    const now = new Date(), sourcePhotoId = example.sourcePhotoId;
    await tx.correctionDeletionTombstone.upsert({ where: { ownerPlayerId_sourcePhotoId: { ownerPlayerId, sourcePhotoId } },
      create: { ownerPlayerId, sourcePhotoId, deletedAt: now }, update: { deletedAt: now } });
    const [events, evidence] = await Promise.all([
      tx.correctionReviewEvent.aggregate({ where: { ownerPlayerId, sourcePhotoId }, _sum: { bytes: true } }),
      tx.correctionEvidence.aggregate({ where: { ownerPlayerId, sourcePhotoId }, _sum: { bytes: true } }),
    ]);
    await tx.correctionReviewEvent.deleteMany({ where: { ownerPlayerId, sourcePhotoId } });
    await tx.correctionEvidence.deleteMany({ where: { ownerPlayerId, sourcePhotoId } });
    await tx.correctionExample.update({ where: { id: exampleId }, data: { label: Prisma.DbNull, sourceMetadata: Prisma.DbNull,
      metadataBytes: 0, firstEvidenceId: null, labelState: "REMOVED", deletedAt: now } });
    await tx.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: {
      evidenceBytes: { decrement: BigInt(events._sum.bytes ?? 0) + BigInt(evidence._sum.bytes ?? 0) + BigInt(example.metadataBytes) },
    } });
    if (!await correctionBackupActive(tx)) await tx.correctionRetentionPin.updateMany({
      where: { ownerPlayerId, photoId: sourcePhotoId, releasedAt: null }, data: { releasedAt: now },
    });
    await tx.correctionLibraryAccess.create({ data: { ownerPlayerId, actorId: actor.userId, action: "EXAMPLE_REMOVED", exampleId } });
    return { removed: true };
  });
}
