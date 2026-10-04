export function requireVisibleAcquisitionBatch(row: {trashedAt: Date | null; deletedAt: Date | null}) {
  if (row.trashedAt || row.deletedAt) throw new Error("Capture batch unavailable; check the batch dashboard and Trash");
}
export function requireProcessingAcquisitionBatch(row: {cancelledAt: Date | null; trashedAt: Date | null; deletedAt: Date | null; phase: string}) {
  requireVisibleAcquisitionBatch(row);
  if (row.cancelledAt || row.phase === "CANCELLED") throw new Error("Capture batch is cancelled; resume processing from the batch dashboard");
}
