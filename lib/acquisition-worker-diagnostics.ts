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
