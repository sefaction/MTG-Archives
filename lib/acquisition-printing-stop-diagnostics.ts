import {recognitionWorkerFailure} from "./acquisition-worker-diagnostics";

export type PrintingWorkerPhase = "PRIVILEGES" | "REFRESH_GENERATION" | "WAIT_GENERATION" | "ADMISSION" | "PROCESSING" | "IDLE_WAIT" | "SHUTDOWN_NATIVE" | "SHUTDOWN_DATABASE";
const phases = new Set<PrintingWorkerPhase>(["PRIVILEGES", "REFRESH_GENERATION", "WAIT_GENERATION", "ADMISSION", "PROCESSING", "IDLE_WAIT", "SHUTDOWN_NATIVE", "SHUTDOWN_DATABASE"]);
const boundedMilliseconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.round(value) : null;

// Reuse only the public exception projection. No OCR snapshot or arbitrary error
// properties, messages, stacks, input, query or provider data enter this record.
export function printingWorkerFailure(phase: PrintingWorkerPhase, error: unknown, elapsedMs: number, phaseElapsedMs: number) {
  const {errorKind,errorType,errorCode,systemCode,nativeFailure} = recognitionWorkerFailure("PROCESSING", error);
  return {event:"printing-worker-stopped",phase:phases.has(phase) ? phase : "UNKNOWN",
    elapsedMs:boundedMilliseconds(elapsedMs),phaseElapsedMs:boundedMilliseconds(phaseElapsedMs),
    errorKind,errorType,errorCode,systemCode,nativeFailure};
}
