export const importableStatuses: string[] = [
  "matched",
  "new",
  "resolved",
  "manually_resolved",
  "changed",
];

export const finalImportStatuses = [...importableStatuses, "imported"];

export type ImportReviewFilter =
  | "all"
  | "resolved"
  | "needs-review"
  | "unresolved"
  | "failed"
  | "skipped"
  | "committed";

export const importReviewFilters: Array<{
  key: ImportReviewFilter;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "resolved", label: "Resolved" },
  { key: "needs-review", label: "Needs review" },
  { key: "unresolved", label: "Unresolved" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
  { key: "committed", label: "Committed" },
];

type ReviewItem = {
  status: string;
  cardPrintingId?: string | null;
  quantityImported?: number | null;
  parsedRowJson: unknown;
  rawRowJson?: unknown;
  message?: string | null;
  cardPrinting?: {
    name?: string | null;
    setCode?: string | null;
    collectorNumber?: string | null;
  } | null;
};

type ParsedImportRow = {
  quantity?: number;
  name?: string;
  setCode?: string;
  collectorNumber?: string;
  locationName?: string;
  warning?: string;
};

function parsedRow(item: ReviewItem) {
  return (item.parsedRowJson ?? {}) as ParsedImportRow;
}

export function isImportItemReadyToCommit(item: ReviewItem) {
  const parsed = parsedRow(item);
  return Boolean(
    item.status !== "skipped" &&
    item.status !== "imported" &&
    item.cardPrintingId &&
    importableStatuses.includes(item.status) &&
    Number.isInteger(Number(parsed.quantity)) &&
    Number(parsed.quantity) > 0,
  );
}

export function getImportReviewBucket(item: ReviewItem): ImportReviewFilter {
  if (item.status === "imported") return "committed";
  if (item.status === "skipped") return "skipped";
  if (item.status === "error") return "failed";
  if (item.status === "ambiguous" || item.status === "suggested_match")
    return "needs-review";
  if (!item.cardPrintingId || item.status === "unmatched") return "unresolved";
  if (importableStatuses.includes(item.status)) return "resolved";
  return "failed";
}

export function getImportReviewSummary(items: ReviewItem[]) {
  const counts = {
    parsedLines: items.length,
    totalCards: 0,
    readyToCommit: 0,
    resolved: 0,
    needsReview: 0,
    unresolved: 0,
    failed: 0,
    skipped: 0,
    committed: 0,
    warnings: 0,
  };

  for (const item of items) {
    const parsed = parsedRow(item);
    const quantity = Number(parsed.quantity);
    counts.totalCards +=
      Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    if (isImportItemReadyToCommit(item)) counts.readyToCommit += 1;
    if (
      item.message?.toLowerCase().includes("warning") ||
      Boolean(parsed.warning)
    )
      counts.warnings += 1;

    const bucket = getImportReviewBucket(item);
    if (bucket === "resolved") counts.resolved += 1;
    if (bucket === "needs-review") counts.needsReview += 1;
    if (bucket === "unresolved") counts.unresolved += 1;
    if (bucket === "failed") counts.failed += 1;
    if (bucket === "skipped") counts.skipped += 1;
    if (bucket === "committed") counts.committed += 1;
  }

  return counts;
}

export function rowMatchesImportReviewSearch(item: ReviewItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parsed = parsedRow(item);
  const rawText = JSON.stringify(item.rawRowJson ?? "");
  return [
    parsed.name,
    rawText,
    item.cardPrinting?.name,
    parsed.setCode,
    item.cardPrinting?.setCode,
    parsed.collectorNumber,
    item.cardPrinting?.collectorNumber,
    item.message,
    parsed.warning,
    parsed.locationName,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

export function filterImportReviewItems<T extends ReviewItem>(
  items: T[],
  filter: ImportReviewFilter,
  query = "",
) {
  return items.filter((item) => {
    if (!rowMatchesImportReviewSearch(item, query)) return false;
    if (filter === "all") return true;
    return getImportReviewBucket(item) === filter;
  });
}

export function normalizeImportReviewFilter(
  value?: string,
): ImportReviewFilter {
  return importReviewFilters.some((filter) => filter.key === value)
    ? (value as ImportReviewFilter)
    : "all";
}
