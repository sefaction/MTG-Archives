import assert from "node:assert/strict";
import { test } from "node:test";
import { nextAwaitingAcquisitionSlot } from "../lib/acquisition-review-display";

test("next awaiting review uses physical order, skips current/added/ready/missing originals, and wraps", () => {
  const pending = (position: number) => ({ position, committed: false, review: null,
    photos: [{ ready: true, purgedAt: null }] });
  const review = { cardId: "printing", finish: "NONFOIL", condition: "NM", language: "en" };
  const slots = [pending(19), { ...pending(2), committed: true }, { ...pending(4), review },
    { ...pending(5), photos: [{ ready: false, purgedAt: null }] },
    { ...pending(6), photos: [{ ready: true, purgedAt: "expired" }] }, pending(0), pending(11)];
  assert.equal(nextAwaitingAcquisitionSlot(slots, 0)?.position, 11);
  assert.equal(nextAwaitingAcquisitionSlot(slots, 11)?.position, 19);
  assert.equal(nextAwaitingAcquisitionSlot(slots, 19)?.position, 0);
  assert.equal(nextAwaitingAcquisitionSlot([pending(0)], 0), null);
  assert.equal(nextAwaitingAcquisitionSlot([], 0), null);
});
