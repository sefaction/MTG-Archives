import { z } from "zod";
import { readStorageLayout, remainingStorageSpace } from "./storage-layout";
import { storageSections } from "./storage-sections";

// Pure v1 foundation. No transport ACK, authorization, reservation or inventory
// write is implemented here. Persisted adapters must validate/re-authorize inputs.
const id = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value.trim() === value,
    "Identity must not contain surrounding whitespace",
  );
const count = z.number().int().nonnegative().safe();
const side = z.enum(["FRONT", "BACK", "UNKNOWN"]);
const uncertainty = z.enum(["BOUNDARY_CONFLICT", "MULTIFEED"]);
const candidateInput = z
  .object({
    id,
    identityKind: z.enum(["NATIVE", "DETECTION", "EPISODE"]),
    order: z.tuple([count, count]), // acquisition order, then spatial order
    expectedSides: z.array(side).min(1).max(2),
    provisional: z.boolean(),
  })
  .strict();
const artifactInput = z.object({ id, digest: id }).strict();
const observationInput = z
  .object({
    id,
    artifactId: id,
    side,
  })
  .strict();
export const acquisitionEventSchema = z
  .object({
    version: z.literal(1),
    providerId: id,
    runId: id,
    eventId: id,
    artifacts: z.array(artifactInput),
    sightings: z.array(
      z
        .object({
          candidate: candidateInput,
          observation: observationInput,
          uncertainty: z.array(uncertainty),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (event) => event.artifacts.length > 0 || event.sightings.length > 0,
    "Empty event",
  );
export type AcquisitionEvent = z.infer<typeof acquisitionEventSchema>;
export type Enforcement =
  "EXACT_BEFORE_NEXT_ITEM" | "BEST_EFFORT_STOP" | "LOGICAL_ALLOCATION" | "NONE";
export type Control = "STOP" | "CANCEL" | "PAUSE" | "RESUME";
export type AcquisitionPhase =
  "DRAFT" | "CAPTURING" | "PAUSED" | "STOPPING" | "COMPLETE" | "CANCELLED";
export type TargetPolicy =
  | { kind: "FILL" }
  | { kind: "MANUAL"; quantity: number }
  | { kind: "UNTARGETED" };

export type PlacementSnapshot = {
  version: 1;
  ownerPlayerId: string;
  locationId: string;
  section: string;
  layoutRevision: string;
  remaining: number | null;
  committedDirect: number;
  committedSection: number;
  otherSessionPending: number;
};

// Only direct-location rows, as in getStorageLocations. A parent's descendants
// are not its capacity occupancy. Section names retain repository exact matching.
export function placementSnapshot(input: {
  ownerPlayerId: string;
  locationId: string;
  section: string;
  layoutRevision: string;
  storageLayout: unknown;
  type?: string | null;
  rows: { locationId: string; section: string; quantity: number }[];
  otherSessionPending?: number;
}): PlacementSnapshot {
  id.parse(input.ownerPlayerId);
  id.parse(input.locationId);
  id.parse(input.layoutRevision);
  const layout = readStorageLayout(input.storageLayout, input.type);
  const rows = input.rows.filter((r) => r.locationId === input.locationId);
  rows.forEach((r) => count.parse(r.quantity));
  const committedDirect = rows.reduce((sum, r) => sum + r.quantity, 0);
  count.parse(committedDirect);
  const sections = storageSections(
    input.type,
    rows.map((r) => ({ name: r.section, quantity: r.quantity })),
    input.storageLayout,
  );
  const selected = sections.find((s) => s.name === input.section);
  return {
    version: 1,
    ownerPlayerId: input.ownerPlayerId,
    locationId: input.locationId,
    section: input.section,
    layoutRevision: input.layoutRevision,
    remaining: remainingStorageSpace(
      layout,
      committedDirect,
      selected ? [selected] : [],
    ),
    committedDirect,
    committedSection: selected?.quantity ?? 0,
    otherSessionPending: count.parse(input.otherSessionPending ?? 0),
  };
}

export type ReviewAttributes = {
  cardId: string | null;
  language: string | null;
  finish: "UNKNOWN" | "NONFOIL" | "FOIL" | "ETCHED";
  condition: string | null;
  source?: "AUTO_STRONG_MATCH";
};
type Candidate = {
  key: string;
  input: z.infer<typeof candidateInput>;
  observations: z.infer<typeof observationInput>[];
  uncertainty: z.infer<typeof uncertainty>[];
  revision: number;
  excluded: boolean;
  countConfirmed: boolean;
  proposal: ReviewAttributes | null;
  review: (ReviewAttributes & { actorId: string }) | null;
};
export type CaptureSession = {
  version: 1;
  id: string;
  intent: "ADD_NEW"; // AUDIT_EXISTING/RECONCILE and MOVE_EXISTING are future flows.
  run: {
    providerId: string;
    runId: string;
    enforcement: Enforcement;
    controls: Control[];
  };
  placement: PlacementSnapshot;
  policy: TargetPolicy;
  target: number | null;
  phase: AcquisitionPhase;
  artifacts: z.infer<typeof artifactInput>[];
  candidates: Candidate[];
  receipts: { eventId: string; payload: string }[];
  corrections: {
    candidateKey: string;
    actorId: string;
    reason: string;
    revision: number;
    action: "CONFIRM_COUNT" | "EXCLUDE_FALSE_DETECTION";
  }[];
};

export function createCaptureSession(
  input: Pick<CaptureSession, "id" | "intent" | "run" | "placement" | "policy">,
): CaptureSession {
  id.parse(input.id);
  id.parse(input.run.providerId);
  id.parse(input.run.runId);
  if (input.intent !== "ADD_NEW" || input.placement.version !== 1)
    throw new Error("Unsupported session contract");
  id.parse(input.placement.ownerPlayerId);
  id.parse(input.placement.locationId);
  id.parse(input.placement.layoutRevision);
  if (input.placement.remaining !== null)
    count.parse(input.placement.remaining);
  count.parse(input.placement.committedDirect);
  count.parse(input.placement.committedSection);
  count.parse(input.placement.otherSessionPending);
  z.enum([
    "EXACT_BEFORE_NEXT_ITEM",
    "BEST_EFFORT_STOP",
    "LOGICAL_ALLOCATION",
    "NONE",
  ]).parse(input.run.enforcement);
  z.array(z.enum(["STOP", "CANCEL", "PAUSE", "RESUME"])).parse(
    input.run.controls,
  );
  let target: number | null;
  switch (input.policy.kind) {
    case "FILL":
      target = input.placement.remaining;
      break;
    case "MANUAL":
      target = count.positive().parse(input.policy.quantity);
      break;
    case "UNTARGETED":
      target = null;
      break;
    default:
      throw new Error("Unsupported target policy");
  }
  return structuredClone({
    ...input,
    version: 1,
    target,
    phase: "DRAFT",
    artifacts: [],
    candidates: [],
    receipts: [],
    corrections: [],
  });
}

export function transitionCapture(
  session: CaptureSession,
  command: "START" | "COMPLETE" | Control,
): CaptureSession {
  if (
    ["STOP", "CANCEL", "PAUSE", "RESUME"].includes(command) &&
    !session.run.controls.includes(command as Control)
  )
    throw new Error(`Unsupported control: ${command}`);
  const allowed: Record<string, AcquisitionPhase[]> = {
    START: ["DRAFT"],
    STOP: ["CAPTURING", "PAUSED"],
    CANCEL: ["DRAFT", "CAPTURING", "PAUSED", "STOPPING"],
    PAUSE: ["CAPTURING"],
    RESUME: ["PAUSED"],
    COMPLETE: ["CAPTURING", "STOPPING"],
  };
  if (!allowed[command]?.includes(session.phase))
    throw new Error(`Invalid transition: ${session.phase} / ${command}`);
  if (
    command === "START" &&
    session.policy.kind === "FILL" &&
    (session.target === null || session.target === 0)
  )
    throw new Error(
      session.target === null
        ? "Unknown capacity: choose MANUAL or UNTARGETED"
        : "No remaining fill capacity",
    );
  const phases: Record<typeof command, AcquisitionPhase> = {
    START: "CAPTURING",
    STOP: "STOPPING",
    CANCEL: "CANCELLED",
    PAUSE: "PAUSED",
    RESUME: "CAPTURING",
    COMPLETE: "COMPLETE",
  };
  return { ...structuredClone(session), phase: phases[command] };
}

// Canonical typed payload, independent of object insertion order. Arrays retain
// their meaning/order. No caller-supplied digest is trusted for event equality.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function candidateKey(runId: string, physicalId: string) {
  return JSON.stringify([runId, physicalId]);
}

export function receiveAcquisitionEvent(
  session: CaptureSession,
  value: AcquisitionEvent,
): CaptureSession {
  const event = acquisitionEventSchema.parse(value);
  if (
    event.providerId !== session.run.providerId ||
    event.runId !== session.run.runId
  )
    throw new Error("Foreign provider/run");
  const payload = canonical(event);
  const prior = session.receipts.find((r) => r.eventId === event.eventId);
  if (prior) {
    if (prior.payload !== payload) throw new Error("Event identity conflict");
    return session; // Even terminal replay neither recounts nor reopens a run.
  }
  if (!["CAPTURING", "STOPPING"].includes(session.phase))
    throw new Error("Run cannot receive new evidence");
  const next = structuredClone(session);
  for (const artifact of event.artifacts) {
    const old = next.artifacts.find((a) => a.id === artifact.id);
    if (old && old.digest !== artifact.digest)
      throw new Error("Artifact identity conflict");
    if (!old) next.artifacts.push(artifact);
  }
  for (const sighting of event.sightings) {
    const { candidate: input, observation } = sighting;
    if (!next.artifacts.some((a) => a.id === observation.artifactId))
      throw new Error("Missing artifact");
    if (new Set(input.expectedSides).size !== input.expectedSides.length)
      throw new Error("Duplicate expected side");
    const key = candidateKey(event.runId, input.id);
    let candidate = next.candidates.find((c) => c.key === key);
    if (candidate && canonical(candidate.input) !== canonical(input))
      throw new Error("Physical identity conflict");
    if (!candidate) {
      if (
        next.candidates.some(
          (c) => canonical(c.input.order) === canonical(input.order),
        )
      )
        throw new Error("Acquisition order conflict");
      candidate = {
        key,
        input,
        observations: [],
        uncertainty: [],
        revision: 0,
        excluded: false,
        countConfirmed: false,
        proposal: null,
        review: null,
      };
      next.candidates.push(candidate);
    }
    const owner = next.candidates.find((c) =>
      c.observations.some((o) => o.id === observation.id),
    );
    const old = owner?.observations.find((o) => o.id === observation.id);
    if (
      owner &&
      (owner.key !== key || canonical(old) !== canonical(observation))
    )
      throw new Error("Observation identity conflict");
    const changed =
      !old ||
      sighting.uncertainty.some((u) => !candidate.uncertainty.includes(u));
    if (!old) candidate.observations.push(observation);
    candidate.uncertainty = [
      ...new Set([...candidate.uncertainty, ...sighting.uncertainty]),
    ];
    if (changed) {
      candidate.revision++;
      candidate.countConfirmed = false;
      candidate.review = null; // Additional evidence invalidates a prior preview.
    }
  }
  next.receipts.push({ eventId: event.eventId, payload });
  return next;
}

export function countReasons(candidate: Candidate): string[] {
  if (candidate.countConfirmed) return [];
  return [
    ...(candidate.input.provisional ? ["PROVISIONAL_DETECTION"] : []),
    ...candidate.uncertainty,
    ...(candidate.input.expectedSides.some(
      (side) => !candidate.observations.some((o) => o.side === side),
    )
      ? ["MISSING_SIDE"]
      : []),
  ];
}
export function captureSummary(session: CaptureSession) {
  const ordered = session.candidates
    .filter((c) => !c.excluded)
    .sort(
      (a, b) =>
        a.input.order[0] - b.input.order[0] ||
        a.input.order[1] - b.input.order[1],
    );
  const allocated = ordered
    .slice(0, session.target ?? ordered.length)
    .map((c) => c.key);
  const overflow = ordered.slice(allocated.length).map((c) => c.key);
  const uncertain = ordered
    .filter((c) => countReasons(c).length > 0)
    .map((c) => c.key);
  return {
    physicalCandidates: ordered.length,
    confirmedCandidates: ordered.length - uncertain.length,
    uncertain,
    allocated,
    overflow,
    targetReached: session.target !== null && ordered.length >= session.target,
  };
}

function editCandidate(session: CaptureSession, key: string, revision: number) {
  const next = structuredClone(session);
  const candidate = next.candidates.find((c) => c.key === key);
  if (!candidate || candidate.excluded)
    throw new Error("Unavailable candidate");
  if (candidate.revision !== revision)
    throw new Error("Stale candidate revision");
  return { next, candidate };
}
export function correctPhysicalCount(
  session: CaptureSession,
  input: {
    candidateKey: string;
    revision: number;
    actorId: string;
    reason: string;
    action: "CONFIRM_COUNT" | "EXCLUDE_FALSE_DETECTION";
  },
): CaptureSession {
  id.parse(input.actorId);
  z.string().trim().min(1).max(1000).parse(input.reason);
  if (!["CONFIRM_COUNT", "EXCLUDE_FALSE_DETECTION"].includes(input.action))
    throw new Error("Unsupported correction");
  const { next, candidate } = editCandidate(
    session,
    input.candidateKey,
    input.revision,
  );
  if (
    input.action === "EXCLUDE_FALSE_DETECTION" &&
    candidate.input.identityKind !== "DETECTION"
  )
    throw new Error("Only a detection can be excluded as a false detection");
  candidate.excluded = input.action === "EXCLUDE_FALSE_DETECTION";
  candidate.countConfirmed = !candidate.excluded;
  candidate.review = null;
  candidate.revision++;
  next.corrections.push({ ...input, revision: candidate.revision });
  return next;
}

const attributes = z
  .object({
    cardId: id.nullable(),
    language: id.nullable(),
    finish: z.enum(["UNKNOWN", "NONFOIL", "FOIL", "ETCHED"]),
    condition: id.nullable(),
  })
  .strict();
export function recordRecognitionProposal(
  session: CaptureSession,
  key: string,
  revision: number,
  proposal: ReviewAttributes,
): CaptureSession {
  const { next, candidate } = editCandidate(session, key, revision);
  candidate.proposal = attributes.parse(proposal);
  // Recognition is evidence only; never overwrite the human review or count.
  return next;
}
export function reviewCandidate(
  session: CaptureSession,
  key: string,
  revision: number,
  actorId: string,
  decision: ReviewAttributes,
): CaptureSession {
  id.parse(actorId);
  const { next, candidate } = editCandidate(session, key, revision);
  candidate.review = { ...attributes.parse(decision), actorId };
  candidate.revision++;
  return next;
}
export function candidateCommitReadiness(session: CaptureSession, key: string) {
  const candidate = session.candidates.find((c) => c.key === key);
  const reasons: string[] = [];
  if (!candidate || candidate.excluded) reasons.push("UNAVAILABLE");
  else {
    reasons.push(...countReasons(candidate));
    if (!captureSummary(session).allocated.includes(key))
      reasons.push("OVERFLOW");
    if (!candidate.review) reasons.push("UNREVIEWED");
    else if (
      !candidate.review.cardId ||
      !candidate.review.language ||
      !candidate.review.condition ||
      candidate.review.finish === "UNKNOWN"
    )
      reasons.push("UNKNOWN_ATTRIBUTES");
  }
  if (!["COMPLETE", "CANCELLED"].includes(session.phase))
    reasons.push("ACQUISITION_NOT_SETTLED");
  return {
    readyForCommitPreview: reasons.length === 0,
    reasons,
    requiresPersistedRevalidation: true as const,
  };
}

// Deterministic source fixture, not a production provider. Each input represents
// one explicitly bounded, complete physical item; exact mode checks BEFORE feed.
export function consumeExactFixture(
  session: CaptureSession,
  inputs: AcquisitionEvent[],
) {
  if (
    session.run.enforcement !== "EXACT_BEFORE_NEXT_ITEM" ||
    session.phase !== "CAPTURING"
  )
    throw new Error("Exact capturing fixture required");
  let current = session;
  let consumed = 0;
  for (const event of inputs) {
    if (captureSummary(current).targetReached) break;
    const next = receiveAcquisitionEvent(current, event);
    const before = captureSummary(current);
    const after = captureSummary(next);
    if (
      after.physicalCandidates !== before.physicalCandidates + 1 ||
      after.uncertain.length
    )
      throw new Error(
        "Exact fixture requires one certain physical item per input",
      );
    current = next;
    consumed++;
  }
  return { session: current, unconsumed: inputs.slice(consumed) };
}
