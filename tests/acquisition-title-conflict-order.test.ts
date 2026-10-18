import test from "node:test";
import assert from "node:assert/strict";
import {createAcquisitionRecognitionIndex,proposeAcquisitionPrintings,proposeOrientedAcquisitionPrintings,type RecognitionCard,type RecognitionText} from "../lib/acquisition-recognition";
import {combineAcquisitionPhotoText,needsAcquisitionPhotoText} from "../lib/acquisition-photo-text";

const target:RecognitionCard={id:"z",name:"Cedar Colossus",setCode:"abc",collectorNumber:"197",lang:"en"};
const other:RecognitionCard={...target,id:"a",name:"Misty Passage",collectorNumber:"77"};
const readings:RecognitionText[]=[
 {title:[target.name],footer:["077","U0197","ABC EN"]},
 {title:["X "+target.name],footer:["R0197","ABC EN"],footerSupplemental:["R077"]},
 {title:[target.name],footer:["172","U0197","ABC EN"]},
 {title:[target.name],footer:["R197","R019","ABC EN"]},
];

for(const [i,input] of readings.entries())test("corroborated title leads conflicting identifier tier "+i,()=>{
 const conflicting={...other,collectorNumber:i===2?"172":i===3?"19":"77"};
 for(const reverse of [false,true])for(const swapIds of [false,true]){
  const cards=[{...target,id:swapIds?"a":"z"},{...conflicting,id:swapIds?"z":"a"}];
  if(reverse)cards.reverse();
  const index=createAcquisitionRecognitionIndex(cards);
  const raw=JSON.stringify(input);
  for(const mode of ["direct","oriented"]){
   const result=mode==="direct"?proposeAcquisitionPrintings(index,input):proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:input},{rotationDegrees:180,text:{title:[],footer:[]}}]);
   assert.equal(result.proposals[0].card.name,target.name);
   assert(result.proposals[0].reasons.includes(i===1?"TITLE_FRAGMENT":"TITLE_TEXT_AGREES"));
   assert(result.proposals[1].reasons.includes(i===1?"TITLE_UNCONFIRMED":"TITLE_CONTRADICTION"));
   assert.equal(result.totalProposals,2);assert.equal(result.status,i===1?"REVIEW_REQUIRED":"CONFLICT");assert.equal(result.automaticAcceptance,false);
   assert(result.proposals.every(p=>p.reasons.includes("REVIEW_REQUIRED")&&!p.reasons.includes("STRONG_EXACT_PRINTING")));
  }
  assert.equal(JSON.stringify(input),raw);
  const capped=proposeAcquisitionPrintings(index,input,1);
  assert.equal(capped.proposals[0].card.name,target.name);assert.equal(capped.totalProposals,2);assert.equal(capped.truncated,true);assert.equal(capped.status,i===1?"REVIEW_REQUIRED":"CONFLICT");
 }
});

test("same-name editions and List counterparts remain uncertain alternatives",()=>{
 const cards=[target,other,{...target,id:"variant",collectorNumber:"311"},{...target,id:"list",setCode:"plst",collectorNumber:"ABC-197"}];
 const result=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex(cards),{title:[target.name],footer:["U197","R311","R77","ABC EN"]});
 assert.deepEqual(new Set(result.proposals.slice(0,3).map(p=>p.card.id)),new Set(["z","variant","list"]));
 assert.equal(result.proposals.at(-1)!.card.id,"a");assert.equal(result.automaticAcceptance,false);assert.equal(result.status,"CONFLICT");
 for(const id of ["z","list"])assert(result.proposals.find(p=>p.card.id===id)!.reasons.includes("STAMP_UNVERIFIED"));
});

test("missing, typo-only and ambiguous titles do not acquire invented agreement",()=>{
 const index=createAcquisitionRecognitionIndex([target,other]);
 for(const title of [[],["Cedar Colossvs"],["unreadable"]]){
  const result=proposeAcquisitionPrintings(index,{title,footer:["U197","R77","ABC EN"]});
  assert.deepEqual(result.proposals.map(p=>p.card.id),["a","z"]);
  assert(result.proposals.every(p=>p.reasons.includes("TITLE_UNCONFIRMED")&&!p.reasons.includes("TITLE_TEXT_AGREES")));
  assert.equal(result.automaticAcceptance,false);
 }
 const ambiguous=proposeAcquisitionPrintings(index,{title:[target.name,other.name],footer:["U197","R77","ABC EN"]});
 assert.deepEqual(ambiguous.proposals.map(p=>p.card.id),["a","z"]);assert.equal(ambiguous.automaticAcceptance,false);
});

test("strict short, Unicode and face titles keep existing recognition authority",()=>{
 for(const name of ["Fog","雪", "Front // Back"]){
  const c={...target,name,faceNames:name.includes("//")?["Printed Back"]:undefined};
  const title=name.includes("//")?"Printed Back":name;
  const index=createAcquisitionRecognitionIndex([c,other]);
  const result=proposeAcquisitionPrintings(index,{title:[title],footer:["U197","ABC EN"]});
  assert.equal(result.proposals[0].card.id,target.id);
  assert.equal(result.automaticAcceptance,name!=="雪");
 }
});

test("identifier precedence and whole-photo hint policy remain bounded to existing scope",()=>{
 const index=createAcquisitionRecognitionIndex([target,other]);
 const result=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[target.name],footer:["R77","ABC EN"]}},{rotationDegrees:180,text:{title:[],footer:[]}}]);
 // This batch only repairs ordering within equal identifier tiers.
 assert.equal(result.proposals[0].card.id,other.id);assert.equal(result.status,"CONFLICT");assert.equal(result.automaticAcceptance,false);
 const empty=proposeOrientedAcquisitionPrintings(index,[]);
 const hinted=combineAcquisitionPhotoText(index,empty,{version:1,scope:"WHOLE_PHOTO",status:"COMPLETE",readings:[{rotationDegrees:0,text:[target.name],truncated:false}]});
 assert(hinted.proposals[0].reasons.includes("UNLOCALIZED_NAME_HINT"));assert.equal(hinted.automaticAcceptance,false);assert.equal(needsAcquisitionPhotoText(empty),true);
});
