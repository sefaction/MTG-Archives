import {cropPoint} from './acquisition-review-evidence';
import {combineAcquisitionReferenceReadings} from './acquisition-reference-text';
import type {createAcquisitionRecognitionIndex} from './acquisition-recognition';
import {scannerLayoutAnchorsObserved,type ScannerLayoutTemplate} from './acquisition-scanner-layout';
import type {nativeSchema} from './acquisition-recognition-worker';
import type {z} from 'zod';
type Native=z.infer<typeof nativeSchema>;

export function assertScannerLayoutInference(profile:ScannerLayoutTemplate,native:Native){
  const layout=native.scannerLayout,inference=layout?.inference;
  if(!layout||!inference||(inference.status==='REJECTED'&&!layout.anchorSearch))return;
  const quad=native.geometry.quad as number[][];
  if(!Array.isArray(quad)||quad.length!==4)throw Error('Scanner layout source frame unavailable');
  const width=quad[1][0]+1,height=quad[2][1]+1;
  if(JSON.stringify(quad)!==JSON.stringify([[0,0],[width-1,0],[width-1,height-1],[0,height-1]])||
    width!==profile.frame.width||Math.abs(height-profile.frame.height)>.02*profile.frame.height||
    (inference.status==='PROPOSED'&&inference.sourceDigest!==profile.sourceDigest))throw Error('Scanner layout source frame changed');
  if(inference.status==='PROPOSED'&&height!==profile.frame.height&&!inference.observedAnchors.includes('TITLE'))throw Error('Scanner layout needs two anchors for a changed frame');
  const base=profile.region.quad.map(([x,y])=>[x*(profile.frame.width-1),y*(profile.frame.height-1)]);
  if(layout.anchorSearch){
    if(!profile.anchors.some(a=>a.kind==='TITLE')||layout.anchorSearch.region.quad.some(([x,y],i)=>
      Math.hypot(x*(width-1)-base[i][0],y*(height-1)-base[i][1])>.001)||
      layout.anchorSearch.orientations[0].rotationDegrees!==0||layout.anchorSearch.orientations[1].rotationDegrees!==180)
      throw Error('Scanner anchor search differs from calibrated source placement');
  }
  if(inference.status==='REJECTED')return;
  const guided=inference.anchorSpace==='LAYOUT_SEARCH';
  const observedQuad=guided?layout.anchorSearch?.region.quad.map(([x,y])=>[x*(width-1),y*(height-1)]):quad;
  if(!observedQuad||(guided&&!inference.observedAnchors.includes('TITLE')))throw Error('Scanner anchor search lacks current corroboration');
  const observation=(guided?layout.anchorSearch!.orientations:native.orientations).find(o=>o.rotationDegrees===inference.rotationDegrees);
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
    const observed=cropPoint(observedQuad,...turn(matches[0].point) as [number,number]);
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

import type {sourceFooterSchema} from './acquisition-source-footer';
import type {AcquisitionManualRegion} from './acquisition-manual-region';

// Match the actual original-pixel window to the inferred card transform. The
// extracted source stays inferred; this check supplies no physical-edge authority.
export function assertScannerLayoutFooterSource(source:z.infer<typeof sourceFooterSchema>,region:AcquisitionManualRegion,direct:unknown){
  if(source.status!=='EXTRACTED')return;
  if(!Array.isArray(direct)||direct.length!==4||direct.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))))
    throw Error('Inferred footer source frame unavailable');
  const points=direct as number[][],width=points[1][0]+1,height=points[2][1]+1;
  if(JSON.stringify(points)!==JSON.stringify([[0,0],[width-1,0],[width-1,height-1],[0,height-1]])||
    source.sourceFrame.width!==width||source.sourceFrame.height!==height)throw Error('Inferred footer source frame differs');
  const quad=region.quad.map(([x,y])=>[x*(width-1),y*(height-1)]);
  const corners=[[24,1270],[630,1270],[630,1396],[24,1396]];
  const tolerance=Math.max(.01,Math.hypot(width,height)*1e-6);
  const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const physicalWidth=Math.min(distance(source.sourceQuad[0],source.sourceQuad[1]),distance(source.sourceQuad[2],source.sourceQuad[3]));
  const physicalHeight=Math.min(distance(source.sourceQuad[0],source.sourceQuad[3]),distance(source.sourceQuad[1],source.sourceQuad[2]));
  const scale=Math.min(1,1280/physicalWidth,512/physicalHeight);
  if(Math.abs(source.sourceWidth-physicalWidth)>tolerance||Math.abs(source.sourceHeight-physicalHeight)>tolerance||
    source.width>physicalWidth+tolerance||source.height>physicalHeight+tolerance||
    Math.abs(source.width-Math.floor(physicalWidth*scale))>1||Math.abs(source.height-Math.floor(physicalHeight*scale))>1)
    throw Error('Inferred footer dimensions differ from its source pixels');
  if(corners.some(([x,y],i)=>{
    if(source.rotationDegrees===180){x=999-x;y=1396-y;}
    const expected=cropPoint(quad,x/999,y/1396),observed=source.sourceQuad[i];
    return Math.hypot(expected[0]-observed[0],expected[1]-observed[1])>tolerance;
  }))throw Error('Inferred footer polygon differs from its card frame');
}
