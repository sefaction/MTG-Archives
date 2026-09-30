import { z } from "zod";
import { scannerBatchSchema } from "./scanner-run-protocol";

// Per-tab, per-account pending intent. No connection secret or image is stored.
const browserRequestSchema = scannerBatchSchema.extend({ loadedCount: z.null() });
const pendingSchema = z.object({ version: z.literal(1), request: browserRequestSchema }).strict();
export type PendingScannerStart = z.infer<typeof browserRequestSchema>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const key = (userId: string) => `mtg-scanner-start-v1:${userId}`;
export function readScannerStart(storage: Storage, userId: string): PendingScannerStart | null {
  const value = storage.getItem(key(userId));
  return value === null ? null : pendingSchema.parse(JSON.parse(value)).request;
}
export function saveScannerStart(storage: Storage, userId: string, request: PendingScannerStart) {
  storage.setItem(key(userId), JSON.stringify(pendingSchema.parse({ version: 1, request })));
}
export function clearScannerStart(storage: Storage, userId: string, requestKey: string) {
  // Do not clear a newer intent from a late acknowledgement.
  if (readScannerStart(storage, userId)?.requestKey === requestKey) storage.removeItem(key(userId));
}
