import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { checkedPrintingNative, printingReuseIdentity, reusablePrintingNative } from "../lib/acquisition-printing-reuse";

const ids = [randomUUID(), randomUUID()];
const request = {version: 1 as const, ownerPlayerId: "owner", photoDigest: "a".repeat(64),
  descriptor: "b".repeat(64), policy: "policy-v1", scryfallIds: ids};
const identity = printingReuseIdentity(request);
const native = {version: "registered-printing-runtime-v1", descriptor: request.descriptor,
  photoDigest: request.photoDigest, milliseconds: 9123, observedStamp: "UNREADABLE",
  conflictingObservations: true, automaticAcceptance: false, candidates: ids.map(id => ({
    scryfallId: id, referenceId: `${id}:0`, referenceStampState: "UNKNOWN", relation: "UNRESOLVED",
    alignment: {status: "UNREADABLE"}, stamp: {status: "UNREADABLE", reason: "REFERENCE_UNAVAILABLE"},
  }))};
const saved = {printingReuse: identity, printingNative: native};

test("printing reuse binds the exact selected region and refuses legacy whole-photo output", () => {
  const manualRegion = {version: 1 as const, quad: [[0,0],[1,0],[1,1],[0,1]] as [[number,number],[number,number],[number,number],[number,number]]};
  const selected = printingReuseIdentity({...request, manualRegion});
  assert.notEqual(selected.key, identity.key);
  assert.equal(reusablePrintingNative(saved, selected), null);
  assert.throws(() => checkedPrintingNative(native, selected), /identity/);
  const scoped = {...native, manualRegion};
  assert.deepEqual(reusablePrintingNative({printingReuse: selected, printingNative: scoped}, selected), scoped);
  assert.equal(reusablePrintingNative({printingReuse: selected, printingNative: scoped}, identity), null);
  assert.throws(() => checkedPrintingNative({...scoped, manualRegion: {...manualRegion,
    quad: [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]}}, selected), /identity/);
});

test("exact persisted native observations retain uncertainty, conflict and original inference timing", () => {
  assert.deepEqual(reusablePrintingNative(JSON.parse(JSON.stringify(saved)), identity), native);
  assert.deepEqual(checkedPrintingNative(native, identity), native);
});
test("owner, original bytes, every descriptor component, policy and ordered candidate envelope invalidate reuse", () => {
  const changes = [
    {ownerPlayerId: "other-owner"}, {photoDigest: "c".repeat(64)}, {policy: "policy-v2"},
    {scryfallIds: [...ids].reverse()}, {scryfallIds: ids.slice(0, 1)},
    {scryfallIds: [...ids, randomUUID()]}, {scryfallIds: []},
    // The native descriptor hashes runtime, registration, reference manifest,
    // index, annotations, detector policy and OpenCV identity. Any new digest
    // invalidates the observation, regardless of which component changed.
    ..."def0123".split("").map(value => ({descriptor: value.repeat(64)})),
  ];
  for (const change of changes) {
    const other = printingReuseIdentity({...request, ...change});
    assert.notEqual(other.key, identity.key);
    assert.equal(reusablePrintingNative(saved, other), null);
  }
});
test("legacy, forged, oversized, invalid or mismatched observations are conservative misses", () => {
  const invalid = [
    {printingNative: native}, {...saved, printingReuse: {...identity, key: "f".repeat(64)}},
    {...saved, printingReuse: {...identity, ownerPlayerId: "other-owner"}},
    {...saved, printingNative: {...native, descriptor: "c".repeat(64)}},
    {...saved, printingNative: {...native, photoDigest: "c".repeat(64)}},
    {...saved, printingNative: {...native, automaticAcceptance: true}},
    {...saved, printingNative: {...native, observedStamp: "ABSENT"}},
    {...saved, printingNative: {...native, milliseconds: -1}},
    {...saved, printingNative: {...native, candidates: [{...native.candidates[0], scryfallId: randomUUID()}]}},
    {...saved, extra: "x".repeat(65536)}, null,
  ];
  for (const output of invalid) assert.equal(reusablePrintingNative(output, identity), null);
  assert.throws(() => printingReuseIdentity({...request, scryfallIds: [ids[0], ids[0]]}), /Repeated/);
  assert.throws(() => printingReuseIdentity({...request, scryfallIds: Array(13).fill(ids[0])}));
});
