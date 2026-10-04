import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type InventoryLocation } from "@prisma/client";
import { z } from "zod";
import { SCANNER_CAPTURE_PROVIDER, scannerCanonical } from "./scanner-run-protocol";
import { acquisitionImageInputKindSchema, type AcquisitionImageInputKind } from "./acquisition-image-input";
import { isAdminUser } from "./auth-policy";
import { requireVisibleAcquisitionBatch, requireProcessingAcquisitionBatch } from "./acquisition-batch-policy";
import { getStorageLocations } from "./storage-summary";
import {
  acquisitionDefaultsSchema,
  emptyAcquisitionDefaults,
  acquisitionPrintingSelect,
  acquisitionReviewRequestSchema,
  type AcquisitionCardReview,
} from "./acquisition-review";
import { VISUAL_STAGE } from "./acquisition-visual";
import { PRINTING_STAGE } from "./acquisition-printing";
import { acquisitionRecognitionJobs } from "./acquisition-recognition-jobs";
import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { acquisitionReviewEvidence } from "./acquisition-review-evidence";
import { searchLocalCardCatalog } from "./local-card-search";
import {
  acquisitionEventSchema,
  candidateKey,
  createCaptureSession,
  placementSnapshot,
  receiveAcquisitionEvent,
  transitionCapture,
  correctPhysicalCount,
  recordRecognitionProposal,
  reviewCandidate,
  type AcquisitionEvent,
  type CaptureSession,
  type ReviewAttributes,
} from "./acquisition-domain";

// Server-only context: derive from the authenticated session and Admin Mode,
// never from a request body's user/admin fields. Live role/owner checks repeat here.
export type AcquisitionActor = { userId: string; adminMode: boolean };
const usesPhotoSlots = (provider: string) => ["phone-photo-v1", SCANNER_CAPTURE_PROVIDER].includes(provider);
type Tx = Prisma.TransactionClient;
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => s.trim() === s);
const createInput = z
  .object({
    requestKey: identity,
    ownerPlayerId: identity,
    locationId: identity,
    section: z.string().max(100),
    defaults: acquisitionDefaultsSchema.optional(),
    policy: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("FILL") }).strict(),
      z
        .object({
          kind: z.literal("MANUAL"),
          quantity: z.number().int().min(1).max(2147483647),
        })
        .strict(),
      z.object({ kind: z.literal("UNTARGETED") }).strict(),
    ]),
    run: z
      .object({
        providerId: identity,
        runId: identity,
        enforcement: z.enum([
          "EXACT_BEFORE_NEXT_ITEM",
          "BEST_EFFORT_STOP",
          "LOGICAL_ALLOCATION",
          "NONE",
        ]),
        controls: z.array(z.enum(["STOP", "CANCEL", "PAUSE", "RESUME"])).max(4),
      })
      .strict(),
  })
  .strict();
export type CreateAcquisitionInput = z.infer<typeof createInput>;
export function canonicalAcquisitionCreation(value: CreateAcquisitionInput) {
  return JSON.stringify(createInput.parse(value));
}
const include = {
  location: true,
  run: {
    include: {
      artifacts: true,
      events: { orderBy: { sessionRevision: "asc" as const } },
      candidates: { include: { observations: true, receipt: true } },
      corrections: {
        include: { candidate: { select: { physicalId: true } } },
        orderBy: { createdAt: "asc" as const },
      },
    },
  },
} satisfies Prisma.AcquisitionSessionInclude;
type Stored = Prisma.AcquisitionSessionGetPayload<{ include: typeof include }>;
export type StoredCapture = {
  defaults: ReturnType<typeof acquisitionDefaultsSchema.parse>;
  defaultsRevision: number;
  batchNumber: number;
  revision: number;
  session: CaptureSession;
  destinationCurrent: boolean;
};

async function transaction<T>(
  db: PrismaClient | Tx,
  work: (tx: Tx) => Promise<T>,
  retryCreate = false,
): Promise<T> {
  // Scanner admission joins session creation and START in its outer transaction.
  if (!("$transaction" in db)) return work(db);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        attempt >= 5 ||
        !(
          error.code === "P2034" ||
          (error.code === "P2010" &&
            ["40001", "40P01"].includes(String(error.meta?.code))) ||
          (retryCreate && error.code === "P2002")
        )
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}
async function authorize(
  tx: Tx,
  actor: AcquisitionActor,
  ownerPlayerId: string,
) {
  identity.parse(actor.userId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    include: { player: true },
  });
  if (
    !user?.isActive ||
    user.forcePasswordChange ||
    !(
      (actor.adminMode && isAdminUser(user, user.player)) ||
      (user.playerId === ownerPlayerId && user.player?.active)
    )
  )
    throw new Error("Capture session unavailable");
}
function layoutRevision(location: InventoryLocation) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        location.ownerPlayerId,
        location.type,
        location.storageLayout,
        location.active,
        location.kind,
        location.systemManaged,
      ]),
    )
    .digest("hex");
}
function destinationCurrent(row: Stored) {
  const location = row.location;
  const snapshot = row.placement as unknown as CaptureSession["placement"];
  return Boolean(
    location &&
    location.active &&
    !location.systemManaged &&
    location.kind === "NORMAL" &&
    location.ownerPlayerId === row.ownerPlayerId &&
    layoutRevision(location) === snapshot.layoutRevision,
  );
}
function hydrate(row: Stored): StoredCapture {
  const run = row.run;
  if (row.version !== 1 || row.intent !== "ADD_NEW" || !run)
    throw new Error("Unsupported or incomplete capture record");
  const session: CaptureSession = {
    version: 1,
    id: row.id,
    intent: "ADD_NEW",
    phase: row.phase,
    run: {
      providerId: run.providerId,
      runId: run.sourceRunId,
      enforcement: run.enforcement as CaptureSession["run"]["enforcement"],
      controls: run.controls as CaptureSession["run"]["controls"],
    },
    placement: row.placement as unknown as CaptureSession["placement"],
    policy: row.policy as CaptureSession["policy"],
    target: row.target,
    artifacts: run.artifacts.map((a) => ({ id: a.sourceId, digest: a.digest })),
    receipts: run.events.map((e) => ({
      eventId: e.sourceEventId,
      payload: e.payload,
    })),
    candidates: run.candidates.map((c) => ({
      key: candidateKey(run.sourceRunId, c.physicalId),
      input: {
        id: c.physicalId,
        identityKind: c.identityKind as "NATIVE" | "DETECTION" | "EPISODE",
        order: [c.acquisitionOrder, c.spatialOrder],
        expectedSides: c.expectedSides as ("FRONT" | "BACK" | "UNKNOWN")[],
        provisional: c.provisional,
      },
      observations: c.observations.map((o) => ({
        id: o.sourceId,
        artifactId: run.artifacts.find((a) => a.id === o.artifactId)!.sourceId,
        side: o.side as "FRONT" | "BACK" | "UNKNOWN",
      })),
      uncertainty: c.uncertainty as ("BOUNDARY_CONFLICT" | "MULTIFEED")[],
      revision: c.revision,
      excluded: c.excluded,
      countConfirmed: c.countConfirmed,
      proposal: c.proposal as ReviewAttributes | null,
      review: c.review as (ReviewAttributes & { actorId: string }) | null,
    })),
    corrections: run.corrections.map((c) => ({
      candidateKey: candidateKey(run.sourceRunId, c.candidate.physicalId),
      actorId: c.actorUserId,
      reason: c.reason,
      revision: c.candidateRevision,
      action: c.action as "CONFIRM_COUNT" | "EXCLUDE_FALSE_DETECTION",
    })),
  };
  return {
    batchNumber: row.batchNumber,
    defaults: acquisitionDefaultsSchema.parse(
      row.reviewDefaults ?? emptyAcquisitionDefaults,
    ),
    defaultsRevision: row.defaultsRevision,
    revision: row.revision,
    session,
    destinationCurrent: destinationCurrent(row),
  };
}
async function read(tx: Tx, actor: AcquisitionActor, sessionId: string) {
  identity.parse(sessionId);
  const row = await tx.acquisitionSession.findUnique({
    where: { id: sessionId },
    include,
  });
  if (!row) throw new Error("Capture session unavailable");
  await authorize(tx, actor, row.ownerPlayerId);
  return row;
}
export async function getAcquisitionSession(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
) {
  return transaction(db, async (tx) => {
    const row = await read(tx, actor, sessionId);
    requireVisibleAcquisitionBatch(row);
    return hydrate(row);
  });
}
export async function createAcquisitionSession(
  db: PrismaClient | Tx,
  actor: AcquisitionActor,
  value: CreateAcquisitionInput,
  beforeWrite?: (tx: Prisma.TransactionClient) => Promise<void>,
  scannerCapacity?: (tx: Prisma.TransactionClient) => Promise<{ remaining: number | null; pendingSection: number }>,
) {
  const input = createInput.parse(value);
  const requestPayload = JSON.stringify(input);
  return transaction(
    db,
    async (tx) => {
      await beforeWrite?.(tx);
      await authorize(tx, actor, input.ownerPlayerId);
      const existing = await tx.acquisitionSession.findUnique({
        where: {
          createdByUserId_requestKey: {
            createdByUserId: actor.userId,
            requestKey: input.requestKey,
          },
        },
        include,
      });
      if (existing) {
        if (existing.requestPayload !== requestPayload)
          throw new Error("Capture creation identity conflict");
        return hydrate(existing);
      }
      const owner = await tx.player.findUnique({
        where: { id: input.ownerPlayerId },
      });
      const location = await tx.inventoryLocation.findUnique({
        where: { id: input.locationId },
      });
      if (
        !owner?.active ||
        !location?.active ||
        location.ownerPlayerId !== input.ownerPlayerId ||
        location.kind !== "NORMAL" ||
        location.systemManaged
      )
        throw new Error("Choose an active owned storage location");
      const [storage] = await getStorageLocations(tx, [location]);
      const otherSessions = await tx.acquisitionSession.findMany({
        where: { locationId: location.id, section: input.section },
        select: {
          target: true,
          run: {
            select: {
              _count: {
                select: {
                  candidates: { where: { excluded: false, receipt: null } },
                },
              },
            },
          },
        },
      });
      const otherSessionPending = otherSessions.reduce(
        (sum, s) =>
          sum + Math.min(s.target ?? Infinity, s.run?._count.candidates ?? 0),
        0,
      );
      const scannerSpace = scannerCapacity ? await scannerCapacity(tx) : null;
      const placement = placementSnapshot({
        ownerPlayerId: owner.id,
        locationId: location.id,
        section: input.section,
        layoutRevision: layoutRevision(location),
        storageLayout: location.storageLayout,
        type: location.type,
        rows: storage.sections.map((s) => ({
          locationId: location.id,
          section: s.name,
          quantity: s.quantity,
        })),
        otherSessionPending,
      });
      if (scannerSpace) {
        placement.remaining = scannerSpace.remaining;
        placement.otherSessionPending = scannerSpace.pendingSection;
      }
      const policy =
        usesPhotoSlots(input.run.providerId) &&
        input.policy.kind !== "MANUAL"
          ? placement.remaining === null
            ? { kind: "UNTARGETED" as const }
            : { kind: "FILL" as const }
          : input.policy;
      const state = createCaptureSession({
        id: randomUUID(),
        intent: "ADD_NEW",
        run: input.run,
        placement,
        policy,
      });
      if (
        usesPhotoSlots(input.run.providerId) &&
        state.target !== null &&
        placement.remaining !== null &&
        state.target > placement.remaining
      )
        throw new Error(
          "Choose a batch within the selected remaining capacity",
        );
      const row = await tx.acquisitionSession.create({
        data: {
          id: state.id,
          createdByUserId: actor.userId,
          ownerPlayerId: owner.id,
          locationId: location.id,
          section: input.section,
          requestKey: input.requestKey,
          requestPayload,
          placement,
          policy: state.policy,
          target: state.target,
          ...(scannerSpace ? { scannerReserved: state.target } : {}),
          ...(input.defaults ? { reviewDefaults: input.defaults } : {}),
          run: {
            create: {
              sourceRunId: input.run.runId,
              providerId: input.run.providerId,
              enforcement: input.run.enforcement,
              controls: input.run.controls,
            },
          },
        },
        include,
      });
      return hydrate(row);
    },
    true,
  );
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
async function save(
  tx: Tx,
  row: Stored,
  before: CaptureSession,
  after: CaptureSession,
) {
  const runId = row.run!.id;
  if (usesPhotoSlots(row.run!.providerId)) {
    const slots = await tx.acquisitionCaptureSlot.findMany({
      where: { runId },
    });
    for (const candidate of after.candidates) {
      const slot = slots.find((s) => s.id === candidate.input.id);
      if (
        !slot ||
        candidate.input.order[0] !== slot.position ||
        candidate.input.order[1] !== 0
      )
        throw new Error("Phone candidate requires its reserved capture slot");
    }
  }
  const artifacts = new Map(row.run!.artifacts.map((a) => [a.sourceId, a.id]));
  for (const artifact of after.artifacts) {
    if (artifacts.has(artifact.id)) continue;
    const stored = await tx.acquisitionArtifact.create({
      data: { runId, sourceId: artifact.id, digest: artifact.digest },
    });
    artifacts.set(artifact.id, stored.id);
  }
  const candidates = new Map(
    row.run!.candidates.map((c) => [c.physicalId, c.id]),
  );
  for (const candidate of after.candidates) {
    const old = before.candidates.find((c) => c.key === candidate.key);
    if (old && JSON.stringify(old) === JSON.stringify(candidate)) continue;
    if (
      row.run!.candidates.find((c) => c.physicalId === candidate.input.id)
        ?.receipt
    )
      throw new Error(
        "Capture card is already committed; use Inventory to change it",
      );
    const data = {
      identityKind: candidate.input.identityKind,
      acquisitionOrder: candidate.input.order[0],
      spatialOrder: candidate.input.order[1],
      expectedSides: candidate.input.expectedSides,
      provisional: candidate.input.provisional,
      uncertainty: candidate.uncertainty,
      revision: candidate.revision,
      excluded: candidate.excluded,
      countConfirmed: candidate.countConfirmed,
      proposal: json(candidate.proposal),
      review: json(candidate.review),
    };
    const stored = await tx.acquisitionCandidate.upsert({
      where: { runId_physicalId: { runId, physicalId: candidate.input.id } },
      create: { runId, physicalId: candidate.input.id, ...data },
      update: data,
    });
    candidates.set(candidate.input.id, stored.id);
    for (const observation of candidate.observations) {
      if (old?.observations.some((o) => o.id === observation.id)) continue;
      await tx.acquisitionObservation.create({
        data: {
          runId,
          sourceId: observation.id,
          artifactId: artifacts.get(observation.artifactId)!,
          candidateId: stored.id,
          side: observation.side,
        },
      });
    }
  }
  for (const correction of after.corrections.slice(before.corrections.length)) {
    const candidate = after.candidates.find(
      (c) => c.key === correction.candidateKey,
    )!;
    await tx.acquisitionCountCorrection.create({
      data: {
        runId,
        candidateId: candidates.get(candidate.input.id)!,
        actorUserId: correction.actorId,
        action: correction.action,
        reason: correction.reason,
        candidateRevision: correction.revision,
      },
    });
  }
  for (const receipt of after.receipts.slice(before.receipts.length))
    await tx.acquisitionEvent.create({
      data: {
        runId,
        sourceEventId: receipt.eventId,
        payload: receipt.payload,
        sessionRevision: row.revision + 1,
      },
    });
  await tx.acquisitionSession.update({
    where: { id: row.id },
    data: { phase: after.phase, revision: { increment: 1 } },
  });
}
async function mutate(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  expectedRevision: number | undefined,
  apply: (s: CaptureSession, destinationCurrent: boolean) => CaptureSession,
) {
  return transaction(db, async (tx) => {
    let row = await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    row = await read(tx, actor, sessionId);
    requireVisibleAcquisitionBatch(row);
    if (expectedRevision !== undefined && row.revision !== expectedRevision)
      throw new Error("Stale capture session revision");
    const before = hydrate(row);
    const after = apply(before.session, before.destinationCurrent);
    if (after === before.session) return { ...before, replay: true };
    if (
      after.candidates.length > 1000 ||
      after.artifacts.length > 2000 ||
      after.receipts.length > 4000 ||
      after.receipts.reduce((n, e) => n + Buffer.byteLength(e.payload), 0) >
        16 * 1024 * 1024
    )
      throw new Error(
        "Capture staging limit reached; retain source evidence and start a new session",
      );
    await save(tx, row, before.session, after);
    return { ...hydrate(await read(tx, actor, sessionId)), replay: false };
  });
}
export async function ingestAcquisitionEvent(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  value: AcquisitionEvent,
) {
  const event = acquisitionEventSchema.parse(value);
  if (
    Buffer.byteLength(JSON.stringify(event)) > 128 * 1024 ||
    event.sightings.length > 300 ||
    event.artifacts.length > 300
  )
    throw new Error("Capture event too large");
  for (const sighting of event.sightings)
    for (const n of sighting.candidate.order)
      z.number().int().min(0).max(2147483647).parse(n);
  return mutate(db, actor, sessionId, undefined, (s) =>
    receiveAcquisitionEvent(s, event),
  );
}
export async function controlAcquisitionSession(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  revision: number,
  command: Parameters<typeof transitionCapture>[1],
) {
  z.number().int().nonnegative().parse(revision);
  return mutate(db, actor, sessionId, revision, (s, current) => {
    if ((command === "START" || command === "RESUME") && !current)
      throw new Error("Destination changed; review placement before starting");
    return transitionCapture(s, command);
  });
}
export async function correctAcquisitionCount(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  revision: number,
  input: Omit<Parameters<typeof correctPhysicalCount>[1], "actorId">,
) {
  z.number().int().nonnegative().parse(revision);
  return mutate(db, actor, sessionId, revision, (s) =>
    correctPhysicalCount(s, { ...input, actorId: actor.userId }),
  );
}
export async function reviewAcquisitionCandidate(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  revision: number,
  key: string,
  candidateRevision: number,
  attributes: ReviewAttributes,
) {
  z.number().int().nonnegative().parse(revision);
  return mutate(db, actor, sessionId, revision, (s) =>
    reviewCandidate(s, key, candidateRevision, actor.userId, attributes),
  );
}
export async function proposeAcquisitionCandidate(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  revision: number,
  key: string,
  candidateRevision: number,
  attributes: ReviewAttributes,
) {
  z.number().int().nonnegative().parse(revision);
  return mutate(db, actor, sessionId, revision, (s) =>
    recordRecognitionProposal(s, key, candidateRevision, attributes),
  );
}

// Commands are replayable even after their original revision has advanced.
export async function executeAcquisitionCommand(
  db: PrismaClient | Tx,
  actor: AcquisitionActor,
  sessionId: string,
  input: {
    requestKey: string;
    revision: number;
    command: Parameters<typeof transitionCapture>[1];
  },
  beforeWrite?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  identity.parse(input.requestKey);
  z.number().int().nonnegative().parse(input.revision);
  const payload = JSON.stringify({
    revision: input.revision,
    command: input.command,
  });
  return transaction(db, async (tx) => {
    await beforeWrite?.(tx);
    await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = await read(tx, actor, sessionId);
    const previous = await tx.acquisitionCommand.findUnique({
      where: {
        runId_requestKey: { runId: row.run!.id, requestKey: input.requestKey },
      },
    });
    if (previous) {
      if (previous.payload !== payload)
        throw new Error("Capture command identity conflict");
      return { ...hydrate(row), replay: true };
    }
    requireProcessingAcquisitionBatch(row);
    if (row.revision !== input.revision)
      throw new Error("Stale capture session revision");
    if (["START", "RESUME"].includes(input.command) && !destinationCurrent(row))
      throw new Error("Destination changed; review placement before starting");
    const before = hydrate(row).session;
    const after = transitionCapture(before, input.command);
    await save(tx, row, before, after);
    await tx.acquisitionCommand.create({
      data: {
        runId: row.run!.id,
        requestKey: input.requestKey,
        payload,
      },
    });
    return { ...hydrate(await read(tx, actor, sessionId)), replay: false };
  });
}

// Single-card phone provider admission. A reservation remains occupied after an
// interrupted upload; retry/retake uses the SAME slot, never another physical ID.
export async function reserveAcquisitionCaptureSlot(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  requestKey: string,
) {
  identity.parse(requestKey);
  return transaction(db, async (tx) => {
    await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = await read(tx, actor, sessionId);
    const run = row.run!;
    if (run.providerId !== "phone-photo-v1")
      throw new Error("Provider does not use phone slots");
    const existing = await tx.acquisitionCaptureSlot.findUnique({
      where: { runId_requestKey: { runId: run.id, requestKey } },
    });
    if (existing) return { slot: existing, replay: true };
    if (row.phase !== "CAPTURING" || !destinationCurrent(row))
      throw new Error("Capture is not accepting new photos");
    // No mixing unreserved candidates into the exact phone provider.
    const slots = await tx.acquisitionCaptureSlot.findMany({
      where: { runId: run.id },
    });
    if (
      run.candidates.some(
        (c) => !slots.some((slot) => slot.id === c.physicalId),
      )
    )
      throw new Error("Phone capture identities need reconciliation");
    if (row.target !== null && slots.length >= row.target)
      throw new Error("Capture batch is full");
    const slot = await tx.acquisitionCaptureSlot.create({
      data: {
        runId: run.id,
        requestKey,
        position: slots.length,
      },
    });
    await tx.acquisitionSession.update({
      where: { id: sessionId },
      data: { revision: { increment: 1 } },
    });
    return { slot, replay: false };
  });
}

export const acquisitionStageVersionsSchema = z
  .object({
    pipeline: identity,
    runtime: identity,
    model: identity,
    catalog: identity,
    index: identity,
    execution: z.enum(["CPU", "GPU"]),
  })
  .strict();

// Internal server call after artifact finalization. Input versions form immutable
// identity; replacing bytes/model/catalog requires a new job identity.
export async function enqueueAcquisitionProcessing(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  input: {
    artifactSourceId: string;
    physicalId: string;
    stage: string;
    versions: z.infer<typeof acquisitionStageVersionsSchema>;
  },
) {
  const stage = identity.parse(input.stage);
  const versions = acquisitionStageVersionsSchema.parse(input.versions);
  return transaction(
    db,
    async (tx) => {
      const row = await read(tx, actor, sessionId);
      const run = row.run!;
      const candidate = run.candidates.find(
        (c) => c.physicalId === input.physicalId,
      );
      requireProcessingAcquisitionBatch(row);
      const artifact = run.artifacts.find(
        (a) => a.sourceId === input.artifactSourceId,
      );
      if (
        !candidate ||
        candidate.receipt ||
        !artifact ||
        !candidate.observations.some((o) => o.artifactId === artifact.id)
      )
        throw new Error("Processing requires a related candidate and artifact");
      const jobInput = { version: 1, digest: artifact.digest, versions };
      const versionKey = createHash("sha256")
        .update(JSON.stringify(jobInput))
        .digest("hex");
      const key = {
        artifactId: artifact.id,
        candidateId: candidate.id,
        candidateRevision: candidate.revision,
        stage,
        versionKey,
      };
      // A unique versioned key admits concurrent retries without duplicate jobs.
      return tx.acquisitionProcessingJob.upsert({
        where: {
          artifactId_candidateId_candidateRevision_stage_versionKey: key,
        },
        create: { runId: run.id, ...key, input: jobInput },
        update: {},
      });
    },
    true,
  );
}

export async function getAcquisitionProgress(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
) {
  return transaction(db, async (tx) => {
    const row = await read(tx, actor, sessionId);
    requireVisibleAcquisitionBatch(row);
    const slots = await tx.acquisitionCaptureSlot.findMany({
      where: { runId: row.run!.id },
      orderBy: { position: "asc" },
      include: {
        photos: {
          orderBy: { generation: "desc" },
          take: 2,
          select: {
            id: true,
            uploadKey: true,
            generation: true,
            ready: true,
            purgedAt: true,
            digest: true,
            bytes: true,
            inputKind: true,
          },
        },
      },
    });
    const jobs = await tx.acquisitionProcessingJob.groupBy({
      by: ["status"],
      where: { runId: row.run!.id },
      _count: { _all: true },
    });
    const currentPhotoIds = slots.flatMap((slot) => {
      const photo = slot.photos.find((p) => p.ready);
      return photo ? [photo.id] : [];
    });
    const photoJobs = await tx.acquisitionProcessingJob.findMany({
      where: {
        runId: row.run!.id,
        stage: "photo-canonical-v1",
        artifact: { sourceId: { in: currentPhotoIds } },
      },
      select: {
        status: true,
        candidateRevision: true,
        candidate: { select: { revision: true } },
        artifact: { select: { sourceId: true } },
      },
    });
    const state = hydrate(row);
    const reviewedIds = [
      ...new Set(
        state.session.candidates.flatMap((c) =>
          c.review?.cardId ? [c.review.cardId] : [],
        ),
      ),
    ];
    const reviewedNames = new Map(
      (
        await tx.card.findMany({
          where: { id: { in: reviewedIds } },
          select: {
            id: true,
            name: true,
            setCode: true,
            collectorNumber: true,
          },
        })
      ).map((c) => [c.id, c]),
    );
    const reviews = new Map(
      state.session.candidates.map((c) => [
        c.input.id,
        c.review
          ? {
              ...c.review,
              cardName: reviewedNames.get(c.review.cardId ?? "")?.name ?? null,
              setCode:
                reviewedNames.get(c.review.cardId ?? "")?.setCode ?? null,
              collectorNumber:
                reviewedNames.get(c.review.cardId ?? "")?.collectorNumber ??
                null,
            }
          : null,
      ]),
    );
    return {
      ...state,
      photoPreparation: photoJobs.map((j) => ({
        photoId: j.artifact.sourceId,
        status: j.status,
      })),
      slots: slots.map((slot) => ({
        id: slot.id,
        position: slot.position,
        generation: slot.generation,
        photos: slot.photos,
        review: reviews.get(slot.id) ?? null,
        committed: Boolean(
          row.run!.candidates.find((c) => c.physicalId === slot.id)?.receipt,
        ),
        received: row.run!.candidates.some((c) => c.physicalId === slot.id),
      })),
      reservedSlots: slots.length,
      availableSlots:
        row.target === null ? null : Math.max(0, row.target - slots.length),
      // Stage totals are not resolved-card totals. The UI must not label a
      // canonicalization job COMPLETE as a reviewed/commit-ready card.
      processingStages: jobs.map((job) => ({
        status: job.status,
        count: job._count._all,
      })),
    };
  });
}

export const acquisitionPhotoMetadataSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().min(1).max(12000),
    height: z.number().int().min(1).max(12000),
  })
  .strict()
  .refine((m) => m.width * m.height <= 36000000, "Photo exceeds 36 megapixels");
export type AcquisitionPhotoMetadata = z.infer<
  typeof acquisitionPhotoMetadataSchema
>;

export async function beginAcquisitionPhoto(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  input: {
    slotId: string;
    uploadKey: string;
    generation: number;
    replacePending?: boolean;
    metadata: AcquisitionPhotoMetadata;
    inputKind?: AcquisitionImageInputKind;
    sourceMetadata?: Prisma.InputJsonObject;
  },
) {
  z.string().uuid().parse(input.slotId);
  z.string().uuid().parse(input.uploadKey);
  z.number().int().min(0).max(20).parse(input.generation);
  const metadata = acquisitionPhotoMetadataSchema.parse(input.metadata);
  const inputKind = acquisitionImageInputKindSchema.parse(input.inputKind ?? "PHOTO");
  return transaction(db, async (tx) => {
    await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = await read(tx, actor, sessionId);
    const run = row.run!;
    if (run.providerId === SCANNER_CAPTURE_PROVIDER &&
      (!input.sourceMetadata || inputKind !== "CARD_SCAN"))
      throw new Error("Capture scanner source evidence required");
    if (row.deletedAt) throw new Error("Capture batch has expired");
    const slot = await tx.acquisitionCaptureSlot.findUnique({
      where: { id: input.slotId },
    });
    if (!slot || slot.runId !== run.id)
      throw new Error("Capture slot unavailable");
    const previous = await tx.acquisitionPhoto.findUnique({
      where: { runId_uploadKey: { runId: run.id, uploadKey: input.uploadKey } },
    });
    if (previous) {
      if (
        previous.slotId !== slot.id ||
        previous.generation !== input.generation + 1 ||
        previous.digest !== metadata.digest ||
        previous.bytes !== metadata.bytes ||
        previous.inputKind !== inputKind ||
        scannerCanonical(previous.sourceMetadata) !== scannerCanonical(input.sourceMetadata ?? null)
      )
        throw new Error("Photo upload identity conflict");
      if (
        !previous.ready &&
        (previous.purgedAt ||
          run.candidates.find((c) => c.physicalId === slot.id)?.receipt)
      )
        throw new Error(
          "Capture card is already committed; its unfinished retake cannot resume",
        );
      return previous;
    }
    if (
      !(["CAPTURING", "STOPPING"].includes(row.phase) || row.phase === "CANCELLED" && row.cancelledAt && run.providerId === SCANNER_CAPTURE_PROVIDER) ||
      !destinationCurrent(row)
    )
      throw new Error("Capture is not accepting photos");
    if (slot.generation !== input.generation)
      throw new Error("Photo changed; refresh before retaking");
    if (
      !input.replacePending &&
      (await tx.acquisitionPhoto.count({
        where: { slotId: slot.id, generation: slot.generation, ready: false },
      }))
    )
      throw new Error("Retry the unfinished upload before retaking");
    if (run.candidates.find((c) => c.physicalId === slot.id)?.receipt)
      throw new Error(
        "Capture card is already committed; use Inventory to change it",
      );
    // Every intake for this owner takes the same quota lock. Pending writes count.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.ownerPlayerId}, 314))`;
    const [ownerUsage, sessionUsage] = await Promise.all([
      tx.acquisitionPhoto.aggregate({
        where: {
          run: { session: { ownerPlayerId: row.ownerPlayerId } },
          purgedAt: null,
        },
        _sum: { bytes: true },
      }),
      tx.acquisitionPhoto.aggregate({
        where: { runId: run.id, purgedAt: null },
        _sum: { bytes: true },
      }),
    ]);
    if (
      (ownerUsage._sum.bytes ?? 0) + metadata.bytes > 4 * 1024 ** 3 ||
      (sessionUsage._sum.bytes ?? 0) + metadata.bytes > 1024 ** 3
    )
      throw new Error(
        "Photo storage limit reached; finish or discard older batches",
      );
    const photo = await tx.acquisitionPhoto.create({
      data: {
        runId: run.id,
        slotId: slot.id,
        uploadKey: input.uploadKey,
        generation: slot.generation + 1,
        ...metadata,
        inputKind,
        ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
      },
    });
    await tx.acquisitionCaptureSlot.update({
      where: { id: slot.id },
      data: { generation: { increment: 1 } },
    });
    return photo;
  });
}

export async function finalizeAcquisitionPhoto(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  photoId: string,
) {
  return transaction(db, async (tx) => {
    await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = await read(tx, actor, sessionId);
    const photo = await tx.acquisitionPhoto.findUnique({
      where: { id: photoId },
      include: { slot: true },
    });
    if (row.deletedAt) throw new Error("Capture batch has expired");
    if (!photo || photo.runId !== row.run!.id)
      throw new Error("Photo unavailable");
    if (photo.ready) return photo;
    if (photo.slot.generation !== photo.generation)
      throw new Error("Photo generation changed");
    const before = hydrate(row).session;
    // Accepted in-flight evidence survives pause/cancel/complete. Reconcile it
    // without reopening capture, only through an already reserved photo record.
    const receiving = { ...before, phase: "CAPTURING" as const };
    const scanner = before.run.providerId === SCANNER_CAPTURE_PROVIDER;
    const after = receiveAcquisitionEvent(receiving, {
      version: 1,
      providerId: before.run.providerId,
      runId: before.run.runId,
      eventId: `photo:${photo.id}`,
      artifacts: [{ id: photo.id, digest: photo.digest }],
      sightings: [
        {
          candidate: {
            id: photo.slotId,
            identityKind: scanner ? "DETECTION" : "EPISODE",
            order: [photo.slot.position, 0],
            expectedSides: [scanner ? "UNKNOWN" : "FRONT"],
            provisional: scanner,
          },
          observation: { id: photo.id, artifactId: photo.id, side: scanner ? "UNKNOWN" : "FRONT" },
          uncertainty: [],
        },
      ],
    });
    after.phase = before.phase;
    await save(tx, row, before, after);
    const artifact = await tx.acquisitionArtifact.findUniqueOrThrow({
      where: { runId_sourceId: { runId: row.run!.id, sourceId: photo.id } },
    });
    const candidate = await tx.acquisitionCandidate.findUniqueOrThrow({
      where: {
        runId_physicalId: { runId: row.run!.id, physicalId: photo.slotId },
      },
    });
    await tx.acquisitionProcessingJob.create({
      data: {
        ...(row.cancelledAt || row.trashedAt || row.deletedAt || row.phase === "CANCELLED" ? {
          status: "SUPERSEDED" as const, errorCode: "BATCH_STOPPED",
        } : {}),
        runId: row.run!.id,
        artifactId: artifact.id,
        candidateId: candidate.id,
        candidateRevision: candidate.revision,
        stage: "photo-canonical-v1",
        versionKey: "sharp-0.35.4-orient-1600-v1",
        input: {
          version: 1,
          photoId: photo.id,
          digest: photo.digest,
          inputKind: photo.inputKind,
          versions: {
            pipeline: "orient-1600-v1",
            runtime: "sharp-0.35.4",
            model: "none",
            catalog: "none",
            index: "none",
            execution: "CPU",
          },
        },
      },
    });
    return tx.acquisitionPhoto.update({
      where: { id: photo.id },
      data: { ready: true, readyAt: new Date() },
    });
  });
}

export async function getAcquisitionPhoto(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  photoId: string,
) {
  return transaction(db, async (tx) => {
    const row = await read(tx, actor, sessionId);
    requireVisibleAcquisitionBatch(row);
    const photo = await tx.acquisitionPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo || photo.runId !== row.run!.id || !photo.ready || photo.purgedAt)
      throw new Error("Photo unavailable");
    return photo;
  });
}

async function reviewPhoto(tx: Tx, row: Stored, photoId: string) {
  requireVisibleAcquisitionBatch(row);
  z.string().uuid().parse(photoId);
  const photo = await tx.acquisitionPhoto.findUnique({
    where: { id: photoId },
    include: { slot: true },
  });
  if (
    !photo ||
    photo.runId !== row.run!.id ||
    !photo.ready ||
    photo.purgedAt ||
    photo.generation !== photo.slot.generation
  )
    throw new Error("Photo changed or unavailable; reopen the latest card");
  const candidate = row.run!.candidates.find(
    (c) => c.physicalId === photo.slotId,
  );
  if (!candidate || candidate.excluded)
    throw new Error("Capture card unavailable");
  return { photo, candidate };
}

export async function getAcquisitionCardReview(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  photoId: string,
): Promise<AcquisitionCardReview> {
  return transaction(db, async (tx) => {
    const row = await read(tx, actor, sessionId);
    const { photo, candidate } = await reviewPhoto(tx, row, photoId);
    const jobs = await tx.acquisitionProcessingJob.findMany({
      where: {
        runId: row.run!.id,
        artifact: { sourceId: photo.id },
        stage: {
          in: [
            "photo-recognition-v1",
            CATALOG_RECONCILIATION_STAGE,
            VISUAL_STAGE,
            PRINTING_STAGE,
          ],
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 16,
    });
    // A saved suggestion remains evidence for these immutable bytes after human
    // review increments the candidate revision. It never changes that review.
    const {job, evidence, visualStatus, printingStatus} = acquisitionRecognitionJobs(
      jobs, process.env.ACQUISITION_VISUAL_ENABLED === "1", process.env.ACQUISITION_PRINTING_ENABLED === "1",
    );
    const review = candidate.review as AcquisitionCardReview["review"];
    const ids = [
      ...new Set([
        ...(evidence.result?.proposals.map((p) => p.card.id) ?? []),
        ...(review?.cardId ? [review.cardId] : []),
      ]),
    ];
    const cards = await tx.card.findMany({
      where: { id: { in: ids } },
      select: acquisitionPrintingSelect,
    });
    return {
      photoId,
      revision: candidate.revision,
      position: photo.slot.position,
      defaults: acquisitionDefaultsSchema.parse(
        row.reviewDefaults ?? emptyAcquisitionDefaults,
      ),
      review,
      printing:
        cards.find(
          (c) =>
            c.id ===
            (review?.cardId ??
              (evidence.result?.status === "STRONG_MATCH"
                ? evidence.result.proposals[0]?.card.id
                : null)),
        ) ?? null,
      recognitionStatus:
        !evidence.result && evidence.status !== "COMPLETE"
          ? evidence.status
          : evidence.catalog?.status === "CHECKING"
          ? "PENDING"
          : evidence.status === "FAILED"
            ? "FAILED"
            : (evidence.result?.status ?? evidence.status),
      catalog: evidence.catalog,
      visualStatus,
      printingStatus,
      evidence: acquisitionReviewEvidence(job?.output),
      suggestions: (evidence.result?.proposals ?? []).flatMap((p) => {
        const printing = cards.find((c) => c.id === p.card.id);
        return printing ? [{ printing, reasons: p.reasons }] : [];
      }),
    };
  });
}

export async function saveAcquisitionReview(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  raw: unknown,
) {
  const input = acquisitionReviewRequestSchema.parse(raw);
  return transaction(db, async (tx) => {
    await read(tx, actor, sessionId);
    await tx.$queryRaw`SELECT id FROM "AcquisitionSession" WHERE id = ${sessionId} FOR UPDATE`;
    const row = await read(tx, actor, sessionId);
    requireVisibleAcquisitionBatch(row);
    if (input.action === "defaults") {
      if (row.defaultsRevision !== input.revision)
        throw new Error(
          "Capture batch defaults changed; reload them before saving",
        );
      await tx.acquisitionSession.update({
        where: { id: sessionId },
        data: {
          reviewDefaults: input.defaults,
          defaultsRevision: { increment: 1 },
        },
      });
      await tx.acquisitionCommand.create({
        data: {
          runId: row.run!.id,
          requestKey: `review-defaults:${row.defaultsRevision + 1}`,
          payload: JSON.stringify({
            version: 1,
            action: "REVIEW_DEFAULTS",
            actorId: actor.userId,
            before: row.reviewDefaults,
            after: input.defaults,
          }),
        },
      });
      return {
        defaults: input.defaults,
        defaultsRevision: row.defaultsRevision + 1,
      };
    }
    const { candidate } = await reviewPhoto(tx, row, input.photoId);
    if (candidate.receipt)
      throw new Error(
        "Capture card is already committed; use Inventory to change it",
      );
    const current = candidate.review as AcquisitionCardReview["review"];
    if (candidate.revision !== input.revision) {
      if (
        input.action === "accept" &&
        candidate.revision === input.revision + 1 &&
        current?.actorId === actor.userId &&
        Object.entries(input.decision).every(
          ([key, value]) => current[key as keyof typeof current] === value,
        )
      )
        return { replay: true };
      throw new Error("Capture card changed; reload its review before saving");
    }
    if (input.action === "accept") {
      const card = await tx.card.findUnique({
        where: { id: input.decision.cardId },
      });
      if (!card || card.digital === true)
        throw new Error("Choose an available paper printing");
      if (
        card.lang &&
        card.lang.toLowerCase() !== input.decision.language.toLowerCase()
      )
        throw new Error("Choose the selected printing's language");
      if (
        Array.isArray(card.finishes) &&
        card.finishes.length &&
        !card.finishes.includes(input.decision.finish.toLowerCase())
      )
        throw new Error("Choose a finish available for this printing");
    }
    const before = hydrate(row).session;
    const key = candidateKey(before.run.runId, candidate.physicalId);
    const after =
      input.action === "accept"
        ? reviewCandidate(
            before,
            key,
            input.revision,
            actor.userId,
            input.decision,
          )
        : structuredClone(before);
    if (input.action === "pending") {
      const pending = after.candidates.find((c) => c.key === key)!;
      pending.review = null;
      pending.revision++;
    }
    await save(tx, row, before, after);
    await tx.acquisitionCommand.create({
      data: {
        runId: row.run!.id,
        requestKey: `review:${candidate.id}:${input.revision + 1}`,
        payload: JSON.stringify({
          version: 1,
          action: input.action,
          actorId: actor.userId,
          photoId: input.photoId,
          before: candidate.review,
          after: input.action === "accept" ? input.decision : null,
        }),
      },
    });
    return { replay: false };
  });
}

export async function searchAcquisitionPrintings(
  db: PrismaClient,
  actor: AcquisitionActor,
  sessionId: string,
  raw: unknown,
  fallback?: (
    query: import("./acquisition-catalog-queries").CatalogQuery,
    signal: AbortSignal,
  ) => Promise<import("./acquisition-catalog-cache").CachedCatalogResult>,
) {
  const input = z
    .object({
      query: z.string().trim().max(120),
      set: z.string().trim().max(30),
      number: z.string().trim().max(100),
    })
    .strict()
    .parse(raw);
  const search = (externalIds?: string[]) =>
    transaction(db, async (tx) => {
      const session = await tx.acquisitionSession.findUnique({
        where: { id: sessionId },
        select: { ownerPlayerId: true },
      });
      if (!session) throw new Error("Capture session unavailable");
      await authorize(tx, actor, session.ownerPlayerId);
      if (input.query.length < 2 && !input.set && !input.number)
        throw new Error("Choose a card name or set and collector number");
      const matches = externalIds
        ? await tx.card.findMany({
            where: {
              scryfallId: { in: externalIds },
              OR: [{ digital: false }, { digital: null }],
            },
            take: 50,
            orderBy: [{ name: "asc" }, { releasedAt: "desc" }, { id: "asc" }],
          })
        : !input.set && !input.number
          ? await searchLocalCardCatalog(tx, {
              query: input.query,
              setCode: input.query.toLowerCase(),
              limit: 50,
            })
          : await tx.card.findMany({
              where: {
                ...(input.query.length >= 2
                  ? {
                      name: {
                        contains: input.query,
                        mode: "insensitive" as const,
                      },
                    }
                  : {}),
                ...(input.set
                  ? {
                      setCode: {
                        equals: input.set,
                        mode: "insensitive" as const,
                      },
                    }
                  : {}),
                ...(input.number
                  ? {
                      collectorNumber: {
                        equals: input.number.replace(/^0+(?=\d)/, ""),
                        mode: "insensitive" as const,
                      },
                    }
                  : {}),
              },
              take: 50,
              orderBy: [{ name: "asc" }, { releasedAt: "desc" }, { id: "asc" }],
            });
      return matches
        .filter((c) => c.digital !== true)
        .map(
          ({
            id,
            name,
            setCode,
            collectorNumber,
            lang,
            imageUri,
            finishes,
          }) => ({
            id,
            name,
            setCode,
            collectorNumber,
            lang,
            imageUri,
            finishes,
          }),
        );
    });
  // Authorization completes before network work, and is checked again before
  // returning imported metadata. No session/database transaction spans HTTP.
  const local = await search();
  const exactName = input.query.trim().toLocaleLowerCase();
  if (
    local.length &&
    (input.set ||
      input.number ||
      local.some((card) =>
        [card.name, ...card.name.split(" // ")].some(
          (name) => name.toLocaleLowerCase() === exactName,
        ),
      ))
  )
    return local;
  const query: import("./acquisition-catalog-queries").CatalogQuery | null =
    input.set && input.number
      ? {
          kind: "printing",
          set: input.set.toLowerCase(),
          number: input.number.replace(/^0+(?=\d)/, ""),
          language: "en",
        }
      : input.query.length >= 3
        ? { kind: "name", name: input.query }
        : null;
  if (!query) return local;
  const lookup =
    fallback ??
    ((q, signal) =>
      import("./acquisition-catalog-cache").then((m) =>
        m.resolveCachedAcquisitionCatalog(db, q, signal),
      ));
  const signal = AbortSignal.timeout(45000);
  let result = await lookup(query, signal);
  while (result.status === "PENDING") {
    signal.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await lookup(query, signal);
  }
  if (result.status === "PROVIDER_ERROR" || result.status === "INCOMPLETE")
    throw new Error(
      "Scryfall could not complete the catalog search. Your photo is saved; try again shortly.",
    );
  if (result.status === "NOT_FOUND") return local;
  const imported = await search(result.cards.map((card) => card.id));
  return [
    ...new Map([...imported, ...local].map((card) => [card.id, card])).values(),
  ].slice(0, 50);
}

// Internal service primitives. Callers must keep authorization inside each
// transaction; these are not browser endpoints or authentication shortcuts.
export {
  transaction as acquisitionTransaction,
  read as readAcquisitionRow,
  hydrate as hydrateAcquisitionRow,
  save as saveAcquisitionRow,
};
