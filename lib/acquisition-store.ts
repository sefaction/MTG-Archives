import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type InventoryLocation } from "@prisma/client";
import { z } from "zod";
import { isAdminUser } from "./auth-policy";
import { getStorageLocations } from "./storage-summary";
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
const include = {
  location: true,
  run: {
    include: {
      artifacts: true,
      events: { orderBy: { sessionRevision: "asc" as const } },
      candidates: { include: { observations: true } },
      corrections: {
        include: { candidate: { select: { physicalId: true } } },
        orderBy: { createdAt: "asc" as const },
      },
    },
  },
} satisfies Prisma.AcquisitionSessionInclude;
type Stored = Prisma.AcquisitionSessionGetPayload<{ include: typeof include }>;
export type StoredCapture = {
  revision: number;
  session: CaptureSession;
  destinationCurrent: boolean;
};

async function transaction<T>(
  db: PrismaClient,
  work: (tx: Tx) => Promise<T>,
  retryCreate = false,
): Promise<T> {
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
  return transaction(db, async (tx) =>
    hydrate(await read(tx, actor, sessionId)),
  );
}
export async function createAcquisitionSession(
  db: PrismaClient,
  actor: AcquisitionActor,
  value: CreateAcquisitionInput,
) {
  const input = createInput.parse(value);
  const requestPayload = JSON.stringify(input);
  return transaction(
    db,
    async (tx) => {
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
                select: { candidates: { where: { excluded: false } } },
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
      const state = createCaptureSession({
        id: randomUUID(),
        intent: "ADD_NEW",
        run: input.run,
        placement,
        policy: input.policy,
      });
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
          policy: input.policy,
          target: state.target,
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
