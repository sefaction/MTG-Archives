import assert from "node:assert/strict";
import test from "node:test";
import { correctionHistoryEntry } from "../lib/acquisition-correction-history-dto";
const card = (id: string) => ({ id, name: `Printing ${id}`, setCode: "tst", collectorNumber: id, lang: "en", password: "PRIVATE" });
const event = (payload: unknown, classification = "OFFERED_ALTERNATIVE_SELECTED") => ({
  id: "event", candidateRevision: 7, createdAt: new Date(0), origin: "HUMAN", classification, payload,
});
test("history shows the recorded save suggestion and decisions without inventing verification", () => {
  const result = correctionHistoryEntry(event({ version: 1, before: null, after: { cardId: "b", finish: "FOIL", condition: "LP", language: "en" },
    displayKnown: true, firstDisplayedSuggestion: card("a"), printingProjections: [card("b")], independentVerification: "UNVERIFIED", missing: [] }));
  assert.equal(result.before.state, "PENDING"); assert.equal(result.after.state, "SELECTED");
  assert.equal(result.after.printing?.name, "Printing b"); assert.equal(result.after.finish, "FOIL");
  assert.equal(result.suggestion.printing?.name, "Printing a"); assert.equal(result.verification, "UNVERIFIED");
  assert.equal(result.kind, "Selected another suggestion"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test("missing display and printing metadata stays unknown, distinct from a known empty suggestion list", () => {
  const raw = { version: 1, before: { cardId: "old" }, after: null, displayKnown: false, firstDisplayedSuggestion: card("a"),
    missing: ["DISPLAY_IDENTITY_UNKNOWN"], independentVerification: "UNVERIFIED" };
  const unknown = correctionHistoryEntry(event(raw, "RETURNED_TO_PENDING"));
  assert.equal(unknown.before.state, "SELECTED"); assert.equal(unknown.before.printing, null);
  assert.equal(unknown.after.state, "PENDING"); assert.equal(unknown.suggestion.state, "UNKNOWN");
  assert.equal(unknown.suggestion.printing, null); assert.equal(unknown.evidenceGaps.length, 1);
  const empty = correctionHistoryEntry(event({ ...raw, displayKnown: true, firstDisplayedSuggestion: null }));
  assert.equal(empty.suggestion.state, "NONE");
});
test("unsupported evidence, unknown flags and malformed selections do not export raw fields or imply pending", () => {
  for (const payload of [null, [], { version: 2, before: null, after: null, token: "PRIVATE" }, { version: 1, removed: true }]) {
    const value = correctionHistoryEntry(event(payload));
    assert.equal(value.before.state, "UNKNOWN"); assert.equal(value.after.state, "UNKNOWN");
    assert.equal(value.verification, "UNKNOWN"); assert.equal(value.suggestion.state, "UNKNOWN");
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE/); assert.equal(value.evidenceGaps.length, 1);
  }
  const value = correctionHistoryEntry(event({ version: 1, after: { cardId: [], path: "PRIVATE" }, missing: ["PRIVATE", "PRIVATE"],
    token: "PRIVATE", jobOutput: "PRIVATE", actorId: "PRIVATE", independentVerification: "VERIFIED" }, "PRIVATE"));
  assert.equal(value.after.state, "UNKNOWN"); assert.equal(value.verification, "UNKNOWN");
  assert.equal(value.evidenceGaps.length, 1); assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
});
test("same-printing attribute edits and automatic origins remain separate from printing corrections", () => {
  const input = { version: 1, before: { cardId: "a", condition: "NM" }, after: { cardId: "a", condition: "LP" }, printingProjections: [card("a")] };
  const value = correctionHistoryEntry(event(input, "METADATA_ONLY"));
  assert.equal(value.kind, "Updated attributes of the same printing");
  assert.equal(value.before.printing?.id, value.after.printing?.id); assert.notEqual(value.before.condition, value.after.condition);
  assert.equal(correctionHistoryEntry({ ...event(input), origin: "AUTO" }).origin, "Automatic selection");
});
