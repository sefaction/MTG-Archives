import assert from "node:assert/strict";
import test from "node:test";
import { BulkReviewUncertainError, saveBulkReview } from "../components/acquisition-bulk-save";

const endpoint = "/api/acquisition/batch/review", body = '{"revision":7,"decision":{"condition":"NM"}}';
test("a known successful review needs one send and no recovery guard", async () => {
  let sends = 0;
  await saveBulkReview(endpoint, body, () => { throw Error("unexpected retry"); }, { fetch: async () => { sends++; return new Response(null, { status: 200 }); } });
  assert.equal(sends, 1);
});
test("lost acknowledgement retries the exact body with a fresh abort signal", async () => {
  const requests: RequestInit[] = []; let guards = 0;
  await saveBulkReview(endpoint, body, () => { guards++; return true; }, { fetch: async (url, request) => {
    assert.equal(url, endpoint); requests.push(request!);
    if (requests.length === 1) throw new TypeError("network loss");
    return new Response(null, { status: 200 });
  } });
  assert.equal(guards, 1); assert.equal(requests.length, 2);
  for (const request of requests) { assert.equal(request.body, body); assert.equal(request.method, "POST"); assert.deepEqual(request.headers, { "Content-Type": "application/json" }); }
  assert.notEqual(requests[0].signal, requests[1].signal);
});
for (const status of [403, 409, 500]) test(`HTTP ${status} rejection does not retry or become acknowledgement uncertainty`, async () => {
  let sends = 0;
  await assert.rejects(saveBulkReview(endpoint, body, () => { throw Error("unexpected retry"); }, { fetch: async () => {
    sends++; return Response.json({ error: "Capture card changed" }, { status });
  } }), error => error instanceof Error && !(error instanceof BulkReviewUncertainError) && error.message === "Capture card changed");
  assert.equal(sends, 1);
});
test("two transport failures stop after two sends and retain uncertainty", async () => {
  let sends = 0;
  await assert.rejects(saveBulkReview(endpoint, body, () => true, { fetch: async () => { sends++; throw new TypeError("offline"); } }), BulkReviewUncertainError);
  assert.equal(sends, 2);
});
test("a correction appearing after a lost response blocks the automatic retry", async () => {
  let sends = 0;
  await assert.rejects(saveBulkReview(endpoint, body, () => false, { fetch: async () => { sends++; throw new TypeError("network loss"); } }), BulkReviewUncertainError);
  assert.equal(sends, 1);
});
test("a stalled transport is aborted and recovery remains bounded", async () => {
  const signals: AbortSignal[] = [];
  await assert.rejects(saveBulkReview(endpoint, body, () => true, { timeoutMs: 5, fetch: async (_, request) => {
    const signal = request!.signal!; signals.push(signal);
    return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  } }), BulkReviewUncertainError);
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted));
});
