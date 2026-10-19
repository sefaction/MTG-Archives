import test from "node:test";
import assert from "node:assert/strict";
import { createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { ACQUISITION_PHOTO_TEXT_POLICY_VERSION, combineAcquisitionPhotoText, needsAcquisitionScannerFooter, type AcquisitionPhotoText } from "../lib/acquisition-photo-text";
const cards = [
  { id: "wrong", name: "Cruel Calculations", setCode: "plst", collectorNumber: "WAR-26", lang: "en" },
  { id: "right", name: "Cruel Calculations", setCode: "war", collectorNumber: "336", lang: "en" },
];
const index = createAcquisitionRecognitionIndex(cards);
const base = () => proposeOrientedAcquisitionPrintings(index, [
  { rotationDegrees: 0, text: { title: [cards[0].name], footer: [] } },
  { rotationDegrees: 180, text: { title: [], footer: [] } },
]);
test("uncapped distinct same-name printings request the missing footer without automatic authority", () => {
  const original = base();
  // Force the alternative first: the natural current catalogue already sorts 336 first.
  original.proposals.sort((a,b) => Number(b.card.id === "wrong") - Number(a.card.id === "wrong"));
  const frozen = JSON.stringify(original);
  assert.equal(original.truncated, false);
  assert.equal(original.totalProposals, 2);
  assert.equal(original.proposals[0].card.id, "wrong");
  assert.equal(needsAcquisitionScannerFooter(original), true);
  const raw: AcquisitionPhotoText = { version: 1, scope: "WHOLE_PHOTO", status: "COMPLETE", readings: [{
    rotationDegrees: 0, text: [cards[0].name], truncated: false,
    scannerSource: { scope: "SCANNER_SOURCE_PIXELS", width: 1000, height: 1400, boundaryVerified: false, lines: [
      { text: "R 0336", polygon: [[60,1300],[180,1300],[180,1316],[60,1316]] },
      { text: "WAR EN Artist", polygon: [[60,1325],[300,1325],[300,1341],[60,1341]] },
    ] },
  }] };
  const result = combineAcquisitionPhotoText(index, original, raw);
  assert.equal(result.proposals[0].card.id, "right");
  assert(result.proposals[0].reasons.includes("SCANNER_SOURCE_IDENTIFIERS"));
  assert.equal(result.automaticAcceptance, false);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(new Set(result.proposals.map(p => p.card.id)), new Set(["wrong", "right"]));
  assert.equal(JSON.stringify(original), frozen);
});
test("uncapped admission rejects duplicate IDs, mixed identities, weak titles and contradictory alternatives", () => {
  const original = base();
  for (const changed of [
    { ...original, proposals: [original.proposals[0]] },
    { ...original, proposals: [original.proposals[0], original.proposals[0]] },
    { ...original, proposals: original.proposals.map((p,i) => i ? { ...p, card: { ...p.card, name: "Another Card" } } : p) },
    { ...original, proposals: original.proposals.map(p => ({ ...p, reasons: ["TITLE_FRAGMENT"] })) },
    { ...original, proposals: original.proposals.map((p,i) => i ? { ...p, reasons: [...p.reasons,"TITLE_CONTRADICTION"] } : p) },
    { ...original, status: "CONFLICT" as const },
    { ...original, automaticAcceptance: true },
    { ...original, orientation: { status: "UNRESOLVED" as const, rotationDegrees: null } },
    { ...original, evidence: { ...original.evidence, collectors: ["26"] } },
  ]) assert.equal(needsAcquisitionScannerFooter(changed), false);
  assert.equal(ACQUISITION_PHOTO_TEXT_POLICY_VERSION, "ambiguous-scanner-footer-v3");
});
