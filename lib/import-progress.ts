export type ImportProgressCounts = {
  total: number;
  processed: number;
  matched: number;
  needsReview: number;
  skipped: number;
  failed: number;
  percent: number;
  terminal: boolean;
  statusLabel: string;
};

const terminalBatchStatuses = new Set([
  "IMPORTED",
  "IMPORTED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "UNDONE",
]);
const readyStatuses = new Set([
  "matched",
  "new",
  "resolved",
  "manually_resolved",
  "changed",
  "imported",
]);
const reviewStatuses = new Set([
  "unmatched",
  "ambiguous",
  "suggested_match",
  "not_found",
]);
const failedStatuses = new Set(["error", "cannot_undo"]);

export function calculateImportProgress(input: {
  batchStatus: string;
  itemStatuses: string[];
}): ImportProgressCounts {
  const total = input.itemStatuses.length;
  const matched = input.itemStatuses.filter((status) =>
    readyStatuses.has(status),
  ).length;
  const skipped = input.itemStatuses.filter(
    (status) => status === "skipped",
  ).length;
  const failed = input.itemStatuses.filter((status) =>
    failedStatuses.has(status),
  ).length;
  const needsReview = input.itemStatuses.filter((status) =>
    reviewStatuses.has(status),
  ).length;
  const processed = Math.min(total, matched + skipped + failed + needsReview);
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const terminal =
    terminalBatchStatuses.has(input.batchStatus) ||
    (total > 0 && processed >= total && input.batchStatus !== "RUNNING");
  const statusLabel = terminal
    ? "Identification complete"
    : total > 0
      ? `Processing ${processed} of ${total}`
      : "Preparing card identification";
  return {
    total,
    processed,
    matched,
    needsReview,
    skipped,
    failed,
    percent,
    terminal,
    statusLabel,
  };
}
