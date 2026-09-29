import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {scoreAcquisitionRuntime} from "../scripts/acquisition-runtime-score";

const photo = "a".repeat(64), descriptor = "b".repeat(64);
const printingId = "ed417212-eaa0-44d3-8ce3-f20b43f72d45";
const otherId = "7eab1c7c-a3fe-4c58-81c1-d6fbfbc0789c";
const manifest = Buffer.from(JSON.stringify({scope: "fixture; physical grouping unknown",
  catalogCompressedSha256: "c".repeat(64), inputKind: "CARD_SCAN", entries: [
    {file: "card.jpg", sha256: photo, category: "PLAYABLE", scryfallId: printingId, stamp: "PRESENT"},
    {file: "art.jpg", sha256: "d".repeat(64), category: "ART_CARD"},
  ]}));
const provenance = {labelHash: createHash("sha256").update(manifest).digest("hex"),
  nativeVersions: {ocr: descriptor, visual: descriptor, printing: descriptor}};
function observation() {
  const native = {descriptor, photoDigest: photo, milliseconds: 100, geometry: {method: "declared-card-scan"}};
  return {file: "card.jpg", sha256: photo, native,
    image: {...native, referenceCount: 112474, unavailableCount: 899},
    output: {printingNative: {version: "registered-printing-runtime-v1", descriptor, photoDigest: photo,
      milliseconds: 200, observedStamp: "UNREADABLE", conflictingObservations: false,
      automaticAcceptance: false, candidates: []},
      proposals: {automaticAcceptance: false, proposals: [{card: {id: "local-original"}}, {card: {id: "local-list"}}]}},
    proposedCards: [{id: "local-original", scryfallId: otherId}, {id: "local-list", scryfallId: printingId}]};
}
function records(value = observation()) {return new Map([["card.jpg", Buffer.from(JSON.stringify(value))]]);}

test("scores actual printing order, excludes art and preserves unreadable stamp uncertainty", ()=>{
  const report = scoreAcquisitionRuntime(manifest, provenance, records());
  assert.equal(report.complete, true);
  assert.equal(report.total, 1);
  assert.equal(report.excludedArtCards, 1);
  assert.equal(report.first, 0);
  assert.equal(report.offered, 1);
  assert.equal(report.results[0].rank, 2);
  assert.equal(report.stamps.PRESENT.unreadable, 1);
  assert.deepEqual(report.stamps.PRESENT.wrong, []);
  assert.equal(report.proposalAutomaticAcceptances, 0);
  assert.equal(report.nativeTimingMilliseconds.printing.mean, 200);
  const exported = JSON.stringify(report);
  assert(!exported.includes("local-list"), "private local identity is omitted");
  assert(!exported.includes('"native":'), "raw observations are omitted");
});
test("partial results cannot masquerade as completed accuracy", ()=>{
  assert.throws(()=>scoreAcquisitionRuntime(manifest, provenance, new Map()), /incomplete/);
  const report = scoreAcquisitionRuntime(manifest, provenance, new Map(), true);
  assert.equal(report.complete, false);
  assert.equal(report.scored, 0);
  assert.deepEqual(report.pending, ["card.jpg"]);
  assert.equal(report.nativeTimingMilliseconds.ocr.mean, null);
});
test("rejects changed truth, native generation, photo bytes and lost full-frame mode", ()=>{
  assert.throws(()=>scoreAcquisitionRuntime(manifest, {...provenance, labelHash: "f".repeat(64)}, records()), /labels changed/);
  const changed = observation(); changed.native.descriptor = "e".repeat(64);
  assert.throws(()=>scoreAcquisitionRuntime(manifest, provenance, records(changed)), /generation differs/);
  const photoChanged = observation(); photoChanged.image.photoDigest = "e".repeat(64);
  assert.throws(()=>scoreAcquisitionRuntime(manifest, provenance, records(photoChanged)), /different photo/);
  const cropped = observation(); cropped.native.geometry.method = "contours";
  assert.throws(()=>scoreAcquisitionRuntime(manifest, provenance, records(cropped)), /full frame/);
});
test("rejects reordered identity mapping and duplicate dependent bytes", ()=>{
  const changed = observation(); changed.proposedCards.reverse();
  assert.throws(()=>scoreAcquisitionRuntime(manifest, provenance, records(changed)), /mapping differs/);
  const truth = JSON.parse(manifest.toString());truth.entries[1].sha256 = photo;
  const duplicate = Buffer.from(JSON.stringify(truth));
  assert.throws(()=>scoreAcquisitionRuntime(duplicate,
    {...provenance, labelHash: createHash("sha256").update(duplicate).digest("hex")}, records()), /Duplicate sample/);
});
