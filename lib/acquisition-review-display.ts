export type AcquisitionReviewMode = "simple" | "advanced";
export type AcquisitionReviewFilter = "all" | "awaiting" | "ready" | "added";
type Slot = {
  committed: boolean;
  physicalReadiness?: { reasons: string[] };
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
  return acquisitionReviewComplete(slot) && slot.physicalReadiness?.reasons.length === 0
    ? "ready" : "awaiting";
}

export function acquisitionReviewComplete(slot: Slot) {
  const review = slot.review;
  return Boolean(review?.cardId &&
    review.finish !== "UNKNOWN" &&
    review.condition &&
    review.language);
}

export function acquisitionSlotBlockedReason(slot: Slot): string {
  if (!acquisitionReviewComplete(slot))
    return "Complete the printing, finish, condition and language before continuing.";
  const reasons = slot.physicalReadiness?.reasons;
  if (!reasons) return "Review saved. Refresh to check physical readiness.";
  const messages: Record<string, string> = {
    UNAVAILABLE: "This physical card is unavailable.",
    COUNT_UNCERTAIN: "Confirm the physical count in reconciliation.",
    OVERFLOW: "This copy is outside the batch allocation and remains pending. Reconcile its placement before continuing.",
    ACQUISITION_NOT_SETTLED: "Stop capture before continuing.",
    PHOTO_NOT_CURRENT: "Wait for the current photo to finish uploading, or reload.",
  };
  return reasons.length ? `Review saved. ${[...new Set(reasons.map(reason => messages[reason] ?? "Refresh and reconcile this physical card before continuing."))].join(" ")}` : "";
}

export function acquisitionReviewCounts<T extends Slot>(slots: T[], hasDraft: (slot: T) => boolean = () => false) {
  const counts = { all: slots.length, awaiting: 0, ready: 0, added: 0 };
  for (const slot of slots) counts[acquisitionSlotReviewState(slot, hasDraft(slot))]++;
  return counts;
}

// Acquisition position is stable even when suggestions finish out of order.
// Navigation still seeks missing reviews, not already-reviewed physical blockers.
export function nextAwaitingAcquisitionSlot<T extends Slot & {
  position: number; photos: { ready: boolean; purgedAt: unknown }[];
}>(slots: T[], after: number, hasDraft: (slot: T) => boolean = () => false): T | null {
  const awaiting = slots.filter(slot => slot.position !== after &&
    !slot.committed && (hasDraft(slot) || !acquisitionReviewComplete(slot)) &&
    slot.photos.some(photo => photo.ready && !photo.purgedAt))
    .sort((a, b) => a.position - b.position);
  return awaiting.find(slot => slot.position > after) ?? awaiting[0] ?? null;
}
