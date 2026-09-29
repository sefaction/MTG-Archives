import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionRecognitionJobs } from "../lib/acquisition-recognition-jobs";
import { PRINTING_STAGE } from "../lib/acquisition-printing";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";

const output = {catalog: {status: "RESOLVED", printingCoverage: "CHECKED"},
  proposals: {status: "STRONG_MATCH", automaticAcceptance: true, totalProposals: 1, truncated: false,
    proposals: [{card: {id: "local-print", name: "Example", setCode: "neo", collectorNumber: "1"}, reasons: [], nameDistance: null}]}};
const catalog = {id: "catalog", stage: CATALOG_RECONCILIATION_STAGE, status: "COMPLETE" as const, output};

test("queued OCR does not claim that missing-metadata checks have started", ()=>{
  for (const status of ["PENDING", "RUNNING"] as const) {
    const view = acquisitionRecognitionJobs([
      {id: "ocr", stage: "photo-recognition-v1", status, output: null},
    ], true, true);
    assert.equal(view.evidence.status, status);
    assert.equal(view.evidence.catalog, null);
    assert.equal(view.evidence.result, null);
    assert.equal(view.printingStatus, "WAITING");
  }
  const view = acquisitionRecognitionJobs([
    {id: "reconcile", stage: CATALOG_RECONCILIATION_STAGE, status: "PENDING", output: null},
  ], true, true);
  assert.equal(view.evidence.catalog?.status, "CHECKING");
  const textOnly = acquisitionRecognitionJobs([
    {id: "text", stage: "photo-recognition-v1", status: "COMPLETE", output: {proposals: output.proposals}},
  ], true, true);
  assert.equal(textOnly.evidence.catalog, null);
  assert.equal(textOnly.evidence.result?.automaticAcceptance, false);
  const legacy = {proposals: output.proposals, catalog: {status: "CHECKING", printingCoverage: "UNRESOLVED"}};
  const savedText = acquisitionRecognitionJobs([
    {id: "saved-text", stage: "photo-recognition-v1", status: "COMPLETE", output: legacy},
  ], true, true);
  assert.equal(savedText.evidence.catalog, null);
  assert.equal(savedText.evidence.result?.proposals.length, 1);
  assert.equal(savedText.evidence.result?.automaticAcceptance, false);
  assert.equal(legacy.catalog.status, "CHECKING", "saved observation remains intact");
});
test("pending and failed printing work retains source suggestions while blocking confirmation", ()=>{
  for (const status of ["PENDING", "FAILED"] as const) {
    const printing = {id: "printing", stage: PRINTING_STAGE, status, input: {catalogJobId: catalog.id}, output: null};
    const view = acquisitionRecognitionJobs([printing, catalog], false, true);
    assert.equal(view.printingStatus, status);
    assert.equal(view.evidence.catalog?.status, "RESOLVED");
    assert.equal(view.evidence.result?.proposals[0].card.id, "local-print");
    assert.equal(view.evidence.result?.automaticAcceptance, false);
    assert.equal(view.job?.id, catalog.id);
  }
});
test("printing evidence from a superseded catalog pair cannot replace current suggestions", ()=>{
  const stale = {id: "stale", stage: PRINTING_STAGE, status: "COMPLETE" as const,
    input: {catalogJobId: "old-catalog"}, output: {...output, sourceCatalogJobId: "old-catalog"}};
  const view = acquisitionRecognitionJobs([stale, catalog], false, true);
  assert.equal(view.job?.id, catalog.id);
  assert.equal(view.printingStatus, "WAITING");
  assert.equal(view.evidence.result?.automaticAcceptance, false);
});
test("current completed printing evidence is preferred without changing source evidence", ()=>{
  const printing = {id: "printing", stage: PRINTING_STAGE, status: "COMPLETE" as const,
    input: {catalogJobId: catalog.id}, output: {...output, sourceCatalogJobId: catalog.id,
      proposals: {...output.proposals, automaticAcceptance: false, status: "REVIEW_REQUIRED"}}};
  const view = acquisitionRecognitionJobs([printing, catalog], false, true);
  assert.equal(view.job?.id, printing.id);
  assert.equal(view.printingStatus, "COMPLETE");
  assert.equal(view.evidence.result?.status, "REVIEW_REQUIRED");
  assert.equal(catalog.output.proposals.automaticAcceptance, true);
});
