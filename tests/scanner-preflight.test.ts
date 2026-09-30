import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { scannerPreflightCodeSchema, scannerPreflightReportSchema } from "../lib/scanner-run-protocol";
import { scannerPreflightMessage } from "../lib/scanner-preflight-message";

test("preflight reports are bounded problem codes without arbitrary diagnostic content", () => {
  const report = { version: 1, runId: randomUUID(), epoch: randomUUID(), code: "SCANNER_UNAVAILABLE" };
  assert.equal(scannerPreflightReportSchema.safeParse(report).success, true);
  for (const value of [{ ...report, secret: "credential" }, { ...report, code: "C:\\private\\driver.exe" },
    { ...report, executionId: randomUUID() }, { ...report, version: 2 }, { ...report, epoch: "" }])
    assert.equal(scannerPreflightReportSchema.safeParse(value).success, false);
});
test("every allowed problem has guidance; unknown stored data cannot leak into the page", () => {
  for (const code of scannerPreflightCodeSchema.options) {
    const message = scannerPreflightMessage({ code, observedAt: new Date().toISOString() });
    assert.ok(message && message.length > 40);
  }
  for (const value of [null, { code: "native-secret-message", observedAt: new Date().toISOString() },
    { code: "SCANNER_BUSY", observedAt: "bad", privatePath: "private" }]) assert.equal(scannerPreflightMessage(value), null);
});
