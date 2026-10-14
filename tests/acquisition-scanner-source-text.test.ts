import test from "node:test";
import assert from "node:assert/strict";
import { observedScannerIdentifiers, scannerSourceTextSchema, type ScannerSourceText } from "../lib/acquisition-scanner-source-text";
import { acquisitionPhotoTextSchema, combineAcquisitionPhotoText, readAcquisitionPhotoText, type AcquisitionPhotoText } from "../lib/acquisition-photo-text";
import { acquisitionCatalogQueries } from "../lib/acquisition-catalog-queries";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {combineAcquisitionCandidates} from "../lib/acquisition-visual";
const box=(text:string,x=60,y=1300):ScannerSourceText["lines"][number]=>({text,polygon:[[x,y],[x+180,y],[x+180,y+16],[x,y+16]]});
const source=():ScannerSourceText=>({scope:"SCANNER_SOURCE_PIXELS",width:1000,height:1400,boundaryVerified:false,
  lines:[box("153/264 C"),box("WAR·EN Josh Hass",60,1325)]});
const photo=(scannerSource=source()):AcquisitionPhotoText=>({version:1,scope:"WHOLE_PHOTO",status:"COMPLETE",
  readings:[{rotationDegrees:0,text:["Band Together","Instant"],truncated:false,scannerSource}]});
const card={id:"war",name:"Band Together",setCode:"war",collectorNumber:"153",lang:"en"};
const others=[{...card,id:"clu",setCode:"clu",collectorNumber:"156"},{...card,id:"list",setCode:"plst",collectorNumber:"WAR-153"}];
const index=createAcquisitionRecognitionIndex([...others,card]);const empty=()=>proposeOrientedAcquisitionPrintings(index,[]);
test("explicit nearby source rows retrieve printing and promote same-direction name without a physical frame",()=>{
  assert.deepEqual(observedScannerIdentifiers(source()),{set:"war",language:"en",number:"153"});
  assert.deepEqual(acquisitionCatalogQueries([],photo()).printings,[{kind:"printing",set:"war",language:"en",number:"153"}]);
  const result=combineAcquisitionPhotoText(index,empty(),photo(),["clu"]);
  assert.equal(result.proposals[0].card.id,"list"); // original and stamped share their printed footer
  assert.deepEqual(result.proposals.filter(p=>p.reasons.includes("SCANNER_SOURCE_IDENTIFIERS")).map(p=>p.card.id),["list","war"]);
  assert.equal(result.automaticAcceptance,false);assert.equal(result.status,"REVIEW_REQUIRED");
  assert.deepEqual(result.evidence,empty().evidence);assert.deepEqual(result.orientation,empty().orientation);
  assert.ok(result.proposals.every(p=>!p.reasons.includes("TITLE_EXACT")&&!p.reasons.includes("STRONG_EXACT_PRINTING")));
  const combined=combineAcquisitionCandidates(result,{candidates:[{scryfallId:"clu"}]},new Map(others.map(c=>[c.id,c])));
  assert.notEqual(combined.proposals[0].card.id,"clu");assert.equal(combined.automaticAcceptance,false);
});
test("bare numbers, P/T, years, missing markers, distant/reversed rows and conflicts remain unknown",()=>{
  for(const lines of [[box("2/3"),box("WAR EN",60,1325)], [box("153"),box("WAR EN",60,1325)],
    [box("C 1993"),box("WAR EN",60,1325)], [box("153/264 C")],
    [box("153/264 C"),box("WAR EN",350,1325)], [box("153/264 C",60,1350),box("WAR EN",60,1300)],
    [box("153/264 C"),box("WAR EN",60,1390)], [box("153/264 C"),box("WAR EN",60,1325),box("154/264 C")],
    [box("153/264 C"),box("WAR EN",60,1325),box("M21 EN",60,1325)]])
    assert.equal(observedScannerIdentifiers({...source(),lines}),null);
  assert.deepEqual(observedScannerIdentifiers({...source(),lines:[box("R 00153"),box("WAR EN",60,1325)]}),{set:"war",language:"en",number:"153"});
});
test("source schema rejects body boxes, invalid frames, inferred outlines and unbounded observations",()=>{
  for(const altered of [{width:1400,height:1000},{width:1000,height:1401.5},{boundaryVerified:true},
    {lines:[box("153/264 C",60,900)]},{lines:[box("WAR EN",900,1300)]},
    {lines:Array.from({length:13},()=>box("WAR EN"))},
    {lines:[{text:"WAR EN",polygon:[[0,1300],[NaN,1300],[180,1316],[0,1316]]}]}])
    assert.equal(scannerSourceTextSchema.safeParse({...source(),...altered}).success,false);
});
test("different directions cannot lend title/footer agreement; absent legacy positions do not change results",()=>{
  const raw=photo();raw.readings[0].text=["Instant","Rules"];
  raw.readings.push({rotationDegrees:180,text:[card.name],truncated:false});
  const result=combineAcquisitionPhotoText(index,empty(),raw,["clu"]);
  assert.equal(result.proposals[0].card.id,"clu");assert.ok(result.proposals.every(p=>!p.reasons.includes("SCANNER_SOURCE_IDENTIFIERS")));
  const legacy=photo();delete legacy.readings[0].scannerSource;
  assert.deepEqual(acquisitionCatalogQueries([],legacy).printings,[]);
  assert.equal(combineAcquisitionPhotoText(index,empty(),legacy,["clu"]).proposals[0].card.id,"clu");
  assert.equal(acquisitionPhotoTextSchema.safeParse(photo()).success,true);
});
test("source positions require CARD_SCAN and unchanged photo/model/progress identity",async()=>{
  const expected={photoDigest:"a".repeat(64),descriptor:"b".repeat(64)};
  const envelope={...expected,recognitionTask:"WHOLE_PHOTO_TEXT",photoText:photo()};
  for(const kind of ["PHOTO","CARD_SCAN"] as const){
    const result=await readAcquisitionPhotoText(async()=>envelope,Buffer.from("scan"),kind,expected,new AbortController().signal);
    assert.equal(result.status,kind==="CARD_SCAN"?"COMPLETE":"UNAVAILABLE");
  }
  const result=await readAcquisitionPhotoText(async(_bytes,_signal,progress)=>{
    progress!({...envelope,progress:true,photoText:{...photo(),status:"PARTIAL"}});
    const changed=photo();changed.readings[0].scannerSource!.width=999;
    return {...envelope,photoText:changed};
  },Buffer.from("scan"),"CARD_SCAN",expected,new AbortController().signal);
  assert.equal(result.status,"UNAVAILABLE");assert.deepEqual(result.readings,[]);
});
