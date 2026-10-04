import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { acquisitionTransaction, readAcquisitionRow } from "./acquisition-store";
import type { AcquisitionActor } from "./acquisition-store";
import { scannerStartMarkerExists, persistScannerStartRetirement } from "./scanner-control-files";
import {scannerTransferIsSettled} from "./scanner-drain-policy";

export const BATCH_TRASH_DAYS = 7;
export const batchLifecycleAction = z.enum(["cancel", "trash", "restore", "resume-processing"]);

/** Locks match scanner admission: series, physical runs, then session. A
 * cancellation freezes inference immediately while accepted transfers drain. */
export async function manageAcquisitionBatch(db: PrismaClient, actor: AcquisitionActor,
  sessionId: string, value: unknown, now = new Date()) {
  const action = batchLifecycleAction.parse(value);
  return acquisitionTransaction(db, async tx => {
    const authorized = await readAcquisitionRow(tx, actor, sessionId);
    const runId = authorized.run!.id;
    const runs = await tx.scannerRun.findMany({where: {acquisitionRunId: runId}, orderBy: {segment: "asc"}});
    const rootId = runs[0]?.seriesRootId;
    if (rootId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scanner-series-v1:${rootId}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE "acquisitionRunId"=${runId} ORDER BY segment FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id=${sessionId} FOR UPDATE`;
    const row = await readAcquisitionRow(tx, actor, sessionId);
    if (row.deletedAt) throw new Error("Capture batch has expired and cannot be restored");
    const currentRuns = await tx.scannerRun.findMany({where: {acquisitionRunId: runId}});
    const draining = currentRuns.some(r => !scannerTransferIsSettled(r));
    if (action === "restore" || action === "resume-processing") {
      if (draining) throw new Error("Capture is still draining or needs scanner recovery; wait before restoring processing");
      if (action === "restore") {
        if (!row.trashedAt) return {id: row.id, phase: row.phase, replay: true};
        if (!row.trashExpiresAt || row.trashExpiresAt <= now)
          throw new Error("Capture batch has expired and cannot be restored");
      } else {
        if (row.trashedAt) throw new Error("Capture batch is in Trash; restore it first");
        if (!row.cancelledAt && row.phase !== "CANCELLED") return {id: row.id, phase: row.phase, replay: true};
      }
      // Restore never revives physical capture or a stopped section series.
      // A batch cancelled before Trash remains cancelled until explicitly resumed.
      const keepCancelled = action === "restore" && row.phaseBeforeTrash === "CANCELLED";
      await tx.acquisitionSession.update({where: {id: row.id}, data: {
        phase: keepCancelled ? "CANCELLED" : "COMPLETE", cancelledAt: keepCancelled ? row.cancelledAt : null,
        trashedAt: null, trashExpiresAt: null, phaseBeforeTrash: null, scannerReserved: 0,
        revision: {increment: 1},
      }});
      if (!keepCancelled) await tx.acquisitionProcessingJob.updateMany({where: {runId,
        status: "SUPERSEDED", errorCode: "BATCH_STOPPED"}, data: {status: "PENDING", attempts: 0,
          availableAt: now, errorCode: null, leaseToken: null, leaseExpiresAt: null}});
      return {id: row.id, phase: keepCancelled ? "CANCELLED" : "COMPLETE", replay: false};
    }
    if (action === "cancel" && row.cancelledAt || action === "trash" && row.trashedAt)
      return {id: row.id, phase: row.phase, replay: true};
    if (row.trashedAt) throw new Error("Capture batch is in Trash; restore it first");
    if (rootId) {
      const latest = await tx.scannerRun.findFirst({where: {seriesRootId: rootId},
        orderBy: [{seriesOrdinal: "desc"}, {segment: "desc"}]});
      if (latest?.acquisitionRunId === runId) await tx.scannerRun.updateMany({where: {id: rootId, seriesStoppedAt: null},
        data: {seriesStoppedAt: now}});
    }
    let acceptedOrUncertain = false;
    for (const run of currentRuns) {
      if (scannerTransferIsSettled(run)) continue;
      const noStart = run.status === "QUEUED" && !run.executionId && !await scannerStartMarkerExists(run.id);
      if (noStart) await persistScannerStartRetirement(run.id, actor.userId, run.epoch, {action, sessionId});
      else acceptedOrUncertain = true;
      await tx.scannerRun.update({where: {id: run.id}, data: {stopRequestedAt: run.stopRequestedAt ?? now,
        ...(noStart ? {status: "CANCELLED_BEFORE_START", reconciliation: {
          mode: "CANCELLED_WITHOUT_START", actorUserId: actor.userId, recordedAt: now.toISOString(),
          evidence: "No authorized START; batch processing cancelled",
        }} : run.status === "QUEUED" ? {status: "RECONCILIATION"} : {}),
      }});
    }
    await tx.acquisitionSession.update({where: {id: row.id}, data: {
      cancelledAt: row.cancelledAt ?? now, phase: "CANCELLED",
      scannerReserved: acceptedOrUncertain ? row.scannerReserved : 0, revision: {increment: 1},
      ...(action === "trash" ? {trashedAt: now, trashExpiresAt: new Date(now.getTime() + BATCH_TRASH_DAYS * 86400000),
        phaseBeforeTrash: row.cancelledAt || row.phase === "CANCELLED" ? "CANCELLED" : row.phase} : {}),
    }});
    // Clear every live lease, including canonical preparation. Late results and
    // failures cannot publish or resurrect a cancelled job after restoration.
    await tx.acquisitionProcessingJob.updateMany({where: {runId, status: {in: ["PENDING", "RUNNING", "FAILED"]}},
      data: {status: "SUPERSEDED", errorCode: "BATCH_STOPPED", leaseToken: null, leaseExpiresAt: null}});
    await tx.acquisitionCommand.create({data: {runId, requestKey: `batch-${action}:${row.revision + 1}`,
      payload: JSON.stringify({action, actorUserId: actor.userId, at: now.toISOString()})}});
    return {id: row.id, phase: "CANCELLED", draining: acceptedOrUncertain, replay: false};
  });
}

