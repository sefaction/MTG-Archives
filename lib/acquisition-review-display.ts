export type AcquisitionReviewMode = "simple" | "advanced";
export type AcquisitionReviewFilter = "all" | "awaiting" | "ready" | "added";
type Slot = {
  committed: boolean;
  review: {
    cardId: string | null;
    finish: string;
    condition: string | null;
    language: string | null;
  } | null;
};

export function acquisitionSlotReviewState(slot: Slot) {
  if (slot.committed) return "added";
  const review = slot.review;
  return review?.cardId &&
    review.finish !== "UNKNOWN" &&
    review.condition &&
    review.language
    ? "ready"
    : "awaiting";
}

export function acquisitionReviewCounts(slots: Slot[]) {
  const counts = { all: slots.length, awaiting: 0, ready: 0, added: 0 };
  for (const slot of slots) counts[acquisitionSlotReviewState(slot)]++;
  return counts;
}
