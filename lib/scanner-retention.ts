import type { PrismaClient } from "@prisma/client";
import { scannerRetentionSchema } from "./scanner-run-protocol";
import { authenticateScanner, scannerTransaction } from "./scanner-store";
import { PHOTO_RETENTION_DAYS_AFTER_COMMIT } from "./acquisition-files";
import {BATCH_TRASH_DAYS} from "./acquisition-batch-policy";
import {scannerTransferIsSettled} from "./scanner-drain-policy";
import {PHOTO_PRESSURE_CLEANUP_KEY} from "./acquisition-photo-pressure";

/** A helper may discard its own verified image after the server byte purge:
 * an aged commit receipt or an explicitly expired Trash tombstone is required.
 * This is an attestation, never a motor command or physical-count observation.
 * Unresolved transfers and mismatched image receipts remain local. */
export async function eligibleScannerOriginals(db: PrismaClient, authorization: string | null,
  value: unknown, epoch: string, now = new Date()) {
  const input = scannerRetentionSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { agent, actor } = await authenticateScanner(tx, authorization, now);
    const run = await tx.scannerRun.findUnique({ where: { id: input.runId },
      include: { acquisitionRun: { include: { session: true } } } });
    if (!run || run.agentId !== agent.id || run.epoch !== epoch || input.epoch !== epoch ||
        run.acquisitionRun.session.createdByUserId !== actor.userId)
      throw new Error("Scanner originals are not eligible for retention cleanup");
    const session = run.acquisitionRun.session;
    const trashCutoff = new Date(now.getTime() - BATCH_TRASH_DAYS * 86400000);
    const expiredTrash = !!(session.deletedAt && session.deletedAt <= now && session.trashedAt &&
      session.trashedAt <= trashCutoff && session.trashExpiresAt && session.trashExpiresAt <= now);
    const pressureDeleted = !!(session.deletedAt && session.deletedAt <= now &&
      await tx.acquisitionCommand.findUnique({where: {runId_requestKey: {
        runId: run.acquisitionRunId, requestKey: PHOTO_PRESSURE_CLEANUP_KEY}}}));
    if (!scannerTransferIsSettled(run) || !expiredTrash && !pressureDeleted && !run.reconciliation)
      return { version: 1 as const, runId: run.id, epoch, eligible: [] as string[] };
    const ids = input.artifacts.map(a => a.artifactId);
    const photos = await tx.acquisitionPhoto.findMany({
      where: { runId: run.acquisitionRunId, slot: { requestKey: { in: ids } } },
      include: { slot: true },
    });
    const candidates = await tx.acquisitionCandidate.findMany({
      where: { runId: run.acquisitionRunId, physicalId: { in: photos.map(p => p.slotId) } },
      include: { receipt: { include: { commit: true } } },
    });
    const bySlot = new Map(candidates.map(c => [c.physicalId, c]));
    const byPhoto = new Map(photos.map(p => [p.id, p]));
    const cutoff = new Date(now.getTime() - PHOTO_RETENTION_DAYS_AFTER_COMMIT * 24 * 60 * 60 * 1000);
    const eligible = input.artifacts.filter(a => {
      const photo = byPhoto.get(a.photoId);
      const member = photo && bySlot.get(photo.slotId)?.receipt;
      return photo?.slot.requestKey === a.artifactId && photo.digest === a.digest && photo.ready &&
        photo.purgedAt !== null && photo.purgedAt <= now && (expiredTrash || pressureDeleted ||
          photo.purgeAfter !== null && photo.purgeAfter <= now &&
          member?.commit.runId === run.acquisitionRunId && member.commit.createdAt <= cutoff);
    }).map(a => a.artifactId);
    return { version: 1 as const, runId: run.id, epoch, eligible };
  });
}
