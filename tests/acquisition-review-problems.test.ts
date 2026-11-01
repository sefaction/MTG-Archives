import assert from "node:assert/strict";
import test from "node:test";
import {acquisitionReviewProblems, type AcquisitionProblemJob} from "../lib/acquisition-review-problems";
import {CATALOG_RECONCILIATION_STAGE} from "../lib/acquisition-catalog-status";
import {VISUAL_STAGE} from "../lib/acquisition-visual";
import {PRINTING_STAGE} from "../lib/acquisition-printing";

const printing = {finishes: ["nonfoil", "foil"]};
const base = {committed: false, physicalReasons: [] as string[], photoReady: true,
  review: null, defaultsFinish: "NONFOIL" as const, printings: new Map([["card", printing]])};
function job(change: Partial<AcquisitionProblemJob> = {}): AcquisitionProblemJob {
  return {id: "catalog", stage: CATALOG_RECONCILIATION_STAGE, status: "COMPLETE",
    input: {catalogJobId: null}, output: {sourceCatalogJobId: null, referenceAdmission: {status: null}},
    resultStatus: "NO_MATCH", proposalCount: 0, proposalIds: [], catalogStatus: "RESOLVED",
    geometryStatus: "PROPOSED", framing: null, ...change};
}
const problems = (jobs: AcquisitionProblemJob[], change: Partial<Parameters<typeof acquisitionReviewProblems>[0]> = {}) =>
  acquisitionReviewProblems({...base, jobs, ...change});

test("confirmed batch language exposes a readable conflict until the card is individually reviewed",()=>{
  const readable=job({resultStatus:"STRONG_MATCH",proposalCount:1,proposalIds:["card"],observedLanguages:["fr"]});
  assert.deepEqual(problems([readable],{defaultsLanguage:"en"}),["conflict"]);
  assert.deepEqual(problems([readable],{defaultsLanguage:"fr"}),[]);
  assert.deepEqual(problems([readable]),[]);
  assert.deepEqual(problems([{...readable,observedLanguages:[]}],{defaultsLanguage:"en"}),[]);
  assert.deepEqual(problems([readable],{defaultsLanguage:"en",review:{cardId:"card",finish:"NONFOIL"}}),[]);
});

test("unstarted, running, failed and provider checks are not completed no-match results", () => {
  assert.deepEqual(problems([]), []);
  for (const status of ["PENDING", "RUNNING", "FAILED", "SUPERSEDED"] as const)
    assert.deepEqual(problems([job({status})]), []);
  for (const catalogStatus of ["CHECKING", "PROVIDER_ERROR", "INCOMPLETE"])
    assert.deepEqual(problems([job({catalogStatus})]), []);
  assert.deepEqual(problems([job()]), ["no-match"]);
  assert.deepEqual(problems([job({catalogStatus: "NOT_FOUND"})]), ["no-match"]);
});

test("current supplemental work blocks no-match; obsolete failures and skipped admissions do not", () => {
  for (const status of ["PENDING", "RUNNING", "FAILED"] as const) {
    assert.deepEqual(problems([job({id: "new", status}), job()]), []);
    assert.deepEqual(problems([job({id: "image", stage: VISUAL_STAGE, status}), job()]), []);
    assert.deepEqual(problems([job({id: "print", stage: PRINTING_STAGE, status,
      input: {catalogJobId: "catalog"}}), job()]), []);
  }
  assert.deepEqual(problems([job(), job({id: "old", status: "FAILED"})]), ["no-match"]);
  assert.deepEqual(problems([job({id: "skip", stage: "photo-reference-refinement-v1", status: "SUPERSEDED",
    output: {sourceCatalogJobId: null, referenceAdmission: {status: "SKIPPED"}}}), job()]), ["no-match"]);
  assert.deepEqual(problems([job({stage: "photo-recognition-v1", catalogStatus: "CHECKING"})]), ["no-match"]);
});

test("a completed result with no still-available local printing remains no match", () => {
  assert.deepEqual(problems([job({resultStatus: "REVIEW_REQUIRED", proposalCount: 1, proposalIds: ["removed"]})]), ["no-match"]);
  assert.deepEqual(problems([job({resultStatus: "REVIEW_REQUIRED", proposalCount: 1, proposalIds: ["card"]})]), []);
});

test("enabled stages waiting for admission are not a final no-match result", () => {
  assert.deepEqual(problems([job()], {visualEnabled: true}), []);
  assert.deepEqual(problems([job()], {printingEnabled: true}), []);
  assert.deepEqual(problems([job({id: "visual", stage: VISUAL_STAGE}), job()],
    {visualEnabled: true}), ["no-match"]);
  assert.deepEqual(problems([job({id: "printing", stage: PRINTING_STAGE,
    output: {sourceCatalogJobId: "catalog", referenceAdmission: {status: null}}}), job()],
    {printingEnabled: true}), ["no-match"]);
});

test("overlapping unresolved problems stay distinct and do not change source observations", () => {
  const jobs = [job({resultStatus: "CONFLICT", proposalCount: 1, proposalIds: ["card"], framing: "CLIPPED"})];
  const before = JSON.stringify(jobs);
  assert.deepEqual(problems(jobs, {defaultsFinish: "UNKNOWN", physicalReasons: ["OVERFLOW"]}),
    ["overflow", "unknown-finish", "quality", "conflict"]);
  assert.equal(JSON.stringify(jobs), before);
  assert.deepEqual(problems(jobs, {defaultsFinish: "UNKNOWN", physicalReasons: ["OVERFLOW"],
    review: {cardId: "card", finish: "NONFOIL"}}), ["overflow", "quality"]);
});

test("finish filtering uses the same supported-printing default policy as review", () => {
  const jobs = [job({resultStatus: "REVIEW_REQUIRED", proposalCount: 1, proposalIds: ["card"]})];
  assert.deepEqual(problems(jobs, {defaultsFinish: "UNKNOWN"}), ["unknown-finish"]);
  assert.deepEqual(problems(jobs, {defaultsFinish: "UNKNOWN", printings: new Map([["card", {finishes: ["etched"]}]])}), []);
  assert.deepEqual(problems(jobs, {defaultsFinish: "FOIL", printings: new Map([["card", {finishes: ["nonfoil", "etched"]}]])}), ["unknown-finish"]);
  assert.deepEqual(problems(jobs, {review: {cardId: "card", finish: "UNKNOWN"}}), ["unknown-finish"]);
});

test("committed, excluded and missing-current-photo states cannot acquire recognition problems", () => {
  const jobs = [job({geometryStatus: "NEEDS_CROP"})];
  assert.deepEqual(problems(jobs, {committed: true, defaultsFinish: "UNKNOWN", physicalReasons: ["OVERFLOW"]}), []);
  assert.deepEqual(problems(jobs, {physicalReasons: ["UNAVAILABLE", "OVERFLOW"]}), []);
  assert.deepEqual(problems(jobs, {photoReady: false, defaultsFinish: "UNKNOWN"}), []);
  assert.deepEqual(problems(jobs, {photoReady: false, physicalReasons: ["OVERFLOW"]}), ["overflow"]);
});

test("malformed summaries cannot manufacture completed no-match evidence", () => {
  for (const change of [
    {proposalCount: null}, {proposalCount: -1}, {proposalCount: 13},
    {resultStatus: "UNKNOWN"}, {proposalIds: null}, {proposalIds: [null]}, {proposalIds: ["extra"]},
  ]) assert.deepEqual(problems([job(change)]), []);
});

test("only printing paired to the selected catalogue supplies current problem evidence", () => {
  const parent = job();
  const printed = job({id: "printing", stage: PRINTING_STAGE, resultStatus: "CONFLICT",
    proposalCount: 1, proposalIds: ["card"], output: {sourceCatalogJobId: "catalog", referenceAdmission: {status: null}}});
  assert.deepEqual(problems([printed, parent]), ["conflict"]);
  assert.deepEqual(problems([{...printed, output: {...printed.output, sourceCatalogJobId: "old"}}, parent]), ["no-match"]);
});
