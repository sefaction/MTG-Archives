import {acquisitionSetLanguageMarker} from './acquisition-footer';
import {z} from 'zod';
import {acquisitionManualRegionSchema,validateAcquisitionManualRegionFrame} from './acquisition-manual-region';
import {scannerReferenceRectangle} from './acquisition-reference-region';

export const SCANNER_LAYOUT_POLICY='scanner-layout-anchor-v1';
export const SCANNER_MARKER_LAYOUT_POLICY='scanner-layout-marker-v2';
const point=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
const source={sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
  sourceMethod:z.enum(['manual-card-region-v1','scanner-card-edges','scanner-white-card-edges']),
  frame:z.object({width:z.number().int().min(2).max(36000000),height:z.number().int().min(2).max(36000000)}).strict(),region:acquisitionManualRegionSchema};
export const scannerLayoutTemplateSchema=z.discriminatedUnion('version',[
  z.object({...source,version:z.literal(1),policy:z.literal(SCANNER_LAYOUT_POLICY),
    anchors:z.array(z.object({kind:z.enum(['COLLECTOR','TITLE']),point}).strict()).min(1).max(2)}).strict(),
  z.object({...source,version:z.literal(2),policy:z.literal(SCANNER_MARKER_LAYOUT_POLICY),
    anchors:z.array(z.object({kind:z.enum(['SET_LANGUAGE','TITLE']),point}).strict()).length(2)}).strict(),
]).superRefine((value,ctx)=>{
  try{
    validateAcquisitionManualRegionFrame(value.region,value.frame.width,value.frame.height);
    const quad=value.region.quad.map(([x,y])=>[x*(value.frame.width-1),y*(value.frame.height-1)]);
    const lengths=quad.map(([x,y],i)=>Math.hypot(x-quad[(i+1)%4][0],y-quad[(i+1)%4][1]));
    if(!scannerReferenceRectangle(quad)||Math.min(...lengths)<500||lengths[0]/lengths[1]<.68||lengths[0]/lengths[1]>.75)
      throw Error('Unsupported scanner card dimensions');
    const kinds=new Set<string>(value.anchors.map(a=>a.kind));
    if(kinds.size!==value.anchors.length||(value.version===1?!kinds.has('COLLECTOR'):!kinds.has('SET_LANGUAGE')||!kinds.has('TITLE')))
      throw Error('Required unique printed anchors unavailable');
    for(const anchor of value.anchors){
      if(anchor.kind!=='TITLE'&&(anchor.point[0]>.4||anchor.point[1]<1270/1396))throw Error('Printed anchor outside footer');
      if(anchor.kind==='TITLE'&&(anchor.point[0]>=.8||anchor.point[1]>250/1396))throw Error('Title anchor outside title region');
    }
  }catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Unsupported scanner layout template'});}
});
export type ScannerLayoutTemplate=z.infer<typeof scannerLayoutTemplateSchema>;
export type ScannerLayoutAnchorKind='COLLECTOR'|'SET_LANGUAGE'|'TITLE';
type LayoutLine={text:string;score:number;polygon:number[][]};
type LayoutObservation={lines:LayoutLine[];footerLines?:LayoutLine[];identifierLines?:LayoutLine[]};
export function scannerLayoutLineAnchor(kind:ScannerLayoutAnchorKind,line:LayoutLine){
  if(line.polygon.length!==4||!Number.isFinite(line.score)||line.score<.75||line.score>1||line.polygon.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>999||y<0||y>1396))return false;
  const left=Math.min(...line.polygon.map(p=>p[0])),bottom=Math.max(...line.polygon.map(p=>p[1]));
  if(kind==='TITLE')return line.text.trim().length>=3&&bottom<=250&&left<800;
  if(bottom<1270||left>400||/wizards|copyright|©|\b(?:19|20)\d{2}\s*[-–]/iu.test(line.text))return false;
  return kind==='SET_LANGUAGE'?Boolean(acquisitionSetLanguageMarker(line.text)):/^\s*(?:[CUMRLT]\s*\d{1,5}[a-z★†]?(?![\p{L}\p{N}★†])|\d{1,5}[a-z★†]?\s*\/\s*\d{2,5}\b)/iu.test(line.text);
}
function scannerLayoutPrintedMarkers(observation:LayoutObservation){
  const markers=new Map<string,LayoutLine>();
  for(const line of [...(observation.identifierLines??[]),...(observation.footerLines??[]),...observation.lines]){
    if(!scannerLayoutLineAnchor('SET_LANGUAGE',line))continue;
    const match=acquisitionSetLanguageMarker(line.text)!;const key=match.set.toUpperCase()+':'+match.language.toUpperCase();
    if(!markers.has(key)||line.score>markers.get(key)!.score)markers.set(key,line);
  }
  return markers;
}
export function scannerLayoutMarkerLines(observation:LayoutObservation){
  const markers=scannerLayoutPrintedMarkers(observation);return markers.size===1?[...markers.values()]:[];
}
export function scannerLayoutCollectorLines(observation:LayoutObservation){
  const codes=new Set([...scannerLayoutPrintedMarkers(observation).keys()].map(k=>k.split(':')[0]));
  return [...(observation.identifierLines??[]),...(observation.footerLines??[]),...observation.lines].filter(line=>{
    if(!scannerLayoutLineAnchor('COLLECTOR',line))return false;
    const match=/^\s*[CUMRLT]\s*\d{1,5}[a-z★†]?(?![\p{L}\p{N}★†])/iu.exec(line.text);
    return !match||!codes.has(match[0].trim().toUpperCase());
  });
}
export function scannerLayoutAnchorsObserved(template:ScannerLayoutTemplate,observations:LayoutObservation[]){
  return observations.some(o=>template.anchors.every(anchor=>{
    const lines=anchor.kind==='TITLE'?o.lines:anchor.kind==='SET_LANGUAGE'?scannerLayoutMarkerLines(o):scannerLayoutCollectorLines(o);
    return lines.some(line=>scannerLayoutLineAnchor(anchor.kind,line)&&
      Math.abs(Math.min(...line.polygon.map(p=>p[0]))/999-anchor.point[0])<=1e-9&&
      Math.abs(Math.max(...line.polygon.map(p=>p[1]))/1396-anchor.point[1])<=1e-9);
  }));
}
export function parseScannerLayoutProfile(raw:string|null|undefined){
  if(!raw)return null;
  try{return scannerLayoutTemplateSchema.parse(JSON.parse(raw));}catch{return null;}
}
const policies=z.enum([SCANNER_LAYOUT_POLICY,SCANNER_MARKER_LAYOUT_POLICY]);
export const scannerLayoutInferenceSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('REJECTED'),policy:policies,reason:z.string().min(1).max(80)}).strict(),
  z.object({status:z.literal('PROPOSED'),policy:policies,boundaryVerified:z.literal(false),
    region:acquisitionManualRegionSchema,rotationDegrees:z.union([z.literal(0),z.literal(180)]),
    observedAnchors:z.array(z.enum(['COLLECTOR','SET_LANGUAGE','TITLE'])).min(1).max(2),anchorSpace:z.literal('LAYOUT_SEARCH').optional(),
    offsetPixels:z.tuple([z.number().finite(),z.number().finite()]),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
]).superRefine((value,ctx)=>{
  if(value.status!=='PROPOSED')return;
  const anchors=value.observedAnchors,marker=value.policy===SCANNER_MARKER_LAYOUT_POLICY;
  if(new Set(anchors).size!==anchors.length||(marker?!anchors.includes('SET_LANGUAGE')||!anchors.includes('TITLE')||anchors.includes('COLLECTOR'):!anchors.includes('COLLECTOR')||anchors.includes('SET_LANGUAGE')))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scanner inference requires its policy-specific current anchors'});
});
export function freezeScannerLayoutProfile(raw:string|null|undefined){
  return raw&&parseScannerLayoutProfile(raw)&&new TextEncoder().encode(JSON.stringify({inputKind:'CARD_SCAN',scannerLayoutProfile:raw})).length<=1020 ? raw : null;
}
