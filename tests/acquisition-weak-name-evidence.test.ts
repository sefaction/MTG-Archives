import test from "node:test";
import assert from "node:assert/strict";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings,type RecognitionCard} from "../lib/acquisition-recognition";
import {combineAcquisitionPhotoText,needsAcquisitionPhotoText,type AcquisitionPhotoText} from "../lib/acquisition-photo-text";
import {combineAcquisitionCandidates} from "../lib/acquisition-visual";
const card:RecognitionCard={id:"z",name:"Pilot's Kitesail",setCode:"abc",collectorNumber:"173",lang:"en"};
const short={...card,id:"a",name:"Kitesail",collectorNumber:"126"};
const hints=(text:string[]):AcquisitionPhotoText=>({version:1,scope:"WHOLE_PHOTO",status:"COMPLETE",readings:[{rotationDegrees:0,text,truncated:false}]});
const propose=(cards:RecognitionCard[],title:string[],footer:string[]=[])=>{const index=createAcquisitionRecognitionIndex(cards);return {index,result:proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title,footer}},{rotationDegrees:180,text:{title:[],footer:[]}}])};};

test("a contained shorter name stays available but cannot suppress whole-photo fallback",()=>{
 for(const footer of [[],["R126"],["R126","ABC EN"]]){
  const {result}=propose([short],[card.name],footer);
  assert.equal(result.proposals[0].card.id,short.id);assert(result.proposals[0].reasons.includes("TITLE_FRAGMENT"));
  assert(!result.proposals[0].reasons.some(r=>["TITLE_TEXT","TITLE_TEXT_AGREES","TITLE_AND_COLLECTOR_TEXT","TITLE_EXACT"].includes(r)));
  assert.equal(needsAcquisitionPhotoText(result),true);assert.equal(result.automaticAcceptance,false);
 }
});

test("a full supported title leads a contained-name alternative regardless of IDs or insertion",()=>{
 for(const swap of [false,true])for(const reverse of [false,true]){
  const records=[{...card,id:swap?"a":"z"},{...short,id:swap?"z":"a"}];if(reverse)records.reverse();const {result}=propose(records,[card.name]);
  assert.equal(result.proposals[0].card.name,card.name);assert.equal(result.proposals.length,2);assert.equal(result.automaticAcceptance,false);assert.equal(needsAcquisitionPhotoText(result),false);
 }
});

test("partial OCR does not manufacture a contradiction against a different identifier candidate",()=>{
 const other={...card,id:"other",name:"Cloud Ranger",collectorNumber:"7"};const {result}=propose([short,other],[card.name],["R7","ABC EN"]);
 assert.equal(result.proposals[0].card.id,other.id);assert(!result.proposals[0].reasons.includes("TITLE_CONTRADICTION"));assert.equal(result.automaticAcceptance,false);assert.equal(result.status,"REVIEW_REQUIRED");assert.deepEqual(result.evidence.collectors,["7"]);
});

test("unlocalized short body and shared spell-face hints cannot displace supported title identity",()=>{
 const other={...short,name:"Turn // Burn",faceNames:["Turn","Burn"]};
 for(const title of [card.name,"Printed Sail"]){
  const proper={...card,printedName:"Printed Sail"},records=[other,proper],{index,result}=propose(records,[title]);const raw=hints(["Turn.","Burn"]),frozen=JSON.stringify({result,raw});
  const photo=combineAcquisitionPhotoText(index,result,raw,[other.id]);assert.equal(photo.proposals[0].card.id,proper.id);assert.equal(photo.automaticAcceptance,false);assert(photo.proposals.find(p=>p.card.id===other.id)!.reasons.includes("UNLOCALIZED_NAME_HINT"));
  const combined=combineAcquisitionCandidates(photo,{candidates:[{scryfallId:other.id}]},new Map(records.map(c=>[c.id,c])));assert.equal(combined.proposals[0].card.id,proper.id);assert.equal(combined.automaticAcceptance,false);assert.equal(JSON.stringify({result,raw}),frozen);
 }
});

test("known full front identity leads another card sharing an unlocalized spell-face alias",()=>{
 const front={...card,name:"Heartwood Crafter // Soul Tether",faceNames:["Heartwood Crafter","Soul Tether"]},other={...short,name:"Echo Mage // Soul Tether",faceNames:["Echo Mage","Soul Tether"]};const records=[other,front],{index,result}=propose(records,["Heartwood Crafter"]);const photo=combineAcquisitionPhotoText(index,result,hints(["Soul Tether"]),[other.id]);assert.equal(photo.proposals[0].card.id,front.id);assert.equal(photo.automaticAcceptance,false);
 assert.equal(combineAcquisitionCandidates(photo,{candidates:[{scryfallId:other.id}]},new Map(records.map(c=>[c.id,c]))).proposals[0].card.id,front.id);
});

test("image-supported same-full-name printings survive a capped title group without acquiring certainty",()=>{
 const cards=Array.from({length:30},(_,i)=>({...card,id:String(i).padStart(3,"0"),collectorNumber:String(i+1)}));cards.push({...card,id:"list",setCode:"plst",collectorNumber:"ABC-26"});const {index,result}=propose(cards,[card.name]);assert.equal(result.proposals.length,12);assert.equal(result.truncated,true);
 const photo=combineAcquisitionPhotoText(index,result,hints([card.name]),["025"]);assert.equal(photo.proposals[0].card.id,"025");assert.equal(photo.totalProposals,31);assert.equal(photo.automaticAcceptance,false);
 const combined=combineAcquisitionCandidates(photo,{candidates:[{scryfallId:"025"}]},new Map(cards.map(c=>[c.id,c])));assert.equal(combined.proposals[0].card.id,"025");assert.equal(combined.automaticAcceptance,false);assert(combined.proposals.some(p=>p.card.id==="025"&&!p.reasons.includes("TITLE_EXACT")));
});

test("short Unicode and face names retain exact fast paths; missing titles keep honest hint retrieval",()=>{
 for(const name of ["Fog","山","Front // Back"]){const c={...card,name,faceNames:name.includes("//")?["Printed Back"]:[]};const {result}=propose([c],[name.includes("//")?"Printed Back":name]);assert.equal(needsAcquisitionPhotoText(result),false);assert(!result.proposals[0].reasons.includes("TITLE_FRAGMENT"));}
 const {index,result}=propose([card],[]);const photo=combineAcquisitionPhotoText(index,result,hints([card.name]));assert.equal(photo.proposals[0].card.id,card.id);assert(photo.proposals[0].reasons.includes("UNLOCALIZED_NAME_HINT"));assert(!photo.proposals[0].reasons.includes("TITLE_EXACT"));assert.equal(photo.automaticAcceptance,false);
});

test("exact identity with a contained-name ambiguity does not gain automatic acceptance",()=>{
 const {result}=propose([card,short],[card.name],["R173","ABC EN"]);assert.equal(result.automaticAcceptance,false);assert(result.proposals[0].reasons.includes("REVIEW_REQUIRED"));
 const exact=propose([card],[card.name],["R173","ABC EN"]).result;assert.equal(exact.automaticAcceptance,true);
});
