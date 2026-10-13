import test from "node:test";
import assert from "node:assert/strict";
import { createAcquisitionRecognitionIndex } from "../lib/acquisition-recognition";
import { combineAcquisitionReferenceReadings } from "../lib/acquisition-reference-text";
const cards=[{id:"first",name:"Forest",setCode:"aaa",collectorNumber:"1",lang:"en"},
  {id:"second",name:"Island",setCode:"bbb",collectorNumber:"2",lang:"en"}];
const index=createAcquisitionRecognitionIndex(cards);
const reading=(title:string[],footer:string[])=>({orientations:[
  {rotationDegrees:0,text:{title,footer}},{rotationDegrees:180,text:{title:[],footer:[]}}]});
test("positive inferred footer remains review-only with distinct reading provenance",()=>{
  const result=combineAcquisitionReferenceReadings(index,reading([],[]),reading(["Forest"],["001","AAA EN"]));
  assert.equal(result.proposals[0].card.id,"first");assert.equal(result.automaticAcceptance,false);
  assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(result.finish,"UNKNOWN");assert.equal(result.condition,"UNKNOWN");
  assert(result.proposals[0].reasons.includes("REFERENCE_OCR_OBSERVATION"));
  assert(result.proposals[0].reasons.includes("REFERENCE_ANCHOR_INFERRED"));
  assert(!result.proposals[0].reasons.includes("STRONG_EXACT_PRINTING"));
});
test("a conflicting primary printing remains alongside an inferred match",()=>{
  const result=combineAcquisitionReferenceReadings(index,reading(["Island"],["002","BBB EN"]),reading(["Forest"],["001","AAA EN"]));
  assert.equal(result.status,"CONFLICT");assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(new Set(result.proposals.map(p=>p.card.id)),new Set(["first","second"]));
  assert.deepEqual(new Set(result.evidence.setCodes),new Set(["aaa","bbb"]));
  assert(result.proposals.find(p=>p.card.id==="second")!.reasons.includes("PRIMARY_OCR_OBSERVATION"));
});
test("a primary contradiction cannot disappear when the refined frame has no reading",()=>{
  const result=combineAcquisitionReferenceReadings(index,reading(["Forest"],["002","BBB EN"]),reading([],[]));
  assert.equal(result.status,"CONFLICT");assert.equal(result.automaticAcceptance,false);
  assert(result.proposals.length>0);
});
test("different frames cannot manufacture title/footer agreement",()=>{
  const result=combineAcquisitionReferenceReadings(index,reading(["Island"],[]),reading([],["001","AAA EN"]));
  assert.equal(result.status,"CONFLICT");assert.equal(result.automaticAcceptance,false);
  assert(result.proposals.every(p=>!p.reasons.includes("STRONG_EXACT_PRINTING")));
  assert.equal(result.orientation.status,"UNRESOLVED");
});
test("matching independent readings retain both origins without duplicate proposals",()=>{
  const source=reading(["Forest"],["001","AAA EN"]),before=structuredClone(source);
  const result=combineAcquisitionReferenceReadings(index,source,source);
  assert.equal(result.proposals.length,1);assert.equal(result.status,"REVIEW_REQUIRED");
  assert(result.proposals[0].reasons.includes("PRIMARY_OCR_OBSERVATION"));
  assert(result.proposals[0].reasons.includes("REFERENCE_OCR_OBSERVATION"));assert.deepEqual(source,before);
});

test('later artwork refinement keeps earlier scanner-layout readings and conflicts',()=>{
  const primary={...reading(['Forest'],['001','AAA EN']),scannerLayout:{readingStatus:'COMPLETE',
    ...reading(['Island'],['002','BBB EN'])}};
  const before=structuredClone(primary);
  const result=combineAcquisitionReferenceReadings(index,primary,reading([],[]));
  assert.equal(result.status,'CONFLICT');assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(new Set(result.proposals.map(p=>p.card.id)),new Set(['first','second']));
  assert(result.proposals.some(p=>p.reasons.includes('SCANNER_LAYOUT_OCR_OBSERVATION')));
  assert.deepEqual(primary,before);
});
