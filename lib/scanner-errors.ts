import { ZodError } from "zod";

export class ScannerConnectionDenied extends Error {
  constructor() { super("Scanner connection unavailable"); }
}
export class ScannerRequestError extends Error {
  constructor(public readonly status: 400 | 413) { super(status === 413 ? "Scanner request too large" : "Scanner request unavailable"); }
}

// Only a known credential/ownership rejection is permanent. In particular,
// never expose a database exception as 403: helpers stop on revoked credentials.
export function scannerConnectionError(error: unknown) {
  const status = error instanceof ScannerConnectionDenied ? 403 :
    error instanceof ScannerRequestError ? error.status : error instanceof ZodError ? 400 : 503;
  const message = status === 503 ? "Scanner service temporarily unavailable. The helper will retry; saved scans are kept." :
    status === 403 ? "Scanner connection unavailable. Reconnect from Scan cards." : "Scanner request could not be read.";
  return Response.json({ error: message }, { status, headers: {
    "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "5" } : {}),
  } });
}
