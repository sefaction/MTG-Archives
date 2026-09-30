import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scannerTransaction, authenticateScanner, listScannerAgents } from "./scanner-store";
import { SCANNER_CAPTURE_PROVIDER, scannerBatchSchema, scannerRunClaimSchema,
  scannerTransferSchema, scannerRunFinishSchema, scannerReconcileSchema, scannerCanonical,
  scannerPreflightReportSchema, scannerPreflightProblemSchema } from "./scanner-run-protocol";
import { createAcquisitionSession, executeAcquisitionCommand, getAcquisitionProgress,
  readAcquisitionRow, hydrateAcquisitionRow, saveAcquisitionRow,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, type AcquisitionActor } from "./acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes } from "./acquisition-files";
import { candidateKey, correctPhysicalCount, confirmPhysicalCountBatch } from "./acquisition-domain";
import { persistScannerStartMarker, scannerStartMarkerExists } from "./scanner-control-files";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";

type Tx = Prisma.TransactionClient;
const denied = () => new Error("Capture scanner run unavailable");
const include = { acquisitionRun: { include: { session: true } } } as const;
async function agentRun(tx: Tx, authorization: string | null, input: { runId: string; epoch: string }, epoch: string) {
  const auth = await authenticateScanner(tx, authorization, new Date());
  const run = await tx.scannerRun.findUnique({ where: { id: input.runId }, include });
  if (!run || run.agentId !== auth.agent.id || run.epoch !== input.epoch || input.epoch !== epoch ||
    run.acquisitionRun.session.createdByUserId !== auth.actor.userId) throw denied();
  // Repeat current owner/role checks, never trust the enrollment snapshot alone.
  await readAcquisitionRow(tx, auth.actor, run.acquisitionRun.sessionId);
  return { ...auth, run };
}
function command(run: { id: string; epoch: string; deviceId: string; loadedCount: number | null; settings: Prisma.JsonValue;
  stopRequestedAt: Date | null; status: string; executionId: string | null; acquisitionRun: { sessionId: string; session: { target: number | null } } }) {
  return { version: 1, runId: run.id, epoch: run.epoch, sessionId: run.acquisitionRun.sessionId,
    deviceId: run.deviceId, loadedCount: run.loadedCount, settings: run.settings,
    physicalTarget: run.acquisitionRun.session.target, stopRequested: !!run.stopRequestedAt,
    status: run.status, executionId: run.executionId };
}
export async function createScannerBatch(db: PrismaClient, actor: AcquisitionActor, value: unknown, epoch: string) {
  z.string().uuid().parse(epoch);
  const input = scannerBatchSchema.parse(value), scoped = { userId: actor.userId, adminMode: false };
  const helper = (await listScannerAgents(db, scoped.userId)).find(a => a.id === input.agentId);
  const device = helper?.devices.find(d => d.id === input.deviceId);
  if (!helper?.online || !device || device.qualification === "Unsupported") throw denied();
  const location = await db.inventoryLocation.findUnique({ where: { id: input.locationId } });
  if (!location) throw denied();
  const capture = await createAcquisitionSession(db, scoped, {
    requestKey: input.requestKey, ownerPlayerId: location.ownerPlayerId,
    locationId: location.id, section: input.section,
    policy: input.quantity === null ? { kind: "FILL" } : { kind: "MANUAL", quantity: input.quantity },
    run: { providerId: SCANNER_CAPTURE_PROVIDER, runId: input.requestKey,
      enforcement: "LOGICAL_ALLOCATION", controls: ["STOP"] },
  });
  if (capture.session.target !== null && input.loadedCount !== null && input.loadedCount > capture.session.target)
    throw new Error("Choose a loaded batch within the selected remaining capacity");
  await executeAcquisitionCommand(db, scoped, capture.session.id, { requestKey: "initial-start", revision: 0, command: "START" });
  return scannerTransaction(db, async tx => {
    const row = await readAcquisitionRow(tx, scoped, capture.session.id);
    const old = await tx.scannerRun.findUnique({ where: { id: input.requestKey }, include });
    if (old) {
      if (old.agentId !== helper.id || old.requestPayload !== scannerCanonical(input) || old.epoch !== epoch) throw denied();
      return command(old);
    }
    if (row.phase !== "CAPTURING" || await tx.scannerRun.count({ where: { agentId: helper.id, reconciliation: { equals: Prisma.DbNull } } }))
      throw new Error("Capture scanner has an unfinished batch; reconcile it before starting another");
    const agent = await tx.scannerAgent.findUniqueOrThrow({ where: { id: helper.id } });
    if (agent.revokedAt || agent.userId !== actor.userId || !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() >= 30000)
      throw denied();
    const run = await tx.scannerRun.create({ data: { id: input.requestKey, agentId: helper.id,
      acquisitionRunId: row.run!.id, epoch, requestPayload: scannerCanonical(input), deviceId: device.id,
      device, settings: input.settings, loadedCount: input.loadedCount }, include });
    return command(run);
  });
}
export async function pollScannerRun(db: PrismaClient, authorization: string | null, epoch: string) {
  return scannerTransaction(db, async tx => {
    const { agent } = await authenticateScanner(tx, authorization, new Date());
    const run = await tx.scannerRun.findFirst({ where: { agentId: agent.id, status: { in: ["QUEUED", "STARTED", "ERROR"] },
      reconciliation: { equals: Prisma.DbNull } }, include, orderBy: { createdAt: "asc" } });
    return { version: 1, agentId: agent.id, epoch, run: run ? command(run) : null };
  });
}
export async function claimScannerRun(db: PrismaClient, authorization: string | null, value: unknown, epoch: string) {
  const input = scannerRunClaimSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { run, actor } = await agentRun(tx, authorization, input, epoch);
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${run.id} FOR UPDATE`;
    const current = await tx.scannerRun.findUniqueOrThrow({ where: { id: run.id }, include });
    if (current.status === "STARTED" && current.executionId === input.executionId) {
      await persistScannerStartMarker(run.id, epoch, input.executionId);
      return { version: 1, runId: run.id, executionId: input.executionId, feedAuthorized: true, replay: true };
    }
    if (current.status !== "QUEUED" || current.stopRequestedAt) throw denied();
    const progress = await getStartState(tx, actor, current.acquisitionRun.sessionId);
    if (!progress.destinationCurrent || progress.session.phase !== "CAPTURING" ||
      progress.session.target !== null && current.loadedCount !== null && current.loadedCount > progress.session.target) throw denied();
    const capacity = await lockAndReadInventoryCapacity(tx, {
      locationId: progress.session.placement.locationId, ownerPlayerId: progress.session.placement.ownerPlayerId,
      section: progress.session.placement.section,
    });
    if (capacity.remaining !== null && (capacity.remaining === 0 || current.loadedCount !== null && current.loadedCount > capacity.remaining))
      throw new Error("Choose a loaded batch within the current remaining capacity; no feed authorized");
    // File write deliberately occurs under the short serialized claim lock.
    // If DB commit fails, the marker persists and denies automatic refeeding.
    if (!await persistScannerStartMarker(run.id, epoch, input.executionId)) {
      await tx.scannerRun.update({ where: { id: run.id }, data: { status: "RECONCILIATION", executionId: input.executionId } });
      return { version: 1, runId: run.id, executionId: input.executionId, feedAuthorized: false, reconciliationRequired: true, replay: false };
    }
    await tx.scannerRun.update({ where: { id: run.id }, data: { status: "STARTED", executionId: input.executionId, preflightProblem: Prisma.DbNull } });
    return { version: 1, runId: run.id, executionId: input.executionId, feedAuthorized: true, replay: false };
  });
}
export async function reportScannerPreflightProblem(db: PrismaClient, authorization: string | null, value: unknown, epoch: string) {
  const input = scannerPreflightReportSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { run, actor } = await agentRun(tx, authorization, input, epoch);
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${run.id} FOR UPDATE`;
    const current = await tx.scannerRun.findUniqueOrThrow({ where: { id: run.id } });
    if (current.status !== "QUEUED" || current.executionId || current.stopRequestedAt || current.reconciliation ||
        await scannerStartMarkerExists(run.id)) throw denied();
    const row = await readAcquisitionRow(tx, actor, run.acquisitionRun.sessionId);
    if (row.phase !== "CAPTURING") throw denied();
    const previous = scannerPreflightProblemSchema.safeParse(current.preflightProblem);
    // A retry does not need another write every five seconds for the same problem.
    if (!previous.success || previous.data.code !== input.code)
      await tx.scannerRun.update({ where: { id: run.id }, data: { preflightProblem: {
        code: input.code, observedAt: new Date().toISOString(),
      } } });
    return { version: 1, runId: run.id, retryable: true };
  });
}
async function getStartState(tx: Tx, actor: AcquisitionActor, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
  return hydrateAcquisitionRow(await readAcquisitionRow(tx, actor, sessionId));
}
export async function receiveScannerImage(db: PrismaClient, authorization: string | null, value: unknown,
  epoch: string, bytes: Buffer, mediaType: string) {
  const input = scannerTransferSchema.parse(value);
  await authorizeScannerTransfer(db, authorization, input, epoch);
  const metadata = await inspectAcquisitionPhoto(bytes, mediaType);
  const assigned = await scannerTransaction(db, async tx => {
    const auth = await agentRun(tx, authorization, input, epoch), { run } = auth;
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${run.id} FOR UPDATE`;
    if (run.executionId !== input.executionId || !["STARTED", "DRAINED", "ERROR"].includes(run.status)) throw denied();
    const state = await getStartState(tx, auth.actor, run.acquisitionRun.sessionId);
    const row = await readAcquisitionRow(tx, auth.actor, run.acquisitionRun.sessionId);
    const old = await tx.acquisitionCaptureSlot.findUnique({ where: { runId_requestKey: {
      runId: row.run!.id, requestKey: input.artifactId } } });
    if (old && old.position !== input.sequence - 1) throw new Error("Photo scanner sequence identity conflict");
    if (!old && (!state.destinationCurrent || !["CAPTURING", "STOPPING"].includes(row.phase) || run.status === "DRAINED")) throw denied();
    // No target truncation: overscan becomes provisional overflow in the ordinary
    // acquisition model. Its original remains recoverable on either host.
    const slot = old ?? await tx.acquisitionCaptureSlot.create({ data: {
      runId: row.run!.id, requestKey: input.artifactId, position: input.sequence - 1 } });
    if (!old) await tx.acquisitionSession.update({ where: { id: row.id }, data: { revision: { increment: 1 } } });
    return { ...auth, slot };
  });
  const { run, actor, slot } = assigned;
  const sourceMetadata = { ...input, backend: (run.device as Prisma.JsonObject).backend, device: run.device,
    requestedSettings: run.settings, negotiatedSettings: "UNKNOWN" } as Prisma.InputJsonObject;
  const photo = await beginAcquisitionPhoto(db, actor, run.acquisitionRun.sessionId, {
    slotId: slot.id, uploadKey: input.artifactId, generation: 0, metadata, inputKind: "CARD_SCAN", sourceMetadata,
  });
  if (!photo.ready) {
    await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
    await finalizeAcquisitionPhoto(db, actor, run.acquisitionRun.sessionId, photo.id);
  }
  return { version: 1, runId: run.id, artifactId: input.artifactId, sequence: input.sequence,
    photoId: photo.id, digest: photo.digest, ready: true };
}
export async function authorizeScannerTransfer(db: PrismaClient, authorization: string | null, value: unknown, epoch: string) {
  const input = scannerTransferSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { run } = await agentRun(tx, authorization, input, epoch);
    if (run.executionId !== input.executionId || !["STARTED", "DRAINED", "ERROR"].includes(run.status)) throw denied();
    return { runId: run.id };
  });
}
export async function finishScannerRun(db: PrismaClient, authorization: string | null, value: unknown, epoch: string) {
  const input = scannerRunFinishSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { run, actor } = await agentRun(tx, authorization, input, epoch);
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${run.id} FOR UPDATE`;
    if (run.executionId !== input.executionId || !["STARTED", "DRAINED", "ERROR"].includes(run.status)) throw denied();
    if (run.outcome && scannerCanonical(run.outcome) !== scannerCanonical(input.outcome)) throw denied();
    const photos = await tx.acquisitionPhoto.findMany({ where: { runId: run.acquisitionRunId }, include: { slot: true } });
    const positions = photos.map(p=>p.slot.position).sort((a,b)=>a-b);
    if (photos.length !== input.outcome.imageCount || photos.some(p=>!p.ready) || positions.some((p,i)=>p!==i))
      throw new Error("Capture scanner transfers need reconciliation before completion");
    const row = await readAcquisitionRow(tx, actor, run.acquisitionRun.sessionId);
    const status = ["ERROR", "INTERRUPTED"].includes(input.outcome.outcome) ? "ERROR" : "DRAINED";
    const natural = run.loadedCount === null && status === "DRAINED" && !run.stopRequestedAt &&
      ["COMPLETED", "SOURCE_EXHAUSTED"].includes(input.outcome.outcome) && !input.outcome.nativeError;
    let reconciled = false;
    if (natural && !run.reconciliation) {
      const state = await getStartState(tx, actor, run.acquisitionRun.sessionId);
      if (state.session.candidates.length === input.outcome.imageCount &&
          state.session.candidates.every(c => !c.excluded && !c.countConfirmed && !c.uncertainty.length && c.observations.length === 1)) {
        const after = confirmPhysicalCountBatch(state.session, actor.userId,
          "Natural scanner completion; one retained front image assumed per card; device physical boundaries unknown");
        await saveAcquisitionRow(tx, row, state.session, after);
        reconciled = true;
      }
    }
    await tx.scannerRun.update({ where: { id: run.id }, data: { status, outcome: input.outcome,
      ...(reconciled ? { reconciliation: { mode: "SCANNER_IMAGE_COUNT", actorUserId: actor.userId,
        observedAt: new Date().toISOString(), imageCount: input.outcome.imageCount,
        boundarySource: "ONE_RETAINED_IMAGE_PER_CARD_ASSUMED; SDK physical boundaries UNKNOWN" } } : {}) } });
    if (row.phase !== "COMPLETE") await tx.acquisitionSession.update({ where: { id: row.id }, data: {
      phase: status === "ERROR" ? "STOPPING" : "COMPLETE", revision: { increment: 1 } } });
    return { version: 1, runId: run.id, status, physicalCount: reconciled || run.reconciliation ? "ASSUMED_FROM_IMAGES" : "UNCONFIRMED" };
  });
}
export async function getScannerBatch(db: PrismaClient, userId: string, runId: string) {
  const state = await scannerTransaction(db, async tx => {
    const run = await tx.scannerRun.findUnique({ where: { id: runId }, include });
    if (!run || run.acquisitionRun.session.createdByUserId !== userId) throw denied();
    await readAcquisitionRow(tx, { userId, adminMode: false }, run.acquisitionRun.sessionId);
    return { ...command(run), device: run.device, outcome: run.outcome, reconciliation: run.reconciliation,
      preflightProblem: scannerPreflightProblemSchema.safeParse(run.preflightProblem).success ? run.preflightProblem : null };
  });
  return state;
}
export async function stopScannerBatch(db: PrismaClient, userId: string, runId: string) {
  return scannerTransaction(db, async tx => {
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.scannerRun.findUniqueOrThrow({ where: { id: runId }, include });
    if (run.acquisitionRun.session.createdByUserId !== userId || !["QUEUED", "STARTED", "CANCELLED_BEFORE_START"].includes(run.status)) throw denied();
    await readAcquisitionRow(tx, { userId, adminMode: false }, run.acquisitionRun.sessionId);
    await tx.scannerRun.update({ where: { id: runId }, data: { stopRequestedAt: run.stopRequestedAt ?? new Date(),
      ...(run.status === "QUEUED" ? { status: "CANCELLED_BEFORE_START" } : {}) } });
    if (run.status === "QUEUED") await tx.acquisitionSession.update({ where: { id: run.acquisitionRun.sessionId },
      data: { phase: "CANCELLED", revision: { increment: 1 } } });
    return { version: 1, runId, stopGuarantee: "UNSUPPORTED; current feeder run drains" };
  });
}
export async function reconcileScannerBatch(db: PrismaClient, userId: string, value: unknown) {
  const input = scannerReconcileSchema.parse(value), actor = { userId, adminMode: false };
  return scannerTransaction(db, async tx => {
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${input.runId} FOR UPDATE`;
    const run = await tx.scannerRun.findUnique({ where: { id: input.runId }, include });
    if (!run || run.acquisitionRun.session.createdByUserId !== userId || !["DRAINED", "ERROR", "CANCELLED_BEFORE_START"].includes(run.status)) throw denied();
    if (run.reconciliation) {
      const existing = run.reconciliation as Prisma.JsonObject;
      if (scannerCanonical(existing.observation) !== scannerCanonical(input)) throw denied();
      return { version: 1, runId: run.id, confirmed: true, replay: true };
    }
    const state = await getStartState(tx, actor, run.acquisitionRun.sessionId);
    const row = await readAcquisitionRow(tx, actor, run.acquisitionRun.sessionId);
    const cancelledEmpty = run.status === "CANCELLED_BEFORE_START" && input.cardsEmitted === 0 && state.session.candidates.length === 0;
    if (!cancelledEmpty && (state.session.candidates.length !== input.cardsEmitted || run.loadedCount !== null && input.cardsEmitted !== run.loadedCount ||
      (run.outcome as Prisma.JsonObject)?.imageCount !== input.cardsEmitted))
      throw new Error("Capture scanner physical count differs; retain images for individual reconciliation");
    let after = state.session;
    for (const c of after.candidates) after = correctPhysicalCount(after, {
      candidateKey: candidateKey(after.run.runId, c.input.id), revision: c.revision,
      actorId: userId, reason: "Operator observed one front per emitted physical card, empty feeder/transport and no jam/double",
      action: "CONFIRM_COUNT" });
    await saveAcquisitionRow(tx, row, state.session, after);
    await tx.scannerRun.update({ where: { id: run.id }, data: { reconciliation: {
      observation: input, actorUserId: userId, observedAt: new Date().toISOString(), boundarySource: "OPERATOR; SDK boundaries remain UNKNOWN" } } });
    return { version: 1, runId: run.id, confirmed: true, replay: false };
  });
}
