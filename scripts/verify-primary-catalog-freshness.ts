import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {z} from "zod";
import type {PrismaClient} from "@prisma/client";
import * as recognition from "../lib/acquisition-recognition-worker";
import {writeAcquisitionPhotoBytes} from "../lib/acquisition-files";
import {recognitionWorkerFailure} from "../lib/acquisition-worker-diagnostics";
import {REFERENCE_REFINEMENT_STAGE} from "../lib/acquisition-reference-lineage";
import {CATALOG_RESOLVER_VERSION} from "../lib/acquisition-catalog-status";

// Actual primary entrypoint, PostgreSQL snapshot/index, private source reads and
// proposal generation. Clock, job delivery and native OCR are explicit fixtures;
// this does not measure OCR accuracy, queue fairness or native resource use.
export async function verifyPrimaryCatalogFreshness(db:PrismaClient) {
  const parent=path.resolve(".local-data");await mkdir(parent,{recursive:true});
  const root=await mkdtemp(path.join(parent,"primary-catalog-fixture-")),previousRoot=process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH=root;
  const ids:string[]=[];
  const source=await readFile(new URL("./acquisition-recognition-worker.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  try {for(const refinement of [false,true]) {
    const model="a".repeat(64),tag="Fresh catalog "+randomUUID(),cards=[0,1].map(n=>({id:randomUUID(),scryfallId:randomUUID(),name:tag+" "+n,setCode:"tst",collectorNumber:String(n+1),lang:"en",digital:false,typeLine:"Artifact",rarity:"common",finishes:["nonfoil"]}));
    ids.push(...cards.map(c=>c.id));
    const photos=cards.map((card,n)=>{const bytes=Buffer.from("synthetic exact source "+tag+" "+n);return{card,bytes,id:randomUUID(),digest:createHash("sha256").update(bytes).digest("hex")};});
    let now=0,cycles=0,delivered=0,refinementAdmissions=0,disconnected=false,closed=false;
    const actualErrors:unknown[]=[];const loads:recognition.RecognitionSnapshot[]=[],admissions:string[]=[],outputs:any[]=[],failures:unknown[]=[],handlers:Record<string,()=>void>={};
    const processState={platform:"linux",getuid:()=>0,on:(name:string,handler:()=>void)=>handlers[name]=handler,env:refinement?{ACQUISITION_REFERENCE_REFINEMENT_ENABLED:"1"}:{},argv:[],exitCode:undefined as number|undefined};
    class NativeFixture {
      async prepare() {}
      close(){closed=true;}
      async request(frame:Buffer){
        const length=frame.readUInt32BE(0),framed=length<frame.length-4;
        const header=framed?JSON.parse(frame.subarray(4,4+length).toString()):null;
        const bytes=framed?frame.subarray(4+length):frame;
        const photo=photos.find(p=>p.bytes.equals(bytes));assert(photo,"exact original source bytes required");
        if(header?.recognitionTask==="WHOLE_PHOTO_TEXT")return{photoDigest:photo.digest,descriptor:model,recognitionTask:"WHOLE_PHOTO_TEXT",photoText:{version:1,scope:"WHOLE_PHOTO",status:"UNAVAILABLE",reason:"WORKER_ERROR",readings:[]}};
        const text={title:[photo.card.name],footer:["TST "+photo.card.collectorNumber+" EN"]};
        return{version:1,descriptor:model,descriptorDetails:{},photoDigest:photo.digest,text,geometry:{status:"ACCEPTED"},orientations:[{rotationDegrees:0,text,lines:[]},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],lines:[],milliseconds:1,automaticAcceptance:false};
      }
    }
    const dependencies:Record<string,unknown>={
      "../lib/acquisition-worker-diagnostics":{recognitionWorkerFailure},"@prisma/client":{PrismaClient:class{constructor(){return db;} }},
      "node:crypto":{randomUUID},"zod":{z},"../lib/acquisition-native-process":{runAcquisitionNativeProcess:async()=>({digest:model})},
      "../lib/acquisition-native-stream":{AcquisitionNativeStream:NativeFixture},"../lib/acquisition-native-failure":{observeNativeFailure:()=>()=>{}},
      "../lib/acquisition-reference-lineage":{REFERENCE_REFINEMENT_STAGE},"../lib/acquisition-catalog-status":{CATALOG_RESOLVER_VERSION},
      "../lib/acquisition-reference-jobs":{enqueueReadyReferenceRefinement:async()=>{refinementAdmissions++;}},"../lib/acquisition-reference-worker":{currentAcquisitionReferenceInput:()=>{throw Error("No reference job in this fixture");},recognizeAcquisitionReferenceRefinement:()=>{throw Error("No reference job in this fixture");}},
      "../lib/acquisition-recognition-worker":{...recognition,loadAcquisitionRecognitionSnapshot:async(client:PrismaClient,previous?:recognition.RecognitionSnapshot)=>{const loaded=await recognition.loadAcquisitionRecognitionSnapshot(client,previous);if(loads.length)assert.equal(previous,loads.at(-1));loads.push(loaded);return loaded;},enqueueReadyRecognition:async(_client:PrismaClient,digest:string)=>{admissions.push(digest);}},
      "../lib/acquisition-jobs":{runAcquisitionJobsOnce:async(_client:PrismaClient,stages:Record<string,(job:unknown,signal:AbortSignal)=>Promise<unknown>>,_worker:string,options:unknown)=>{
        assert.deepEqual(JSON.parse(JSON.stringify(options)),{timeoutMs:45000,leaseMs:90000});
        if(now<=30000)return{claimed:0};
        const photo=photos[delivered];if(!photo)return{claimed:0};
        let output:any;try{output=await stages[recognition.RECOGNITION_STAGE]({input:{photoId:photo.id,digest:photo.digest,inputKind:"PHOTO",versions:{catalog:admissions.at(-1),model}}},AbortSignal.timeout(5000));}catch(error){actualErrors.push(error);throw error;}
        outputs.push(output);delivered++;return{claimed:1,complete:1};
      }},
      "node:timers/promises":{setTimeout:async()=>{
        cycles++;
        if(cycles===1){await db.card.createMany({data:cards});for(const p of photos)await writeAcquisitionPhotoBytes(p.id,p.bytes,"raw",p.digest);now=30000;}
        else if(cycles===2)now=30001;
        else if(cycles===3)now=60002;
        else handlers.SIGTERM();
      }},
    };
    // The script owns its client lifetime; intercept only its final disconnect.
    dependencies["@prisma/client"]={PrismaClient:class{constructor(){return new Proxy(db,{get(target,key){if(key==="$disconnect")return async()=>{disconnected=true;};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});}}};
    const context=vm.createContext({exports:{},require:(name:string)=>{assert(name in dependencies,"Unexpected dependency "+name);return dependencies[name];},process:processState,Buffer,AbortSignal,Date:{now:()=>now},console:{log:()=>{},error:(value:string)=>failures.push(JSON.parse(value))}});
    await vm.runInContext(code,context);
    if(actualErrors.length)throw actualErrors[0];assert.deepEqual(failures,[],"Worker fixture failure: "+JSON.stringify(failures));assert.equal(processState.exitCode,undefined);assert(closed&&disconnected);
    assert.equal(outputs.length,2);assert.equal(loads.length,3,"startup, changed-content refresh, unchanged-content reuse");
    assert.equal(admissions[0],admissions[1],"exact30s boundary retains current immutable snapshot");
    assert.notEqual(loads[0].digest,loads[1].digest);assert.equal(loads[1],loads[2],"unchanged catalog reuses index/maps");
    for(let n=0;n<2;n++){
      assert.equal(outputs[n].proposals.proposals[0]?.card.id,cards[n].id,"primary OCR must see a card cached after its startup snapshot");
      assert.equal(outputs[n].versions.catalog,loads[1].digest);assert.equal(outputs[n].versions.index,loads[1].digest);
      assert.equal(outputs[n].native.automaticAcceptance,false);
    }
    assert.equal(refinementAdmissions,refinement?4:0,"freshness never enables reference work");
    assert.equal(recognition.acquisitionRecognitionVersion(loads[0].digest,model),recognition.acquisitionRecognitionVersion(loads[1].digest,model),"catalog refresh grants no duplicate raw OCR identity");
  }
  console.log("PASS: actual primary entrypoint with real paged PostgreSQL snapshots sees post-startup exact cards in both refinement modes;30s boundary, unchanged index reuse, source bytes, catalog provenance, raw job identity and unchanged lease policy; native/clock/delivery are synthetic");
  } finally {await db.card.deleteMany({where:{id:{in:ids}}});if(previousRoot===undefined)delete process.env.UPLOADS_DATA_PATH;else process.env.UPLOADS_DATA_PATH=previousRoot;if(path.dirname(root)!==parent||!path.basename(root).startsWith("primary-catalog-fixture-"))throw Error("Fixture root escaped");await rm(root,{recursive:true,force:true});}
}
