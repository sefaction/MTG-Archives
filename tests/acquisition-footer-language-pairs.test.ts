import test from "node:test";
import assert from "node:assert/strict";
import { createAcquisitionRecognitionIndex, proposeAcquisitionPrintings, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { acquisitionCatalogQueries } from "../lib/acquisition-catalog-queries";
import { combineAcquisitionCandidates } from "../lib/acquisition-visual";

const name = "Synthetic language-pair card";
const cards = [
  { id: "a-abc-en", setCode: "abc", lang: "en" }, { id: "b-abc-fr", setCode: "abc", lang: "fr" },
  { id: "c-xyz-en", setCode: "xyz", lang: "en" }, { id: "d-xyz-fr", setCode: "xyz", lang: "fr" },
].map(card => ({ ...card, name, collectorNumber: "7" }));
const text = { title: [name], footer: ["ABC FR", "XYZ EN", "C 7"] };
const supported = (result: ReturnType<typeof proposeAcquisitionPrintings>) => result.proposals
  .filter(p => p.reasons.includes("SET_AND_COLLECTOR_TEXT")).map(p => p.card.id);

test("local footer support keeps the set/language pairs used by external lookup", () => {
  const result = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex(cards), text);
  assert.deepEqual(supported(result), ["b-abc-fr", "c-xyz-en"]);
  assert.deepEqual(acquisitionCatalogQueries([{rotationDegrees: 0, text}]).printings,
    [{kind: "printing", set: "abc", number: "7", language: "fr"}, {kind: "printing", set: "xyz", number: "7", language: "en"}]);
  assert.equal(result.status, "REVIEW_REQUIRED"); assert.equal(result.automaticAcceptance, false);
});

test("another set's supported language does not hide a missing-language contradiction", () => {
  const result = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([cards[0], cards[2]]), text);
  const fallback = result.proposals.find(p => p.card.id === cards[0].id)!;
  assert(fallback.reasons.includes("LANGUAGE_CONTRADICTION"));
  assert.equal(result.status, "CONFLICT"); assert.equal(result.automaticAcceptance, false);
  assert(!result.proposals.find(p => p.card.id === cards[2].id)!.reasons.includes("LANGUAGE_CONTRADICTION"));
});

test("List aliases use their printed source set while same-set language ambiguity stays review-only", () => {
  const aliases = cards.map(card => ({...card, id: card.id + "-list", setCode: "plst", collectorNumber: `${card.setCode.toUpperCase()}-0007`}));
  const result = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex(aliases), text);
  assert.deepEqual(supported(result), ["b-abc-fr-list", "c-xyz-en-list"]);
  assert(result.proposals.every(p => p.reasons.includes("STAMP_UNVERIFIED")));
  const ambiguous = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex(cards), {title: [name], footer: ["ABC FR", "ABC EN", "C 7"]});
  assert.deepEqual(supported(ambiguous), ["a-abc-en", "b-abc-fr"]);
  assert.equal(ambiguous.automaticAcceptance, false);
  const single = proposeAcquisitionPrintings(createAcquisitionRecognitionIndex(cards), {title: [name], footer: ["ABC FR", "C 7"]});
  assert.deepEqual(supported(single), ["b-abc-fr"]); assert.equal(single.automaticAcceptance, true);
});

test("orientation separation and image union cannot manufacture paired footer support", () => {
  const index = createAcquisitionRecognitionIndex(cards);
  const separated = proposeOrientedAcquisitionPrintings(index, [{rotationDegrees: 0, text: {title: [name], footer: ["ABC FR"]}},
    {rotationDegrees: 180, text: {title: [], footer: ["XYZ EN", "C 7"]}}]);
  assert(!supported(separated).some(id => id.startsWith("a-") || id.startsWith("b-")));
  assert.equal(separated.automaticAcceptance, false);
  const resolved = proposeOrientedAcquisitionPrintings(index, [{rotationDegrees: 0, text},
    {rotationDegrees: 180, text: {title: [], footer: []}}]);
  const visual = {candidates: [{scryfallId: "wrong-image", referenceId: "wrong-image:0", name, setCode: "abc", collectorNumber: "7",
    distance: 0.01, rotationDegrees: 0}], geometricCandidates: []};
  const combined = combineAcquisitionCandidates(resolved, visual as any, new Map([["wrong-image", cards[0]]]));
  assert.deepEqual(supported(combined), ["b-abc-fr", "c-xyz-en"]);
  assert.equal(combined.proposals[0].card.id, "b-abc-fr"); assert.equal(combined.automaticAcceptance, false);
});
