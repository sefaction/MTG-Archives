import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionReviewCounts,
  acquisitionSlotReviewState,
  acquisitionSlotBlockedReason,
} from "../lib/acquisition-review-display";

test("review totals distinguish incomplete/pending choices from Inventory-ready and committed copies", () => {
  const review = {
    cardId: "printing",
    finish: "NONFOIL",
    condition: "NM",
    language: "en",
  };
  const slots = [
    { committed: false, review: null },
    { committed: false, review: { ...review, cardId: null } },
    { committed: false, review: { ...review, finish: "UNKNOWN" } },
    { committed: false, review: { ...review, condition: null } },
    { committed: false, review: { ...review, language: null } },
    { committed: false, review },
    { committed: true, review },
  ].map(slot => ({ ...slot, physicalReadiness: { reasons: [] as string[] } }));
  assert.deepEqual(acquisitionReviewCounts(slots), {
    all: 7,
    awaiting: 5,
    ready: 1,
    added: 1,
  });
  const batch = Array.from({ length: 1000 }, (_, i) => ({
    committed: false,
    review: i % 3 ? null : review,
    physicalReadiness: { reasons: [] },
  }));
  assert.equal(acquisitionReviewCounts(batch).ready, 334);
  assert.deepEqual(acquisitionReviewCounts(slots, slot => Boolean(slot.review?.cardId)), {
    all: 7, awaiting: 6, ready: 0, added: 1,
  });
  assert.equal(
    batch.filter((s) => acquisitionSlotReviewState(s) === "ready").slice(0, 12)
      .length,
    12,
  );
});

test("accepted reviews remain pending for physical blockers and become ready after reconciliation", () => {
  const review = { cardId: "printing", finish: "NONFOIL", condition: "NM", language: "en" };
  for (const reason of ["COUNT_UNCERTAIN", "OVERFLOW", "ACQUISITION_NOT_SETTLED", "PHOTO_NOT_CURRENT", "UNAVAILABLE"]) {
    const slot = { committed: false, review, physicalReadiness: { reasons: [reason] } };
    assert.equal(acquisitionSlotReviewState(slot), "awaiting");
    assert.match(acquisitionSlotBlockedReason(slot), /^Review saved\./);
    assert.doesNotMatch(acquisitionSlotBlockedReason(slot), /Complete the printing/);
    assert.deepEqual(acquisitionReviewCounts([slot]), { all: 1, awaiting: 1, ready: 0, added: 0 });
    const reloaded = JSON.parse(JSON.stringify(slot));
    assert.equal(acquisitionSlotReviewState(reloaded), "awaiting");
    reloaded.physicalReadiness.reasons = [];
    assert.equal(acquisitionSlotReviewState(reloaded), "ready");
    assert.deepEqual(reloaded.review, review);
    assert.equal(acquisitionSlotReviewState(reloaded, true), "awaiting");
    assert.equal(acquisitionSlotReviewState({ ...slot, committed: true }), "added");
  }
  assert.equal(acquisitionSlotReviewState({ committed: false, review }), "awaiting");
  assert.match(acquisitionSlotBlockedReason({ committed: false, review }), /Refresh/);
});
