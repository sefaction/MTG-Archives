/** Internal work sizes, never a cap on retained scans or a new user batch. */
export const SCANNER_FEED_CHUNK = 500;
export const ACQUISITION_REVIEW_PAGE = 100;

export function scannerFeedTarget(target: number | null, offset = 0) {
  return target === null ? SCANNER_FEED_CHUNK : Math.min(SCANNER_FEED_CHUNK, Math.max(0, target - offset));
}

export function acquisitionReviewPage(value: unknown = 0) {
  const page = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0 || page > Math.floor(2147483647 / ACQUISITION_REVIEW_PAGE))
    throw new Error("Choose a valid saved-card page");
  return page;
}
