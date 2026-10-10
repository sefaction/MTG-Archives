import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionFooterIdentifiers, acquisitionFooterObservations } from "../lib/acquisition-footer";
import { createAcquisitionRecognitionIndex, proposeAcquisitionPrintings, proposeOrientedAcquisitionPrintings } from "../lib/acquisition-recognition";
import { acquisitionCatalogQueries } from "../lib/acquisition-catalog-queries";

const card = {id:"shadow",name:"Thousand-Faced Shadow",setCode:"neo",collectorNumber:"86",lang:"en"};
const index = createAcquisitionRecognitionIndex([card]);
const original = ["086/302 R", "TM & © 2022 Wizards of the Coast", "NEOENEKATERinA BURMaK"];
const separate = ["086/302 R", "TM & © 2022 Wizards of the Coast", "NEOEN EkAterina Burmak"];

test("an independently read footer can recover printing evidence without guessing the joined artist prefix", () => {
  assert.deepEqual(acquisitionFooterIdentifiers(original).identifiers, []);
  const input = {title:[card.name],footer:[...original],footerSupplemental:[...separate]};
  const result = proposeAcquisitionPrintings(index,input);
  assert.deepEqual(result.evidence,{setCodes:["neo"],collectors:["86"],languages:["en"]});
  assert.equal(result.proposals[0].card.id,card.id);
  assert(result.proposals[0].reasons.includes("SET_AND_COLLECTOR_TEXT"));
  assert(result.proposals[0].reasons.includes("RECOVERED_FOOTER_LAYOUT"));
  assert.equal(result.status,"REVIEW_REQUIRED"); assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(acquisitionCatalogQueries([{rotationDegrees:0,text:input}]).printings,
    [{kind:"printing",set:"neo",number:"86",language:"en"}]);
  assert.deepEqual(input.footer, original); assert.deepEqual(input.footerSupplemental,separate);
  assert.deepEqual(acquisitionFooterObservations(original,original).identifiers,[]);
});

test("duplicate supplemental evidence preserves a supported original match; new conflicts require review", () => {
  const primary={title:[card.name],footer:["NEO EN","086/302 R"]};
  assert.equal(proposeAcquisitionPrintings(index,primary).automaticAcceptance,true);
  assert.equal(proposeAcquisitionPrintings(index,{...primary,footerSupplemental:["086/302 R","NEO EN"]}).automaticAcceptance,true);
  const conflict=proposeAcquisitionPrintings(index,{...primary,footerSupplemental:["NEO FR","087/302 R"]});
  assert.equal(conflict.automaticAcceptance,false);
  assert.deepEqual(conflict.evidence.languages,["en","fr"]);
  assert.deepEqual(conflict.evidence.collectors,["86","87"]);
  assert(conflict.proposals[0].reasons.includes("RECOVERED_FOOTER_LAYOUT"));
});

test("supplemental readings cannot combine across orientation or convert bare years and artist words into identifiers", () => {
  const result=proposeOrientedAcquisitionPrintings(index,[
    {rotationDegrees:0,text:{title:[card.name],footer:["086/302 R"]}},
    {rotationDegrees:180,text:{title:[],footer:[],footerSupplemental:["NEO EN"]}},
  ]);
  assert(!result.proposals.some(p=>p.reasons.includes("SET_AND_COLLECTOR_TEXT")));
  assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(acquisitionCatalogQueries([
    {rotationDegrees:0,text:{title:[card.name],footer:["086/302 R"]}},
    {rotationDegrees:180,text:{title:[],footer:[],footerSupplemental:["NEO EN"]}},
  ]).printings,[]);
  assert.deepEqual(acquisitionFooterObservations([], ["Artist Frank Herbert", "2025"]).identifiers,[]);
  assert.deepEqual(acquisitionFooterObservations(["NEO EN"], ["2025"]).collectors,[]);
  assert.throws(()=>acquisitionFooterObservations(Array(100).fill(""),["NEO EN"]),/bounds/);
  assert.throws(()=>acquisitionFooterObservations([], ["x".repeat(2001)]),/bounds/);
});
import { acquisitionReviewEvidence } from "../lib/acquisition-review-evidence";

test("owner review retains both readings and their real footer boxes without runtime internals", () => {
  const line={text:"NEOEN",score:0.9,polygon:[[80,1310],[180,1310],[180,1335],[80,1335]]};
  const output={native:{descriptorDetails:{privatePath:"do-not-expose"},geometry:{status:"PROPOSED",method:"full-frame",quad:[[0,0],[1,0],[1,1],[0,1]]},orientations:[{rotationDegrees:0,text:{title:[card.name],footer:original,footerSupplemental:separate},lines:[],footerLines:[line]}]},proposals:{orientation:{status:"SELECTED",rotationDegrees:0},evidence:{setCodes:["neo"],collectors:["86"],languages:["en"]}}};
  const evidence=acquisitionReviewEvidence(output);
  assert(evidence);
  assert.deepEqual(evidence.observations[0].text.footer,original);
  assert.deepEqual(evidence.observations[0].text.footerSupplemental,separate);
  assert.deepEqual(evidence.observations[0].footerLines,[line]);
  assert(!JSON.stringify(evidence).includes("do-not-expose"));
});
