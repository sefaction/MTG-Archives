import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { scannerRunClaimSchema, scannerHelperIdentitySchema, scannerTransferSchema,
  scannerCanonical } from "../lib/scanner-run-protocol";

const identity = () => ({ version: 1, payloadKind: "MANAGED_ASSEMBLY", sha256: "a".repeat(64),
  moduleVersionId: randomUUID(), helperVersion: "0.4.4", protocolVersion: "0.3.0-native", naps2SdkVersion: "1.3.0" });
const execution = () => ({ version: 1, runId: randomUUID(), epoch: randomUUID(), executionId: randomUUID() });

test("actual compiled Windows helper report is accepted by the production site schema", {
  skip: !process.env.SCANNER_HELPER_IDENTITY_REPORT,
}, () => {
  const report = JSON.parse(readFileSync(process.env.SCANNER_HELPER_IDENTITY_REPORT!, "utf8"));
  const parsed = scannerRunClaimSchema.parse({ ...execution(), helperIdentity: report.helperIdentity });
  assert.deepEqual(parsed.helperIdentity, report.helperIdentity);
  assert.equal(parsed.helperIdentity!.helperVersion, report.helperVersion);
  assert.equal(parsed.helperIdentity!.protocolVersion, report.protocolVersion);
  assert.equal(parsed.helperIdentity!.naps2SdkVersion, report.naps2SdkVersion);
});

test("helper report is a bounded path-free managed payload identity; legacy claims stay unchanged", () => {
  const legacy = execution(), known = identity();
  assert.deepEqual(scannerRunClaimSchema.parse(legacy), legacy);
  assert.deepEqual(scannerRunClaimSchema.parse({ ...legacy, helperIdentity: known }).helperIdentity, known);
  for (const override of [{ version: 2 }, { payloadKind: "APPHOST" }, { sha256: "not-a-digest" },
    { moduleVersionId: "00000000-0000-0000-0000-000000000000" }, { helperVersion: "C:\\private\\helper.exe" },
    { naps2SdkVersion: "https://private.invalid" }, { protocolVersion: "PRIVATE-MACHINE" }, { machineName: "PRIVATE" }, { path: "PRIVATE" }])
    assert.equal(scannerHelperIdentitySchema.safeParse({ ...known, ...override }).success, false);
});

test("parsed identities detach caller state and canonical equality preserves all fields", () => {
  const original = identity(), parsed = scannerRunClaimSchema.parse({ ...execution(), helperIdentity: original }).helperIdentity!;
  const before = scannerCanonical(parsed); original.sha256 = "b".repeat(64);
  assert.equal(scannerCanonical(parsed), before);
  assert.equal(scannerCanonical(Object.fromEntries(Object.entries(parsed).reverse())), before);
  for (const key of ["sha256", "moduleVersionId", "helperVersion", "protocolVersion", "naps2SdkVersion"]) {
    assert.notEqual(scannerCanonical({ ...parsed, [key]: "changed" }), before);
  }
});

test("transfers cannot supply or override the helper identity frozen by the claim", () => {
  const transfer = { ...execution(), artifactId: randomUUID(), sequence: 1, timestamp: new Date().toISOString(),
    side: "UNKNOWN", physicalBoundary: "UNKNOWN" };
  assert.equal(scannerTransferSchema.safeParse(transfer).success, true);
  assert.equal(scannerTransferSchema.safeParse({ ...transfer, helperIdentity: identity() }).success, false);
});
