import {z} from 'zod';
import {acquisitionManualRegionSchema,validateAcquisitionManualRegionFrame} from './acquisition-manual-region';
import {scannerReferenceRectangle} from './acquisition-reference-region';

export const SCANNER_LAYOUT_POLICY='scanner-layout-anchor-v1';
export const scannerLayoutTemplateSchema=z.object({
  version:z.literal(1),policy:z.literal(SCANNER_LAYOUT_POLICY),
  sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
  sourceMethod:z.enum(['manual-card-region-v1','scanner-card-edges','scanner-white-card-edges']),
  frame:z.object({width:z.number().int().min(2).max(36000000),height:z.number().int().min(2).max(36000000)}).strict(),
  region:acquisitionManualRegionSchema,
  anchors:z.array(z.object({kind:z.enum(['COLLECTOR','TITLE']),
    point:z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)])}).strict()).min(1).max(2),
}).strict().superRefine((value,ctx)=>{
  try{
    validateAcquisitionManualRegionFrame(value.region,value.frame.width,value.frame.height);
    const quad=value.region.quad.map(([x,y])=>[x*(value.frame.width-1),y*(value.frame.height-1)]);
    const lengths=quad.map(([x,y],i)=>Math.hypot(x-quad[(i+1)%4][0],y-quad[(i+1)%4][1]));
    if(!scannerReferenceRectangle(quad)||Math.min(...lengths)<500||lengths[0]/lengths[1]<.68||lengths[0]/lengths[1]>.75)
      throw Error('Unsupported scanner card dimensions');
    const kinds=new Set(value.anchors.map(a=>a.kind));
    if(kinds.size!==value.anchors.length||!kinds.has('COLLECTOR'))throw Error('Unique collector anchor required');
    for(const anchor of value.anchors){
      if(anchor.kind==='COLLECTOR'&&(anchor.point[0]>.4||anchor.point[1]<1270/1396))throw Error('Collector anchor outside footer');
      if(anchor.kind==='TITLE'&&(anchor.point[0]>=.8||anchor.point[1]>250/1396))throw Error('Title anchor outside title region');
    }
  }catch{
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Unsupported scanner layout template'});
  }
});
export type ScannerLayoutTemplate=z.infer<typeof scannerLayoutTemplateSchema>;

type LayoutLine={text:string;score:number;polygon:number[][]};
type LayoutObservation={lines:LayoutLine[];footerLines?:LayoutLine[];identifierLines?:LayoutLine[]};
export function scannerLayoutAnchorsObserved(template:ScannerLayoutTemplate,observations:LayoutObservation[]){
  return observations.some(o=>template.anchors.every(anchor=>{
    const lines=anchor.kind==='TITLE'?o.lines:[...o.lines,...(o.footerLines??[]),...(o.identifierLines??[])];
    return lines.some(line=>{
      if(line.polygon.length!==4||line.score<.75||line.score>1||line.polygon.some(([x,y])=>x<0||x>999||y<0||y>1396))return false;
      const left=Math.min(...line.polygon.map(p=>p[0])),bottom=Math.max(...line.polygon.map(p=>p[1]));
      if(Math.abs(left/999-anchor.point[0])>1e-9||Math.abs(bottom/1396-anchor.point[1])>1e-9)return false;
      if(anchor.kind==='TITLE')return line.text.trim().length>=3&&bottom<=250&&left<800;
      return bottom>=1270&&left<=400&&/^\s*(?:[CUMRLT]\s*\d{1,5}[a-z★†]?(?![\p{L}\p{N}★†])|\d{1,5}[a-z★†]?\s*\/\s*\d{2,5}\b)/iu.test(line.text)&&
        !/wizards|copyright|©|\b(?:19|20)\d{2}\s*[-–]/iu.test(line.text);
    });
  }));
}

export function parseScannerLayoutProfile(raw:string|null|undefined){
  if(!raw)return null;
  try{return scannerLayoutTemplateSchema.parse(JSON.parse(raw));}catch{return null;}
}
export const scannerLayoutInferenceSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('REJECTED'),policy:z.literal(SCANNER_LAYOUT_POLICY),reason:z.string().min(1).max(80)}).strict(),
  z.object({status:z.literal('PROPOSED'),policy:z.literal(SCANNER_LAYOUT_POLICY),boundaryVerified:z.literal(false),
    region:acquisitionManualRegionSchema,rotationDegrees:z.union([z.literal(0),z.literal(180)]),
    observedAnchors:z.array(z.enum(['COLLECTOR','TITLE'])).min(1).max(2),
    offsetPixels:z.tuple([z.number().finite(),z.number().finite()]),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
]);

export function freezeScannerLayoutProfile(raw:string|null|undefined){
  return raw&&parseScannerLayoutProfile(raw)&&new TextEncoder().encode(JSON.stringify({inputKind:'CARD_SCAN',scannerLayoutProfile:raw})).length<=1020 ? raw : null;
}
