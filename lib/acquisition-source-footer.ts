import {z} from 'zod';
const point=z.tuple([z.number().finite().nonnegative(),z.number().finite().nonnegative()]);
const base={version:z.literal('source-footer-identifiers-v1'),
  bounds:z.tuple([z.literal(24),z.literal(1270),z.literal(630),z.literal(1396)]),
  rotationDegrees:z.union([z.literal(0),z.literal(180)])};
const extracted=z.object({...base,status:z.literal('EXTRACTED'),sourceQuad:z.array(point).length(4),
  width:z.number().int().min(16).max(1280),height:z.number().int().min(16).max(512),
  sourceWidth:z.number().finite().positive(),sourceHeight:z.number().finite().positive(),
  sourceFrame:z.object({width:z.number().int().min(2).max(36000000),height:z.number().int().min(2).max(36000000)}).strict(),
}).strict().superRefine((value,ctx)=>{
  if(value.sourceFrame.width*value.sourceFrame.height>36000000||value.width>value.sourceWidth||value.height>value.sourceHeight||
    value.sourceQuad.some(([x,y])=>x>value.sourceFrame.width-1||y>value.sourceFrame.height-1))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier source exceeds observed original pixels'});
});
export const sourceFooterSchema=z.union([extracted,z.object({...base,status:z.literal('UNAVAILABLE'),
  reason:z.enum(['GEOMETRY_UNAVAILABLE','SOURCE_TOO_SMALL','REGION_CLIPPED','PHYSICAL_CLIPPING','TIME_BUDGET','EVIDENCE_BUDGET','WORKER_ERROR'])}).strict()]);
