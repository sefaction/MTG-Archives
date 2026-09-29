import test from "node:test";
import assert from "node:assert/strict";
import {
  combineAcquisitionCandidates,
  visualNativeSchema,
} from "../lib/acquisition-visual";
import {
  createAcquisitionRecognitionIndex,
  proposeOrientedAcquisitionPrintings,
} from "../lib/acquisition-recognition";
import { acquisitionReviewEvidence } from "../lib/acquisition-review-evidence";
import { acquisitionRecognitionDto } from "../lib/acquisition-recognition-dto";

const external = "3b022c4f-d231-4c8e-a924-b27c85e69756";
const card = {
  id: "stable-local-card-id",
  name: "Forest Guard",
  setCode: "abc",
  collectorNumber: "1",
  lang: "en",
};
const visual = visualNativeSchema.parse({
  version: 1,
  descriptor: "a".repeat(64),
  photoDigest: "b".repeat(64),
  referenceCount: 112472,
  unavailableCount: 899,
  geometry: { status: "NEEDS_CROP" },
  inputRegion: "WHOLE_PHOTO",
  milliseconds: 1,
  automaticAcceptance: false,
  candidates: [
    {
      scryfallId: external,
      referenceId: `${external}:0`,
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      distance: 0,
      rotationDegrees: 270,
    },
  ],
});
function text(title: string[] = [], footer: string[] = []) {
  return proposeOrientedAcquisitionPrintings(
    createAcquisitionRecognitionIndex([card]),
    [
      { rotationDegrees: 0, text: { title, footer } },
      { rotationDegrees: 180, text: { title: [], footer: [] } },
    ],
  );
}
test("image-only retrieval rescues unreadable text using the stable local identity", () => {
  const result = combineAcquisitionCandidates(
    text(),
    visual,
    new Map([[external, card]]),
  );
  assert.equal(result.proposals[0].card.id, card.id);
  assert(result.proposals[0].reasons.includes("VISUAL_MATCH"));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.automaticAcceptance, false);
});
test("image and text agreement deduplicates candidates without manufacturing certainty", () => {
  const observed = text([card.name], ["C 001", "ABC EN"]);
  assert.equal(observed.automaticAcceptance, true);
  const before = JSON.stringify(observed);
  const result = combineAcquisitionCandidates(
    observed,
    visual,
    new Map([[external, card]]),
  );
  assert.equal(result.proposals.length, 1);
  assert(result.proposals[0].reasons.includes("TITLE_EXACT"));
  assert(result.proposals[0].reasons.includes("VISUAL_MATCH"));
  assert(!result.proposals[0].reasons.includes("STRONG_EXACT_PRINTING"));
  assert.equal(result.automaticAcceptance, false);
  assert.equal(JSON.stringify(observed), before);
});
test("printing identifiers stay ahead of disagreeing visual retrieval", () => {
  const other = { ...card, id: "other-local-id", name: "River Guard" };
  const result = combineAcquisitionCandidates(
    text([card.name], ["C 001", "ABC EN"]),
    visual,
    new Map([[external, other]]),
  );
  assert.equal(result.proposals[0].card.id, card.id);
  assert.equal(result.proposals[1].card.id, other.id);
  assert.equal(result.automaticAcceptance, false);
});

test("matching title and identifiers precede an explicitly contradicted footer candidate", () => {
  const wrong = {...card,id:"aaa-wrong-card",name:"River Guard",collectorNumber:"2"};
  const observed = proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([card,wrong]),[
    {rotationDegrees:0,text:{title:[card.name],footer:["ABC EN","C 001","C 002"]}},
    {rotationDegrees:180,text:{title:[],footer:[]}},
  ]);
  const before=JSON.stringify(observed);
  const result=combineAcquisitionCandidates(observed,visual,new Map([[external,wrong]]));
  assert.equal(result.proposals[0].card.id,card.id);
  assert(result.proposals.some(p=>p.card.id===wrong.id && p.reasons.includes("TITLE_CONTRADICTION")));
  assert.equal(result.status,"CONFLICT");
  assert.equal(result.automaticAcceptance,false);
  assert.equal(JSON.stringify(observed),before);
});

test("title and collector evidence precede an unrelated image when set text is unreadable", () => {
  const wrong={...card,id:"other-image-id",name:"River Guard",collectorNumber:"99"};
  const result=combineAcquisitionCandidates(text([card.name],["C 001"]),visual,new Map([[external,wrong]]));
  assert.equal(result.proposals[0].card.id,card.id);
  assert(result.proposals[0].reasons.includes("SET_UNCONFIRMED"));
  assert.equal(result.proposals[1].card.id,wrong.id);
  assert.equal(result.automaticAcceptance,false);
});

test("image agreement resolves same-name same-number ties without inventing set or language text", ()=>{
  const older = {...card, id: "aaa-earlier-local-id", name: "Mountain", setCode: "cm2", collectorNumber: "304"};
  const expected = {...older, id: "zzz-image-supported", setCode: "fin"};
  const observed = proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([older, expected]),[
    {rotationDegrees: 0, text: {title: ["Mountain"], footer: ["L0304 FFIV", "FIN• ENRANDY GALLEGOS"]}},
    {rotationDegrees: 180, text: {title: [], footer: []}},
  ]);
  assert.equal(observed.proposals[0].card.id, older.id, "reproduces prior local-ID order");
  const before = JSON.stringify(observed);
  const result = combineAcquisitionCandidates(observed,
    {candidates: [{scryfallId: external}], geometricCandidates: [{scryfallId: external}]},
    new Map([[external, expected]]));
  assert.equal(result.proposals[0].card.id, expected.id);
  assert.equal(result.proposals[1].card.id, older.id);
  assert.deepEqual(result.evidence.setCodes, []);
  assert.deepEqual(result.evidence.languages, []);
  assert.equal(result.automaticAcceptance, false);
  assert.equal(JSON.stringify(observed), before);
});

test("a partial title cannot remove a contradicted identifier match at the review limit", () => {
  const observed=text();
  observed.proposals=[{card, nameDistance:null, reasons:["SET_AND_COLLECTOR_TEXT","TITLE_CONTRADICTION"]}];
  const wrong={...card,id:"other-image-id",name:"River Guard",collectorNumber:"99"};
  const second={...wrong,id:"second-image-id"};
  const result=combineAcquisitionCandidates(observed,{candidates:[{scryfallId:external},{scryfallId:"second"}]},
    new Map([[external,wrong],["second",second]]),2);
  assert.equal(result.proposals.length,2);
  assert.equal(result.proposals[0].card.id,wrong.id);
  assert.equal(result.proposals[1].card.id,card.id);
  assert(result.proposals[1].reasons.includes("TITLE_CONTRADICTION"));
  assert.equal(result.automaticAcceptance,false);
});
test("missing catalog identity is explicit and is never fabricated as a local printing", () => {
  const result = combineAcquisitionCandidates(text(), visual, new Map());
  assert.equal(result.proposals.length, 0);
  assert.equal(result.totalProposals, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.automaticAcceptance, false);
  assert.equal(
    visualNativeSchema.safeParse({ ...visual, automaticAcceptance: true })
      .success,
    false,
  );
});
test("review reports actual visual retrieval independently of unreadable OCR and strips internals", () => {
  const evidence = acquisitionReviewEvidence({
    visual: { ...visual, privatePath: "must-not-leak" },
    native: { geometry: { status: "NEEDS_CROP" }, orientations: [] },
    proposals: { evidence: { setCodes: [], collectors: [], languages: [] } },
  });
  assert.equal(evidence?.imageMatches?.candidates[0].rotationDegrees, 270);
  assert.equal(evidence?.imageMatches?.inputRegion, "WHOLE_PHOTO");
  assert.deepEqual(evidence?.observations, []);
  assert(!JSON.stringify(evidence).includes("private"));
  assert(!JSON.stringify(evidence).includes("descriptor"));
  assert(!JSON.stringify(evidence).includes("distance"));
});

test("pending or failed visual work cannot confirm legacy text evidence or disappear as unreadable", () => {
  const output = {
    proposals: text([card.name], ["C 001", "ABC EN"]),
    catalog: { status: "RESOLVED", printingCoverage: "CHECKED" },
  };
  for (const state of ["WAITING", "RUNNING", "FAILED"] as const) {
    const response = acquisitionRecognitionDto("COMPLETE", output, state);
    assert.equal(response.visualStatus, state);
    assert.equal(response.result?.automaticAcceptance, false);
    assert.equal(response.result?.proposals[0].card.id, card.id);
    if (state === "FAILED")
      assert.equal(response.catalog?.status, "INCOMPLETE");
  }
});

test("SIFT candidates add evidence without removing an independently useful image candidate", () => {
  const secondId = "e151f8ec-e971-454d-8159-d6db801a3cd7";
  const second = { ...card, id: "sift-local-id", name: "River Guard" };
  const result = combineAcquisitionCandidates(
    text(),
    {
      candidates: [{ scryfallId: external }],
      geometricCandidates: [{ scryfallId: secondId }],
    },
    new Map([
      [external, card],
      [secondId, second],
    ]),
  );
  assert.equal(result.proposals.length, 2);
  assert(
    result.proposals.some(
      (p) => p.card.id === card.id && p.reasons.includes("VISUAL_MATCH"),
    ),
  );
  assert(
    result.proposals.some(
      (p) => p.card.id === second.id && p.reasons.includes("SIFT_CANDIDATE"),
    ),
  );
  assert.equal(result.automaticAcceptance, false);
});
