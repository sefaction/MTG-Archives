import { z } from "zod";
import { handoffInput } from "./card-handoff-policy";

export const BULK_BOX_TYPE = "Bulk cleanup";
export const bulkSettingsInput = z.object({
  action: z.literal("SETTINGS"), enabled: z.boolean(),
  maxCopies: z.number().int().min(0).max(1_000_000), includeDecks: z.boolean(),
  revision: z.number().int().nonnegative(),
}).strict();
const identity = z.string().min(1).max(200);
const stamp = z.string().regex(/^[a-f0-9]{64}$/);
const group = z.string().max(500).refine(value => {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) && parsed.length === 3 && parsed.every(part => typeof part === "string" && part.length > 0 && part.length <= 200); } catch { return false; }
}, "Reload the pull list before selecting cards.");
const selection = z.object({ id: identity, quantity: z.number().int().positive().max(2147483647), stamp, group, groupStamp: stamp }).strict();
const base = { requestId: z.string().uuid(), policyStamp: stamp, selected: z.array(selection).min(1).max(500) };
export const bulkActionInput = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("IGNORE_SCANS"), batchId: identity }).strict(),
  z.object({ ...base, action: z.literal("REMOVE") }).strict(),
  z.object({ ...base, action: z.literal("MOVE"), boxName: z.string().trim().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a box name without control characters") }).strict(),
  z.object({ ...base, action: z.literal("GIVE"), kind: handoffInput.shape.kind, recipient: handoffInput.shape.recipient }).strict(),
]).superRefine((input, ctx) => {
  if (new Set(input.selected.map(row => row.id)).size !== input.selected.length)
    ctx.addIssue({ code: "custom", message: "Select each copy/lot only once." });
  if (input.action === "IGNORE_SCANS" && input.selected.some(row => row.quantity !== 1))
    ctx.addIssue({ code: "custom", message: "Each scan represents one physical card." });
});
export type BulkActionInput = z.infer<typeof bulkActionInput>;
export type BulkSettings = { enabled: boolean; maxCopies: number; includeDecks: boolean; revision: number; stamp: string };
export type BulkItem = {
  id: string; group: string; groupStamp: string; stamp: string; quantity: number;
  name: string; setCode: string; collectorNumber: string; finish: string; language: string; condition: string;
  location: string; section: string | null; imageUri: string | null;
  owned: number; deckCopies: number; existingExcess: number; pendingKept: number;
  position?: number; batchNumber?: number;
};
export type BulkPlan = { items: BulkItem[]; totalItems: number; totalCopies: number; page: number; pages: number; groups: number; protectedCopies: number };
export type BulkResult = { requestId: string; action: BulkActionInput["action"]; status: "APPLIED" | "REJECTED"; message: string; quantity: number; items: Array<Pick<BulkItem, "name" | "setCode" | "collectorNumber" | "quantity" | "finish" | "language">>; replay?: boolean; destination?: string };
export type BulkContext = { actorId: string; enabled: boolean; settings: BulkSettings; plan?: BulkPlan; history?: Array<{ id: string; createdAt: string; result: BulkResult }>; recipients?: Array<{ id: string; name: string }> };

export const bulkGroupKey = (cardId: string, finish: string, language: string) => JSON.stringify([cardId, finish, language.trim().toUpperCase()]);
export function excessCounts(loose: number, deck: number, max: number, includeDecks: boolean) {
  const counted = loose + (includeDecks ? deck : 0);
  return { counted, existingExcess: Math.max(0, counted - max), scanAllowance: Math.max(0, max - counted) };
}
export const excessScan = (pendingPosition: number, allowance: number) => pendingPosition > allowance;
