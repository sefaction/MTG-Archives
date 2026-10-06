import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionNativePhotoInput } from "../lib/acquisition-image-input";
import { acquisitionManualRegionSchema, validateAcquisitionManualRegionFrame } from "../lib/acquisition-manual-region";

const region = { version: 1 as const, quad: [[.1, .1], [.9, .1], [.9, .9], [.1, .9]] as
  [[number, number], [number, number], [number, number], [number, number]] };

test("manual hint preserves exact original bytes and normalized source coordinates", () => {
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
  for (const kind of ["PHOTO", "CARD_SCAN"] as const) {
    const framed = acquisitionNativePhotoInput(bytes, kind, undefined, region), length = framed.readUInt32BE(0);
    assert.deepEqual(JSON.parse(framed.subarray(4, length + 4).toString()), { inputKind: kind, manualRegion: region });
    assert.deepEqual(framed.subarray(length + 4), bytes);
  }
  assert.throws(() => acquisitionNativePhotoInput(bytes, "PHOTO", "WHOLE_PHOTO_TEXT", region), /explicit card region/);
  assert.deepEqual(validateAcquisitionManualRegionFrame(region, 630, 880), region);
});

test("crossed, duplicate, concave and unbounded corners cannot become a saved region", () => {
  for (const quad of [[[0, 0], [1, 1], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 0], [0, 1]],
    [[0, 0], [1, 0], [.3, .3], [0, 1]], [[0, 0], [1, 0], [1, 1]]])
    assert(!acquisitionManualRegionSchema.safeParse({ ...region, quad }).success);
  for (const value of [-.01, 1.01, NaN, Infinity, true, "0"])
    assert(!acquisitionManualRegionSchema.safeParse({ ...region, quad: [[value, 0], [1, 0], [1, 1], [0, 1]] }).success);
  assert(!acquisitionManualRegionSchema.safeParse({ ...region, version: true }).success);
  assert(!acquisitionManualRegionSchema.safeParse({ ...region, path: "untrusted" }).success);
  assert.throws(() => validateAcquisitionManualRegionFrame(region, 30, 30), /too small/);
  assert.throws(() => validateAcquisitionManualRegionFrame(region, 10000, 10000), /dimensions/);
});
