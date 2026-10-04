import { scannerPreflightProblemSchema, scannerUploadProblemSchema } from "./scanner-run-protocol";

export function scannerUploadMessage(value: unknown): string | null {
  const result = scannerUploadProblemSchema.safeParse(value);
  if (!result.success) return null;
  const { scope, limitBytes } = result.data;
  return `Scan-photo storage is full (${limitBytes / 1024 ** 3} GiB ${scope === "OWNER" ? "for this account" : "for this batch"}). Uploads are waiting; originals remain saved on the scanner computer. Cleanup checks completed and trashed batches every minute. If space remains full, ask an administrator to increase the allowance. The helper will retry these uploads without scanning the cards again.`;
}

export function scannerPreflightMessage(value: unknown): string | null {
  const result = scannerPreflightProblemSchema.safeParse(value);
  if (!result.success) return null;
  const messages = {
    SCANNER_UNAVAILABLE: "Scanner not available. Check its USB connection and power. The helper will retry automatically.",
    SCANNER_BUSY: "Scanner is busy. Finish the other scan or close the scanner application. The helper will retry automatically.",
    LOW_DISK_SPACE: "Not enough free space on the scanner computer to keep scan originals. Free some disk space; the helper will retry automatically.",
    STORAGE_UNAVAILABLE: "The helper cannot save scan originals on this computer. Check available disk space and folder access, then reopen the helper.",
    FEEDER_UNAVAILABLE: "The selected scanner source has no supported feeder. Cancel this waiting batch, then choose a feeder source for a new batch.",
    DRIVER_ERROR: "The scanner driver could not prepare this scan. Check USB and power, close other scanning apps, and install or repair the manufacturer's driver if needed. The helper will retry automatically.",
  };
  return messages[result.data.code];
}
