import type { BulkActionInput, BulkResult } from "./bulk-cleanup-policy";
// Client-safe result binding. An unexpected response must never clear an
// unresolved confirmation or authorize a new request.
export function verifiedBulkResult(value: unknown, request: BulkActionInput): BulkResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as BulkResult;
  return row.requestId === request.requestId && row.action === request.action &&
    ["APPLIED", "REJECTED"].includes(row.status) && Number.isSafeInteger(row.quantity) && row.quantity >= 0 &&
    typeof row.message === "string" && Array.isArray(row.items) ? row : null;
}
export function readPendingBulk(raw: string): BulkActionInput {
  const value = JSON.parse(raw);
  if (!value || typeof value.requestId !== "string" || !["IGNORE_SCANS", "MOVE", "GIVE", "REMOVE"].includes(value.action) || !Array.isArray(value.selected) || !value.selected.length)
    throw new Error("Invalid saved confirmation");
  return value as BulkActionInput;
}
