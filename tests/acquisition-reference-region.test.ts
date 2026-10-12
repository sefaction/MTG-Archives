import test from "node:test";
import assert from "node:assert/strict";
import { selectAcquisitionReferenceRegion } from "../lib/acquisition-reference-region";
import { acquisitionNativeReferenceInput } from "../lib/acquisition-image-input";
import type { PrintingObservation } from "../lib/acquisition-printing";
const identity = "cfe4a22f-c945-42f4-8b3a-ac3a03ffa015";
const quad: [number, number][] = [[80, 60], [1079, 60], [1079, 1456], [80, 1456]];
const candidate = { scryfallId: identity, referenceId: identity + ":0", referenceStampState: "UNKNOWN",
  relation: "UNRESOLVED", alignment: { status: "ALIGNED", quad, matches: 100, inliers: 80,
    supportFraction: .7, medianReprojectionPixels: 1, sourceCardWidth: 999, footerVisible: true },
  stamp: { status: "UNREADABLE", reason: "NO_TEMPLATES" } } as PrintingObservation["candidates"][number];
const printing: PrintingObservation = { version: "registered-printing-runtime-v1", observedStamp: "UNREADABLE",
  conflictingObservations: false, automaticAcceptance: false, sourceSize: [1180, 1537], candidates: [candidate] };
const input = { inputKind: "CARD_SCAN" as const, geometry: { status: "PROPOSED", method: "declared-card-scan",
  quad: [[0, 0], [1179, 0], [1179, 1536], [0, 1536]] }, printing };

test("observed distributed anchors propose an original-frame region without printing labels", () => {
  const result = selectAcquisitionReferenceRegion(input);
  assert.equal(result.status, "PROPOSED");
  if (result.status !== "PROPOSED") throw Error("Expected mechanism proposal");
  assert.deepEqual(result.references, [identity + ":0"]);
  assert.equal(result.region.quad[0][0], 80 / 1179);
  const bytes = Buffer.from([255, 216, 255, 217]), framed = acquisitionNativeReferenceInput(bytes, result.region);
  const size = framed.readUInt32BE(0), metadata = JSON.parse(framed.subarray(4, 4 + size).toString());
  assert.deepEqual(metadata, { inputKind: "CARD_SCAN", referenceRegion: result.region });
  assert.deepEqual(framed.subarray(4 + size), bytes);
  assert.equal("manualRegion" in metadata, false);
});
test("physical clipping vetoes even a valid outline entirely inside the source", () => {
  assert.deepEqual(selectAcquisitionReferenceRegion({ ...input,
    geometry: { status: "NEEDS_CROP", framing: "CLIPPED" } }), { status: "REJECTED", reason: "PHYSICAL_CLIPPING" });
});
for (const [name, patch] of [
  ["too few anchors", { inliers: 15 }], ["localized art-only support", { supportFraction: .24 }],
  ["poor reprojection", { medianReprojectionPixels: 3.01 }], ["missing footer pixels", { footerVisible: false }],
  ["small source", { sourceCardWidth: 499 }], ["unavailable alignment", { status: "UNREADABLE" }],
  ["out-of-frame reference", { quad: [[-1, 60], ...quad.slice(1)] }],
] as const) test(name + " cannot supply a refinement", () => {
  const weak = { ...candidate, alignment: { ...candidate.alignment, ...patch } };
  assert.equal(selectAcquisitionReferenceRegion({ ...input,
    printing: { ...printing, candidates: [weak as typeof candidate] } }).status, "REJECTED");
});
test("wrong/shared-art reference disagreement cannot choose whichever ran first", () => {
  const other = { ...candidate, referenceId: identity + ":1", alignment: { ...candidate.alignment,
    quad: quad.map(([x, y]) => [x + 30, y] as [number, number]) } };
  assert.deepEqual(selectAcquisitionReferenceRegion({ ...input, printing: { ...printing,
    candidates: [candidate, other] } }), { status: "REJECTED", reason: "AMBIGUOUS_REFERENCE_OUTLINES" });
});
test("an already framed scan is skipped under every quarter-turn corner order", () => {
  for (let turns = 0; turns < 4; turns++) {
    const observed = [...quad.slice(turns), ...quad.slice(0, turns)];
    assert.deepEqual(selectAcquisitionReferenceRegion({ ...input, geometry: { ...input.geometry, quad: observed } }),
      { status: "REJECTED", reason: "ALREADY_FRAMED" });
  }
});
test("manual geometry, photo input and a prior refinement remain authoritative", () => {
  for (const patch of [{ inputKind: "PHOTO" as const }, { manualAnalysis: { region: null } },
    { alreadyRefined: true }, { geometry: { ...input.geometry, method: "scanner-card-edges" } },
    { geometry: { ...input.geometry, method: "reference-anchor-region-v1" } }])
    assert.equal(selectAcquisitionReferenceRegion({ ...input, ...patch }).status, "REJECTED");
});
