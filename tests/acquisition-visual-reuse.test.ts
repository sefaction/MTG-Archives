import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { checkedVisualNative, visualReuseIdentity, reusableVisualNative } from "../lib/acquisition-visual-reuse";

const request = {version: 1 as const, ownerPlayerId: "owner", photoDigest: "a".repeat(64),
  descriptor: "b".repeat(64), inputKind: "CARD_SCAN" as const};
const identity = visualReuseIdentity(request);
const candidate = {scryfallId: randomUUID(), referenceId: "face:0", name: "Fixture", setCode: "war",
  collectorNumber: "14", distance: .3, rotationDegrees: 270};
const visual = {version: 1, descriptor: request.descriptor, photoDigest: request.photoDigest,
  referenceCount: 100000, unavailableCount: 400, geometry: {status: "NEEDS_CROP"},
  inputRegion: "WHOLE_PHOTO", milliseconds: 8123, automaticAcceptance: false,
  candidates: [candidate], geometricCandidates: [{...candidate, inliers: 0}]};
const saved = {visualReuse: identity, visual};

test("a selected boundary cannot reuse whole-photo evidence or a different boundary", () => {
  const manualRegion = {version: 1 as const, quad: [[0,0],[1,0],[1,1],[0,1]] as [[number,number],[number,number],[number,number],[number,number]]};
  const selected = visualReuseIdentity({...request, manualRegion});
  assert.notEqual(selected.key, identity.key);
  assert.equal(reusableVisualNative(saved, selected), null);
  assert.throws(() => checkedVisualNative(visual, selected), /identity/);
  const scoped = {...visual, geometry: {status: "PROPOSED", manualRegion}};
  assert.deepEqual(reusableVisualNative({visualReuse: selected, visual: scoped}, selected), scoped);
  assert.equal(reusableVisualNative({visualReuse: selected, visual: scoped}, identity), null);
  assert.throws(() => checkedVisualNative({...scoped, geometry: {status: "PROPOSED", manualRegion: {...manualRegion,
    quad: [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]}}}, selected), /identity/);
});

test("visual reuse preserves native candidate orders, unavailable coverage, uncertainty and original timing", () => {
  assert.deepEqual(checkedVisualNative(visual, identity), visual);
  assert.deepEqual(reusableVisualNative(JSON.parse(JSON.stringify(saved)), identity), visual);
});
test("owner, byte digest, full native generation and declared input kind independently invalidate visual reuse", () => {
  for (const change of [{ownerPlayerId: "other"}, {photoDigest: "c".repeat(64)},
    {descriptor: "d".repeat(64)}, {inputKind: "PHOTO" as const}]) {
    const other = visualReuseIdentity({...request, ...change});
    assert.notEqual(other.key, identity.key);
    assert.equal(reusableVisualNative(saved, other), null);
  }
});
test("legacy, forged, oversized and invalid visual observations miss conservatively", () => {
  for (const output of [null, {visual}, {...saved, visualReuse: {...identity, key: "f".repeat(64)}},
    {...saved, visualReuse: {...identity, inputKind: "PHOTO"}},
    {...saved, visual: {...visual, descriptor: "c".repeat(64)}},
    {...saved, visual: {...visual, photoDigest: "c".repeat(64)}},
    {...saved, visual: {...visual, automaticAcceptance: true}},
    {...saved, visual: {...visual, milliseconds: -1}},
    {...saved, visual: {...visual, candidates: Array(13).fill(candidate)}},
    {...saved, extra: "x".repeat(65536)}]) {
    assert.equal(reusableVisualNative(output, identity), null);
  }
});
