import assert from "node:assert/strict";
import {test} from "node:test";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../../lib/acquisition-recognition";
import {observedScope} from "./observed_scope";
const cards=[
 {id:"source",name:"Timberland Ancient",setCode:"mom",collectorNumber:"210",lang:"en"},
 {id:"list",name:"Timberland Ancient",setCode:"plst",collectorNumber:"MOM-210",lang:"en"},
 {id:"other",name:"Timberland Ancient",setCode:"xln",collectorNumber:"99",lang:"en"},
 {id:"different",name:"Unrelated Card",setCode:"mom",collectorNumber:"211",lang:"en"},
];
const index=createAcquisitionRecognitionIndex(cards);
function observed(title:string,footer:string[]){return [{rotationDegrees:0 as const,text:{title:[title],footer}},{rotationDegrees:180 as const,text:{title:[],footer:[]}}]}
test("printed source identifiers retain the original and stamped counterpart",()=>{
 const o=observed("Timberland Ancient",["210/281 C","MOM • EN"]);const primary=proposeOrientedAcquisitionPrintings(index,o);
 assert.deepEqual(observedScope(index,primary,o)?.ids.sort(),["list","source"]);
});
test("name alone expands the full family rather than truth-selected top candidates",()=>{
 const o=observed("Timberland Ancient",[]);const primary=proposeOrientedAcquisitionPrintings(index,o);
 assert.deepEqual(observedScope(index,primary,o)?.ids.sort(),["list","other","source"]);
});
test("conflicting footer and title cannot confine the image search to a wrong printing",()=>{
 const o=observed("Unrelated Card",["210/281 C","MOM • EN"]);const primary=proposeOrientedAcquisitionPrintings(index,o);
 assert.equal(primary.status,"CONFLICT");assert.equal(observedScope(index,primary,o),null);
});
test("unreadable title cannot manufacture a name scope",()=>{
 const o=observed("??",[]);assert.equal(observedScope(index,proposeOrientedAcquisitionPrintings(index,o),o),null);
});
