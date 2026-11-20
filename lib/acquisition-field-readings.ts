import {z} from 'zod';
import {setSymbolSchema} from './acquisition-set-symbol';
const readings = z.array(z.object({text:z.string().max(200),score:z.number().finite().min(0).max(1)})).max(16);
export const fieldReadingsSchema = z.object({typeLine:readings,manaText:readings,
  artistText:readings.optional(),
  mana:z.object({status:z.enum(['OBSERVED','UNREADABLE']),automaticAcceptance:z.literal(false),
    symbols:z.array(z.object({symbol:z.enum(['W','U','B','R','G','C']).nullable(),
      similarity:z.number().finite().min(-1).max(1),x:z.number().int().min(600).max(970),y:z.number().int().min(30).max(145)})).max(16)}),
  setSymbol:setSymbolSchema});

// Shape aliases only reorder existing text/catalog candidates. They do not
// manufacture printed identifiers, prune alternatives or authorize confirmation.
export function applyEarlySetSymbol<T extends {orientation?:{rotationDegrees:number|null};
  proposals:{card:{setCode:string};reasons:string[]}[]}>(proposals:T,
  observations:{rotationDegrees:number;fields?:z.infer<typeof fieldReadingsSchema>}[]):T {
  const symbol=observations.find(o=>o.rotationDegrees===proposals.orientation?.rotationDegrees)?.fields?.setSymbol.query;
  if(symbol?.status!=='SIMILAR'||!symbol.matches)return proposals;
  const codes=symbol.matches[0].codes;
  const exact=(p:T['proposals'][number])=>p.reasons.includes('SET_AND_COLLECTOR_TEXT')||p.reasons.includes('TITLE_AND_COLLECTOR_TEXT');
  const agrees=(p:T['proposals'][number])=>codes.includes(p.card.setCode.toUpperCase());
  return {...proposals,proposals:proposals.proposals.map(p=>({...p,reasons:agrees(p)?[...new Set([...p.reasons,'SET_SYMBOL_SHAPE_SUPPORT'])]:p.reasons}))
    .sort((a,b)=>Number(exact(b))-Number(exact(a))||Number(agrees(b))-Number(agrees(a)))};
}
