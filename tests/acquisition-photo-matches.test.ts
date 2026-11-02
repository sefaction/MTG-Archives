import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPhotoMatchCounts } from "../lib/acquisition-photo-matches";

function slot(id: string, digest = "a".repeat(64), bytes = 100) {
  return { id, generation: 1, photos: [{ generation: 1, ready: true,
    purgedAt: null as string | null, digest, bytes }] };
}

test("matching files warn for separate physical slots without changing their identities or order", () => {
  const slots = [slot("second"), slot("first"), slot("different", "b".repeat(64))];
  const before = JSON.stringify(slots);
  assert.deepEqual([...acquisitionPhotoMatchCounts(slots)], [["second", 2], ["first", 2]]);
  assert.equal(JSON.stringify(slots), before);
  assert.equal(slots.length, 3);
});

test("same physical slot or transport replay does not create a duplicate warning", () => {
  const one = slot("one");
  one.photos.push({ ...one.photos[0] });
  assert.deepEqual([...acquisitionPhotoMatchCounts([one, one])], []);
});

test("only the current durable unpurged generation participates, including identical retakes", () => {
  const retake = slot("retake");
  retake.generation = 2;
  retake.photos.unshift({ ...retake.photos[0], generation: 2, digest: "b".repeat(64) });
  assert.deepEqual([...acquisitionPhotoMatchCounts([retake, slot("other")])], []);
  retake.photos[0].digest = "a".repeat(64);
  assert.deepEqual([...acquisitionPhotoMatchCounts([retake, slot("other")])], [["retake", 2], ["other", 2]]);
  retake.photos[0].ready = false;
  assert.deepEqual([...acquisitionPhotoMatchCounts([retake, slot("other")])], []);
  retake.photos[0].ready = true;
  retake.photos[0].purgedAt = new Date().toISOString();
  assert.deepEqual([...acquisitionPhotoMatchCounts([retake, slot("other")])], []);
});

test("a match beyond the first visible page is counted across the complete batch", () => {
  const slots = Array.from({ length: 300 }, (_, i) => slot(`card-${i}`, i.toString(16).padStart(64, "0")));
  slots[299].photos[0].digest = slots[0].photos[0].digest;
  assert.deepEqual([...acquisitionPhotoMatchCounts(slots)], [["card-0", 2], ["card-299", 2]]);
});

test("separate supplied batches cannot retain matches from a previous calculation", () => {
  const matches = acquisitionPhotoMatchCounts([slot("one"), slot("two"), slot("three")]);
  assert.equal(matches.get("one"), 3);
  assert.deepEqual([...acquisitionPhotoMatchCounts([slot("new-batch")])], []);
  assert.deepEqual([...acquisitionPhotoMatchCounts([])], []);
});

test("missing or inconsistent file identity is not used to infer matching photos", () => {
  for (const digest of ["", "invalid", "A".repeat(64)]) {
    assert.deepEqual([...acquisitionPhotoMatchCounts([slot("one", digest), slot("two", digest)])], []);
  }
  for (const bytes of [0, -1, NaN, Infinity, 1.5]) {
    assert.deepEqual([...acquisitionPhotoMatchCounts([slot("one", undefined, bytes), slot("two", undefined, bytes)])], []);
  }
  assert.deepEqual([...acquisitionPhotoMatchCounts([slot("one"), slot("two", undefined, 101)])], []);
});
