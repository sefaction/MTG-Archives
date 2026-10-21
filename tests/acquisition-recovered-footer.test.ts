import test from 'node:test';
import assert from 'node:assert/strict';
import {observedScannerIdentifiers,type ScannerSourceText} from '../lib/acquisition-scanner-source-text';
import {combineAcquisitionPhotoText,type AcquisitionPhotoText} from '../lib/acquisition-photo-text';
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';
import {acquisitionCatalogQueries} from '../lib/acquisition-catalog-queries';

const box=(text:string,left:number,top:number,right:number,bottom:number)=>({text,polygon:[[left,top],[right,top],[right,bottom],[left,bottom]] as [number,number][]});
const split=():ScannerSourceText=>({scope:'SCANNER_SOURCE_PIXELS',width:1620,height:2160,boundaryVerified:false,lines:[
  box('L',108,1945.35,129.6,1962.9),box('0391',144.45,1935.9,248.4,1969.65),
  box('FRA EN Leon Tukker',102.6,1965.6,562.95,2014.2),
]});
test('separate positioned rarity and collector glyph boxes retain a complete literal row',()=>{
  const source=split(),before=JSON.stringify(source);
  assert.deepEqual(observedScannerIdentifiers(source),{set:'fra',language:'en',number:'391'});
  assert.equal(JSON.stringify(source),before);
  for(const prefix of ['C','U','M','R','L','T']){const s=split();s.lines[0].text=prefix;assert.equal(observedScannerIdentifiers(s)?.number,'391');}
});
test('split source collector still requires unique adjacent same-row glyphs and a matching lower marker',()=>{
  const invalid:Array<(s:ScannerSourceText)=>void>=[
    s=>{s.lines.shift();},s=>{s.lines.splice(1,1);},s=>{s.lines[0].text='X';},
    s=>{s.lines[1].text='1999';},s=>{s.lines[1].text='03S1';},s=>{s.lines[1].text='3 9 1';},
    s=>{s.lines.push(box('392',300,1936,400,1969));},s=>{s.lines.push(box('R',20,1945,40,1963));},
    s=>{s.lines[1]=box('0391',400,1936,500,1969);},
    s=>{s.lines[0]=box('L',300,1945,320,1963);},
    s=>{s.lines[0]=box('L',108,1890,129,1908);},
    s=>{s.lines[0]=box('L',108,2000,129,2018);},
    s=>{s.lines[2]=box('FRA EN',102,1800,400,1820);},
    s=>{s.lines[2]=box('FRA EN',600,2000,900,2020);},
    s=>{s.lines.push(box('WAR EN',102,2030,400,2050));},
    s=>{s.lines[2].text='FRA FR';s.lines.push(box('FRA EN',102,2030,400,2050));},
    s=>{s.lines.push(box('R 0392',100,1870,300,1900));},
  ];
  for(const mutate of invalid){const s=split();mutate(s);assert.equal(observedScannerIdentifiers(s),null);}
});
test('split positioned row retrieves the printing beyond a same-name cap without automatic authority',()=>{
  const card={id:'target',name:'Mountain',setCode:'fra',collectorNumber:'391',lang:'en'};
  const index=createAcquisitionRecognitionIndex([card,...Array.from({length:30},(_,i)=>({...card,id:'other'+i,setCode:'old',collectorNumber:String(i)}))]);
  const base=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:['Mountain'],footer:[]}},{rotationDegrees:180,text:{title:[],footer:[]}}]);
  const raw:AcquisitionPhotoText={version:1,scope:'WHOLE_PHOTO',status:'COMPLETE',readings:[{rotationDegrees:0,text:['Mountain','Basic Land — Mountain','L 0391','FRA EN Leon Tukker'],truncated:false,scannerSource:split()}]};
  const result=combineAcquisitionPhotoText(index,base,raw);
  assert.equal(result.proposals[0].card.id,'target');assert.equal(result.automaticAcceptance,false);
  assert.ok(result.proposals[0].reasons.includes('SCANNER_SOURCE_IDENTIFIERS'));
  assert.ok(!result.proposals[0].reasons.includes('STRONG_EXACT_PRINTING'));
  assert.ok(acquisitionCatalogQueries([],raw).printings.some(q=>q.kind==='printing'&&q.number==='391'));
  assert.deepEqual(result.evidence,base.evidence);
  raw.readings[0].text=['Unrelated card'];assert.ok(combineAcquisitionPhotoText(index,base,raw).proposals.every(p=>!p.reasons.includes('SCANNER_SOURCE_IDENTIFIERS')));
});
test('a contained-title collector alternative survives unrelated whole-photo names without gaining title certainty',()=>{
  const card={id:'target',name:'Samut, Tyrant of Naktamun',setCode:'fra',collectorNumber:'302',lang:'en'};
  const other={...card,id:'base',collectorNumber:'220'},body={...card,id:'body',name:'Human Wizard',setCode:'temn',collectorNumber:'2'};
  const index=createAcquisitionRecognitionIndex([card,other,body]);
  const base=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[card.name+' ①C'],footer:[],footerSourceIdentifiers:['0 3 0 Z','FRA EN Nicholas Elias']}},{rotationDegrees:180,text:{title:[],footer:[]}}]);
  assert.equal(base.proposals[0].card.id,card.id);assert.ok(base.proposals[0].reasons.includes('TITLE_FRAGMENT'));
  const raw:AcquisitionPhotoText={version:1,scope:'WHOLE_PHOTO',status:'COMPLETE',readings:[{rotationDegrees:0,text:[card.name+' 10','Legendary Creature — Human Wizard'],truncated:false},{rotationDegrees:90,text:['R 0302','FRA EN Nicholas Elias','Human Wizard'],truncated:false}]};
  const before=JSON.stringify({base,raw}),result=combineAcquisitionPhotoText(index,base,raw);
  assert.equal(result.proposals[0].card.id,card.id);assert.equal(result.automaticAcceptance,false);
  assert.ok(result.proposals[0].reasons.includes('COLLECTOR_OCR_ALTERNATIVE'));
  assert.ok(result.proposals[0].reasons.includes('TITLE_FRAGMENT'));
  for(const reason of ['TITLE_EXACT','SET_AND_COLLECTOR_TEXT','SCANNER_SOURCE_IDENTIFIERS','STRONG_EXACT_PRINTING'])assert.ok(!result.proposals[0].reasons.includes(reason));
  assert.equal(JSON.stringify({base,raw}),before);
  const contradicted={...base,proposals:base.proposals.map(p=>({...p,reasons:[...p.reasons,'SET_CONTRADICTION']}))};
  assert.notEqual(combineAcquisitionPhotoText(index,contradicted,raw).proposals[0].card.id,card.id);
});
