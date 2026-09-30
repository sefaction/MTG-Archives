import test from "node:test";
import assert from "node:assert/strict";
import {acquisitionFooterIdentifiers} from "../lib/acquisition-footer";
import {createAcquisitionRecognitionIndex,proposeAcquisitionPrintings,proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {acquisitionCatalogQueries} from "../lib/acquisition-catalog-queries";

test("separated collector and glued artist markers reach local recognition and unknown-set fallback",()=>{
  for(const [set,number,footer] of [
    ["dmc","178",["178","R","TM & © 2022 Wizards of the Coast","DMC·ENChrIS RAHN"]],
    ["dmc","181",["181","TM & © 2022 Wizards of the Coast","DMCEN Ryan Alexander Lee"]],
    ["onc","128",["128","TM & © 2023 Wizards of the Coast","OnC ·EN Ryan Alexander Lee"]],
    ["eoe","263",["0263","TM & © 2025 Wizards of the Coast","EOE • ENADAM PAQUETTE"]],
    ["fin","304",["L0304 FFIV","FIN• ENRANDY GALLEGOS"]],
  ] as const){
    const text={title:["A Test Card"],footer:[...footer]};
    const card={id:"expected",name:"A Test Card",setCode:set,collectorNumber:number,lang:"en"};
    const result=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([card]),text);
    assert.deepEqual(result.evidence,{setCodes:[set],collectors:[number],languages:["en"]});
    assert.equal(result.proposals[0].card.id,card.id);
    assert(result.proposals[0].reasons.includes("SET_AND_COLLECTOR_TEXT"));
    assert(result.proposals[0].reasons.includes("RECOVERED_FOOTER_LAYOUT"));
    assert.equal(result.automaticAcceptance,false,"newly recovered layout does not expand automatic confirmation");
    assert.equal(proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([]),text).status,"NO_MATCH");
    assert.deepEqual(acquisitionCatalogQueries([{rotationDegrees:0,text}]).printings,
      [{kind:"printing",set,number,language:"en"}],"fallback extraction does not need a local record");
  }
});

test("footer recovery requires context from the same orientation and retains ambiguity",()=>{
  for(const lines of [["178"],["Artist Frank Herbert","178"],["EOE • ENARTIST","2/3"],["EOE EN","2025"]])
    assert.deepEqual(acquisitionFooterIdentifiers(lines).collectors,[]);
  assert.deepEqual(acquisitionFooterIdentifiers(["EOE EN","R","2003"]).collectors,["2003"]);
  assert.deepEqual(acquisitionFooterIdentifiers(["EOE EN","178","179"]).collectors,["178","179"]);
  const card={id:"card",name:"Test Card",setCode:"abc",collectorNumber:"178",lang:"en"};
  const index=createAcquisitionRecognitionIndex([card]);
  const orientations=[{rotationDegrees:0,text:{title:[card.name],footer:["ABC EN"]}},
    {rotationDegrees:180,text:{title:[],footer:["178"]}}];
  assert.deepEqual(acquisitionCatalogQueries(orientations).printings,[]);
  assert.equal(proposeOrientedAcquisitionPrintings(index,orientations).automaticAcceptance,false);
});

test("copyright years are not rarity-prefixed collectors; actual fractions and identity suffixes survive",()=>{
  assert.deepEqual(acquisitionFooterIdentifiers(["C1993-2008 Wizards of the Coast, Inc. 203/301"]).collectors,["203"]);
  assert.deepEqual(acquisitionFooterIdentifiers(["C1996 Wizards of the Coast"]).collectors,[]);
  assert.deepEqual(acquisitionFooterIdentifiers(["C 2003"]).collectors,["2003"]);
  for(const suffix of ["a","★","†"]){
    assert.deepEqual(acquisitionFooterIdentifiers([`C 00123${suffix}`]).collectors,[`123${suffix}`]);
    assert.deepEqual(acquisitionFooterIdentifiers(["ABC EN",`00123${suffix}`]).collectors,[`123${suffix}`]);
  }
  assert.throws(()=>acquisitionFooterIdentifiers(Array(101).fill("x")));
  assert.throws(()=>acquisitionFooterIdentifiers(["x".repeat(2001)]));
});
