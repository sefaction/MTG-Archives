import test from "node:test";
import assert from "node:assert/strict";
import {
  printingNativeSchema, printingSummarySchema, applyAcquisitionPrintingEvidence, acquisitionPrintingSummary,
} from "../lib/acquisition-printing";
import {createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {combineAcquisitionCandidates} from "../lib/acquisition-visual";

const originalId="11111111-1111-4111-8111-111111111111";
const stampedId="22222222-2222-4222-8222-222222222222";
const original={id:"local-original",name:"Green Guard",setCode:"abc",collectorNumber:"17",lang:"en"};
const stamped={...original,id:"local-stamped",setCode:"plst",collectorNumber:"ABC-17"};
const cards=new Map([[originalId,original],[stampedId,stamped]]);
const source=proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([original,stamped]),[
  {rotationDegrees:0,text:{title:[original.name],footer:["ABC EN","C 17"]}},
  {rotationDegrees:180,text:{title:[],footer:[]}},
]);
const union=combineAcquisitionCandidates(source,{candidates:[{scryfallId:originalId},{scryfallId:stampedId}]},cards);
function printing(){return printingNativeSchema.parse({
  version:"registered-printing-runtime-v1",observedStamp:"PRESENT",conflictingObservations:false,automaticAcceptance:false,
  candidates:[originalId,stampedId].map((scryfallId,i)=>({
    scryfallId,referenceId:scryfallId+":0",referenceStampState:i?"PRESENT":"ABSENT",
    relation:i?"AGREES_WITH_STAMP_STATE":"CONTRADICTS_STAMP_STATE",
    stamp:{status:"PRESENT",reason:"LOCAL_SYMBOL_SHAPE"},
    alignment:{status:"ALIGNED",stampVisible:true,footerVisible:true,sourceCardWidth:1000},
  })),
});}
test("observed stamp demotes an original while retaining it for human correction",()=>{
  const evidence=printing(), before=JSON.stringify([union,evidence]);
  const result=applyAcquisitionPrintingEvidence(union,evidence,cards);
  assert.equal(result.proposals[0].card.id,stamped.id);
  assert(result.proposals[0].reasons.includes("STAMP_PRESENT"));
  assert(result.proposals.find(p=>p.card.id===original.id)?.reasons.includes("STAMP_CONTRADICTION"));
  assert.equal(result.automaticAcceptance,false);
  assert.equal(JSON.stringify([union,evidence]),before);
});

test("stamp agreement orders only matching printed families and retains unresolved counterparts",()=>{
  const otherId="33333333-3333-4333-8333-333333333333";
  const other={...original,id:"local-other",name:"Blue Guard",collectorNumber:"88"};
  const source={...union,proposals:[union.proposals.find(p=>p.card.id===stamped.id)!,
    {card:other,reasons:["VISUAL_MATCH","REVIEW_REQUIRED"],nameDistance:null},
    union.proposals.find(p=>p.card.id===original.id)!]};
  const evidence=printing(); evidence.observedStamp="ABSENT";
  evidence.candidates[0].relation="AGREES_WITH_STAMP_STATE";
  evidence.candidates[0].stamp={status:"ABSENT",reason:"VISIBLE_REFERENCE_AGREEMENT"};
  evidence.candidates[1].referenceStampState="UNKNOWN";
  evidence.candidates[1].relation="UNRESOLVED";
  evidence.candidates[1].stamp={status:"UNREADABLE",reason:"NO_VERIFIED_REFERENCE"};
  evidence.candidates.push({...evidence.candidates[0],scryfallId:otherId,referenceId:otherId+":0"});
  const before=JSON.stringify([source,evidence]);
  const result=applyAcquisitionPrintingEvidence(source,printingNativeSchema.parse(evidence),new Map([...cards,[otherId,other]]));
  assert.deepEqual(result.proposals.map(p=>p.card.id),[original.id,other.id,stamped.id]);
  assert(result.proposals[2].reasons.includes("STAMP_UNREADABLE"));
  assert(!result.proposals[2].reasons.includes("STAMP_CONTRADICTION"));
  assert.equal(result.automaticAcceptance,false);
  assert.equal(JSON.stringify([source,evidence]),before);
});
test("unreadable and unannotated references do not establish absence or contradiction",()=>{
  const evidence=printing(); evidence.observedStamp="UNREADABLE";
  for(const candidate of evidence.candidates){
    candidate.referenceStampState="UNKNOWN"; candidate.relation="UNRESOLVED";
    candidate.stamp={status:"UNREADABLE",reason:"NO_VERIFIED_UNSTAMPED_REFERENCE"};
  }
  const result=applyAcquisitionPrintingEvidence(union,evidence,cards);
  assert.deepEqual(result.proposals.map(p=>p.card.id),union.proposals.map(p=>p.card.id));
  assert(result.proposals.every(p=>p.reasons.includes("STAMP_UNREADABLE")));
  assert(result.proposals.every(p=>!p.reasons.includes("STAMP_ABSENT") && !p.reasons.includes("STAMP_CONTRADICTION")));
});
test("conflicting observations hold every printing for review",()=>{
  const evidence=printing(); evidence.observedStamp="UNREADABLE"; evidence.conflictingObservations=true;
  for(const candidate of evidence.candidates)candidate.relation="UNRESOLVED";
  const result=applyAcquisitionPrintingEvidence(union,evidence,cards);
  assert.equal(result.status,"CONFLICT"); assert.equal(result.automaticAcceptance,false);
  assert(result.proposals.every(p=>p.reasons.includes("STAMP_EVIDENCE_CONFLICT")));
});
test("native evidence rejects mismatched identity, clipped support and invented certainty",()=>{
  const value=printing();
  assert.equal(printingNativeSchema.safeParse({...value,automaticAcceptance:true}).success,false);
  assert.equal(printingNativeSchema.safeParse({...value,conflictingObservations:true}).success,false);
  for(const change of [
    {referenceId:stampedId+":0"}, {referenceStampState:"UNKNOWN"},
    {alignment:{status:"UNREADABLE"}},
    {alignment:{status:"ALIGNED",stampVisible:false,footerVisible:true,sourceCardWidth:1000}},
  ]) assert.equal(printingNativeSchema.safeParse({...value,candidates:[{...value.candidates[0],...change}]}).success,false);
});
test("review summary uses stable local identities and omits native metrics and paths",()=>{
  const value=printing();
  value.candidates[0].stamp.footerSharpness=123;
  value.candidates[0].alignment.matches=321;
  const stored=printingNativeSchema.parse(value);
  assert.equal(stored.candidates[0].stamp.footerSharpness,123);
  assert.equal(stored.candidates[0].alignment.matches,321);
  const summary=acquisitionPrintingSummary(stored,new Map([[stampedId,stamped]]));
  assert.equal(summary.candidates[0].cardId,null);
  assert.equal(summary.candidates[1].cardId,stamped.id);
  assert.equal(JSON.stringify(summary).includes(originalId),false);
  assert.equal(JSON.stringify(summary).includes("sourceCardWidth"),false);
  assert.equal(JSON.stringify(summary).includes("footerSharpness"),false);
});

function unannotatedPrinting() {
  const value=printing();
  for(const candidate of value.candidates){
    candidate.referenceStampState="UNKNOWN";
    candidate.relation="UNRESOLVED";
  }
  return printingNativeSchema.parse(value);
}

test("catalog stamp expectation resolves actual original/List counterparts with unannotated images",()=>{
  const value=unannotatedPrinting(), before=JSON.stringify([union,value,cards]);
  const result=applyAcquisitionPrintingEvidence(union,value,cards);
  assert.equal(result.proposals[0].card.id,stamped.id);
  assert(result.proposals[0].reasons.includes("STAMP_PRESENT"));
  assert(result.proposals[1].reasons.includes("STAMP_CONTRADICTION"));
  const summary=printingSummarySchema.parse(acquisitionPrintingSummary(value,cards));
  assert.deepEqual(summary.candidates.map(c=>[c.expectedStampState,c.expectationSource,c.referenceRelation]),[
    ["ABSENT","CATALOG_SOURCE_PRINTING","UNRESOLVED"],
    ["PRESENT","CATALOG_LIST_REPRINT","UNRESOLVED"],
  ]);
  assert.equal(result.automaticAcceptance,false);
  assert.equal(JSON.stringify([union,value,cards]),before);
});

test("catalog expectation is distinct from a reference annotation; unreadable pixels still stay unresolved",()=>{
  const value=printing();
  value.candidates[1].referenceStampState="ABSENT";
  value.candidates[1].relation="CONTRADICTS_STAMP_STATE";
  const summary=acquisitionPrintingSummary(printingNativeSchema.parse(value),cards);
  assert.equal(summary.candidates[1].expectedStampState,"PRESENT");
  assert.equal(summary.candidates[1].referenceStampState,"ABSENT");
  assert.equal(summary.candidates[1].referenceRelation,"CONTRADICTS_STAMP_STATE");
  assert.equal(summary.candidates[1].relation,"AGREES_WITH_STAMP_STATE");
  value.observedStamp="UNREADABLE";
  for(const c of value.candidates){c.stamp.status="UNREADABLE";c.relation="UNRESOLVED";}
  assert(acquisitionPrintingSummary(printingNativeSchema.parse(value),cards).candidates.every(c=>c.relation==="UNRESOLVED"));
  const legacy={observedStamp:"UNREADABLE",conflictingObservations:false,candidates:[{
    cardId:original.id,stamp:"UNREADABLE",referenceStampState:"UNKNOWN",relation:"UNRESOLVED",reason:"UNREADABLE",
  }]};
  assert.equal(printingSummarySchema.safeParse(legacy).success,true,"saved older evidence still renders");
});

test("unknown treatments and unproposed catalog counterparts are not assumed unstamped",()=>{
  const value=unannotatedPrinting();
  const other={...original,id:"other",setCode:"mb2",collectorNumber:"9"};
  const malformed={...stamped,collectorNumber:"17"};
  for(const unsupported of [other,malformed,{...stamped,digital:true}]){
    const map=new Map([[originalId,original],[stampedId,unsupported]]);
    assert(acquisitionPrintingSummary(value,map).candidates.every(c=>c.expectedStampState==="UNKNOWN"));
  }
  const onlyOriginal={...value,candidates:[value.candidates[0]]};
  assert.equal(acquisitionPrintingSummary(onlyOriginal,cards).candidates[0].expectedStampState,"UNKNOWN");
});

test("catalog relations require visible physical evidence or validated same-outline transfer",()=>{
  const value=unannotatedPrinting();
  const quad: [number,number][]=[[0,0],[1000,0],[1000,1397],[0,1397]];
  const target=value.candidates[1];
  target.stamp.status="UNREADABLE";
  target.alignment.quad=quad;
  value.candidates[0].alignment.quad=quad;
  assert.equal(acquisitionPrintingSummary(value,cards).candidates[1].relation,"UNRESOLVED");
  target.sharedObservationSources=[value.candidates[0].referenceId];
  assert.equal(acquisitionPrintingSummary(value,cards).candidates[1].relation,"AGREES_WITH_STAMP_STATE");
  target.alignment.quad=quad.map(([x,y])=>[x+20,y]);
  assert.equal(acquisitionPrintingSummary(value,cards).candidates[1].relation,"UNRESOLVED");
  for(const change of [
    {status:"UNREADABLE" as const}, {stampVisible:false}, {footerVisible:false}, {sourceCardWidth:499},
  ]){
    const bad={...value,candidates:[value.candidates[0],{...target,stamp:{...target.stamp,status:"PRESENT" as const},
      alignment:{...target.alignment,...change}}]};
    assert.equal(acquisitionPrintingSummary(printingNativeSchema.parse(bad),cards).candidates[1].relation,"UNRESOLVED");
  }
  const conflict={...value,observedStamp:"UNREADABLE" as const,conflictingObservations:true};
  assert(acquisitionPrintingSummary(printingNativeSchema.parse(conflict),cards).candidates.every(c=>c.relation==="UNRESOLVED"));
});
