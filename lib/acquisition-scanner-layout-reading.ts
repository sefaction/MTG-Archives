import {cropPoint} from './acquisition-review-evidence';
import {combineAcquisitionReferenceReadings} from './acquisition-reference-text';
import type {createAcquisitionRecognitionIndex} from './acquisition-recognition';
import {scannerLayoutAnchorsObserved,type ScannerLayoutTemplate} from './acquisition-scanner-layout';
import type {nativeSchema} from './acquisition-recognition-worker';
import type {z} from 'zod';
type Native=z.infer<typeof nativeSchema>;

export function assertScannerLayoutInference(profile:ScannerLayoutTemplate,native:Native){
  const inference=native.scannerLayout?.inference;
  if(!inference||inference.status==='REJECTED')return;
  const quad=native.geometry.quad as number[][];
  if(!Array.isArray(quad)||quad.length!==4)throw Error('Scanner layout source frame unavailable');
  const width=quad[1][0]+1,height=quad[2][1]+1;
  if(JSON.stringify(quad)!==JSON.stringify([[0,0],[width-1,0],[width-1,height-1],[0,height-1]])||
    width!==profile.frame.width||Math.abs(height-profile.frame.height)>.02*profile.frame.height||
    inference.sourceDigest!==profile.sourceDigest)throw Error('Scanner layout source frame changed');
  if(height!==profile.frame.height&&!inference.observedAnchors.includes('TITLE'))throw Error('Scanner layout needs two anchors for a changed frame');
  const base=profile.region.quad.map(([x,y])=>[x*(profile.frame.width-1),y*(profile.frame.height-1)]);
  const observation=native.orientations.find(o=>o.rotationDegrees===inference.rotationDegrees);
  if(!observation)throw Error('Scanner layout anchor direction unavailable');
  const offsets:number[][]=[];
  for(const kind of inference.observedAnchors){
    const anchor=profile.anchors.find(a=>a.kind===kind);
    if(!anchor)throw Error('Scanner layout anchor unavailable');
    const lines=kind==='TITLE'?observation.lines:[...(observation.identifierLines??[]),...(observation.footerLines??[]),...observation.lines];
    const matches=lines.filter(line=>scannerLayoutAnchorsObserved({...profile,anchors:[{kind,point:[Math.min(...line.polygon.map(p=>p[0]))/999,Math.max(...line.polygon.map(p=>p[1]))/1396]}]},[{...observation,lines:[line],footerLines:[],identifierLines:[]}]))
      .map(line=>({point:[Math.min(...line.polygon.map(p=>p[0]))/999,Math.max(...line.polygon.map(p=>p[1]))/1396],score:line.score}));
    if(!matches.length)throw Error('Scanner layout anchor was not observed');
    matches.sort((a,b)=>kind==='TITLE'?a.point[1]-b.point[1]||a.point[0]-b.point[0]:b.score-a.score);
    const turn=(point:number[])=>inference.rotationDegrees===180?point.map(v=>1-v):point;
    const predicted=cropPoint(base,...turn(anchor.point) as [number,number]);
    const observed=cropPoint(quad,...turn(matches[0].point) as [number,number]);
    offsets.push(observed.map((v,i)=>v-predicted[i]));
  }
  const offset=[0,1].map(i=>offsets.reduce((sum,p)=>sum+p[i],0)/offsets.length);
  if(Math.abs(offset[0])>.015*width||Math.abs(offset[1])>.015*height||
    offsets.some(p=>Math.hypot(p[0]-offset[0],p[1]-offset[1])>.004*Math.hypot(width,height))||
    inference.offsetPixels.some((v,i)=>Math.abs(v-offset[i])>.001)||
    inference.region.quad.some(([x,y],i)=>Math.hypot(x*(width-1)-base[i][0]-offset[0],y*(height-1)-base[i][1]-offset[1])>.001))
    throw Error('Scanner layout differs from its observed anchors');
}
export function combineScannerLayoutReadings(index:ReturnType<typeof createAcquisitionRecognitionIndex>,native:Native){
  const combined=combineAcquisitionReferenceReadings(index,{orientations:native.orientations,photoText:native.photoText},{orientations:native.scannerLayout!.orientations});
  return {...combined,proposals:combined.proposals.map(p=>({...p,reasons:p.reasons.map(r=>r==='REFERENCE_ANCHOR_INFERRED'?'SCANNER_LAYOUT_INFERRED':r==='REFERENCE_OCR_OBSERVATION'?'SCANNER_LAYOUT_OCR_OBSERVATION':r)}))};
}
