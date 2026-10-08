import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { classifyCorrection, correctionRequiresOriginal, correctionLibraryDefaultBytes,
  correctionHash, correctionJobSnapshot, signCorrectionDisplay, readCorrectionDisplay } from "../lib/acquisition-correction-policy";
import { rememberCorrectionDisplay } from "../lib/acquisition-correction-display";
import { getDefaultAppdataPaths } from "../lib/backup";

test("initial selections, later changes, metadata edits and automatic decisions have distinct meanings", () => {
  const input = { afterId: "a", beforeId: null, offeredIds: ["a", "b"], displayKnown: true, origin: "HUMAN" as const };
  const classify = (patch: Partial<Parameters<typeof classifyCorrection>[0]>) => classifyCorrection({ ...input, ...patch });
  assert.equal(classify({}), "FIRST_CHOICE_AGREEMENT");
  assert.equal(classify({ afterId: "b" }), "OFFERED_ALTERNATIVE_SELECTED");
  assert.equal(classify({ afterId: "c" }), "SEARCHED_PRINTING_SELECTED");
  assert.equal(classify({ offeredIds: [] }), "NO_SUGGESTION_RESOLVED");
  assert.equal(classifyCorrection({ ...input, beforeId: "a", displayKnown: false }), "METADATA_ONLY");
  assert.equal(classifyCorrection({ ...input, beforeId: "b" }), "LABEL_REVISED");
  assert.equal(classifyCorrection({ ...input, afterId: null }), "RETURNED_TO_PENDING");
  assert.equal(classifyCorrection({ ...input, displayKnown: false }), "DISPLAY_IDENTITY_UNKNOWN");
  assert.equal(classifyCorrection({ ...input, origin: "AUTO" }), "AUTOMATIC_SELECTION");
  assert.equal(correctionRequiresOriginal("FIRST_CHOICE_AGREEMENT"), false);
  assert.equal(correctionRequiresOriginal("METADATA_ONLY"), false);
  assert.equal(correctionRequiresOriginal("OFFERED_ALTERNATIVE_SELECTED"), true);
});
test("64 decimal GB is separate from scan quotas and configuration is bounded", () => {
  assert.equal(correctionLibraryDefaultBytes({}), 64000000000n);
  assert.equal(correctionLibraryDefaultBytes({ CORRECTION_LIBRARY_OWNER_LIMIT_GB: "128" }), 128000000000n);
  for (const value of ["0", "-1", "1.5", "NaN", "1000000"]) assert.throws(() => correctionLibraryDefaultBytes({ CORRECTION_LIBRARY_OWNER_LIMIT_GB: value }));
});
test("display signatures preserve actual ordering and fail on edits or another owner's key", () => {
  const value = { version: 1 as const, ownerPlayerId: "owner", actorId: "actor", photoId: randomUUID(), digest: "a".repeat(64), generation: 1,
    candidateId: "candidate", revision: 0, jobs: [{ id: randomUUID(), outputHash: null }], status: "PENDING",
    suggestions: ["b", "a"].map(id => ({ id, name: id, setCode: "t", collectorNumber: "1", lang: "en", imageUri: null, finishes: ["nonfoil"] })) };
  const token = signCorrectionDisplay(value, "key-owner-1");
  assert.deepEqual(readCorrectionDisplay(token, "key-owner-1"), value);
  assert.equal(readCorrectionDisplay(token, "key-owner-2"), null);
  const [payload, signature] = token.split(".");
  const altered = JSON.parse(Buffer.from(payload, "base64url").toString()); altered.suggestions.reverse();
  assert.equal(readCorrectionDisplay(`${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`, "key-owner-1"), null);
  assert.equal(readCorrectionDisplay(`${token}.trailing`, "key-owner-1"), null);
});
test("browser history preserves the first display, current display, edit baseline and explicit truncation", () => {
  let history = rememberCorrectionDisplay({ displayed: [] }, "first");
  history = { ...history, edit: "edit" };
  for (let i = 0; i < 30; i++) history = rememberCorrectionDisplay(history, `poll-${i}`);
  assert.equal(history.initial, "first"); assert.equal(history.edit, "edit"); assert.equal(history.current, "poll-29");
  assert.equal(history.displayed?.length, 16); assert.equal(history.truncated, true);
});
test("saved evidence strips nested secrets and paths while preserving scores, order and partial replay limits", () => {
  const snapshot = correctionJobSnapshot({ id: randomUUID(), stage: "printing", versionKey: "v1", candidateRevision: 2,
    createdAt: new Date(0), updatedAt: new Date(1), status: "COMPLETE",
    input: { digest: "digest", credentials: "private", manualAnalysis: { path: "private", version: 1 } },
    output: { printing: { candidates: [{ id: "b", score: 0.7 }, { id: "a", score: 0.6 }], secret: "private", nested: { token: "private" } }, previewDigest: "preview" } });
  assert.doesNotMatch(JSON.stringify(snapshot), /private/);
  assert.deepEqual((snapshot.output as any).printing.candidates, [{ id: "b", score: 0.7 }, { id: "a", score: 0.6 }]);
  assert.equal((snapshot.output as any).previewDigest, "preview");
  assert.equal(snapshot.replayCoverage, "PARTIAL_SAVED_EVIDENCE");
  assert.equal(correctionHash({ a: 1, b: 2 }), correctionHash({ b: 2, a: 1 }));
  assert.notEqual(correctionHash(["a", "b"]), correctionHash(["b", "a"]));
});
test("custom backups include library and pending originals unless an existing ancestor already covers uploads", () => {
  const independent = getDefaultAppdataPaths({ BACKUP_APPDATA_PATHS: "/test/imports", UPLOADS_DATA_PATH: "/test/uploads" });
  assert.deepEqual(independent.map(p => p.envName), ["BACKUP_APPDATA_PATHS_1", "UPLOADS_DATA_PATH"]);
  assert.equal(getDefaultAppdataPaths({ BACKUP_APPDATA_PATHS: "/test", UPLOADS_DATA_PATH: "/test/uploads" }).length, 1);
  assert.equal(getDefaultAppdataPaths({ BACKUP_APPDATA_PATHS: "/test/upload", UPLOADS_DATA_PATH: "/test/uploads" }).length, 2);
  assert.deepEqual(getDefaultAppdataPaths({ BACKUP_APPDATA_PATHS: "/test/uploads/imports", UPLOADS_DATA_PATH: "/test/uploads" }).map(p => p.envName), ["UPLOADS_DATA_PATH"]);
});
