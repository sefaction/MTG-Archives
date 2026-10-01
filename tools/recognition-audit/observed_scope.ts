// Candidate scope from observed evidence only. Expected labels are not accepted.
import {acquisitionFooterIdentifiers,acquisitionCollectorKey} from "../../lib/acquisition-footer";
import type {RecognitionCard,createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../../lib/acquisition-recognition";
const nameKey=(name:string)=>name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
export function observedScope(index:ReturnType<typeof createAcquisitionRecognitionIndex>,primary:ReturnType<typeof proposeOrientedAcquisitionPrintings>,orientations:any[]){
 if(primary.status==="CONFLICT"||primary.orientation.status!=="SELECTED")return null;
 const selected=orientations.find(o=>o.rotationDegrees===primary.orientation.rotationDegrees);
 if(!selected)return null;
 const exactNames=new Set<string>();for(const title of selected.text.title)if(index.byName.has(nameKey(title)))exactNames.add(nameKey(title));
 const candidates=new Map<string,RecognitionCard>();
 if(exactNames.size)for(const name of exactNames)for(const c of index.byName.get(name)??[])candidates.set(c.id,c);
 else{
  const names=new Set(primary.proposals.filter(p=>p.reasons.some(r=>["TITLE_TEXT","TITLE_AND_COLLECTOR_TEXT","TITLE_EXACT","TITLE_TEXT_AGREES"].includes(r))).map(p=>nameKey(p.card.name)));
  if(!names.size||names.size>3)return null;
  for(const name of names)for(const c of index.byName.get(name)??[])candidates.set(c.id,c);
 }
 const footer=acquisitionFooterIdentifiers(selected.text.footer);
 const identifiers=footer.identifiers.filter(i=>index.sets.has(i.set.toUpperCase()));
 const collectors=new Set(footer.collectors);
 const printed=(c:RecognitionCard)=>{const origin=c.setCode.toLowerCase()==="plst"?/^([a-z0-9]{2,6})-(.+)$/i.exec(c.collectorNumber):null;return{set:origin?.[1].toLowerCase()??c.setCode.toLowerCase(),number:acquisitionCollectorKey(origin?.[2]??c.collectorNumber)}};
 // Apply reliable partial evidence; if it excludes every name candidate, retain conflict and escalate.
 let rows=[...candidates.values()].filter(c=>!c.digital);
 if(identifiers.length)rows=rows.filter(c=>identifiers.some(i=>i.set===printed(c).set&&(!c.lang||c.lang===i.language)));
 if(collectors.size)rows=rows.filter(c=>collectors.has(printed(c).number));
 if(!rows.length||rows.length>1000)return null;
 return {ids:rows.map(c=>c.id),exactName:exactNames.size>0,identifierCount:identifiers.length,collectorCount:collectors.size};
}
