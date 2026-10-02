import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionReviewProgress } from "../lib/acquisition-processing-status";
import type { AcquisitionCardReview } from "../lib/acquisition-review";
const record = (values: Partial<AcquisitionCardReview>) => ({ review: null, recognitionStatus: "COMPLETE", suggestions: [], ...values } as AcquisitionCardReview);
test("terminal scan failures and no-match never imply waiting for identification", () => {
  for (const [values, label] of [
    [{recognitionStatus:"FAILED",catalog:{status:"PROVIDER_ERROR",printingCoverage:"UNRESOLVED"}},"Catalog unavailable"],
    [{recognitionStatus:"FAILED",visualStatus:"WAITING"},"Card identification failed"],
    [{recognitionStatus:"NO_MATCH",visualStatus:"FAILED"},"Image comparison failed"],
    [{printingStatus:"FAILED",catalog:{status:"CHECKING"}},"Printing check failed"],
    [{recognitionStatus:"NO_MATCH"},"No printing found"],
    [{recognitionStatus:"COMPLETE"},"No printing found"],
  ] as const) {
    const next=acquisitionReviewProgress(record(values as Partial<AcquisitionCardReview>),false);
    assert.equal(next.label,label); assert.ok(next.problem);
  }
  const saved=record({review:{cardId:"saved"} as AcquisitionCardReview["review"],recognitionStatus:"FAILED",visualStatus:"FAILED",printingStatus:"FAILED"});
  assert.deepEqual(acquisitionReviewProgress(saved,true),{label:"Review saved",problem:null});
});
test("active supplemental work stays visible instead of falsely claiming no-match", () => {
  assert.equal(acquisitionReviewProgress(record({visualStatus:"RUNNING"}),false).label,"Comparing card image…");
  assert.equal(acquisitionReviewProgress(record({recognitionStatus:"NO_MATCH",visualStatus:"WAITING"}),false).label,"Image comparison queued");
  assert.equal(acquisitionReviewProgress(record({}),true).label,"Verify this printing");
});
