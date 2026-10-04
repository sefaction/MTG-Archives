import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionPhotoLimits, requireAcquisitionPhotoSpace, AcquisitionPhotoStorageLimitError } from "../lib/acquisition-photo-limits";
import { scannerRunError } from "../lib/scanner-errors";
import { scannerUploadMessage } from "../lib/scanner-preflight-message";
import { scannerPreflightReportSchema } from "../lib/scanner-run-protocol";
const GIB = 1024 ** 3;

test("photo limits preserve defaults and accept explicit larger finite allowances", () => {
  assert.deepEqual(acquisitionPhotoLimits({}), { owner: 4 * GIB, batch: GIB });
  assert.deepEqual(acquisitionPhotoLimits({ ACQUISITION_PHOTO_OWNER_LIMIT_GIB: "64", ACQUISITION_PHOTO_BATCH_LIMIT_GIB: "4" }),
    { owner: 64 * GIB, batch: 4 * GIB });
  for (const value of ["0", "-1", "1.5", "Infinity", "NaN", "1e2", "1048577"])
    assert.throws(() => acquisitionPhotoLimits({ ACQUISITION_PHOTO_OWNER_LIMIT_GIB: value }));
});

test("quota boundary keeps the incoming original blocked until allowance increases", () => {
  const retained = 4290894938, incoming = 6320293;
  assert.throws(() => requireAcquisitionPhotoSpace(retained, 300000000, incoming, acquisitionPhotoLimits({})),
    (e: unknown) => e instanceof AcquisitionPhotoStorageLimitError && e.scope === "OWNER");
  assert.doesNotThrow(() => requireAcquisitionPhotoSpace(retained, 300000000, incoming,
    acquisitionPhotoLimits({ ACQUISITION_PHOTO_OWNER_LIMIT_GIB: "64" })));
  assert.doesNotThrow(() => requireAcquisitionPhotoSpace(4 * GIB - incoming, 0, incoming));
  assert.throws(() => requireAcquisitionPhotoSpace(0, GIB, incoming),
    (e: unknown) => e instanceof AcquisitionPhotoStorageLimitError && e.scope === "BATCH");
});

test("scanner quota rejection is recoverable and guidance rejects untrusted text", async () => {
  const response = scannerRunError(new AcquisitionPhotoStorageLimitError("OWNER", 4 * GIB));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PHOTO_STORAGE_LIMIT");
  const problem = { code: "PHOTO_STORAGE_LIMIT", scope: "OWNER", limitBytes: 4 * GIB, observedAt: new Date().toISOString() };
  assert.match(scannerUploadMessage(problem)!, /Uploads are waiting/);
  assert.match(scannerUploadMessage(problem)!, /without scanning the cards again/);
  assert.equal(scannerUploadMessage({ ...problem, privatePath: "secret" }), null);
  assert.equal(scannerUploadMessage({ ...problem, scope: "secret" }), null);
  assert.equal(scannerPreflightReportSchema.safeParse({ ...problem, version: 1 }).success, false);
});
