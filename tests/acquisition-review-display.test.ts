import test from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionReviewCounts,
  acquisitionSlotReviewState,
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
  ];
  assert.deepEqual(acquisitionReviewCounts(slots), {
    all: 7,
    awaiting: 5,
    ready: 1,
    added: 1,
  });
  const batch = Array.from({ length: 1000 }, (_, i) => ({
    committed: false,
    review: i % 3 ? null : review,
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
