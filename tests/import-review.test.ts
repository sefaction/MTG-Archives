import assert from "node:assert/strict";
import test from "node:test";

import {
  filterImportReviewItems,
  getImportReviewSummary,
  isImportItemReadyToCommit,
} from "../lib/import-review";

const rows = [
  {
    id: "resolved-1",
    status: "matched",
    cardPrintingId: "card-1",
    parsedRowJson: { quantity: 2, name: "Sol Ring", setCode: "cmm" },
    rawRowJson: { Name: "Sol Ring" },
    cardPrinting: {
      name: "Sol Ring",
      setCode: "cmm",
      collectorNumber: "1",
    },
  },
  {
    id: "review-1",
    status: "ambiguous",
    cardPrintingId: null,
    parsedRowJson: {
      quantity: 1,
      name: "Island",
      setCode: "und",
      locationName: "Box-0001",
    },
    rawRowJson: { Name: "Island" },
    message: "Multiple possible printings need review.",
  },
  {
    id: "failed-1",
    status: "error",
    cardPrintingId: null,
    parsedRowJson: { quantity: 3, name: "Bad Card" },
    rawRowJson: { Name: "Bad Card" },
    message: "Quantity must be a positive integer.",
  },
  {
    id: "committed-1",
    status: "imported",
    cardPrintingId: "card-2",
    quantityImported: 4,
    parsedRowJson: { quantity: 4, name: "Command Tower" },
  },
];

test("import review summary exposes useful counts", () => {
  const summary = getImportReviewSummary(rows);

  assert.equal(summary.parsedLines, 4);
  assert.equal(summary.totalCards, 10);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.committed, 1);
  assert.equal(summary.readyToCommit, 1);
});

test("status filters isolate problem rows without rerunning resolution", () => {
  assert.deepEqual(
    filterImportReviewItems(rows, "resolved").map((row) => row.id),
    ["resolved-1"],
  );
  assert.deepEqual(
    filterImportReviewItems(rows, "needs-review").map((row) => row.id),
    ["review-1"],
  );
  assert.deepEqual(
    filterImportReviewItems(rows, "failed").map((row) => row.id),
    ["failed-1"],
  );
});

test("search matches imported names, messages, set codes, and locations", () => {
  assert.deepEqual(
    filterImportReviewItems(rows, "all", "box-0001").map((row) => row.id),
    ["review-1"],
  );
  assert.deepEqual(
    filterImportReviewItems(rows, "all", "positive integer").map(
      (row) => row.id,
    ),
    ["failed-1"],
  );
  assert.deepEqual(
    filterImportReviewItems(rows, "all", "cmm").map((row) => row.id),
    ["resolved-1"],
  );
});

test("commit eligibility excludes already committed and unresolved rows", () => {
  assert.equal(isImportItemReadyToCommit(rows[0]), true);
  assert.equal(isImportItemReadyToCommit(rows[1]), false);
  assert.equal(isImportItemReadyToCommit(rows[3]), false);
});
