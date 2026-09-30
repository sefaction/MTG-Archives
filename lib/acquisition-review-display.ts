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

export function acquisitionSlotReviewState(slot: Slot, hasDraft = false) {
  if (slot.committed) return "added";
  if (hasDraft) return "awaiting";
  const review = slot.review;
  return review?.cardId &&
    review.finish !== "UNKNOWN" &&
    review.condition &&
    review.language
    ? "ready"
    : "awaiting";
}

export function acquisitionReviewCounts<T extends Slot>(slots: T[], hasDraft: (slot: T) => boolean = () => false) {
  const counts = { all: slots.length, awaiting: 0, ready: 0, added: 0 };
  for (const slot of slots) counts[acquisitionSlotReviewState(slot, hasDraft(slot))]++;
  return counts;
}

// Acquisition position is stable even when suggestions finish out of order.
// Awaiting means an explicit saved review is missing, not inferred confidence.
export function nextAwaitingAcquisitionSlot<T extends Slot & {
  position: number; photos: { ready: boolean; purgedAt: unknown }[];
}>(slots: T[], after: number, hasDraft: (slot: T) => boolean = () => false): T | null {
  const awaiting = slots.filter(slot => slot.position !== after &&
    acquisitionSlotReviewState(slot, hasDraft(slot)) === "awaiting" &&
    slot.photos.some(photo => photo.ready && !photo.purgedAt))
    .sort((a, b) => a.position - b.position);
  return awaiting.find(slot => slot.position > after) ?? awaiting[0] ?? null;
}
