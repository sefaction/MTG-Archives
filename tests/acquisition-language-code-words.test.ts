import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionBatchLanguages, acquisitionObservedLanguages, acquisitionBatchLanguageCandidates, acquisitionBatchLanguageAgrees, acquisitionObservedLanguageEvidence } from "../lib/acquisition-batch-language";
import { acquisitionFooterObservations } from "../lib/acquisition-footer";
import { createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings, type RecognitionCard, type RecognitionText } from "../lib/acquisition-recognition";

const english: RecognitionCard = { id: "english", name: "Forest Guard", setCode: "abc", collectorNumber: "123a", lang: "en" };
const index = createAcquisitionRecognitionIndex([english, { ...english, id: "french", lang: "fr" }]);
const base: RecognitionText = { title: [english.name], footer: ["R 123a", "ABC"] };
const directions = (first: RecognitionText, second: RecognitionText = { title: [], footer: [] }) => [
  { rotationDegrees: 0, text: first }, { rotationDegrees: 180, text: second },
];

for (const channel of ["footer", "footerSupplemental", "footerSourceIdentifiers", "opposite"] as const) {
  test(`readable FR artist-line word vetoes borrowed language through ${channel}`, () => {
    const input = channel === "opposite" ? directions(base, { title: [], footer: ["FR Alice"] }) :
      directions({ ...base, [channel]: channel === "footer" ? [...base.footer, "FR Alice"] : ["FR Alice"] });
    const before = structuredClone(input), ordinary = proposeOrientedAcquisitionPrintings(index, input);
    assert.deepEqual(acquisitionObservedLanguages(input), ["fr"]);
    assert.deepEqual(acquisitionBatchLanguageCandidates(index, input), []);
    assert.equal(acquisitionBatchLanguageAgrees({ native: { orientations: input } }, "en"), false);
    const conflicting = proposeOrientedAcquisitionPrintings(index, input, 12, "en");
    assert.equal(conflicting.status, "CONFLICT");
    assert.equal(conflicting.automaticAcceptance, false);
    assert.equal(proposeOrientedAcquisitionPrintings(index, input, 12, "fr").automaticAcceptance, false,
      "An agreeing readable word cannot manufacture a positive set/language identifier");
    assert.deepEqual(input, before);
    assert.deepEqual(proposeOrientedAcquisitionPrintings(index, input), ordinary);
  });
}

test("every supported complete code word is a bounded observation beside other footer text", () => {
  for (const language of acquisitionBatchLanguages) {
    const input = directions({ ...base, footer: [...base.footer, `© ${language.toUpperCase()} • PainterNameIsLong`] });
    assert.deepEqual(acquisitionObservedLanguages(input), [language]);
    assert.deepEqual(acquisitionBatchLanguageCandidates(index, input), []);
    assert.deepEqual(acquisitionFooterObservations(input[0].text.footer).identifiers, [],
      "Words do not become a fabricated joined footer identifier");
  }
});

test("language substrings inside longer words or identifiers are not standalone code words", () => {
  for (const word of ["FRA", "AFR", "XFRY", "FR2", "2FR", "FR_Alice", "FRançais", "漢FR字", "forest", "zhsx"]) {
    const input = directions({ ...base, footer: [...base.footer, word] });
    assert.deepEqual(acquisitionObservedLanguages(input), [], word);
  }
});

test("code-word uncertainty survives saved-channel and opposite-direction agreement checks", () => {
  const input = directions({ ...base, footerSupplemental: ["EN PainterNameIsLong"] },
    { title: [], footer: [], footerSourceIdentifiers: ["FR Alice"] });
  const output = { native: { orientations: input } };
  assert.deepEqual(acquisitionObservedLanguageEvidence(output)?.sort(), ["en", "fr"]);
  assert.equal(acquisitionBatchLanguageAgrees(output, "en"), false);
  assert.equal(acquisitionBatchLanguageAgrees(output, "fr"), false);
  assert.deepEqual(acquisitionBatchLanguageCandidates(index, input), []);
});
