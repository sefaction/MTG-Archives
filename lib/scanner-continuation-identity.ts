import {createHash} from "node:crypto";

/** Stable across transaction rollback, finish retry and database restoration.
 * A fresh random ID could bypass the older feed's durable START/retirement file. */
export function scannerContinuationRunId(previousRunId: string, offset: number) {
  const bytes = createHash("sha256").update("mtg-scanner-continuation-v1\0")
    .update(previousRunId).update("\0" + offset).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
