import test from 'node:test';
import assert from 'node:assert/strict';
import {collectorOcrAlternatives} from '../lib/acquisition-collector-alternatives';
import {acquisitionFooterObservations} from '../lib/acquisition-footer';
import {createAcquisitionRecognitionIndex, proposeAcquisitionPrintings, proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';
import {acquisitionCatalogQueries} from '../lib/acquisition-catalog-queries';
import {observedScannerCollectorAlternatives, observedScannerIdentifiers, type ScannerSourceText} from '../lib/acquisition-scanner-source-text';
import {combineAcquisitionPhotoText, type AcquisitionPhotoText} from '../lib/acquisition-photo-text';
import {combineAcquisitionCandidates} from '../lib/acquisition-visual';

test('spaced and digit-like source readings retain bounded alternatives, not prefix numbers',()=>{
  for (const [line,numbers] of [
    ['M 0 3 2 3',['323']],['R 03S6',['336','356']],['0 3 0 Z',['302','30z']],
    ['C 3 0 2',['302']],['R 33 6',['336']],['C 0 0 1 7a',['17a']],
    ['U 1 7 8 / 3 0 2',['178']],['C 17 / 3 0 2',['17']],
  ] as const) assert.deepEqual(collectorOcrAlternatives(line),numbers,line);
  for (const line of ['C 17 18','C 17','L 1','L1','R0017a','R 17S','03S6 Artist','C1993-2008 Wizards',
    '2/3','M21 EN','0 3 S Z','1 2 3 4 5 6','C 1\n7','C\n03S6','C 1 9 9 3'])
    assert.deepEqual(collectorOcrAlternatives(line),[],line);
});

const cards=Array.from({length:40},(_,i)=>({id:String(i).padStart(3,'0'),name:'Collector alternative',setCode:'abc',collectorNumber:String(i),lang:'en'}));
const right={...cards[0],id:'target',collectorNumber:'323'};
const index=createAcquisitionRecognitionIndex([...cards,right,{...right,id:'other-ambiguous',collectorNumber:'356'},{...right,id:'ambiguous-target',collectorNumber:'336'}]);

test('same-channel recovered collector rescues a capped exact-title alternative without literal support',()=>{
  const text={title:[right.name],footer:['ABC EN','M 0 3 2 3']};
  const result=proposeAcquisitionPrintings(index,text);
  assert.equal(result.proposals[0].card.id,right.id);
  assert(result.proposals[0].reasons.includes('COLLECTOR_OCR_ALTERNATIVE'));
  assert(!result.proposals[0].reasons.includes('SET_AND_COLLECTOR_TEXT'));
  assert(!result.proposals[0].reasons.includes('STRONG_EXACT_PRINTING'));
  assert.equal(result.automaticAcceptance,false);
  const combined=combineAcquisitionCandidates(proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text},
    {rotationDegrees:180,text:{title:[],footer:[]}}]),{candidates:cards.slice(0,12).map(c=>({scryfallId:c.id}))},new Map(cards.map(c=>[c.id,c])));
  assert.equal(combined.proposals[0].card.id,right.id);
  assert.equal(combined.automaticAcceptance,false);
  assert.deepEqual(result.evidence.collectors,[]);
  assert.deepEqual(acquisitionCatalogQueries([{rotationDegrees:0,text}]).printings,[{kind:'printing',set:'abc',language:'en',number:'323'}]);
  const conflicting=proposeAcquisitionPrintings(index,{title:[right.name],footer:['ABC EN','R 17','R 03S6']});
  assert.equal(conflicting.proposals[0].card.collectorNumber,'17');
  assert.equal(conflicting.automaticAcceptance,false);
  assert.deepEqual(conflicting.proposals.filter(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')).map(p=>p.card.collectorNumber).sort(),['336','356']);
});

test('missing markers, conflicting markers and separate channels/directions never manufacture alternatives',()=>{
  for (const input of [{title:[right.name],footer:['M 0 3 2 3']},
    {title:[right.name],footer:['ABC EN','DEF EN','M 0 3 2 3']},
    {title:[right.name],footer:['ABC EN'],footerSupplemental:['M 0 3 2 3']}]) {
    assert(!proposeAcquisitionPrintings(index,input).proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
  }
  const result=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[right.name],footer:['ABC EN']}},
    {rotationDegrees:180,text:{title:[],footer:['M 0 3 2 3']}}]);
  assert(!result.proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
  assert.equal(acquisitionFooterObservations(['ABC EN','M 0 3 2 3']).recoveredLayout,true);
  const unpaired=proposeAcquisitionPrintings(index,{title:[right.name],footer:['ABC EN','R 17'],footerSupplemental:['R 03S6']});
  assert.equal(unpaired.automaticAcceptance,false,'discarded unpaired ambiguity cannot newly confirm a different clear reading');
  assert(!unpaired.proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
});

const box=(text:string,x=60,y=1300):ScannerSourceText['lines'][number]=>({text,polygon:[[x,y],[x+180,y],[x+180,y+16],[x,y+16]]});
const source=(line='R 03S6'):ScannerSourceText=>({scope:'SCANNER_SOURCE_PIXELS',width:1000,height:1400,boundaryVerified:false,
  lines:[box(line),box('ABC EN',60,1325)]});
const photo=(s=source()):AcquisitionPhotoText=>({version:1,scope:'WHOLE_PHOTO',status:'COMPLETE',readings:[{rotationDegrees:0,text:[right.name],truncated:false,scannerSource:s}]});

test('positioned ambiguous source supplies review alternatives while literal source API stays unknown',()=>{
  const raw=photo(); const before=JSON.stringify(raw);
  assert.equal(observedScannerIdentifiers(source()),null);
  assert.deepEqual(observedScannerCollectorAlternatives(source()).map(p=>p.number),['336','356']);
  const base=proposeOrientedAcquisitionPrintings(index,[]);
  const result=combineAcquisitionPhotoText(index,base,raw);
  assert.deepEqual(result.proposals.slice(0,2).map(p=>p.card.collectorNumber).sort(),['336','356']);
  assert(result.proposals.slice(0,2).every(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')&&!p.reasons.includes('SCANNER_SOURCE_IDENTIFIERS')));
  assert.equal(result.automaticAcceptance,false);
  assert.equal(JSON.stringify(raw),before);
  assert.equal(acquisitionCatalogQueries([],raw).printings.length,2);
});

test('positioned alternatives reject missing, reversed, distant, conflicting and malformed rows',()=>{
  for (const lines of [[box('R 03S6')], [box('R 03S6'),box('ABC EN',60,1380)],
    [box('R 03S6',60,1350),box('ABC EN',60,1300)], [box('R 03S6'),box('ABC EN',350,1325)],
    [box('R 03S6'),box('ABC EN',60,1325),box('DEF EN',60,1325)],
    [box('R 03S6'),box('R 02S1'),box('ABC EN',60,1325)],
    [box('R 03S6',60,1100),box('ABC EN',60,1325)]])
    assert.deepEqual(observedScannerCollectorAlternatives({...source(),lines}),[]);
});

test('literal printing requests retain priority and the existing four-request bound',()=>{
  const orientations=[17,18,19,20].map((n,i)=>({rotationDegrees:i*90,text:{title:[right.name],footer:['ABC EN',`R ${n}`]}}));
  const prior=acquisitionCatalogQueries(orientations).printings;
  assert.deepEqual(acquisitionCatalogQueries(orientations,photo()).printings,prior);
});

test('ambiguity overflow, unsupported title, language and List counterparts stay explicit',()=>{
  const overflow=acquisitionFooterObservations(['ABC EN','R 01S1','R 02S2','R 03S3']);
  assert.deepEqual(overflow.collectorAlternatives,[]);
  assert.equal(overflow.recoveredLayout,true);
  assert(!proposeAcquisitionPrintings(index,{title:['Different card'],footer:['ABC EN','R 03S6']}).proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
  assert(!proposeAcquisitionPrintings(index,{title:[right.name],footer:['ABC FR','R 03S6']}).proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
  const original={...right,collectorNumber:'336'},list={...original,id:'list',setCode:'plst',collectorNumber:'ABC-336'};
  const result=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([original,list]),{title:[right.name],footer:['ABC EN','R 03S6']});
  assert.equal(result.proposals.length,2);
  assert(result.proposals.every(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')&&p.reasons.includes('STAMP_UNVERIFIED')));
  assert.equal(result.automaticAcceptance,false);
  const wrongDirection=photo();wrongDirection.readings[0].text=['Different card'];
  wrongDirection.readings.push({rotationDegrees:180,text:[right.name],truncated:false});
  assert(!combineAcquisitionPhotoText(index,proposeOrientedAcquisitionPrintings(index,[]),wrongDirection).proposals.some(p=>p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
});

test('one contained-title family can retain the collector alternative without gaining exact-title reasons',()=>{
  const target={...right,collectorNumber:'302'},catalog=createAcquisitionRecognitionIndex([...cards,target]);
  const result=proposeAcquisitionPrintings(catalog,{title:[right.name+' γæac'],footer:['ABC EN','0 3 0 Z']});
  assert.equal(result.proposals[0].card.id,target.id);
  assert(result.proposals[0].reasons.includes('COLLECTOR_OCR_ALTERNATIVE'));
  assert(result.proposals[0].reasons.includes('TITLE_FRAGMENT'));
  assert(!result.proposals[0].reasons.some(r=>['TITLE_EXACT','SET_AND_COLLECTOR_TEXT','STRONG_EXACT_PRINTING'].includes(r)));
  assert.equal(result.automaticAcceptance,false);
  const ambiguous=proposeAcquisitionPrintings(createAcquisitionRecognitionIndex([...cards,target,{...target,id:'other',name:'Other identity'}]),
    {title:[right.name+' γæac','Other identity'],footer:['ABC EN','0 3 0 Z']});
  assert(!ambiguous.proposals.some(p=>p.card.id===target.id&&p.reasons.includes('COLLECTOR_OCR_ALTERNATIVE')));
});
