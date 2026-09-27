import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateCommitReadiness,
  candidateKey,
  captureSummary,
  consumeExactFixture,
  correctPhysicalCount,
  countReasons,
  createCaptureSession,
  placementSnapshot,
  receiveAcquisitionEvent,
  recordRecognitionProposal,
  reviewCandidate,
  transitionCapture,
  type AcquisitionEvent,
  type Enforcement,
} from "../lib/acquisition-domain";

const snapshot = (capacity: number | null = 800, quantity = 537) =>
  placementSnapshot({
    ownerPlayerId: "owner",
    locationId: "box",
    section: "A",
    layoutRevision: "layout-1",
    storageLayout: { capacity, sections: [] },
    rows: [{ locationId: "box", section: "A", quantity }],
  });
function session(
  enforcement: Enforcement = "LOGICAL_ALLOCATION",
  quantity = 263,
) {
  return transitionCapture(
    createCaptureSession({
      id: "session",
      intent: "ADD_NEW",
      placement: snapshot(),
      policy: { kind: "MANUAL", quantity },
      run: {
        providerId: "fixture",
        runId: "run",
        enforcement,
        controls: ["STOP", "CANCEL", "PAUSE", "RESUME"],
      },
    }),
    "START",
  );
}
function event(n: number): AcquisitionEvent {
  return {
    version: 1,
    providerId: "fixture",
    runId: "run",
    eventId: `event-${n}`,
    artifacts: [{ id: `artifact-${n}`, digest: "same-image-bytes-allowed" }],
    sightings: [
      {
        candidate: {
          id: `physical-${n}`,
          identityKind: "NATIVE",
          order: [n, 0],
          expectedSides: ["FRONT"],
          provisional: false,
        },
        observation: {
          id: `observation-${n}`,
          artifactId: `artifact-${n}`,
          side: "FRONT",
        },
        uncertainty: [],
      },
    ],
  };
}
const key = (n: number) => candidateKey("run", `physical-${n}`);
const known = {
  cardId: "printing",
  language: "en",
  finish: "NONFOIL" as const,
  condition: "NM",
};

test("01 explicit duplex identity joins two artifacts, while a missing side stays uncertain", () => {
  const front = event(1);
  front.sightings[0].candidate.expectedSides = ["FRONT", "BACK"];
  let state = receiveAcquisitionEvent(session(), front);
  assert.deepEqual(countReasons(state.candidates[0]), ["MISSING_SIDE"]);
  const back = event(2);
  back.sightings[0].candidate = structuredClone(front.sightings[0].candidate);
  back.sightings[0].observation.side = "BACK";
  state = receiveAcquisitionEvent(state, back);
  assert.equal(state.artifacts.length, 2);
  assert.equal(captureSummary(state).physicalCandidates, 1);
  assert.equal(captureSummary(state).confirmedCandidates, 1);
  assert.equal(state.candidates[0].observations.length, 2);
});

test("02 one artifact yields six provisional regions; explicit correction preserves original evidence", () => {
  const photo = event(0);
  photo.sightings = Array.from({ length: 6 }, (_, n) => ({
    candidate: {
      id: `region-${n}`,
      identityKind: "DETECTION",
      order: [0, n],
      expectedSides: ["FRONT"],
      provisional: true,
    },
    observation: {
      id: `region-observation-${n}`,
      artifactId: "artifact-0",
      side: "FRONT",
    },
    uncertainty: [],
  }));
  const original = receiveAcquisitionEvent(session(), photo);
  assert.equal(original.artifacts.length, 1);
  assert.equal(captureSummary(original).physicalCandidates, 6);
  assert.equal(captureSummary(original).confirmedCandidates, 0);
  const corrected = correctPhysicalCount(original, {
    candidateKey: candidateKey("run", "region-5"),
    revision: 1,
    actorId: "reviewer",
    reason: "Region is a background rectangle",
    action: "EXCLUDE_FALSE_DETECTION",
  });
  assert.equal(captureSummary(corrected).physicalCandidates, 5);
  assert.equal(corrected.candidates.length, 6);
  assert.equal(corrected.candidates[5].observations.length, 1);
  assert.equal(corrected.corrections.length, 1);
  assert.equal(captureSummary(original).physicalCandidates, 6);
  const confirmed = correctPhysicalCount(corrected, {
    candidateKey: candidateKey("run", "region-0"),
    revision: 1,
    actorId: "reviewer",
    reason: "Physically counted this card",
    action: "CONFIRM_COUNT",
  });
  assert.equal(captureSummary(confirmed).confirmedCandidates, 1);
  assert.throws(
    () =>
      correctPhysicalCount(confirmed, {
        candidateKey: candidateKey("run", "region-0"),
        revision: 1,
        actorId: "reviewer",
        reason: "old revision",
        action: "CONFIRM_COUNT",
      }),
    /Stale/,
  );
});

test("03 repeated camera episode observations count once; identical next episode is another copy", () => {
  const first = event(0);
  first.sightings[0].candidate.identityKind = "EPISODE";
  const repeat = event(1);
  repeat.sightings[0].candidate = structuredClone(first.sightings[0].candidate);
  let state = receiveAcquisitionEvent(
    receiveAcquisitionEvent(session(), first),
    repeat,
  );
  assert.equal(captureSummary(state).physicalCandidates, 1);
  const rearmed = event(2);
  rearmed.sightings[0].candidate.identityKind = "EPISODE";
  state = receiveAcquisitionEvent(state, rearmed);
  assert.equal(captureSummary(state).physicalCandidates, 2);
  assert.equal(state.artifacts.length, 3);
});

test("04 exact event replay is harmless, conflicting payload and reused identities are rejected atomically", () => {
  const input = event(1);
  const state = receiveAcquisitionEvent(session(), input);
  assert.deepEqual(
    receiveAcquisitionEvent(state, structuredClone(input)),
    state,
  );
  const conflict = structuredClone(input);
  conflict.artifacts[0].digest = "different";
  assert.throws(
    () => receiveAcquisitionEvent(state, conflict),
    /Event identity conflict/,
  );
  const reusedArtifact = { ...conflict, eventId: "another-event" };
  assert.throws(
    () => receiveAcquisitionEvent(state, reusedArtifact),
    /Artifact identity conflict/,
  );
  const foreign = { ...event(2), runId: "foreign" };
  assert.throws(() => receiveAcquisitionEvent(state, foreign), /Foreign/);
  const badVersion = { ...event(2), version: 2 } as unknown as AcquisitionEvent;
  assert.throws(() => receiveAcquisitionEvent(state, badVersion));
  const reusedObservation = event(2);
  reusedObservation.sightings[0].observation.id = "observation-1";
  assert.throws(
    () => receiveAcquisitionEvent(state, reusedObservation),
    /Observation identity conflict/,
  );
  const reusedPhysical = event(2);
  reusedPhysical.sightings[0].candidate.id = "physical-1";
  assert.throws(
    () => receiveAcquisitionEvent(state, reusedPhysical),
    /Physical identity conflict/,
  );
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.receipts.length, 1);
  const cancelled = transitionCapture(state, "CANCEL");
  assert.equal(receiveAcquisitionEvent(cancelled, input).phase, "CANCELLED");
});

test("05 unidentified printing and UNKNOWN finish affect readiness, never physical allocation", () => {
  let state = receiveAcquisitionEvent(session(), event(147));
  const before = captureSummary(state);
  state = recordRecognitionProposal(state, key(147), 1, {
    ...known,
    cardId: null,
    finish: "UNKNOWN",
  });
  state = reviewCandidate(state, key(147), 1, "reviewer", {
    ...known,
    finish: "UNKNOWN",
  });
  state = transitionCapture(state, "COMPLETE");
  assert.deepEqual(captureSummary(state), before);
  assert.deepEqual(candidateCommitReadiness(state, key(147)).reasons, [
    "UNKNOWN_ATTRIBUTES",
  ]);
});

test("06 capacity reuses actual layouts, tighter selected bound, direct counts and null semantics", () => {
  assert.equal(snapshot().remaining, 263);
  assert.equal(snapshot(800, 800).remaining, 0);
  assert.equal(snapshot(800, 850).remaining, 0);
  assert.equal(snapshot(null).remaining, null);
  const input = {
    ownerPlayerId: "owner",
    locationId: "box",
    section: "A",
    layoutRevision: "r1",
    storageLayout: {
      capacity: 800,
      sections: [
        { name: "A", capacity: 85 },
        { name: "B", capacity: 500 },
      ],
    },
    rows: [
      { locationId: "box", section: "A", quantity: 80 },
      { locationId: "box", section: "B", quantity: 457 },
      { locationId: "child", section: "A", quantity: 999 },
    ],
    otherSessionPending: 10,
  };
  const selected = placementSnapshot(input);
  assert.equal(selected.remaining, 5);
  assert.equal(selected.committedDirect, 537);
  assert.equal(selected.committedSection, 80);
  assert.equal(selected.otherSessionPending, 10); // warning, not a reservation
  assert.equal(
    placementSnapshot({
      ...input,
      storageLayout: { ...input.storageLayout, capacity: 540 },
    }).remaining,
    3,
  );
  assert.equal(
    placementSnapshot({ ...input, section: "unconfigured" }).remaining,
    263,
  );
  assert.equal(
    placementSnapshot({
      ...input,
      section: "",
      storageLayout: { ...input.storageLayout, capacity: null },
    }).remaining,
    null,
  );
  assert.equal(
    placementSnapshot({
      ...input,
      type: "Vault",
      storageLayout: null,
      section: "Sect 0",
      rows: [],
    }).remaining,
    85,
  );
  assert.equal(
    placementSnapshot({
      ...input,
      rows: [{ locationId: "box", section: "A", quantity: 86 }],
    }).remaining,
    0,
  );
});

test("07 full fill cannot start; unknown needs explicit manual or untargeted policy", () => {
  const draft = (remaining: number | null) =>
    createCaptureSession({
      id: "session",
      intent: "ADD_NEW",
      placement: { ...snapshot(), remaining },
      policy: { kind: "FILL" },
      run: session().run,
    });
  assert.throws(() => transitionCapture(draft(0), "START"), /No remaining/);
  assert.throws(
    () => transitionCapture(draft(null), "START"),
    /MANUAL or UNTARGETED/,
  );
  const manual = createCaptureSession({
    ...draft(null),
    policy: { kind: "MANUAL", quantity: 5 },
  });
  assert.equal(transitionCapture(manual, "START").target, 5);
  const untargeted = createCaptureSession({
    ...draft(null),
    policy: { kind: "UNTARGETED" },
  });
  assert.equal(transitionCapture(untargeted, "START").target, null);
  assert.throws(() =>
    createCaptureSession({
      ...manual,
      policy: { kind: "MANUAL", quantity: 0 },
    }),
  );
});

test("08 exact 300/263 leaves 37 unconsumed; best-effort/logical retain 37 overflow", () => {
  const inputs = Array.from({ length: 300 }, (_, n) => event(n));
  const exact = consumeExactFixture(session("EXACT_BEFORE_NEXT_ITEM"), inputs);
  assert.equal(captureSummary(exact.session).physicalCandidates, 263);
  assert.equal(captureSummary(exact.session).overflow.length, 0);
  assert.equal(exact.unconsumed.length, 37);
  assert.equal(exact.unconsumed[0].eventId, "event-263");
  assert.equal(exact.session.artifacts.length, 263);
  for (const enforcement of [
    "BEST_EFFORT_STOP",
    "LOGICAL_ALLOCATION",
  ] as const) {
    const received = inputs.reduce(
      receiveAcquisitionEvent,
      session(enforcement),
    );
    const summary = captureSummary(received);
    assert.equal(summary.physicalCandidates, 300);
    assert.equal(summary.allocated.length, 263);
    assert.equal(summary.overflow.length, 37);
    assert.equal(received.artifacts.length, 300);
  }
});

test("09 acquisition/spatial allocation stays stable across reversed receipt and recognition completion", () => {
  const inputs = [event(0), event(1), event(2)];
  inputs[1].sightings[0].candidate.order = [0, 1];
  let forward = inputs.reduce(
    receiveAcquisitionEvent,
    session("LOGICAL_ALLOCATION", 2),
  );
  let reverse = [...inputs]
    .reverse()
    .reduce(receiveAcquisitionEvent, session("LOGICAL_ALLOCATION", 2));
  for (const n of [2, 1, 0])
    forward = recordRecognitionProposal(forward, key(n), 1, known);
  for (const n of [0, 1, 2])
    reverse = recordRecognitionProposal(reverse, key(n), 1, known);
  assert.deepEqual(captureSummary(forward), captureSummary(reverse));
  assert.deepEqual(captureSummary(forward).allocated, [key(0), key(1)]);
  assert.deepEqual(captureSummary(forward).overflow, [key(2)]);
});

test("10 boundary conflict and multifeed remain uncertain; exact fixture cannot claim a proven count", () => {
  for (const reason of ["BOUNDARY_CONFLICT", "MULTIFEED"] as const) {
    const input = event(1);
    input.sightings[0].uncertainty = [reason];
    const state = receiveAcquisitionEvent(session(), input);
    assert.equal(captureSummary(state).physicalCandidates, 1);
    assert.equal(captureSummary(state).confirmedCandidates, 0);
    assert.ok(countReasons(state.candidates[0]).includes(reason));
    assert.throws(
      () =>
        correctPhysicalCount(state, {
          candidateKey: key(1),
          revision: 1,
          actorId: "reviewer",
          reason: "Cannot discard an acquired item as a detector mistake",
          action: "EXCLUDE_FALSE_DETECTION",
        }),
      /Only a detection/,
    );
    assert.throws(
      () => consumeExactFixture(session("EXACT_BEFORE_NEXT_ITEM"), [input]),
      /certain physical item/,
    );
  }
});

test("11 stop drains received evidence; cancel retains pending/overflow; controls and transitions are explicit", () => {
  let state = receiveAcquisitionEvent(session("BEST_EFFORT_STOP", 1), event(0));
  state = transitionCapture(state, "STOP");
  state = receiveAcquisitionEvent(state, event(1));
  const cancelled = transitionCapture(state, "CANCEL");
  assert.deepEqual(captureSummary(cancelled), captureSummary(state));
  assert.equal(cancelled.artifacts.length, 2);
  assert.equal(captureSummary(cancelled).overflow.length, 1);
  assert.throws(
    () => receiveAcquisitionEvent(cancelled, event(2)),
    /cannot receive/,
  );
  assert.throws(
    () => transitionCapture(cancelled, "START"),
    /Invalid transition/,
  );
  assert.throws(() => transitionCapture(state, "RESUME"), /Invalid transition/);
  const noControls = { ...session(), run: { ...session().run, controls: [] } };
  assert.throws(
    () => transitionCapture(noControls, "STOP"),
    /Unsupported control/,
  );
  const paused = transitionCapture(session(), "PAUSE");
  assert.throws(
    () => receiveAcquisitionEvent(paused, event(1)),
    /cannot receive/,
  );
  assert.equal(transitionCapture(paused, "RESUME").phase, "CAPTURING");
});

test("12 recognition, review and target completion yield preview only, preserve review and require persisted revalidation", () => {
  // API contains only pure session values; there is no inventory client/commit.
  let state = receiveAcquisitionEvent(
    session("LOGICAL_ALLOCATION", 1),
    event(0),
  );
  assert.equal(captureSummary(state).targetReached, true);
  assert.equal(
    candidateCommitReadiness(state, key(0)).readyForCommitPreview,
    false,
  );
  state = recordRecognitionProposal(state, key(0), 1, known);
  assert.ok(
    candidateCommitReadiness(state, key(0)).reasons.includes("UNREVIEWED"),
  );
  state = reviewCandidate(state, key(0), 1, "reviewer", known);
  assert.equal(
    candidateCommitReadiness(state, key(0)).readyForCommitPreview,
    false,
  );
  state = recordRecognitionProposal(state, key(0), 2, {
    ...known,
    cardId: "other-printing",
  });
  assert.equal(state.candidates[0].review?.cardId, "printing");
  state = transitionCapture(state, "COMPLETE");
  assert.deepEqual(candidateCommitReadiness(state, key(0)), {
    readyForCommitPreview: true,
    reasons: [],
    requiresPersistedRevalidation: true,
  });
  assert.equal(state.placement.committedDirect, 537);
  assert.equal(captureSummary(state).physicalCandidates, 1);
  assert.throws(
    () => reviewCandidate(state, key(0), 1, "reviewer", known),
    /Stale/,
  );
});

test("raw artifact receipt can precede detection without inventing a physical count", () => {
  const raw = { ...event(0), sightings: [] };
  const received = receiveAcquisitionEvent(session(), raw);
  assert.equal(received.artifacts.length, 1);
  assert.equal(captureSummary(received).physicalCandidates, 0);
  const detected = { ...event(0), eventId: "detection", artifacts: [] };
  const state = receiveAcquisitionEvent(received, detected);
  assert.equal(state.artifacts.length, 1);
  assert.equal(captureSummary(state).physicalCandidates, 1);
  const missing = { ...event(1), artifacts: [] };
  assert.throws(
    () => receiveAcquisitionEvent(received, missing),
    /Missing artifact/,
  );
  assert.throws(
    () =>
      receiveAcquisitionEvent(received, {
        ...raw,
        eventId: "empty",
        artifacts: [],
      }),
    /Empty event/,
  );
});

test("new physical evidence invalidates prior review and count confirmation without destroying history", () => {
  let state = receiveAcquisitionEvent(session(), event(0));
  state = correctPhysicalCount(state, {
    candidateKey: key(0),
    revision: 1,
    actorId: "reviewer",
    reason: "Count checked",
    action: "CONFIRM_COUNT",
  });
  state = reviewCandidate(state, key(0), 2, "reviewer", known);
  const additional = event(1);
  additional.sightings[0].candidate = structuredClone(
    state.candidates[0].input,
  );
  additional.sightings[0].uncertainty = ["MULTIFEED"];
  const changed = receiveAcquisitionEvent(state, additional);
  assert.equal(changed.candidates[0].review, null);
  assert.equal(changed.corrections.length, 1);
  assert.deepEqual(countReasons(changed.candidates[0]), ["MULTIFEED"]);
  assert.equal(state.candidates[0].review?.cardId, "printing");
});
