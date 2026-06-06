import test from "node:test";
import assert from "node:assert/strict";
import { calculateImportProgress } from "../lib/import-progress";

test("card-identification progress uses actual processed counts", () => {
  const progress = calculateImportProgress({
    batchStatus: "PREVIEW",
    itemStatuses: [
      "matched",
      "new",
      "unmatched",
      "ambiguous",
      "skipped",
      "error",
    ],
  });

  assert.equal(progress.total, 6);
  assert.equal(progress.processed, 6);
  assert.equal(progress.matched, 2);
  assert.equal(progress.needsReview, 2);
  assert.equal(progress.skipped, 1);
  assert.equal(progress.failed, 1);
  assert.equal(progress.percent, 100);
});

test("completed import progress is terminal and should stop polling", () => {
  const progress = calculateImportProgress({
    batchStatus: "IMPORTED",
    itemStatuses: ["imported", "imported"],
  });

  assert.equal(progress.terminal, true);
  assert.equal(progress.statusLabel, "Identification complete");
});

test("running import progress is not fake when no rows exist yet", () => {
  const progress = calculateImportProgress({
    batchStatus: "RUNNING",
    itemStatuses: [],
  });

  assert.equal(progress.total, 0);
  assert.equal(progress.processed, 0);
  assert.equal(progress.percent, 0);
  assert.equal(progress.terminal, false);
  assert.equal(progress.statusLabel, "Preparing card identification");
});
