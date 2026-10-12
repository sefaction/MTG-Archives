import {z} from 'zod';
const match=z.object({family:z.string().regex(/^[a-f0-9]{16}$/),codes:z.array(z.string().regex(/^[A-Z0-9]{2,8}$/)).min(1).max(24),similarity:z.number().finite().min(0).max(1)}).strict();
const observation=z.object({status:z.enum(['SIMILAR','AMBIGUOUS','UNREADABLE']),reason:z.string().regex(/^[A-Z_]{1,80}$/),
  matches:z.array(match).length(2).optional(),box:z.tuple([z.number().int().min(0),z.number().int().min(0),z.number().int().positive(),z.number().int().positive()]).optional()}).strict().superRefine((value,ctx)=>{
  if(value.box&&(value.box[0]+value.box[2]>170||value.box[1]+value.box[3]>155))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Symbol box exceeds observed region'});
  if(value.status!=='UNREADABLE'&&(!value.matches||!value.box||value.matches[0].similarity<.9))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Symbol requires measured shape support'});
  if(value.matches&&(value.matches[0].similarity<value.matches[1].similarity||value.matches[0].family===value.matches[1].family))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Symbol matches differ or repeat'});
  if(value.status==='SIMILAR'&&value.matches&&value.matches[0].similarity-value.matches[1].similarity<.039999)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Symbol requires a separated family'});
});
export const setSymbolSchema=z.object({version:z.literal('expansion-symbol-shapes-v1'),bounds:z.tuple([z.literal(790),z.literal(745),z.literal(960),z.literal(900)]),
  automaticAcceptance:z.literal(false),query:observation,reference:observation,relation:z.enum(['UNRESOLVED','SIMILAR_SHAPE','DIFFERENT_SHAPE'])}).strict().superRefine((value,ctx)=>{
  if(value.relation==='UNRESOLVED')return;
  if(value.query.status!=='SIMILAR'||value.reference.status!=='SIMILAR'||!value.query.matches||!value.reference.matches||
    (value.query.matches[0].family===value.reference.matches[0].family)!==(value.relation==='SIMILAR_SHAPE'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Symbol relation requires two supported observations'});
});
export type SetSymbolEvidence=z.infer<typeof setSymbolSchema>;
export function consistentSetSymbol(symbols:(SetSymbolEvidence|undefined)[]){
  const observed=symbols.filter((s):s is SetSymbolEvidence=>!!s&&s.query.status==='SIMILAR');
  if(new Set(observed.map(s=>s.query.matches![0].family)).size>1)return undefined;
  return observed[0]??symbols.find(s=>!!s);
}
export function setSymbolMessage(symbol:SetSymbolEvidence|undefined){
  if(!symbol)return {observed:'Not checked',comparison:'No symbol observation in this saved analysis'};
  const query=symbol.query;
  if(query.status==='UNREADABLE')return {observed:'Unclear',comparison:'The visible region did not support a symbol family'};
  if(query.status==='AMBIGUOUS')return {observed:'Several shapes look similar',comparison:'Check the symbol on the original scan'};
  const codes=query.matches![0].codes.join(', ');
  return {observed:`Icon resembles ${codes}`,comparison:symbol.relation==='SIMILAR_SHAPE'?'Similar icon on this reference; exact printing still needs review':symbol.relation==='DIFFERENT_SHAPE'?'Visible icon differs from this reference; inspect the original':'Reference icon unclear; exact printing still needs review'};
}
