import {acquisitionNativeFailure} from "./acquisition-native-failure";

export type CatalogWorkerPhase = "ADMISSION" | "PROCESSING" | "AUTO_CONFIRM";

// No exception message, stack, query, input, account or provider payload leaves
// this projection. Known Prisma codes are bounded public diagnostic identifiers.
export function catalogWorkerFailure(phase: CatalogWorkerPhase, error: unknown) {
  let errorCode = "UNKNOWN";
  try {
    if (error && typeof error === "object") {
      for (const key of ["code", "errorCode"] as const) {
        const value = (error as Record<string, unknown>)[key];
        if (typeof value === "string" && /^P\d{4}$/.test(value)) {
          errorCode = value;
          break;
        }
      }
    }
  } catch { /* Malformed exceptions still produce a private, bounded record. */ }
  return {event: "catalog-worker-stopped", phase, errorCode};
}

export type RecognitionWorkerPhase =
  | "PRIVILEGES" | "DESCRIBE_MODEL" | "LOAD_CATALOG" | "PREPARE_NATIVE"
  | "REFRESH_CATALOG" | "ADMISSION" | "REFERENCE_ADMISSION" | "PROCESSING"
  | "IDLE_WAIT" | "SHUTDOWN_NATIVE" | "SHUTDOWN_DATABASE";

const recognitionPhases = new Set<RecognitionWorkerPhase>([
  "PRIVILEGES", "DESCRIBE_MODEL", "LOAD_CATALOG", "PREPARE_NATIVE", "REFRESH_CATALOG",
  "ADMISSION", "REFERENCE_ADMISSION", "PROCESSING", "IDLE_WAIT", "SHUTDOWN_NATIVE", "SHUTDOWN_DATABASE",
]);
const recognitionSystemCodes = new Set([
  "ENOENT", "EACCES", "EPERM", "EPIPE", "ENOMEM", "EMFILE", "ENFILE", "EAGAIN", "ECONNREFUSED", "ETIMEDOUT",
]);
const recognitionErrorTypes = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "ZodError", "TimeoutError", "AbortError",
  "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError",
  "PrismaClientValidationError", "PrismaClientRustPanicError",
]);
export function recognitionWorkerFailure(phase: RecognitionWorkerPhase, error: unknown) {
  const nativeFailure = acquisitionNativeFailure(error) ?? null;
  const errorCode = catalogWorkerFailure("PROCESSING", error).errorCode;
  let systemCode: string | null = null;
  let errorType = "UNKNOWN";
  let errorKind: "NATIVE" | "DATABASE" | "SYSTEM" | "VALIDATION" | "PROGRAMMING" | "TIMEOUT" | "ABORTED" | "UNKNOWN" =
    nativeFailure ? "NATIVE" : errorCode !== "UNKNOWN" ? "DATABASE" : "UNKNOWN";
  try {
    if (error && typeof error === "object") {
      const code = (error as Record<string, unknown>).code;
      if (typeof code === "string" && recognitionSystemCodes.has(code)) systemCode = code;
      const name = (error as Record<string, unknown>).name;
      if (typeof name === "string" && recognitionErrorTypes.has(name)) errorType = name;
      if (errorKind === "UNKNOWN") {
        if (systemCode) errorKind = "SYSTEM";
        else if (errorType.startsWith("PrismaClient")) errorKind = "DATABASE";
        else if (errorType === "TimeoutError") errorKind = "TIMEOUT";
        else if (errorType === "AbortError") errorKind = "ABORTED";
        else if (name === "ZodError") errorKind = "VALIDATION";
        else if (["TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(name as string)) errorKind = "PROGRAMMING";
      }
    }
  } catch { /* Hostile fields cannot disclose private data or suppress the record. */ }
  return {event: "recognition-worker-stopped", phase: recognitionPhases.has(phase) ? phase : "UNKNOWN",
    errorKind, errorType, errorCode, systemCode, nativeFailure};
}
