import test from 'node:test';
import assert from 'node:assert/strict';
import {observedScannerIdentifiers,type ScannerSourceText} from '../lib/acquisition-scanner-source-text';
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from '../lib/acquisition-recognition';
import {combineAcquisitionPhotoText,type AcquisitionPhotoText} from '../lib/acquisition-photo-text';
import {combineAcquisitionCandidates} from '../lib/acquisition-visual';
const row=(text:string,top:number,bottom:number,left=80)=>({text,polygon:[[left,top],[left+180,top],[left+180,bottom],[left,bottom]] as [number,number][]});
const source=(cTop=1800,cBottom=1844,mTop=1832,mBottom=1876):ScannerSourceText=>({scope:'SCANNER_SOURCE_PIXELS',width:1620,height:2160,boundaryVerified:false,lines:[row('R 0336',cTop,cBottom),row('FRA EN Artist',mTop,mBottom)]});
test('distinct central row areas preserve a readable collector despite glyph-box overlap',()=>{
 assert.deepEqual(observedScannerIdentifiers(source()),{set:'fra',language:'en',number:'336'});
 assert.deepEqual(observedScannerIdentifiers(source(1800,1815,1832,1847)),{set:'fra',language:'en',number:'336'});
});
test('same, nested, reversed and centrally overlapping rows gain no source support',()=>{
 for(const s of[source(1800,1844,1800,1844),source(1800,1844,1810,1834),source(1832,1876,1800,1844),source(1800,1844,1820,1864),source(1800,1844,1822,1866)])assert.equal(observedScannerIdentifiers(s),null);
});
test('new row ordering still rejects absent, blurred, contradictory, shifted and distant identifiers',()=>{
 const missing=source();missing.lines.pop();const blurred=source();blurred.lines[0].text='R 03S6';const ambiguous=source();ambiguous.lines.push(row('R 0337',1800,1844));const wrongSet=source();wrongSet.lines.push(row('XYZ EN Artist',1832,1876));const shifted=source();shifted.lines[1]=row('FRA EN Artist',1832,1876,250);const distant=source(1800,1844,1950,1990);
 for(const s of[missing,blurred,ambiguous,wrongSet,shifted,distant])assert.equal(observedScannerIdentifiers(s),null);
});
test('supported overlapping source rows improve OCR-only/combined review without automatic authority',()=>{
 const wrong={id:'a',name:'Cruel Calculations',setCode:'fra',collectorNumber:'26',lang:'en'},target={...wrong,id:'z',collectorNumber:'336'},cards=[wrong,target],index=createAcquisitionRecognitionIndex(cards),base=proposeOrientedAcquisitionPrintings(index,[{rotationDegrees:0,text:{title:[target.name],footer:[]}},{rotationDegrees:180,text:{title:[],footer:[]}}]);
 const raw:AcquisitionPhotoText={version:1,scope:'WHOLE_PHOTO',status:'COMPLETE',readings:[{rotationDegrees:0,text:[target.name],truncated:false,scannerSource:source()}]},frozen=JSON.stringify(raw),result=combineAcquisitionPhotoText(index,base,raw);
 assert.equal(base.proposals[0].card.id,'a');assert.equal(result.proposals[0].card.id,'z');assert(result.proposals[0].reasons.includes('SCANNER_SOURCE_IDENTIFIERS'));assert.equal(result.automaticAcceptance,false);assert.equal(result.status,'REVIEW_REQUIRED');const combined=combineAcquisitionCandidates(result,{candidates:[{scryfallId:'a'}]},new Map(cards.map(c=>[c.id,c])));assert.equal(combined.proposals[0].card.id,'z');assert.equal(combined.automaticAcceptance,false);assert.equal(JSON.stringify(raw),frozen);
 const opposite=structuredClone(raw);opposite.readings[0].text=['Other Name'];const unsupported=combineAcquisitionPhotoText(index,base,opposite);assert(!unsupported.proposals.some(p=>p.reasons.includes('SCANNER_SOURCE_IDENTIFIERS')));
});
