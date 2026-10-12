import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { correctionHash } from "../lib/acquisition-correction-policy";
import { acquisitionReferenceLineageKey, acquisitionReferenceParentsMatch,
  type ReferenceParent, type AcquisitionReferenceLineageInput } from "../lib/acquisition-reference-lineage";
import { REFERENCE_REGION_POLICY } from "../lib/acquisition-reference-region";
import { CATALOG_RECONCILIATION_STAGE } from "../lib/acquisition-catalog-status";
const photoId=randomUUID(), digest="a".repeat(64), model="b".repeat(64), catalog="c".repeat(64),
  referenceModel="d".repeat(64), primaryVersion="e".repeat(64);
const ids=[randomUUID(),randomUUID(),randomUUID()];
const referenceId=randomUUID(), nativePrinting={version:"registered-printing-runtime-v1",
  observedStamp:"UNREADABLE",conflictingObservations:false,automaticAcceptance:false,sourceSize:[1180,1537],
  candidates:[{scryfallId:referenceId,referenceId:referenceId+":0",referenceStampState:"UNKNOWN",relation:"UNRESOLVED",
    alignment:{status:"ALIGNED",quad:[[80,60],[1079,60],[1079,1456],[80,1456]],inliers:80,matches:100,
      sourceCardWidth:999,supportFraction:.7,medianReprojectionPixels:1,footerVisible:true},
    stamp:{status:"UNREADABLE",reason:"NO_TEMPLATES"}}]};
const common={runId:randomUUID(),artifactId:randomUUID(),candidateId:randomUUID(),candidateRevision:0,
  status:"COMPLETE",versionKey:primaryVersion};
const parents: [ReferenceParent,ReferenceParent,ReferenceParent] = [
  {...common,id:ids[0],stage:"photo-recognition-v1",input:{photoId,digest,inputKind:"CARD_SCAN"},
    output:{photoId,native:{photoDigest:digest,descriptor:model,geometry:{status:"PROPOSED",method:"declared-card-scan"}}}},
  {...common,id:ids[1],stage:CATALOG_RECONCILIATION_STAGE,input:{photoId,digest,recognitionJobId:ids[0],
    resolverVersion:"current-resolver"},output:{photoId,sourceRecognitionJobId:ids[0],
      versions:{catalog,resolver:"current-resolver"}}},
  {...common,id:ids[2],stage:"photo-printing-evidence-v1",input:{photoId,digest,catalogJobId:ids[1],model:referenceModel},
    output:{photoId,sourceCatalogJobId:ids[1],versions:{catalog,resolver:"current-resolver",printing:referenceModel},printingNative:nativePrinting}},
];
const lineage={photoId,digest,generation:2,model,catalog,referenceModel,primaryVersion,catalogResolver:"current-resolver"};
const input: AcquisitionReferenceLineageInput={...lineage,version:1,candidateRevision:0,
  lineageKey:acquisitionReferenceLineageKey(lineage),parents:{
    recognitionJobId:ids[0],recognitionOutputHash:correctionHash(parents[0].output),
    catalogJobId:ids[1],catalogOutputHash:correctionHash(parents[1].output),
    printingJobId:ids[2],printingOutputHash:correctionHash(parents[2].output)},
  reference:{version:1,policy:REFERENCE_REGION_POLICY,references:[referenceId+":0"],
    region:{version:1,quad:[[80/1179,60/1536],[1079/1179,60/1536],[1079/1179,1456/1536],[80/1179,1456/1536]]}}};
const scope={...common,currentModel:model,currentCatalog:catalog,currentReferenceModel:referenceModel,
  photoId,photoDigest:digest,currentCatalogResolver:"current-resolver",
  inputKind:"CARD_SCAN" as "PHOTO" | "CARD_SCAN",
  latestRecognitionJobId:ids[0],latestCatalogJobId:ids[1],latestPrintingJobId:ids[2],
  photoGeneration:2,slotGeneration:2,photoReady:true,photoPurged:false,ownerActive:true,creatorActive:true,
  forcePasswordChange:false,excluded:false,committed:false,cancelled:false,trashed:false,deleted:false,
  manualAnalysis:null,review:null,phase:"CAPTURE_OPEN"};
test("complete actual parent chain with unchanged outputs and authority matches",()=>{
  assert.equal(acquisitionReferenceParentsMatch(input,parents,scope),true);
});
test("refreshing parent IDs/revision/outline cannot change a one-pass lineage key",()=>{
  const refreshed={...input,candidateRevision:99,parents:{...input.parents,printingJobId:randomUUID()},
    reference:{...input.reference,references:[randomUUID()+":0"]}};
  assert.equal(acquisitionReferenceLineageKey(refreshed),input.lineageKey);
  for(const key of ["photoId","digest","generation","model","catalog","referenceModel","primaryVersion","catalogResolver"] as const){
    const changed={...lineage,[key]:key==="generation"?3:key==="catalogResolver"?"new-resolver":key==="photoId"?randomUUID():"f".repeat(64)};
    assert.notEqual(acquisitionReferenceLineageKey(changed),input.lineageKey);
  }
});
for(const patch of [
  {currentModel:"f".repeat(64)},{currentCatalog:"f".repeat(64)},{currentReferenceModel:"f".repeat(64)},
  {photoId:randomUUID()},{photoDigest:"f".repeat(64)},{currentCatalogResolver:"new-resolver"},
  {inputKind:"PHOTO" as const},
  {latestRecognitionJobId:randomUUID()},{latestCatalogJobId:randomUUID()},{latestPrintingJobId:randomUUID()},
  {candidateRevision:1},{photoGeneration:3},{slotGeneration:3},{photoReady:false},{photoPurged:true},
  {ownerActive:false},{creatorActive:false},{forcePasswordChange:true},{excluded:true},{committed:true},
  {cancelled:true},{trashed:true},{deleted:true},{manualAnalysis:{region:null}},{review:{cardId:"human"}},
  {phase:"DRAFT"},{phase:"CANCELLED"},
])test("stale or authoritative state veto: "+Object.keys(patch)[0],()=>{
  assert.equal(acquisitionReferenceParentsMatch(input,parents,{...scope,...patch}),false);
});
test("mutated, cross-scope, incomplete and unrelated parents are rejected",()=>{
  for(let i=0;i<3;i++)for(const patch of [
    {status:"RUNNING"},{runId:randomUUID()},{artifactId:randomUUID()},{candidateId:randomUUID()},
    {candidateRevision:1},{output:{changed:true}},{input:{photoId:randomUUID(),digest}},
  ]){
    const replaced=parents.map((p,n)=>n===i?{...p,...patch}:p) as typeof parents;
    assert.equal(acquisitionReferenceParentsMatch(input,replaced,scope),false);
  }
});
test("an earlier refinement cannot pose as the first native observation",()=>{
  const changed={...parents[0],output:{...(parents[0].output as object),referenceRefinement:{already:true}}};
  const loop={...input,parents:{...input.parents,recognitionOutputHash:correctionHash(changed.output)}};
  assert.equal(acquisitionReferenceParentsMatch(loop,[changed,parents[1],parents[2]],scope),false);
});
test("supplied geometry and references must match actual supported parent observations",()=>{
  for(const reference of [
    {...input.reference,references:[randomUUID()+":0"]},
    {...input.reference,region:{version:1 as const,quad:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]] as [[number,number],[number,number],[number,number],[number,number]]}},
  ])assert.equal(acquisitionReferenceParentsMatch({...input,reference},parents,scope),false);
});
test("original photo hints and already framed native corners cannot be hidden by schema parsing",()=>{
  const photo={...parents[0],input:{photoId,digest,inputKind:"PHOTO"}};
  assert.equal(acquisitionReferenceParentsMatch(input,[photo,parents[1],parents[2]],scope),false);
  const output={...(parents[0].output as any),native:{...(parents[0].output as any).native,
    geometry:{...(parents[0].output as any).native.geometry,quad:nativePrinting.candidates[0].alignment.quad}}};
  const framed={...parents[0],output};
  assert.equal(acquisitionReferenceParentsMatch({...input,parents:{...input.parents,
    recognitionOutputHash:correctionHash(output)}},[framed,parents[1],parents[2]],scope),false);
});
for(const [parentIndex,key,value] of [[1,"catalog","f".repeat(64)],[1,"resolver","new-resolver"],
  [2,"catalog","f".repeat(64)],[2,"printing","f".repeat(64)]] as const)
test("freshly hashed parent cannot hide mismatched output version "+parentIndex+"/"+key,()=>{
  const output={...(parents[parentIndex].output as any),versions:{...(parents[parentIndex].output as any).versions,[key]:value}};
  const replaced=parents.map((p,n)=>n===parentIndex?{...p,output}:p) as typeof parents;
  const hashes={...input.parents,[parentIndex===1?"catalogOutputHash":"printingOutputHash"]:correctionHash(output)};
  assert.equal(acquisitionReferenceParentsMatch({...input,parents:hashes},replaced,scope),false);
});
