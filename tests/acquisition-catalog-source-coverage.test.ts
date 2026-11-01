import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionRecognitionDto } from "../lib/acquisition-recognition-dto";
import { acquisitionCatalogMessage } from "../lib/acquisition-catalog-status";

const sourceCoverage = [{ kind: "BULK_SNAPSHOT", version: 1, sourceDigest: "a".repeat(64),
  sourceUpdatedAt: "2026-10-31T21:06:29.482Z", language: "en" }];
const proposals = { status: "STRONG_MATCH", automaticAcceptance: true, totalProposals: 1, truncated: false,
  proposals: [{ card: { id: "printing", name: "Forest", setCode: "tst", collectorNumber: "1", lang: "en" },
    reasons: ["STRONG_EXACT_PRINTING"], nameDistance: 0 }] };
const dto = (catalog: unknown) => acquisitionRecognitionDto("COMPLETE", { proposals, catalog });

test("review responses retain dated English snapshot coverage and identify it in feedback", () => {
  const value = dto({ status: "RESOLVED", printingCoverage: "CHECKED", sourceCoverage });
  assert.deepEqual((value.catalog as any).sourceCoverage, sourceCoverage);
  const message = acquisitionCatalogMessage(value.catalog)!;
  assert.match(message, /saved/i); assert.match(message, /English paper/); assert.match(message, /2026-10-31/);
  assert.equal(value.result?.automaticAcceptance, true, "Source feedback alone does not promote or demote a valid match");
});

test("malformed or unsupported source claims cannot survive DTO validation as resolved coverage", () => {
  for (const change of [{ language: "fr" }, { sourceDigest: "not-a-digest" }, { version: 2 }, { sourceUpdatedAt: "unknown" }]) {
    const value = dto({ status: "RESOLVED", printingCoverage: "CHECKED", sourceCoverage: [{ ...sourceCoverage[0], ...change }] });
    assert.equal(value.catalog, null); assert.equal(value.result?.automaticAcceptance, false);
    assert.equal(value.result?.status, "REVIEW_REQUIRED");
  }
});

test("ordinary live lookup and unresolved feedback retain their existing behavior", () => {
  assert.equal(acquisitionCatalogMessage(dto({ status: "RESOLVED", printingCoverage: "CHECKED" }).catalog),
    "Printing information checked against Scryfall’s catalog.");
  const value = dto({ status: "INCOMPLETE", printingCoverage: "UNRESOLVED", sourceCoverage });
  assert.equal(value.result?.automaticAcceptance, false); assert.match(acquisitionCatalogMessage(value.catalog)!, /incomplete/);
});
