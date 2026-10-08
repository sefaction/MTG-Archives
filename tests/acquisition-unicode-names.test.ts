import test from "node:test";
import assert from "node:assert/strict";
import {acquisitionNameKey} from "../lib/acquisition-name";
import {createAcquisitionRecognitionIndex, proposeAcquisitionPrintings, proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {acquisitionPhotoNameKey, combineAcquisitionPhotoText} from "../lib/acquisition-photo-text";

const first={id:"first",name:"Synthetic first card",printedName:"Верная карта 123",setCode:"abc",collectorNumber:"7",lang:"ru"};
const other={id:"other",name:"Synthetic other card",printedName:"Совсем другая 123",setCode:"xyz",collectorNumber:"8",lang:"ru"};
const orientations=(title:string[],footer:string[]=[])=>[{rotationDegrees:0,text:{title,footer}},{rotationDegrees:180,text:{title:[],footer:[]}}];

test("name keys preserve non-Latin letters and marks while retaining Latin folding",()=>{
  assert.equal(acquisitionNameKey("  Éowyn, Shieldmaiden! "),"eowynshieldmaiden");
  assert.notEqual(acquisitionNameKey(first.printedName),acquisitionNameKey(other.printedName));
  for(const name of ["Огненный элементаль","火の精霊","Δράκος","𠀋カード"])
    assert.equal(acquisitionPhotoNameKey(name),acquisitionNameKey(name));
  assert.notEqual(acquisitionNameKey("й"),acquisitionNameKey("и"));
  assert.notEqual(acquisitionNameKey("ガ"),acquisitionNameKey("カ"));
  assert.equal(acquisitionNameKey("\u0301 \u0302!!!"),"");
});

test("different Cyrillic titles sharing digits cannot falsely confirm a footer printing",()=>{
  const result=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([first,other]),{title:[other.printedName],footer:["ABC RU","C 7"]});
  assert.equal(result.automaticAcceptance,false);assert.equal(result.status,"CONFLICT");
  assert(result.proposals.find(p=>p.card.id===first.id)!.reasons.includes("TITLE_CONTRADICTION"));
  assert(!result.proposals.find(p=>p.card.id===first.id)!.reasons.includes("TITLE_EXACT"));
  assert(result.proposals.some(p=>p.card.id===other.id));
  const unknown=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([first]),{title:[other.printedName],footer:["ABC RU","C 7"]});
  assert.equal(unknown.automaticAcceptance,false);assert(!unknown.proposals[0].reasons.includes("TITLE_EXACT"));
});

test("non-Latin printed and face aliases retrieve candidates without expanding automatic acceptance",()=>{
  for(const alias of ["Огненный элементаль","火の精霊","Δράκος"]){
    for(const card of [{...first,printedName:alias},{...first,printedName:null,faceNames:[alias]}]){
      const index=createAcquisitionRecognitionIndex([card]);
      const nameOnly=proposeAcquisitionPrintings(index,{title:[alias],footer:[]});
      assert.equal(nameOnly.proposals[0]?.card.id,first.id);assert.equal(nameOnly.automaticAcceptance,false);
      const exact=proposeAcquisitionPrintings(index,{title:[alias],footer:["ABC RU","C 7"]});
      assert.equal(exact.status,"REVIEW_REQUIRED");assert.equal(exact.automaticAcceptance,false);
      assert(exact.proposals[0].reasons.includes("TITLE_EXACT"));assert(exact.proposals[0].reasons.includes("NON_LATIN_TITLE_REVIEW_REQUIRED"));
    }
  }
  const latin={...first,printedName:"Éowyn, Shieldmaiden"};
  const result=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([latin]),{title:["Eowyn Shieldmaiden"],footer:["ABC RU","C 7"]});
  assert.equal(result.automaticAcceptance,true,"established Latin normalization retains its existing gate");
});

test("whole-photo Unicode hints use the same key without supplying located title or footer evidence",()=>{
  const index=createAcquisitionRecognitionIndex([first,other]);const base=proposeOrientedAcquisitionPrintings(index,orientations([]));
  const result=combineAcquisitionPhotoText(index,base,{version:1,scope:"WHOLE_PHOTO",status:"COMPLETE",readings:[{rotationDegrees:0,text:[other.printedName],truncated:false}]});
  assert.deepEqual(result.proposals.map(p=>p.card.id),[other.id]);assert.equal(result.automaticAcceptance,false);
  assert.deepEqual(result.evidence,{setCodes:[],collectors:[],languages:[]});
  assert(result.proposals[0].reasons.includes("UNLOCALIZED_NAME_HINT"));assert(!result.proposals[0].reasons.includes("TITLE_EXACT"));
  const separated=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[first.printedName],footer:[]}},{rotationDegrees:180,text:{title:[],footer:["ABC RU","C 7"]}}]);
  assert.equal(separated.automaticAcceptance,false);assert.equal(separated.orientation.status,"UNRESOLVED");
});
