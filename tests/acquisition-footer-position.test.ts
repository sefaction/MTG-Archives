import test from 'node:test';import assert from 'node:assert/strict';
import {acquisitionFooterObservations,type FooterSpatialReading} from '../lib/acquisition-footer';
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';
import {acquisitionCatalogQueries} from '../lib/acquisition-catalog-queries';
const line=(text:string,left=90,top=1300,right=240,bottom=1329)=>({text,polygon:[[left,top],[right,top],[right,bottom],[left,bottom]]});
const text={title:['Great Oak Guardian'],footer:['170/302 U','C19 · EN Steven Belledin'],footerSupplemental:['47J','170/302 U','C19 · EN Steven Belledin']};
const spatial={lines:[line('170/302')],footerLines:[line('47J',844,1270,920,1290),line('170/302 U')],identifierLines:[line('170/302')]};
const parse=(s?:FooterSpatialReading,t=text)=>acquisitionFooterObservations(t.footer,t.footerSupplemental,[],s);

test('same-frame explicit lower-left collector separates isolated upper-right noise without editing OCR',()=>{
  const original=JSON.stringify({text,spatial});
  assert.deepEqual(parse().collectors,['170','47j']);
  assert.deepEqual(parse(spatial).collectors,['170']);assert.equal(parse(spatial).recoveredLayout,true);
  const card={id:'correct',name:text.title[0],setCode:'c19',collectorNumber:'170',lang:'en'};
  const readings=[{rotationDegrees:0,text,...spatial},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}];
  const proposed=proposeOrientedAcquisitionPrintings(createAcquisitionRecognitionIndex([card]),readings);
  assert.deepEqual(proposed.evidence.collectors,['170']);assert.equal(proposed.proposals[0].card.id,'correct');
  assert.equal(proposed.automaticAcceptance,false);assert(proposed.proposals[0].reasons.includes('RECOVERED_FOOTER_LAYOUT'));
  assert.deepEqual(acquisitionCatalogQueries(readings).printings,[{kind:'printing',set:'c19',number:'170',language:'en'}]);
  assert.equal(JSON.stringify({text,spatial}),original);
});

test('absent, conflicting, wrong-region and invalid boxes retain isolated collector uncertainty',()=>{
  const cases:FooterSpatialReading[]=[
    {},{footerLines:[spatial.footerLines[0]]},
    {...spatial,lines:[line('170/302'),line('171/302')],identifierLines:[]},
    {...spatial,lines:[line('C19')],identifierLines:[],footerLines:[spatial.footerLines[0]]},
    {...spatial,footerLines:[line('47J',500,1270,620,1290)]},
    {...spatial,footerLines:[line('47J',844,1305,920,1335)]},
    {...spatial,footerLines:[line('47J',844,1269,920,1290)]},
    {...spatial,footerLines:[line('47J',844,1270,1000,1290)]},
    {...spatial,footerLines:[{text:'47J',polygon:[[844,1270],[920,1290]]}]},
    {...spatial,footerLines:[line('47J',NaN,1270,920,1290)]},
    {...spatial,footerLines:[line('47J',844,1270,920,1290),line('47J',50,1270,150,1290)]},
  ];
  for(const value of cases)assert.deepEqual(parse(value).collectors,['170','47j']);
  // A sole isolated number on an older layout remains recoverable.
  assert.deepEqual(acquisitionFooterObservations(['ABC EN'],['47J'],[],{footerLines:[spatial.footerLines[0]]}).collectors,['47j']);
});

test('explicit fractions and rarity numbers, source and primary readings, and other directions survive',()=>{
  for(const number of ['47/302 R','R 0047']){
    const t={...text,footerSupplemental:[number]};
    assert.deepEqual(parse({...spatial,footerLines:[line(number,844,1270,920,1290)]},t).collectors,['170','47']);
  }
  assert.deepEqual(acquisitionFooterObservations([...text.footer,'47J'],['47J'],['47J'],spatial).collectors,['170','47j']);
  const readings=[{rotationDegrees:0,text:{title:[],footer:[]},...spatial},
    {rotationDegrees:180,text:{title:[],footer:['C19 EN'],footerSupplemental:['47J']},footerLines:[spatial.footerLines[0]]}];
  assert.deepEqual(acquisitionCatalogQueries(readings).printings,[{kind:'printing',set:'c19',number:'47j',language:'en'}]);
});

test('reference frames cannot lend collector boxes to an independently read isolated number',async()=>{
  const {combineAcquisitionReferenceReadings}=await import('../lib/acquisition-reference-text');
  const card={id:'correct',name:text.title[0],setCode:'c19',collectorNumber:'170',lang:'en'};
  const empty={rotationDegrees:180,text:{title:[],footer:[]},lines:[]};
  const primary={orientations:[{rotationDegrees:0,text,...spatial},empty]};
  const refined={orientations:[{rotationDegrees:0,text:{title:text.title,footer:['C19 EN'],footerSupplemental:['47J']},footerLines:[spatial.footerLines[0]]},empty]};
  const result=combineAcquisitionReferenceReadings(createAcquisitionRecognitionIndex([card]),primary,refined);
  assert.deepEqual(result.evidence.collectors,['170','47j']);
  assert.equal(result.automaticAcceptance,false);
});
