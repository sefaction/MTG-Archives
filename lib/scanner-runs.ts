import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scannerTransaction, authenticateScanner, listScannerAgents } from "./scanner-store";
import { SCANNER_CAPTURE_PROVIDER, scannerBatchSchema, scannerRunClaimSchema,
  scannerTransferSchema, scannerRunFinishSchema, scannerReconcileSchema, scannerCanonical,
  scannerPreflightReportSchema, scannerPreflightProblemSchema, scannerRefillSchema,
  scannerRefillReconciliationIsSafe } from "./scanner-run-protocol";
import { createAcquisitionSession, executeAcquisitionCommand, getAcquisitionProgress,
  readAcquisitionRow, hydrateAcquisitionRow, saveAcquisitionRow,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, type AcquisitionActor } from "./acquisition-store";
import { canonicalAcquisitionCreation, type CreateAcquisitionInput } from "./acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes } from "./acquisition-files";
import { candidateKey, correctPhysicalCount, confirmPhysicalCountBatch, type TargetPolicy } from "./acquisition-domain";
import { persistScannerStartMarker, scannerStartMarkerExists, scannerSiteEpoch,
  scannerStartRetired, persistScannerStartRetirement } from "./scanner-control-files";
import { lockAndReadInventoryCapacity } from "./inventory-capacity";
import { ScannerRunConflict } from "./scanner-errors";
import { isCountedScannerDevice, countedScannerSettings } from "./scanner-counted-profile";
import { readScannerCapacity } from "./scanner-capacity";
import { readStorageLayout } from "./storage-layout";
import { normalizeLocationSection } from "./inventory-locations";
import { lockScannerSeries, requireRunningScannerSeries } from "./scanner-series";
import { scannerDeviceSchema } from "./scanner-protocol";
import { requireVisibleAcquisitionBatch, requireProcessingAcquisitionBatch } from "./acquisition-batch-policy";
import {cancelledSettledScannerTransfer} from "./scanner-drain-policy";

type Tx = Prisma.TransactionClient;
const denied = () => new ScannerRunConflict();
const include = { acquisitionRun: { include: { session: true } } } as const;
function currentCountedSource(agent: { devices: Prisma.JsonValue; lastSeenAt: Date | null }, deviceId: string) {
  const parsed = scannerDeviceSchema.array().safeParse(agent.devices);
  const device = parsed.success ? parsed.data.find(d => d.id === deviceId) : undefined;
  if (!agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() >= 30000 ||
      !device || !isCountedScannerDevice(device) ||
      !["Qualified", "KnownWorking"].includes(device.qualification))
    throw new ScannerRunConflict("Choose a ready scanner that supports card counts before starting or refilling. Refresh scanner setup.");
  return device;
}
async function lockScannerCreation(tx: Tx, requestKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scanner-create-v1:${requestKey}`}, 0))`;
}
async function guardScannerCreation(tx: Tx, requestKey: string) {
  await lockScannerCreation(tx, requestKey);
  if (await scannerStartRetired(requestKey))
    throw new ScannerRunConflict("Cannot retry this Start: it was cancelled. Change setup and start a new batch.");
}
function scannerCaptureInput(input: z.infer<typeof scannerBatchSchema>, ownerPlayerId: string): CreateAcquisitionInput {
  return { requestKey: input.requestKey, ownerPlayerId, locationId: input.locationId, section: input.section,
    ...(input.defaults ? { defaults: input.defaults } : {}),
    policy: input.quantity === null ? { kind: "FILL" } : { kind: "MANUAL", quantity: input.quantity },
    run: { providerId: SCANNER_CAPTURE_PROVIDER, runId: input.requestKey,
      enforcement: "LOGICAL_ALLOCATION", controls: ["STOP"] } };
}
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
  physicalTarget: number | null; sequenceOffset: number; segment: number; counted: boolean;
  stopRequestedAt: Date | null; status: string; executionId: string | null; acquisitionRun: { sessionId: string; session: { target: number | null } } }) {
  return { version: 1, runId: run.id, epoch: run.epoch, sessionId: run.acquisitionRun.sessionId,
    deviceId: run.deviceId, loadedCount: run.loadedCount, settings: run.settings,
    physicalTarget: run.physicalTarget, sequenceOffset: run.sequenceOffset, segment: run.segment,
    counted: run.counted, logicalTarget: run.acquisitionRun.session.target, stopRequested: !!run.stopRequestedAt,
    status: run.status, executionId: run.executionId };
}
export async function createScannerBatch(db: PrismaClient, actor: AcquisitionActor, value: unknown, epoch: string) {
  z.string().uuid().parse(epoch);
  const input = scannerBatchSchema.parse(value), scoped = { userId: actor.userId, adminMode: false };
  if (await scannerStartRetired(input.requestKey))
    throw new ScannerRunConflict("Cannot retry this Start: it was cancelled. Change setup and start a new batch.");
  const helper = (await listScannerAgents(db, scoped.userId)).find(a => a.id === input.agentId);
  const device = helper?.devices.find(d => d.id === input.deviceId);
  if (!helper?.online || !device || device.qualification === "Unsupported") throw denied();
  const counted = isCountedScannerDevice(device);
  if (counted) currentCountedSource(helper, device.id);
  if ((input.continuous || input.continueFrom) && (!counted || !input.continuous || input.quantity !== null))
    throw new ScannerRunConflict("Section series requires a count controlled source and automatic section capacity");
  if (counted && scannerCanonical(input.settings) !== scannerCanonical(countedScannerSettings))
    throw new ScannerRunConflict("Count controlled fi-7160 requires the qualified 600 DPI centered profile");
  const location = await db.inventoryLocation.findUnique({ where: { id: input.locationId } });
  if (!location) throw denied();
  const layout = readStorageLayout(location.storageLayout, location.type);
  if (counted && layout.sections.length && !layout.sections.some(s => s.name === normalizeLocationSection(input.section)))
    throw new ScannerRunConflict("Choose a section before starting a count controlled scanner batch");
  const guard = (tx: Tx) => guardScannerCreation(tx, input.requestKey);
  return scannerTransaction(db, async tx => {
    let seriesRootId = input.continuous ? input.requestKey : null, seriesOrdinal = 0;
    if (input.continueFrom) {
      const prior = await tx.scannerRun.findUnique({ where: { id: input.continueFrom }, include });
      if (!prior?.seriesRootId || prior.acquisitionRun.session.createdByUserId !== actor.userId) throw denied();
      const { root, latest } = await lockScannerSeries(tx, prior.seriesRootId, actor.userId);
      const replay = await tx.scannerRun.findUnique({ where: { id: input.requestKey }, include });
      if (replay) {
        if (replay.requestPayload !== scannerCanonical(input) || replay.epoch !== epoch) throw denied();
        return command(replay);
      }
      requireRunningScannerSeries(root.seriesStoppedAt);
      if (prior.acquisitionRun.session.locationId === input.locationId &&
          normalizeLocationSection(prior.acquisitionRun.session.section) === normalizeLocationSection(input.section))
        throw new ScannerRunConflict("Choose a different section for the next batch");
      requireProcessingAcquisitionBatch(prior.acquisitionRun.session);
      if (latest.id !== prior.id || !prior.reconciliation || !["DRAINED", "CANCELLED_BEFORE_START"].includes(prior.status) ||
          !["COMPLETE", "CANCELLED"].includes(prior.acquisitionRun.session.phase) ||
          prior.agentId !== input.agentId || prior.deviceId !== input.deviceId)
        throw new ScannerRunConflict("Finish and reconcile the current section batch before explicitly choosing the next section");
      seriesRootId = root.id; seriesOrdinal = prior.seriesOrdinal + 1;
    }
    // Refused or concurrent Starts must not leave an orphan capacity reservation.
    const capture = await createAcquisitionSession(tx, scoped, scannerCaptureInput(input, location.ownerPlayerId), guard,
      counted ? inner => readScannerCapacity(inner, { locationId: location.id, ownerPlayerId: location.ownerPlayerId, section: input.section }) : undefined);
    if (counted && (capture.session.target === null || capture.session.target > 5000))
      throw new ScannerRunConflict("Choose a count or a section with known remaining capacity");
    if (!counted && capture.session.target !== null && input.loadedCount !== null && input.loadedCount > capture.session.target)
      throw new ScannerRunConflict("Choose a loaded batch within the selected remaining capacity");
    await executeAcquisitionCommand(tx, scoped, capture.session.id, { requestKey: "initial-start", revision: 0, command: "START" }, guard);
    await guard(tx);
    const row = await readAcquisitionRow(tx, scoped, capture.session.id);
    const old = await tx.scannerRun.findUnique({ where: { id: input.requestKey }, include });
    if (old) {
      if (old.agentId !== helper.id || old.requestPayload !== scannerCanonical(input) || old.epoch !== epoch) throw denied();
      return command(old);
    }
    await tx.$queryRaw`SELECT id FROM "ScannerAgent" WHERE id = ${helper.id} FOR UPDATE`;
    if (row.phase !== "CAPTURING" || await tx.scannerRun.count({ where: { agentId: helper.id, reconciliation: { equals: Prisma.DbNull }, NOT: cancelledSettledScannerTransfer } }))
      throw new ScannerRunConflict("Capture scanner has an unfinished batch; reconcile it before starting another");
    const agent = await tx.scannerAgent.findUniqueOrThrow({ where: { id: helper.id } });
    if (agent.revokedAt || agent.userId !== actor.userId || !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() >= 30000)
      throw denied();
    const admittedDevice = counted ? currentCountedSource(agent, device.id) : device;
    const run = await tx.scannerRun.create({ data: { id: input.requestKey, agentId: helper.id,
      acquisitionRunId: row.run!.id, epoch, requestPayload: scannerCanonical(input), deviceId: device.id,
      device: admittedDevice, settings: input.settings, loadedCount: input.loadedCount, counted,
      physicalTarget: row.target, seriesRootId, seriesOrdinal }, include });
    return command(run);
  });
}
export async function pollScannerRun(db: PrismaClient, authorization: string | null, epoch: string) {
  return scannerTransaction(db, async tx => {
    const { agent } = await authenticateScanner(tx, authorization, new Date());
    const run = await tx.scannerRun.findFirst({ where: { agentId: agent.id, status: { in: ["QUEUED", "STARTED", "ERROR"] },
      reconciliation: { equals: Prisma.DbNull }, NOT: cancelledSettledScannerTransfer }, include, orderBy: { createdAt: "asc" } });
    return { version: 1, agentId: agent.id, epoch, run: run ? command(run) : null };
  });
}
export async function claimScannerRun(db: PrismaClient, authorization: string | null, value: unknown, epoch: string) {
  const input = scannerRunClaimSchema.parse(value);
  return scannerTransaction(db, async tx => {
    const { run, actor } = await agentRun(tx, authorization, input, epoch);
    if (run.seriesRootId) {
      const { root } = await lockScannerSeries(tx, run.seriesRootId, actor.userId);
      if (run.status === "QUEUED") requireRunningScannerSeries(root.seriesStoppedAt);
    }
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${run.id} FOR UPDATE`;
    const current = await tx.scannerRun.findUniqueOrThrow({ where: { id: run.id }, include });
    if (await scannerStartRetired(run.id)) throw denied();
    if (current.status === "STARTED" && current.executionId === input.executionId) {
      await persistScannerStartMarker(run.id, epoch, input.executionId);
      return { version: 1, runId: run.id, executionId: input.executionId, feedAuthorized: true, replay: true };
    }
    if (current.status !== "QUEUED" || current.stopRequestedAt) throw denied();
    if (current.counted) currentCountedSource(await tx.scannerAgent.findUniqueOrThrow({ where: { id: current.agentId } }), current.deviceId);
    const progress = await getStartState(tx, actor, current.acquisitionRun.sessionId);
    if (!progress.destinationCurrent || progress.session.phase !== "CAPTURING" ||
      !current.counted && progress.session.target !== null && current.loadedCount !== null && current.loadedCount > progress.session.target) throw denied();
    const capacity = await (current.counted ? readScannerCapacity : lockAndReadInventoryCapacity)(tx, {
      locationId: progress.session.placement.locationId, ownerPlayerId: progress.session.placement.ownerPlayerId,
      section: progress.session.placement.section, excludeSessionId: progress.session.id,
    });
    const pendingOwn = await tx.acquisitionCandidate.count({ where: { runId: run.acquisitionRunId, receipt: null } });
    if (current.counted && (current.physicalTarget === null || capacity.remaining !== null &&
        current.physicalTarget + pendingOwn > capacity.remaining))
      throw new ScannerRunConflict("Reserved capacity changed; no feed authorized. End this batch and choose available space.");
    if (!current.counted && capacity.remaining !== null && (capacity.remaining === 0 || current.loadedCount !== null && current.loadedCount > capacity.remaining))
      throw new ScannerRunConflict("Choose a loaded batch within the current remaining capacity; no feed authorized");
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
    if (old && old.position !== run.sequenceOffset + input.sequence - 1) throw new ScannerRunConflict("Photo scanner sequence identity conflict");
    if (!old && (run.outcome || !state.destinationCurrent || !(["CAPTURING", "STOPPING"].includes(row.phase) || row.phase === "CANCELLED" && row.cancelledAt) || run.status === "DRAINED")) throw denied();
    // No target truncation: overscan becomes provisional overflow in the ordinary
    // acquisition model. Its original remains recoverable on either host.
    const slot = old ?? await tx.acquisitionCaptureSlot.create({ data: {
      runId: row.run!.id, requestKey: input.artifactId, position: run.sequenceOffset + input.sequence - 1 } });
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
    const photos = await tx.acquisitionPhoto.findMany({ where: { runId: run.acquisitionRunId,
      ...(run.counted ? { sourceMetadata: { path: ["runId"], equals: run.id } } : {}) }, include: { slot: true } });
    const positions = photos.map(p=>p.slot.position).sort((a,b)=>a-b);
    if (photos.length !== input.outcome.imageCount || photos.some(p=>!p.ready) || positions.some((p,i)=>p!==i + run.sequenceOffset))
      throw new ScannerRunConflict("Capture scanner transfers need reconciliation before completion");
    const row = await readAcquisitionRow(tx, actor, run.acquisitionRun.sessionId);
    const unsafeCounted = run.counted && (input.outcome.imageCount > run.physicalTarget! ||
      input.outcome.imageCount < run.physicalTarget! && input.outcome.sourceExhausted !== "REPORTED_EMPTY");
    const status = unsafeCounted || ["ERROR", "INTERRUPTED"].includes(input.outcome.outcome) ? "ERROR" : "DRAINED";
    const natural = !run.counted && run.loadedCount === null && status === "DRAINED" && !run.stopRequestedAt &&
      ["COMPLETED", "SOURCE_EXHAUSTED"].includes(input.outcome.outcome) && !input.outcome.nativeError;
    let reconciled = false;
    const cleanCounted = run.counted && status === "DRAINED" &&
      ["COMPLETED", "SOURCE_EXHAUSTED"].includes(input.outcome.outcome) && !input.outcome.nativeError;
    if (cleanCounted && !run.reconciliation) {
      const state = await getStartState(tx, actor, run.acquisitionRun.sessionId);
      const segmentSlots = new Set(photos.map(photo => photo.slotId));
      const candidates = state.session.candidates.filter(candidate => segmentSlots.has(candidate.input.id));
      if (candidates.length === input.outcome.imageCount && candidates.every(candidate =>
          !candidate.excluded && !candidate.uncertainty.length && candidate.observations.length === 1)) {
        let after = state.session;
        for (const candidate of candidates) if (!candidate.countConfirmed) after = correctPhysicalCount(after, {
          candidateKey: candidateKey(after.run.runId, candidate.input.id), revision: candidate.revision,
          actorId: actor.userId, action: "CONFIRM_COUNT",
          reason: "Qualified counted scanner completed cleanly; one retained front image assumed per card; physical boundaries unknown" });
        if (after !== state.session) await saveAcquisitionRow(tx, row, state.session, after);
        reconciled = true;
      }
    }
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
      ...(row.cancelledAt ? {admissionReleasedAt: run.admissionReleasedAt ?? new Date()} : {}),
      ...(reconciled ? { reconciliation: { mode: "SCANNER_IMAGE_COUNT", actorUserId: actor.userId,
        observedAt: new Date().toISOString(), imageCount: input.outcome.imageCount,
        ...(cleanCounted ? { basis: "QUALIFIED_COUNTED_FRONT_IMAGES" } : {}),
        boundarySource: "ONE_RETAINED_IMAGE_PER_CARD_ASSUMED; SDK physical boundaries UNKNOWN" } } : {}) } });
    // A settled earlier segment may be replayed after a refill has begun. Its
    // idempotent finish cannot pause or complete the newer segment/session.
    const latest = await tx.scannerRun.findFirstOrThrow({ where: { acquisitionRunId: run.acquisitionRunId }, orderBy: { segment: "desc" } });
    if (latest.id === run.id && !run.outcome && row.phase !== "COMPLETE") await tx.acquisitionSession.update({ where: { id: row.id }, data: {
      phase: row.cancelledAt ? "CANCELLED" : status === "ERROR" ? "STOPPING" : run.counted && !run.stopRequestedAt &&
        run.sequenceOffset + input.outcome.imageCount < row.target! ? "PAUSED" : "COMPLETE",
      ...(row.cancelledAt ? {scannerReserved: 0} : {}), revision: { increment: 1 } } });
    return { version: 1, runId: run.id, status, physicalCount: reconciled || run.reconciliation ? "ASSUMED_FROM_IMAGES" : "UNCONFIRMED" };
  });
}
export async function getScannerBatch(db: PrismaClient, userId: string, runId: string) {
  const state = await scannerTransaction(db, async tx => {
    const requested = await tx.scannerRun.findUnique({ where: { id: runId }, include });
    if (!requested || requested.acquisitionRun.session.createdByUserId !== userId) throw denied();
    const run = await tx.scannerRun.findFirstOrThrow({ where: { acquisitionRunId: requested.acquisitionRunId }, include, orderBy: { segment: "desc" } });
    requireVisibleAcquisitionBatch(run.acquisitionRun.session);
    await readAcquisitionRow(tx, { userId, adminMode: false }, run.acquisitionRun.sessionId);
    const series = run.seriesRootId ? await lockScannerSeries(tx, run.seriesRootId, userId) : null;
    const policy = run.acquisitionRun.session.policy as unknown as TargetPolicy;
    return { ...command(run), agentId: run.agentId, device: run.device, outcome: run.outcome, reconciliation: run.reconciliation,
      batchLimit: run.counted && policy.kind === "MANUAL" ? policy.quantity : null,
      series: series ? { rootRunId: series.root.id, ordinal: run.seriesOrdinal, stopped: !!series.root.seriesStoppedAt,
        latestRunId: series.latest.id, current: series.latest.acquisitionRunId === run.acquisitionRunId } : null,
      phase: run.acquisitionRun.session.phase,
      remainingTarget: Math.max(0, (run.acquisitionRun.session.target ?? 0) - run.sequenceOffset -
        ((run.outcome as Prisma.JsonObject | null)?.imageCount as number ?? 0)),
      preflightProblem: scannerPreflightProblemSchema.safeParse(run.preflightProblem).success ? run.preflightProblem : null };
  });
  return state;
}
export async function findScannerBatchCreation(db: PrismaClient, actor: AcquisitionActor, requestKey: string) {
  z.string().uuid().parse(requestKey);
  const run = await db.scannerRun.findUnique({ where: { id: requestKey }, select: { id: true } });
  if (!run) return null;
  // Recover already accepted runs even if the helper is now offline or space
  // has changed. Current ownership/roles still apply; this never authorizes START.
  const owned = await getScannerBatch(db, actor.userId, run.id);
  return getAcquisitionProgress(db, { userId: actor.userId, adminMode: false }, owned.sessionId);
}
export async function retireScannerBatchCreation(db: PrismaClient, actor: AcquisitionActor, value: unknown) {
  const input = scannerBatchSchema.parse(value), scoped = { userId: actor.userId, adminMode: false };
  // Read committed observes a creator that finished while this lock waited.
  // Atomic admission and retirement both use this same creation lock.
  return db.$transaction(async tx => {
    await lockScannerCreation(tx, input.requestKey);
    const user = await tx.user.findUnique({ where: { id: actor.userId }, include: { player: true } });
    const agent = await tx.scannerAgent.findUnique({ where: { id: input.agentId } });
    if (!user?.isActive || !user.player?.active || agent?.userId !== actor.userId) throw denied();
    const accepted = await tx.scannerRun.findUnique({ where: { id: input.requestKey }, include });
    if (accepted) {
      if (accepted.agentId !== input.agentId || accepted.requestPayload !== scannerCanonical(input)) throw denied();
      await readAcquisitionRow(tx, scoped, accepted.acquisitionRun.sessionId);
      return { retired: false as const, sessionId: accepted.acquisitionRun.sessionId };
    }
    if (await scannerStartMarkerExists(input.requestKey))
      throw new ScannerRunConflict("Cannot change setup: this Start has saved or uncertain scanner evidence. Keep the cards and retry recovery.");
    const existing = await tx.acquisitionSession.findUnique({ where: {
      createdByUserId_requestKey: { createdByUserId: actor.userId, requestKey: input.requestKey },
    } });
    let phase = existing?.phase;
    if (existing) {
      await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${existing.id} FOR UPDATE`;
      const row = await readAcquisitionRow(tx, scoped, existing.id);
      phase = row.phase;
      if (row.requestPayload !== canonicalAcquisitionCreation(scannerCaptureInput(input, row.ownerPlayerId)) ||
        !["DRAFT", "CAPTURING", "CANCELLED"].includes(row.phase) || !row.run ||
        row.run.artifacts.length || row.run.candidates.length || row.run.events.length || row.run.corrections.length ||
        await tx.acquisitionCaptureSlot.count({ where: { runId: row.run.id } }) ||
        await tx.acquisitionPhoto.count({ where: { runId: row.run.id } }) ||
        await tx.acquisitionCommit.count({ where: { runId: row.run.id } }))
        throw new ScannerRunConflict("Cannot change setup: the unfinished batch contains saved or uncertain evidence. Keep the cards and retry recovery.");
    }
    const epoch = await scannerSiteEpoch();
    // Publish before DB cancellation. A rollback cannot revive the old START.
    // Retrying this action finishes cancellation without overwriting the marker.
    await persistScannerStartRetirement(input.requestKey, actor.userId, epoch, input);
    if (existing) {
      if (phase !== "CANCELLED") await tx.acquisitionSession.update({ where: { id: existing.id },
        data: { phase: "CANCELLED", scannerReserved: 0, revision: { increment: 1 } } });
      const run = await tx.acquisitionRun.findUniqueOrThrow({ where: { sessionId: existing.id } });
      await tx.acquisitionCommand.upsert({ where: { runId_requestKey: { runId: run.id, requestKey: "scanner-creation-retired" } },
        update: {}, create: { runId: run.id, requestKey: "scanner-creation-retired",
          payload: scannerCanonical({ action: "RETIRE_SCANNER_CREATION", requestKey: input.requestKey, epoch }) } });
    }
    return { retired: true as const, partialBatchId: existing?.id ?? null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
}
export async function stopScannerBatch(db: PrismaClient, userId: string, runId: string) {
  return scannerTransaction(db, async tx => {
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.scannerRun.findUniqueOrThrow({ where: { id: runId }, include });
    if (run.acquisitionRun.session.createdByUserId !== userId || !["QUEUED", "STARTED", "CANCELLED_BEFORE_START"].includes(run.status)) throw denied();
    const state = await getStartState(tx, { userId, adminMode: false }, run.acquisitionRun.sessionId);
    if (run.status === "CANCELLED_BEFORE_START" && run.reconciliation) return {
      version: 1, runId, stopGuarantee: "Cancellation already recorded", replay: true,
    };
    const beforeStart = ["QUEUED", "CANCELLED_BEFORE_START"].includes(run.status);
    if (beforeStart) {
      // Database QUEUED alone is insufficient after restore. Serialize with
      // claim and reject uncertainty before asserting there was no authorized feed.
      if (run.executionId || run.epoch !== await scannerSiteEpoch() || await scannerStartMarkerExists(runId) ||
          !["CAPTURING", "CANCELLED"].includes(state.session.phase) ||
          (!run.counted && (state.session.artifacts.length || state.session.candidates.length)) ||
          await tx.acquisitionCaptureSlot.count({ where: { runId: run.acquisitionRunId,
            ...(run.counted ? { position: { gte: run.sequenceOffset } } : {}) } }))
        throw new ScannerRunConflict("This batch has saved or uncertain START evidence. Keep the cards and originals; reconcile it before scanning again.");
    }
    await tx.scannerRun.update({ where: { id: runId }, data: { stopRequestedAt: run.stopRequestedAt ?? new Date(),
      ...(beforeStart ? { status: "CANCELLED_BEFORE_START", preflightProblem: Prisma.DbNull, reconciliation: {
        mode: "CANCELLED_WITHOUT_START", actorUserId: userId, recordedAt: new Date().toISOString(),
        evidence: "No server START marker, execution or acquisition artifacts; not an observed physical count",
      } } : {}) } });
    if (beforeStart && state.session.phase !== "CANCELLED") await tx.acquisitionSession.update({ where: { id: run.acquisitionRun.sessionId },
      data: { phase: run.counted && run.segment > 0 ? "COMPLETE" : "CANCELLED",
        ...(run.counted ? { scannerReserved: run.sequenceOffset } : {}), revision: { increment: 1 } } });
    return { version: 1, runId, stopGuarantee: beforeStart ? "No START authorized; no physical count required" : "UNSUPPORTED; current feeder run drains" };
  });
}
export async function reconcileScannerBatch(db: PrismaClient, userId: string, value: unknown) {
  const input = scannerReconcileSchema.parse(value), actor = { userId, adminMode: false };
  return scannerTransaction(db, async tx => {
    await tx.$queryRaw`SELECT id FROM "ScannerRun" WHERE id = ${input.runId} FOR UPDATE`;
    const run = await tx.scannerRun.findUnique({ where: { id: input.runId }, include });
    if (!run || run.acquisitionRun.session.createdByUserId !== userId || !["DRAINED", "ERROR", "CANCELLED_BEFORE_START"].includes(run.status)) throw denied();
    if (run.reconciliation && !(run.counted && (run.reconciliation as Prisma.JsonObject).mode === "SCANNER_IMAGE_COUNT")) {
      const existing = run.reconciliation as Prisma.JsonObject;
      if (existing.mode === "CANCELLED_WITHOUT_START" && input.cardsEmitted === 0)
        return { version: 1, runId: run.id, confirmed: true, replay: true };
      if (scannerCanonical(existing.observation) !== scannerCanonical(input)) throw denied();
      return { version: 1, runId: run.id, confirmed: true, replay: true };
    }
    const state = await getStartState(tx, actor, run.acquisitionRun.sessionId);
    const row = await readAcquisitionRow(tx, actor, run.acquisitionRun.sessionId);
    if (run.counted) {
      if (!input.feederEmpty && (!input.remainingWhollyInHopper || !input.remainingCards) ||
        input.feederEmpty && (input.remainingCards ?? 0) !== 0 || run.loadedCount !== null &&
        input.cardsEmitted + (input.remainingCards ?? 0) !== run.loadedCount)
        throw new ScannerRunConflict("Observe all emitted and remaining cards and a clear transport before continuing");
    } else if (!input.feederEmpty || (input.remainingCards ?? 0) !== 0)
      throw new ScannerRunConflict("This scanner route requires an empty hopper and transport");
    const segmentPhotos = await tx.acquisitionPhoto.findMany({ where: { runId: run.acquisitionRunId,
      ...(run.counted ? { sourceMetadata: { path: ["runId"], equals: run.id } } : {}) }, select: { slotId: true } });
    const segmentSlots = new Set(segmentPhotos.map(p => p.slotId));
    const segmentCandidates = state.session.candidates.filter(c => segmentSlots.has(c.input.id));
    const cancelledEmpty = run.status === "CANCELLED_BEFORE_START" && input.cardsEmitted === 0 &&
      !run.executionId && run.epoch === await scannerSiteEpoch() && !await scannerStartMarkerExists(run.id) &&
      state.session.candidates.length === 0 && state.session.artifacts.length === 0 &&
      !await tx.acquisitionCaptureSlot.count({ where: { runId: run.acquisitionRunId } });
    if (!cancelledEmpty && (segmentCandidates.length !== input.cardsEmitted || !run.counted && run.loadedCount !== null && input.cardsEmitted !== run.loadedCount ||
      (run.outcome as Prisma.JsonObject)?.imageCount !== input.cardsEmitted))
      throw new ScannerRunConflict("Capture scanner physical count differs; retain images for individual reconciliation");
    let after = state.session;
    for (const c of segmentCandidates) if (!c.countConfirmed) after = correctPhysicalCount(after, {
      candidateKey: candidateKey(after.run.runId, c.input.id), revision: c.revision,
      actorId: userId, reason: "Operator observed one front per emitted physical card, clear transport, accounted hopper cards and no jam/double",
      action: "CONFIRM_COUNT" });
    await saveAcquisitionRow(tx, row, state.session, after);
    await tx.scannerRun.update({ where: { id: run.id }, data: { reconciliation: {
      observation: input, actorUserId: userId, observedAt: new Date().toISOString(), boundarySource: "OPERATOR; SDK boundaries remain UNKNOWN" } } });
    if (run.counted && row.phase === "COMPLETE") await tx.acquisitionSession.update({ where: { id: row.id },
      data: { scannerReserved: run.sequenceOffset + input.cardsEmitted } });
    return { version: 1, runId: run.id, confirmed: true, replay: false };
  });
}

/** Explicit new feed authorization within the same unfinished logical batch.
 * Recovery of an old segment never enters this function or opens the device. */
export async function refillScannerBatch(db: PrismaClient, userId: string, value: unknown, epoch: string) {
  const input = scannerRefillSchema.parse(value), actor = { userId, adminMode: false };
  return scannerTransaction(db, async tx => {
    await guardScannerCreation(tx, input.requestKey);
    const prior = await tx.scannerRun.findUnique({ where: { id: input.runId }, include });
    if (!prior || !prior.counted || prior.acquisitionRun.session.createdByUserId !== userId || prior.epoch !== epoch) throw denied();
    if (prior.seriesRootId) {
      const { root } = await lockScannerSeries(tx, prior.seriesRootId, userId);
      // Saved request recovery below is allowed; no new feed after Stop.
      if (!await tx.scannerRun.findUnique({ where: { id: input.requestKey } })) requireRunningScannerSeries(root.seriesStoppedAt);
    }
    await tx.$queryRaw`SELECT id FROM "ScannerAgent" WHERE id = ${prior.agentId} FOR UPDATE`;
    const state = await getStartState(tx, actor, prior.acquisitionRun.sessionId);
    const old = await tx.scannerRun.findUnique({ where: { id: input.requestKey }, include });
    if (old) {
      if (old.acquisitionRunId !== prior.acquisitionRunId || old.requestPayload !== scannerCanonical(input) || old.epoch !== epoch) throw denied();
      return command(old);
    }
    const latest = await tx.scannerRun.findFirstOrThrow({ where: { acquisitionRunId: prior.acquisitionRunId }, orderBy: { segment: "desc" } });
    const outcome = prior.outcome as Prisma.JsonObject | null;
    if (latest.id !== prior.id || prior.status !== "DRAINED" || !prior.reconciliation || prior.stopRequestedAt ||
        state.session.phase !== "PAUSED" || !state.destinationCurrent ||
        !scannerRefillReconciliationIsSafe(prior.reconciliation, prior.id, Number(outcome?.imageCount)) ||
        outcome?.sourceExhausted !== "REPORTED_EMPTY" || !["COMPLETED", "SOURCE_EXHAUSTED"].includes(String(outcome?.outcome)) || outcome?.nativeError)
      throw new ScannerRunConflict("Run cannot resume until the previous scan is complete and its saved count is verified.");
    const agent = await tx.scannerAgent.findUniqueOrThrow({ where: { id: prior.agentId } });
    if (agent.revokedAt || agent.userId !== userId || !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() >= 30000) throw denied();
    const refillDevice = currentCountedSource(agent, prior.deviceId);
    if (await tx.scannerRun.count({ where: { agentId: agent.id, reconciliation: { equals: Prisma.DbNull } } })) throw denied();
    const offset = prior.sequenceOffset + Number(outcome!.imageCount), remaining = state.session.target! - offset;
    if (remaining <= 0 || remaining > 5000) throw denied();
    const space = await readScannerCapacity(tx, { locationId: state.session.placement.locationId,
      ownerPlayerId: state.session.placement.ownerPlayerId, section: state.session.placement.section, excludeSessionId: state.session.id });
    const pending = await tx.acquisitionCandidate.count({ where: { runId: prior.acquisitionRunId, receipt: null } });
    if (space.remaining !== null && remaining + pending > space.remaining)
      throw new ScannerRunConflict("Reserved capacity changed. End this batch and select available space before feeding again.");
    const next = await tx.scannerRun.create({ data: { id: input.requestKey, agentId: prior.agentId,
      acquisitionRunId: prior.acquisitionRunId, epoch, requestPayload: scannerCanonical(input), deviceId: prior.deviceId,
      device: refillDevice, settings: prior.settings!, loadedCount: input.loadedCount, physicalTarget: remaining,
      counted: true, sequenceOffset: offset, segment: prior.segment + 1,
      seriesRootId: prior.seriesRootId, seriesOrdinal: prior.seriesOrdinal }, include });
    await tx.acquisitionSession.update({ where: { id: state.session.id }, data: { phase: "CAPTURING", revision: { increment: 1 } } });
    return command(next);
  });
}

export async function endScannerBatch(db: PrismaClient, userId: string, runId: string) {
  return scannerTransaction(db, async tx => {
    const prior = await tx.scannerRun.findUnique({ where: { id: runId }, include });
    if (!prior || !prior.counted || prior.acquisitionRun.session.createdByUserId !== userId) throw denied();
    const state = await getStartState(tx, { userId, adminMode: false }, prior.acquisitionRun.sessionId);
    const latest = await tx.scannerRun.findFirstOrThrow({ where: { acquisitionRunId: prior.acquisitionRunId }, orderBy: { segment: "desc" } });
    if (latest.id !== prior.id || !prior.reconciliation || !["DRAINED", "ERROR"].includes(prior.status) ||
      !["PAUSED", "STOPPING", "COMPLETE"].includes(state.session.phase)) throw denied();
    const captured = prior.sequenceOffset + Number((prior.outcome as Prisma.JsonObject).imageCount);
    await tx.acquisitionSession.update({ where: { id: state.session.id }, data: { phase: "COMPLETE", scannerReserved: captured,
      ...(state.session.phase !== "COMPLETE" ? { revision: { increment: 1 } } : {}) } });
    return { version: 1, runId, ended: true };
  });
}

/** Durable Stop first blocks future section/refill admission. Settling the
 * current physical segment uses the existing conservative cancellation rules. */
export async function stopScannerSeries(db: PrismaClient, userId: string, runId: string) {
  const latestId = await scannerTransaction(db, async tx => {
    const requested = await tx.scannerRun.findUnique({ where: { id: runId }, include });
    if (!requested?.seriesRootId || requested.acquisitionRun.session.createdByUserId !== userId) throw denied();
    await readAcquisitionRow(tx, { userId, adminMode: false }, requested.acquisitionRun.sessionId);
    const { root, latest } = await lockScannerSeries(tx, requested.seriesRootId, userId);
    await tx.scannerRun.update({ where: { id: root.id }, data: { seriesStoppedAt: root.seriesStoppedAt ?? new Date() } });
    return latest.id;
  });
  const current = await getScannerBatch(db, userId, latestId);
  if (["QUEUED", "STARTED"].includes(current.status)) await stopScannerBatch(db, userId, current.runId);
  else if (current.reconciliation && ["PAUSED", "STOPPING"].includes(current.phase)) await endScannerBatch(db, userId, current.runId);
  return { version: 1, stopped: true, runId: current.runId };
}
