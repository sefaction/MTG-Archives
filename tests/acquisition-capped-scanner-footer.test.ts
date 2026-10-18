import test from "node:test";
import assert from "node:assert/strict";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {combineAcquisitionPhotoText,needsAcquisitionPhotoText,needsAcquisitionScannerFooter,type AcquisitionPhotoText} from "../lib/acquisition-photo-text";
import {combineAcquisitionCandidates} from "../lib/acquisition-visual";
const cards=Array.from({length:1000},(_,i)=>({id:String(i).padStart(4,"0"),name:"Island",setCode:"tst",collectorNumber:String(i+1),lang:"en"}));
const index=createAcquisitionRecognitionIndex(cards);
const reads=(footer:string[]=[])=>[{rotationDegrees:0,text:{title:["Island"],footer}},{rotationDegrees:180,text:{title:[],footer:[]}}];
const base=()=>proposeOrientedAcquisitionPrintings(index,reads());
const target=cards[989];
const photo=():AcquisitionPhotoText=>({version:1,scope:"WHOLE_PHOTO",status:"COMPLETE",readings:[{rotationDegrees:0,text:["Island"],truncated:false,scannerSource:{scope:"SCANNER_SOURCE_PIXELS",width:1000,height:1400,boundaryVerified:false,lines:[{text:"L 0990",polygon:[[60,1300],[180,1300],[180,1316],[60,1316]]},{text:"TST EN Artist",polygon:[[60,1325],[300,1325],[300,1341],[60,1341]]}]}}]});
test("a selected title with capped alternatives and no collector admits scanner footer evidence",()=>{
  const result=base();assert.equal(result.totalProposals,1000);assert.equal(result.proposals.length,12);
  assert.equal(result.proposals.some(p=>p.card.id===target.id),false);
  assert.equal(needsAcquisitionPhotoText(result),false);assert.equal(needsAcquisitionScannerFooter(result),true);
});
test("supported identifiers, uncapped names, conflicts and ambiguous directions retain existing admission",()=>{
  const capped=base(),small=proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex(cards.slice(0,2)),reads());
  const identified=proposeOrientedAcquisitionPrintings(index,reads(["L 0990","TST EN"]));
  for(const result of [small,identified,{...capped,status:"CONFLICT" as const},{...capped,automaticAcceptance:true},
      {...capped,orientation:{status:"UNRESOLVED" as const,rotationDegrees:null}},
      {...capped,evidence:{...capped.evidence,collectors:["990"]}},
      {...capped,proposals:capped.proposals.map(p=>({...p,reasons:["TITLE_CONTRADICTION"]}))}])
    assert.equal(needsAcquisitionScannerFooter(result),false);
  const unknown=proposeOrientedAcquisitionPrintings(index,[]);
  assert.equal(needsAcquisitionPhotoText(unknown),true);assert.equal(needsAcquisitionScannerFooter(unknown),false);
});
test("positioned footer rescues a cached printing beyond 12 in OCR-only and combined review",()=>{
  const original=base(),raw=photo(),frozen=JSON.stringify({original,raw});
  const result=combineAcquisitionPhotoText(index,original,raw);
  assert.equal(result.proposals[0].card.id,target.id);assert.equal(result.proposals.length,12);
  assert(result.proposals[0].reasons.includes("SCANNER_SOURCE_IDENTIFIERS"));
  assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(result.automaticAcceptance,false);
  const combined=combineAcquisitionCandidates(result,{candidates:[{scryfallId:cards[0].id}]},new Map(cards.map(c=>[c.id,c])));
  assert.equal(combined.proposals[0].card.id,target.id);assert.equal(combined.automaticAcceptance,false);
  assert.equal(JSON.stringify({original,raw}),frozen);
});
test("missing, bare, conflicting and misplaced footer evidence cannot invent supported printing",()=>{
  const variants=[photo(),photo(),photo(),photo(),photo()];
  delete variants[0].readings[0].scannerSource;
  variants[1].readings[0].scannerSource!.lines[0].text="0990";
  variants[2].readings[0].scannerSource!.lines.push({...structuredClone(variants[2].readings[0].scannerSource!.lines[0]),text:"L 0991"});
  variants[3].readings[0].scannerSource!.lines[1].polygon=[[400,1325],[580,1325],[580,1341],[400,1341]];
  variants[4].readings[0].scannerSource!.lines.splice(1,1);
  for(const raw of variants){const result=combineAcquisitionPhotoText(index,base(),raw);assert(!result.proposals.some(p=>p.reasons.includes("SCANNER_SOURCE_IDENTIFIERS")));assert.equal(result.automaticAcceptance,false);}
});
