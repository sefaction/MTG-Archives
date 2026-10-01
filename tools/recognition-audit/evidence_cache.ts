// Isolated audit prototype. Publishers must still check current job/review lineage.
import {createHash} from "node:crypto";
export type EvidenceRequest={ownerScope:string;stage:string;photoDigest:string;inputKind:string;descriptor:string;indexDigest:string;policy:string;catalogDigest:string;candidateIds:string[]};
export function evidenceKey(r:EvidenceRequest){
 if(!r.ownerScope||!r.stage||!r.policy||!r.inputKind||[r.photoDigest,r.descriptor,r.indexDigest,r.catalogDigest].some(v=>!/^[a-f0-9]{64}$/.test(v))||r.candidateIds.length>1000||new Set(r.candidateIds).size!==r.candidateIds.length)throw Error("Incomplete evidence identity");
 // Ordered IDs are intentional: output ordering and bounded cache effects may differ.
 return createHash("sha256").update(JSON.stringify([r.ownerScope,r.stage,r.photoDigest,r.inputKind,r.descriptor,r.indexDigest,r.policy,r.catalogDigest,r.candidateIds])).digest("hex");
}
export class EvidenceCache{
 private values=new Map<string,string>();private bytes=0;
 constructor(private maxEntries=128,private maxBytes=16*1024*1024){if(!Number.isInteger(maxEntries)||maxEntries<1||!Number.isInteger(maxBytes)||maxBytes<1)throw Error("Invalid cache bounds")}
 get(request:EvidenceRequest){const key=evidenceKey(request);const value=this.values.get(key);if(value===undefined)return undefined;this.values.delete(key);this.values.set(key,value);return JSON.parse(value)}
 put(request:EvidenceRequest,evidence:any){
  if(evidence?.descriptor!==request.descriptor||evidence?.photoDigest!==request.photoDigest)throw Error("Evidence identity differs");
  const key=evidenceKey(request);const value=JSON.stringify(evidence);const size=Buffer.byteLength(value);
  if(size>this.maxBytes)return false;
  const prior=this.values.get(key);if(prior!==undefined){this.bytes-=Buffer.byteLength(prior);this.values.delete(key)}
  while(this.values.size>=this.maxEntries||this.bytes+size>this.maxBytes){const oldest=this.values.keys().next().value!;const entry=this.values.get(oldest)!;this.bytes-=Buffer.byteLength(entry);this.values.delete(oldest)}
  this.values.set(key,value);this.bytes+=size;return true;
 }
}
