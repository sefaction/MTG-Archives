import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { bulkSettingsInput, bulkActionInput, bulkGroupKey, excessCounts, excessScan } from "../lib/bulk-cleanup-policy";
import { verifiedBulkResult, readPendingBulk } from "../lib/bulk-cleanup-pending";
const base = { requestId: randomUUID(), policyStamp: "a".repeat(64), action: "REMOVE" as const,
  selected: [{ id: "lot", group: bulkGroupKey("card", "NONFOIL", "EN"), groupStamp: "b".repeat(64), stamp: "c".repeat(64), quantity: 2 }] };
test("deck toggle changes the allowance without making decks pullable", () => {
  assert.deepEqual(excessCounts(3, 4, 4, false), { counted: 3, existingExcess: 0, scanAllowance: 1 });
  assert.deepEqual(excessCounts(3, 4, 4, true), { counted: 7, existingExcess: 3, scanAllowance: 0 });
  assert.equal(excessScan(1, 1), false); assert.equal(excessScan(2, 1), true);
  assert.equal(excessCounts(0, 0, 0, false).scanAllowance, 0);
});
test("printing, finish and normalized language form independent limits", () => {
  assert.equal(bulkGroupKey("one", "FOIL", " en "), bulkGroupKey("one", "FOIL", "EN"));
  assert.notEqual(bulkGroupKey("one", "FOIL", "EN"), bulkGroupKey("one", "NONFOIL", "EN"));
  assert.notEqual(bulkGroupKey("one", "FOIL", "EN"), bulkGroupKey("two", "FOIL", "EN"));
  assert.notEqual(bulkGroupKey("one", "FOIL", "EN"), bulkGroupKey("one", "FOIL", "JA"));
});
test("settings reject impossible limits and client owner overrides", () => {
  const value = { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 };
  assert.ok(bulkSettingsInput.safeParse(value).success);
  for (const maxCopies of [-1, 0.5, 1000001, Infinity]) assert.equal(bulkSettingsInput.safeParse({ ...value, maxCopies }).success, false);
  assert.equal(bulkSettingsInput.safeParse({ ...value, ownerId: "foreign" }).success, false);
});
test("confirmation rejects duplicate lots, malformed groups and multi-copy scans", () => {
  assert.ok(bulkActionInput.safeParse(base).success);
  assert.equal(bulkActionInput.safeParse({ ...base, selected: [base.selected[0], base.selected[0]] }).success, false);
  assert.equal(bulkActionInput.safeParse({ ...base, selected: [{ ...base.selected[0], group: "{}" }] }).success, false);
  assert.equal(bulkActionInput.safeParse({ ...base, action: "IGNORE_SCANS", batchId: "batch" }).success, false);
  assert.equal(bulkActionInput.safeParse({ ...base, playerId: "foreign" }).success, false);
});
test("only a response bound to the frozen request clears recovery", () => {
  const result = { requestId: base.requestId, action: "REMOVE", status: "APPLIED", quantity: 2, message: "Removed", items: [] };
  assert.ok(verifiedBulkResult(result, base));
  assert.equal(verifiedBulkResult({ ...result, requestId: randomUUID() }, base), null);
  assert.equal(verifiedBulkResult({ ...result, action: "GIVE" }, base), null);
  assert.equal(verifiedBulkResult({ ...result, status: "UNKNOWN" }, base), null);
  assert.deepEqual(readPendingBulk(JSON.stringify(base)), base);
  assert.throws(() => readPendingBulk("{}"));
});
