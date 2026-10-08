export type NativeFailureReason =
  | "ABORTED" | "TIMEOUT" | "OUTPUT_LIMIT" | "INPUT_PIPE" | "SPAWN"
  | "EXIT" | "INVALID_JSON" | "PROTOCOL" | "PROGRESS_CALLBACK"
  | "SHUTDOWN" | "UNSOLICITED_OUTPUT";

export type NativeFailure = Readonly<{
  reason: NativeFailureReason;
  exitCode: number | null;
  signal: string | null;
  systemCode: string | null;
}>;
export type NativeFailureObserver = (failure: NativeFailure) => void;
const reasons = new Set<NativeFailureReason>([
  "ABORTED", "TIMEOUT", "OUTPUT_LIMIT", "INPUT_PIPE", "SPAWN", "EXIT", "INVALID_JSON",
  "PROTOCOL", "PROGRESS_CALLBACK", "SHUTDOWN", "UNSOLICITED_OUTPUT",
]);
const signals = new Set(["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGPIPE"]);
const systemCodes = new Set(["ENOENT", "EACCES", "EPERM", "EPIPE", "ENOMEM", "EMFILE", "ENFILE", "EAGAIN"]);
const failures = new WeakMap<object, NativeFailure>();

// Only locally created failures are trusted. Never project messages, stacks,
// executable paths, argv, stdin, stdout, stderr or arbitrary exception fields.
export function nativeFailureError(
  message: "Processing aborted" | "Processing native attempt failed" | "Processing native evidence invalid" | "Processing native worker stopped",
  reason: NativeFailureReason,
  exitCode: unknown = null,
  signal: unknown = null,
  systemCode: unknown = null,
  observe?: NativeFailureObserver,
) {
  const failure: NativeFailure = Object.freeze({
    reason: reasons.has(reason) ? reason : "EXIT",
    exitCode: typeof exitCode === "number" && Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null,
    signal: typeof signal === "string" && signals.has(signal) ? signal : null,
    systemCode: typeof systemCode === "string" && systemCodes.has(systemCode) ? systemCode : null,
  });
  const error = new Error(message);
  failures.set(error, failure);
  try { observe?.(failure); } catch { /* Observability cannot change child retirement or job outcome. */ }
  return error;
}

export function acquisitionNativeFailure(error: unknown): NativeFailure | undefined {
  return error !== null && (typeof error === "object" || typeof error === "function")
    ? failures.get(error) : undefined;
}

export function nativeAbortReason(signal: AbortSignal): NativeFailureReason {
  return signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "TIMEOUT" : "ABORTED";
}

export function observeNativeFailure(stage: "recognition" | "visual" | "printing"): NativeFailureObserver {
  return failure => console.error(JSON.stringify({event: "native-attempt-failed", stage, ...failure}));
}
