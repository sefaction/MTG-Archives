import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ScannerConnectionDenied, ScannerRunConflict, ScannerRequestError, scannerRunError } from "../lib/scanner-errors";

for (const [name, error, status] of [
  ["known permanent denial", new ScannerConnectionDenied(), 403],
  ["known run conflict", new ScannerRunConflict("private run identity"), 409],
  ["invalid protocol", z.object({ version: z.literal(1) }).safeParse({ version: 9 }).error, 400],
  ["oversized metadata", new ScannerRequestError(413), 413],
  ["database outage", new Error("private database host/token"), 503],
] as const) test(`native endpoint classifies ${name} without leaking internals`, async () => {
  const response = scannerRunError(error);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Retry-After"), status === 503 ? "5" : null);
  assert.doesNotMatch(await response.text(), /private/);
});
