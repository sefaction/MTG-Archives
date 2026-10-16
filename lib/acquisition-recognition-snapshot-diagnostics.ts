type SnapshotPhase = "UNKNOWN" | "BEGIN_TRANSACTION" | "READ_PAGE" | "HASH_ROWS" | "COMMIT_TRANSACTION" | "BUILD_INDEX";
export type RecognitionSnapshotFailure = Readonly<{
  phase: SnapshotPhase;
  elapsedMs: number | null;
  phaseElapsedMs: number | null;
  transactionMs: number | null;
  completedReadMs: number | null;
  maxCompletedReadMs: number | null;
  completedHashMs: number | null;
  pagesRead: number | null;
  rowsRead: number | null;
  callbackEntered: boolean;
  transactionCompleted: boolean;
  pageSize: 512;
  maxWaitMs: 10000;
  transactionTimeoutMs: 60000;
}>;
const failures = new WeakMap<object, RecognitionSnapshotFailure>();
const phases = new Set<SnapshotPhase>(["BEGIN_TRANSACTION", "READ_PAGE", "HASH_ROWS", "COMMIT_TRANSACTION", "BUILD_INDEX"]);
const bounded = (value: unknown, maximum: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? Math.round(value) : null;

// A locally recorded failure is trusted. Never accept serialized lookalikes,
// messages, transaction IDs, cursor/card data, queries or arbitrary metadata.
export function recordRecognitionSnapshotFailure(error: unknown, input: Omit<RecognitionSnapshotFailure, "pageSize" | "maxWaitMs" | "transactionTimeoutMs">) {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return;
  try {
    failures.set(error, Object.freeze({
      phase: phases.has(input.phase) ? input.phase : "UNKNOWN",
      elapsedMs: bounded(input.elapsedMs, 86400000),
      phaseElapsedMs: bounded(input.phaseElapsedMs, 86400000),
      transactionMs: bounded(input.transactionMs, 86400000),
      completedReadMs: bounded(input.completedReadMs, 86400000),
      maxCompletedReadMs: bounded(input.maxCompletedReadMs, 86400000),
      completedHashMs: bounded(input.completedHashMs, 86400000),
      pagesRead: bounded(input.pagesRead, 1000000),
      rowsRead: bounded(input.rowsRead, 2000000),
      callbackEntered: input.callbackEntered === true,
      transactionCompleted: input.transactionCompleted === true,
      pageSize: 512, maxWaitMs: 10000, transactionTimeoutMs: 60000,
    }));
  } catch { /* Diagnostic failure cannot replace the original workflow error. */ }
}
export function recognitionSnapshotFailure(error: unknown) {
  return error !== null && (typeof error === "object" || typeof error === "function") ? failures.get(error) : undefined;
}
