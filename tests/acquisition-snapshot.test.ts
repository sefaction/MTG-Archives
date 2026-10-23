import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCaptureSnapshot } from "../scripts/ci/acquisition-snapshot";
import { createCaptureSession, placementSnapshot, receiveAcquisitionEvent, transitionCapture } from "../lib/acquisition-domain";
import type { StoredCapture } from "../lib/acquisition-store";

function fixture(): StoredCapture {
  let session = transitionCapture(createCaptureSession({
    id: "session", intent: "ADD_NEW",
    placement: placementSnapshot({ ownerPlayerId: "owner", locationId: "box", section: "A",
      layoutRevision: "layout", storageLayout: { capacity: 7, sections: [] }, rows: [] }),
    policy: { kind: "MANUAL", quantity: 7 },
    run: { providerId: "fixture", runId: "run", enforcement: "LOGICAL_ALLOCATION", controls: ["STOP"] },
  }), "START");
  for (const n of [2, 0, 1]) {
    session = receiveAcquisitionEvent(session, {
      version: 1, providerId: "fixture", runId: "run", eventId: `e${n}`,
      artifacts: [{ id: `a${n}`, digest: "same-bytes-do-not-deduplicate-copies" }],
      sightings: [{ candidate: { id: `c${n}`, identityKind: "NATIVE", order: [n, 0], expectedSides: ["FRONT"], provisional: false },
        observation: { id: `o${n}`, artifactId: `a${n}`, side: "FRONT" }, uncertainty: [] }],
    });
  }
  session = transitionCapture(session, "COMPLETE");
  // Two observations exercise nested unordered relations too.
  session.candidates[0].observations.push({ id: "o-extra", artifactId: "a2", side: "BACK" });
  return { session, defaults: { condition: "NM", finish: "NONFOIL" }, defaultsRevision: 1,
    revision: 4, batchNumber: 13, destinationCurrent: true };
}

test("reproduces raw comparison failure and accepts only relation permutations without mutation", () => {
  const saved = fixture(), untouched = structuredClone(saved);
  for (const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
    const reloaded = structuredClone(saved);
    reloaded.session.artifacts = order.map(i => reloaded.session.artifacts[i]);
    reloaded.session.candidates = order.map(i => reloaded.session.candidates[i]);
    for (const candidate of reloaded.session.candidates) candidate.observations.reverse();
    assert.throws(() => assert.deepEqual(reloaded, saved));
    assert.deepEqual(canonicalCaptureSnapshot(reloaded), canonicalCaptureSnapshot(saved));
  }
  assert.deepEqual(saved, untouched);
});

const mutations: [string, (value: StoredCapture) => void][] = [
  ["digest", v => { v.session.artifacts[0].digest = "changed"; }],
  ["missing artifact", v => { v.session.artifacts.pop(); }],
  ["duplicate artifact", v => { v.session.artifacts.push(structuredClone(v.session.artifacts[0])); }],
  ["physical order", v => { v.session.candidates[0].input.order[0] = 99; }],
  ["missing candidate", v => { v.session.candidates.pop(); }],
  ["observation linkage", v => { v.session.candidates[0].observations[0].artifactId = "a0"; }],
  ["uncertainty", v => { v.session.candidates[0].uncertainty = ["MULTIFEED"]; }],
  ["count confirmation", v => { v.session.candidates[0].countConfirmed = true; }],
  ["review", v => { v.session.candidates[0].review = { cardId: "card", finish: "NONFOIL", condition: "NM", language: "en", actorId: "actor" }; }],
  ["receipt order", v => { v.session.receipts.reverse(); }],
  ["revision", v => { v.revision++; }],
  ["target", v => { v.session.target = 6; }],
];
for (const [name, mutate] of mutations) test(`snapshot still detects changed ${name}`, () => {
  const saved = fixture(), changed = structuredClone(saved); mutate(changed);
  assert.throws(() => assert.deepEqual(canonicalCaptureSnapshot(changed), canonicalCaptureSnapshot(saved)));
});
