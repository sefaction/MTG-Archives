import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { markedPullSelection } from "../lib/pull-selection";
import { bulkActionInput, bulkGroupKey } from "../lib/bulk-cleanup-policy";
import {
  readPendingBulk,
  verifiedBulkResult,
} from "../lib/bulk-cleanup-pending";
test("marked quantities include off-page copies, never the unpulled remainder", () => {
  assert.deepEqual(
    markedPullSelection([
      { id: "first-page", quantity: 7, pulled: 2 },
      { id: "other-page", quantity: 4, pulled: 4 },
      { id: "unmarked", quantity: 5 },
    ]),
    { "first-page": 2, "other-page": 4 },
  );
  assert.deepEqual(
    markedPullSelection([
      { id: "moved", quantity: 0, pulled: 3 },
      { id: "remaining", quantity: 2, pulled: 3 },
    ]),
    { remaining: 2 },
  );
});
test("scan diversion freezes one copy per scan and one explicit owned destination", () => {
  const request = {
    action: "MOVE_SCANS",
    requestId: randomUUID(),
    policyStamp: "a".repeat(64),
    batchId: "batch",
    destinationId: "bulk",
    destinationSection: "0",
    selected: [
      {
        id: randomUUID(),
        quantity: 1,
        stamp: "b".repeat(64),
        group: bulkGroupKey("printing", "NONFOIL", "EN"),
        groupStamp: "c".repeat(64),
      },
    ],
  };
  assert(bulkActionInput.safeParse(request).success);
  for (const bad of [
    { ...request, destinationId: undefined },
    { ...request, scope: {} },
    { ...request, selected: [{ ...request.selected[0], quantity: 2 }] },
    { ...request, selected: [request.selected[0], request.selected[0]] },
    { ...request, ownerId: "someone-else" },
  ])
    assert(!bulkActionInput.safeParse(bad).success);
  assert.deepEqual(readPendingBulk(JSON.stringify(request)), request);
  assert(
    verifiedBulkResult(
      {
        ...request,
        status: "APPLIED",
        quantity: 1,
        message: "Added",
        items: [],
      },
      bulkActionInput.parse(request),
    ),
  );
  assert.equal(
    verifiedBulkResult(
      {
        ...request,
        action: "IGNORE_SCANS",
        status: "APPLIED",
        quantity: 1,
        message: "Ignored",
        items: [],
      },
      bulkActionInput.parse(request),
    ),
    null,
  );
});
