// Offline paired audit. Private config supplies mount paths, never labels to inference.
import {observedScope} from "./observed_scope";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../../lib/acquisition-recognition";
import {combineAcquisitionCandidates} from "../../lib/acquisition-visual";
import {applyAcquisitionPrintingEvidence,printingNativeSchema} from "../../lib/acquisition-printing";
import {acquisitionNativePhotoInput} from "../../lib/acquisition-image-input";
import {combineAcquisitionPhotoText,needsAcquisitionPhotoText,readAcquisitionPhotoText} from "../../lib/acquisition-photo-text";
const arg=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw Error(`Missing ${key}`);return process.argv[i+1]};
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
class Native {
 child:any; pending:any;buffer="";started=false;
 constructor(public name:string, public args:string[],public stderr:string){}
 request(bytes:Buffer,limit=45000,progress?:(v:any)=>void):Promise<any>{
  if(this.pending)throw Error("Native busy");
  if(!this.child){
   this.child=spawn("docker",this.args,{windowsHide:true,stdio:["pipe","pipe","pipe"]});
   this.child.stderr.on("data",(data:Buffer)=>{writeFileSync(this.stderr,data,{flag:"a"});});
   this.child.stdout.on("data",(data:Buffer)=>{
    this.buffer+=data.toString("utf8");
    let i;while((i=this.buffer.indexOf("\n"))>=0){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);
     try{const value=JSON.parse(line);if(value.progress){this.pending?.progress?.(value);continue;}const p=this.pending;if(!p)throw Error("Unexpected output");this.pending=null;clearTimeout(p.timer);p.resolve(value);}
     catch(e){this.fail(e);}
    }
   });
   this.child.on("error",(e:Error)=>this.fail(e));this.child.on("close",()=>{this.child=null;this.fail(Error("Native exited"));});
  }
  return new Promise((resolve,reject)=>{
   this.pending={resolve,reject,progress,timer:setTimeout(()=>{this.fail(Error("Native deadline"));this.close()},limit)};
   const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);this.child.stdin.write(header);this.child.stdin.write(bytes);
  });
 }
 fail(e:unknown){if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.reject(e)}}
 close(){this.child?.stdin.end();spawnSync("docker",["rm","-f",this.name],{windowsHide:true,stdio:"ignore"});this.child?.kill();}
}
async function main(){
 const config=JSON.parse(readFileSync(arg("--config"),"utf8"));const manifestBytes=readFileSync(arg("--manifest"));const manifest=JSON.parse(manifestBytes.toString("utf8"));
 const catalogBytes=readFileSync(config.catalog);const cards=JSON.parse(catalogBytes.toString("utf8")).map((c:any)=>({...c,id:c.scryfallId}));
 const index=createAcquisitionRecognitionIndex(cards);const byId=new Map(cards.map((c:any)=>[c.id,c]));
 const variants=process.argv.includes("--baseline-only")?["BASELINE"]:["BASELINE","IDENTIFIER_FIRST","IDENTIFIER_PARTIAL"];
 const limit=process.argv.includes("--limit")?Number(arg("--limit")):manifest.entries.length;
 const dockerArgs=(stage:string,name:string)=>["run","--rm","-i","--name",name,"--network","none","--read-only","--tmpfs","/tmp:rw,size=512m","--cpus","2","--memory",stage==="visual"?"3g":"2g",
  "--mount",`type=bind,source=${config.runtime},target=/app/tools/acquisition-runtime,readonly`,"--mount",`type=bind,source=${config.eval},target=/eval,readonly`,"--mount",`type=bind,source=${config.auditTools},target=/audit,readonly`,
  ...(stage==="ocr"?["--mount",`type=bind,source=${config.ocrModels},target=/models,readonly`]:["--mount",`type=bind,source=${config.index},target=/visual/index,readonly`,"--mount",`type=bind,source=${config.references},target=/visual/references,readonly`,"--mount",`type=bind,source=${config.visualModels},target=/visual/models,readonly`]),
  "--entrypoint","python",stage==="ocr"?config.ocrImage:config.visualImage,...(stage==="visual"?["/audit/scoped_visual_probe.py"]:["/audit/native_probe_progress.py","--stage",stage])];
 const report:any={version:1,scope:"OFFLINE_FULL_CATALOG_CACHE_PAIRED_INFERENCE_NO_APP_QUEUE_OR_PROVIDER_LATENCY",manifestSha256:hash(manifestBytes),catalogSha256:hash(catalogBytes),catalogCards:cards.length,configSha256:hash(readFileSync(arg("--config"))),harnessSha256:hash(readFileSync(import.meta.filename)),nativeProbeSha256:hash(readFileSync(path.join(config.auditTools,"native_probe_progress.py"))),sourceRuntimeHashes:Object.fromEntries(["recognize.py","visual.py","printing.py","printing_worker.py","reading_direction.py"].map(file=>[file,hash(readFileSync(path.join(config.runtime,file)))])),variants,rounds:[],limits:["Existing local background workers remain active; alternate order and report load limitation","Catalog uses frozen full local projection; provider/cache-miss and queue latency excluded","Validation mode must use policy locked after development; physical grouping disclosed separately","Shared native model/reference caches between variants; rotate order per card; stage-specific cold flags, including after timeout restart"]};
 const save=()=>writeFileSync(arg("--output"),JSON.stringify(report,null,2)+"\n");
 const workers:Record<string,Native>={};
 for(const stage of ["ocr","visual","printing"]){const name=`mtg-audit-paired-${stage}`;workers[stage]=new Native(name,dockerArgs(stage,name),arg("--output")+`.${stage}.stderr.log`)}
 try{
  for(let sampleNo=0;sampleNo<Math.min(limit,manifest.entries.length);sampleNo++){
   const entry=manifest.entries[sampleNo];const bytes=readFileSync(path.join(config.photos,entry.file));if(hash(bytes)!==entry.sha256)throw Error("Original digest changed");
   const order=[...variants.slice(sampleNo%variants.length),...variants.slice(0,sampleNo%variants.length)];
   for(const variant of order){
    const start=performance.now();const row:any={sampleId:entry.sampleId??entry.file,sha256:entry.sha256,split:entry.split,variant,cold:sampleNo===0,counts:{},stages:{},automaticAcceptance:false};
    const call=async(stage:string,input:Buffer,budget=45000,onProgress?:(value:any)=>void)=>{const before=performance.now();const coldCall=!workers[stage].child;const progress:any[]=[];let result;row.coldNativeStages??=[];if(coldCall)row.coldNativeStages.push(stage);
     try{result=await workers[stage].request(input,budget,value=>{progress.push(value);onProgress?.(value)});}catch(error){
      row.stageCalls??=[];const last=progress.at(-1);const counts=last?.audit?.counts??{};
      for(const[k,v]of Object.entries(counts))row.counts[k]=(row.counts[k]??0)+Number(v);
      row.incompleteOperationCounts=true;row.stageCalls.push({stage,cold:coldCall,wallMilliseconds:Math.round(performance.now()-before),failed:true,completedProgressFrames:progress.length,audit:{counts,countsAreLowerBound:true}});throw error;
     }
     row.stageCalls??=[];row.stages[stage]={cold:coldCall,wallMilliseconds:Math.round(performance.now()-before),nativeMilliseconds:result.milliseconds,descriptor:result.descriptor,audit:result.audit};row.stageCalls.push({stage,...row.stages[stage]});for(const [k,v]of Object.entries(result.audit?.counts??{}))row.counts[k]=(row.counts[k]??0)+Number(v);if(result.photoDigest!==entry.sha256)throw Error("Native input changed");return result};
    const hint=acquisitionNativePhotoInput(bytes,entry.inputKind);
    const visualPending=variant==="BASELINE"?call("visual",hint):null;visualPending?.catch(()=>{});
    const ocr=await call("ocr",hint);let primary=proposeOrientedAcquisitionPrintings(index,ocr.orientations??[]);
    row.nativeOCR=ocr;
    if(needsAcquisitionPhotoText(primary)){
     const remaining=35000-row.stages.ocr.wallMilliseconds;
     if(remaining>0){const photoText=await readAcquisitionPhotoText((input,signal,onProgress)=>call("ocr",input,Math.min(32000,remaining),onProgress),bytes,entry.inputKind,{photoDigest:entry.sha256,descriptor:ocr.descriptor},AbortSignal.timeout(45000),Math.min(32000,remaining));primary=combineAcquisitionPhotoText(index,primary,photoText);row.wholePhotoText=photoText;}
    }
    const top=primary.proposals[0];
    const identifierRoute=variant!=="BASELINE"&&primary.status!=="CONFLICT"&&primary.orientation?.status==="SELECTED"&&top?.reasons.includes("SET_AND_COLLECTOR_TEXT")&&top.reasons.includes("TITLE_TEXT_AGREES")&&top.reasons.includes("TITLE_EXACT");
    row.route=identifierRoute?"EXACT_IDENTIFIER":"GLOBAL_IMAGE";row.primary=primary;
    let combined=primary;
    if(!identifierRoute){
     let visual;
     const scope=variant==="IDENTIFIER_PARTIAL"?observedScope(index,primary,ocr.orientations??[]):null;
     if(scope){const metadata=Buffer.from(JSON.stringify({inputKind:entry.inputKind,candidateScryfallIds:scope.ids}));const h=Buffer.alloc(4);h.writeUInt32BE(metadata.length);visual=await call("visual",Buffer.concat([h,metadata,bytes]));row.scope=scope;row.route="PARTIAL_SCOPED_IMAGE";
      if(!visual.geometricCandidates?.some((c:any)=>c.inliers>=15)){row.scopedAttempt=visual;visual=await call("visual",hint);row.route="SCOPED_THEN_GLOBAL";}
     }else visual=await(visualPending??call("visual",hint));
     row.nativeVisual=visual;combined=combineAcquisitionCandidates(primary,visual,byId as any)
    }
    else{
     // Restrict only using observed exact-footer evidence; no expected identities.
     combined={...primary,proposals:primary.proposals.filter(p=>p.reasons.includes("SET_AND_COLLECTOR_TEXT")&&p.reasons.includes("TITLE_TEXT_AGREES")&&p.card.name===top.card.name)};
    }
    row.beforePrinting=combined;const ids=combined.proposals.slice(0,12).map(p=>p.card.id);
    if(ids.length){const metadata=Buffer.from(JSON.stringify({scryfallIds:ids}));const header=Buffer.alloc(4);header.writeUInt32BE(metadata.length);const raw=await call("printing",Buffer.concat([header,metadata,bytes]));row.nativePrinting=raw;combined=applyAcquisitionPrintingEvidence(combined,printingNativeSchema.parse(raw),byId as any);}
    row.result=combined;
    const winner=combined.proposals[0];const printing=row.nativePrinting;
    const supportsWinner=printing?.candidates.some((c:any)=>c.scryfallId===winner?.card.id&&c.alignment.status==="ALIGNED"&&c.alignment.stampVisible&&c.alignment.footerVisible&&c.alignment.sourceCardWidth>=500);
    const hasStampFamily=combined.proposals.some(p=>p.card.setCode.toLowerCase()==="plst");
    const candidatesAgree=combined.proposals.filter(p=>!p.reasons.includes("STAMP_CONTRADICTION"));
    const automaticEligible=identifierRoute&&supportsWinner&&!printing?.conflictingObservations&&candidatesAgree.length===1&&(!hasStampFamily||["STAMP_PRESENT","STAMP_ABSENT"].some(r=>winner.reasons.includes(r)))&&printing?.observedStamp!=="UNREADABLE";
    row.offlineAutomaticDecision=automaticEligible?winner.card.id:null;
    row.confidentlyWrong=automaticEligible?!entry.expectedScryfallIds?.includes(winner.card.id):false;
    row.totalMilliseconds=Math.round(performance.now()-start);
    // Candidate acceleration is assessed separately from any automatic promotion.
    row.expectedScryfallIds=entry.expectedScryfallIds;row.exactTop1=entry.expectedScryfallIds?.includes(combined.proposals[0]?.card.id)??null;
    row.exactRank=combined.proposals.findIndex(p=>entry.expectedScryfallIds?.includes(p.card.id))+1||null;
    row.manualCorrectionNeeded=row.exactTop1===false;
    report.rounds.push(row);save();console.log(JSON.stringify({sample:row.sampleId,variant,route:row.route,milliseconds:row.totalMilliseconds,exactTop1:row.exactTop1,counts:row.counts}));
   }
  }
  report.complete=true;save();
 }finally{for(const worker of Object.values(workers))worker.close();save()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
