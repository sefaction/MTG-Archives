import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionNameKey, acquisitionExactNameKeyEligible } from "../lib/acquisition-name";
import { createAcquisitionRecognitionIndex, proposeAcquisitionPrintings, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { combineAcquisitionPhotoText, needsAcquisitionPhotoText, type AcquisitionPhotoText } from "../lib/acquisition-photo-text";

const template = { id: "first", name: "Synthetic short alias", setCode: "abc", collectorNumber: "7", lang: "ja" };
const hints = (title: string): AcquisitionPhotoText => ({ version: 1, scope: "WHOLE_PHOTO", status: "COMPLETE",
  readings: [{ rotationDegrees: 0, text: [title], truncated: false }] });

test("exact short Unicode printed and face aliases retrieve review candidates", () => {
  for (const alias of ["山", "平地", "ガ", "й", "𠀋"]) for (const card of [
    { ...template, printedName: alias }, { ...template, faceNames: [alias] },
  ]) {
    const index = createAcquisitionRecognitionIndex([card]);
    const name = proposeAcquisitionPrintings(index, { title: [alias], footer: [] });
    assert.equal(name.proposals[0]?.card.id, card.id);
    assert.equal(name.automaticAcceptance, false);
    const footer = proposeAcquisitionPrintings(index, { title: [alias], footer: ["ABC JA", "C 7"] });
    assert.equal(footer.status, "REVIEW_REQUIRED");
    assert.equal(footer.automaticAcceptance, false);
    assert(footer.proposals[0].reasons.includes("TITLE_EXACT"));
    assert(footer.proposals[0].reasons.includes("TITLE_CHARACTERS_REVIEW_REQUIRED"));
    const oriented = proposeOrientedAcquisitionPrintings(index, [
      { rotationDegrees: 0, text: { title: [alias], footer: [] } },
      { rotationDegrees: 180, text: { title: [], footer: [] } },
    ]);
    assert.equal(needsAcquisitionPhotoText(oriented), false);
  }
});

test("short exact titles expose contradictory printing evidence without borrowing agreement", () => {
  const index = createAcquisitionRecognitionIndex([
    { ...template, printedName: "山" },
    { ...template, id: "other", name: "Other alias", printedName: "沼", collectorNumber: "8" },
  ]);
  const result = proposeAcquisitionPrintings(index, { title: ["沼"], footer: ["ABC JA", "C 7"] });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.automaticAcceptance, false);
  const contradicted = result.proposals.find(p => p.card.id === template.id)!;
  assert(contradicted.reasons.includes("TITLE_CONTRADICTION"));
  assert(!contradicted.reasons.includes("TITLE_EXACT"));
  assert(result.proposals.some(p => p.card.id === "other"));
});

test("unknown short readings never use fuzzy retrieval or body substrings", () => {
  const index = createAcquisitionRecognitionIndex([{ ...template, printedName: "平地" }]);
  for (const title of ["平山", "地", "1", "12", "X", "ab", "\u0301", "!!!"])
    assert.equal(proposeAcquisitionPrintings(index, { title: [title], footer: [] }).proposals.length, 0);
  for (const title of ["1", "12", "X", "ab", "\u0301", "!!!"])
    assert.equal(acquisitionExactNameKeyEligible(acquisitionNameKey(title)), false);
  const marked = createAcquisitionRecognitionIndex([{ ...template, printedName: "ガ" }]);
  assert.equal(proposeAcquisitionPrintings(marked, { title: ["カ"], footer: [] }).proposals.length, 0);
});

test("whole-photo short names remain exact unlocalized hints with no printing confirmation", () => {
  const index = createAcquisitionRecognitionIndex([{ ...template, printedName: "山" }]);
  const base = proposeOrientedAcquisitionPrintings(index, []);
  const result = combineAcquisitionPhotoText(index, base, hints("山"));
  assert.equal(result.proposals[0]?.card.id, template.id);
  assert.equal(result.automaticAcceptance, false);
  assert.deepEqual(result.evidence, base.evidence);
  assert.deepEqual(result.orientation, base.orientation);
  assert(result.proposals[0].reasons.includes("UNLOCALIZED_NAME_HINT"));
  assert(!result.proposals[0].reasons.includes("TITLE_EXACT"));
  assert(!result.proposals[0].reasons.includes("SET_AND_COLLECTOR_TEXT"));
  for (const title of ["沼", "山を探す", "ab", "12", "!"])
    assert.equal(combineAcquisitionPhotoText(index, base, hints(title)), base);
});

test("short Unicode retrieval preserves orientation separation and ASCII acceptance", () => {
  const index = createAcquisitionRecognitionIndex([{ ...template, printedName: "山" }]);
  const result = proposeOrientedAcquisitionPrintings(index, [
    { rotationDegrees: 0, text: { title: ["山"], footer: [] } },
    { rotationDegrees: 180, text: { title: [], footer: ["ABC JA", "C 7"] } },
  ]);
  assert.equal(result.automaticAcceptance, false);
  assert.equal(result.orientation.status, "UNRESOLVED");
  const latin = createAcquisitionRecognitionIndex([{ ...template, name: "Fog" }]);
  assert.equal(proposeAcquisitionPrintings(latin, { title: ["Fog"], footer: ["ABC JA", "C 7"] }).automaticAcceptance, true);
});
