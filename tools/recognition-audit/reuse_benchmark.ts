// Measured exact-request cache hits; no simulated skipped pipeline latency.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {EvidenceCache,type EvidenceRequest} from "./evidence_cache";
const argument=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`Missing ${name}`);return process.argv[i+1]};
const bytes=readFileSync(argument("--observations"));const source=JSON.parse(bytes.toString("utf8"));
if(source.complete!==true)throw Error("Complete source observations required");
const referenceDigest=JSON.parse(readFileSync(argument("--index"),"utf8")).files["references.json"].sha256;
const cache=new EvidenceCache();const rows=[];
for(const row of source.rounds.filter((r:any)=>r.variant==="BASELINE"&&r.nativePrinting)){
 const native=row.nativePrinting;const stage=row.stageCalls.find((s:any)=>s.stage==="printing");
 const request:EvidenceRequest={ownerScope:"isolated-single-owner-audit",stage:"printing",photoDigest:row.sha256,inputKind:"PRINTING_RAW_PHOTO",descriptor:native.descriptor,indexDigest:referenceDigest,policy:"catalog-stamp-expectations-v1",catalogDigest:source.catalogSha256,candidateIds:row.beforePrinting.proposals.slice(0,12).map((p:any)=>p.card.id)};
 assert.equal(cache.put(request,native),true);const timings=[];
 for(let repeat=0;repeat<20;repeat++){
  const start=performance.now();const hit=cache.get(request);assert.ok(hit);const output=JSON.stringify(hit);timings.push(performance.now()-start);
  assert.equal(output,JSON.stringify(native));
 }
 rows.push({sampleId:row.sampleId,photoDigest:row.sha256,uncachedPrintingWallMilliseconds:stage.wallMilliseconds,cachedReadSerializeMilliseconds:timings,observationsIdentical:true,cacheHitExpensiveOperations:0});
}
writeFileSync(argument("--output"),JSON.stringify({version:1,scope:"WARM_EXACT_REQUEST_REUSE_PROTOTYPE; native observations warmed from separately measured baseline requests",sourceObservationsSha256:createHash("sha256").update(bytes).digest("hex"),results:rows,limits:["Warmup/native computation remains necessary","Cache lookup/validation/serialization timing only; not repeated full pipeline latency","No accuracy or automatic coverage improvement: preserves original uncertainty and errors","Owner/model/index/catalog/policy/ordered candidate boundaries checked; publisher still needs current job/review/revision fences","Filesystem persistence, TTL and cross-process invalidation not implemented or benchmarked"]},null,2)+"\n");
console.log(JSON.stringify({samples:rows.length,measuredHits:rows.length*20,identical:true,expensiveOperationsPerHit:0}));
