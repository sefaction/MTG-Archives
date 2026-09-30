import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionDraftKey, clearAcquisitionDraft, readAcquisitionDraft, saveAcquisitionDraft } from "../lib/acquisition-browser-review-draft";
const scope = { userId: "owner", batchId: "batch", photoId: "photo" };
const draft = { version: 1, revision: 4, selected: { id: "printing", name: "Chosen card", setCode: "tst",
  collectorNumber: "1", lang: "en", imageUri: null, finishes: ["foil"] }, finish: "FOIL", condition: "LP",
  language: "en", query: "Chosen card", set: "tst", number: "1" };
function storage() { const rows = new Map<string, string>(); return { rows,
  getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
  removeItem: (key: string) => { rows.delete(key); } }; }
test("correction draft restores exact decision and original revision, isolated by account, batch and photo", () => {
  const cache = storage(); saveAcquisitionDraft(cache, scope, draft);
  const restored = readAcquisitionDraft(cache, scope)!;
  assert.deepEqual(restored, { ...draft, writeId: restored.writeId });
  for (const field of ["userId", "batchId", "photoId"])
    assert.equal(readAcquisitionDraft(cache, { ...scope, [field]: "other" }), null);
  assert.notEqual(acquisitionDraftKey({ ...scope, userId: "a:b" }), acquisitionDraftKey({ ...scope, userId: "a", batchId: "b:batch" }));
  clearAcquisitionDraft(cache, scope); assert.equal(readAcquisitionDraft(cache, scope), null);
});
test("untrusted and unavailable browser storage cannot turn a draft into a valid server decision", () => {
  const cache = storage(); const writeId = saveAcquisitionDraft(cache, scope, draft);
  assert.throws(() => saveAcquisitionDraft(cache, scope, { ...draft, secret: "unexpected" }));
  assert.throws(() => saveAcquisitionDraft(cache, scope, { ...draft, revision: -1 }));
  assert.throws(() => saveAcquisitionDraft(cache, scope, { ...draft, selected: { ...draft.selected, originalBytes: "private" } }));
  assert.throws(() => saveAcquisitionDraft({ ...cache, setItem() { throw new Error("quota"); } }, scope, { ...draft, condition: "HP" }), /quota/);
  assert.deepEqual(readAcquisitionDraft(cache, scope), { ...draft, writeId });
  cache.setItem(acquisitionDraftKey(scope), "invalid"); assert.throws(() => readAcquisitionDraft(cache, scope));
  cache.setItem(acquisitionDraftKey(scope), "x".repeat(17000)); assert.throws(() => readAcquisitionDraft(cache, scope), /too large/);
});
test("late save or discard cannot erase a newer browser draft", () => {
  const cache = storage(), old = saveAcquisitionDraft(cache, scope, draft);
  const latest = saveAcquisitionDraft(cache, scope, { ...draft, condition: "HP" });
  assert.equal(clearAcquisitionDraft(cache, scope, old), false);
  assert.equal(readAcquisitionDraft(cache, scope)?.condition, "HP");
  assert.equal(clearAcquisitionDraft(cache, scope, latest), true);
  assert.equal(clearAcquisitionDraft(cache, scope, latest), true);
});
