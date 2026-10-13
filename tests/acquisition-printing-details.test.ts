import {test} from "node:test";
import assert from "node:assert/strict";
import {printingDetailSchema,printingDetailSummary,printingDetailBounds,validPrintingReferenceImage} from "../lib/acquisition-printing-details";
import {boundedPrintingDetailOutput} from "../lib/acquisition-printing-detail-budget";
import {printingNativeSchema,acquisitionPrintingSummary,applyAcquisitionPrintingEvidence} from "../lib/acquisition-printing";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {combineAcquisitionCandidates} from "../lib/acquisition-visual";
import {setSymbolSchema} from '../lib/acquisition-set-symbol';

const details=()=>({version:"registered-printing-details-v1",regions:Object.entries(printingDetailBounds).map(([region,bounds])=>({
  region,bounds:[...bounds],status:"MEASURED",reason:"VISIBLE_REFERENCE_COMPARISON",correlation:.97,colorResidual:1.2,
  colorResidual95:2.7,sourceSharpness:98,referenceSharpness:110,localOffset:[0,0],
}))});
test("detail regions retain measurements while review projection omits uncalibrated numerical scores",()=>{
  const parsed=printingDetailSchema.parse(details());
  assert.equal(parsed.regions[0].correlation,.97);
  const review=printingDetailSummary(parsed);
  assert.equal(review.regions.length,5);
  assert.equal(JSON.stringify(review).includes("correlation"),false);
  assert.equal(JSON.stringify(review).includes("colorResidual"),false);
});
test("invented measurements, nonfinite scores, wrong coordinates and duplicate bands are rejected",()=>{
  const value=details();
  for(const change of [{correlation:Infinity},{colorResidual:-1},{correlation:2},
    {bounds:[0,0,1000,1397]},{localOffset:[5,0]},
    {correlation:undefined,colorResidual:undefined},{reason:"MATCH_CONFIRMED"}]){
    assert.equal(printingDetailSchema.safeParse({...value,regions:[{...value.regions[0],...change},...value.regions.slice(1)]}).success,false);
  }
  assert.equal(printingDetailSchema.safeParse({...value,regions:[value.regions[1],...value.regions.slice(1)]}).success,false);
});
test("public reference image identity binds card, face and allowed HTTPS origin",()=>{
  const id="0000419b-0bba-4488-8f7a-6194544ce91e";
  const uri=`https://cards.scryfall.io/normal/front/0/0/${id}.jpg?1783910776`;
  assert(validPrintingReferenceImage(uri,id,"0"));
  assert(!validPrintingReferenceImage(uri,id,"1"));
  assert(!validPrintingReferenceImage(uri,"another-id","0"));
  for(const invalid of [uri.replace("https:","http:"),uri.replace("cards.scryfall.io","localhost"),
    uri.replace("cards.scryfall.io","user:pass@cards.scryfall.io"),uri+"#private",uri+"&token=private"])
    assert(!validPrintingReferenceImage(invalid,id,"0"));
});
test("detail envelope budget preserves primary observations, proposals and stamp evidence",()=>{
  const primary="p".repeat(57000);
  const extra={...details(),padding:"d".repeat(18000)};
  const output={native:{primary},proposals:{automaticAcceptance:false,proposals:[{id:"original",reasons:["STAMP_PRESENT"]}]},
    printingNative:{observedStamp:"PRESENT",candidates:[{id:"original",stamp:{status:"PRESENT"},details:extra,setSymbol:{padding:'s'.repeat(18000)},referenceImage:{uri:"public"}}]},
    printing:{observedStamp:"PRESENT",candidates:[{cardId:"original",relation:"AGREES_WITH_STAMP_STATE",details:extra,setSymbol:{padding:'s'.repeat(18000)},referenceFace:0,referenceImage:{uri:"public"}}]},
  };
  const before=JSON.stringify(output);
  const result=boundedPrintingDetailOutput(output);
  assert(Buffer.byteLength(JSON.stringify(result))<=65536);
  assert.deepEqual(result.native,output.native);
  assert.deepEqual(result.proposals,output.proposals);
  assert.equal((result.printing as any).detailStatus,"OUTPUT_BUDGET");
  assert.deepEqual(result.printingNative.candidates[0].stamp,{status:"PRESENT"});
  assert.equal((result.printingNative.candidates[0] as any).details,undefined);
  assert.equal((result.printingNative.candidates[0] as any).setSymbol,undefined);
  assert.equal((result.printing.candidates[0] as any).setSymbol,undefined);
  assert.equal(JSON.stringify(output),before);
});
test("already-full legacy output is not truncated to manufacture a passing result",()=>{
  const output={native:{primary:"p".repeat(66000)},printingNative:{candidates:[]},printing:{candidates:[]}};
  const result=boundedPrintingDetailOutput(output);
  assert(Buffer.byteLength(JSON.stringify(result))>65536);
  assert.deepEqual(result.native,output.native);
});
test("new detail observations preserve exact identifier and stamp decisions and bind the preview to its face",()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const card={id:"local-card",name:"Example Guard",setCode:"abc",collectorNumber:"17",lang:"en"};
  const cards=new Map([[id,card]]);
  const proposals=combineAcquisitionCandidates(proposeOrientedAcquisitionPrintings(
    createAcquisitionRecognitionIndex([card]),[{rotationDegrees:0,text:{title:[card.name],footer:["ABC EN","17"]}},
      {rotationDegrees:180,text:{title:[],footer:[]}}]),
    {candidates:[{scryfallId:id}]},cards);
  const native={version:"registered-printing-runtime-v1",sourceSize:[1000,1397],observedStamp:"UNREADABLE",
    conflictingObservations:false,automaticAcceptance:false,candidates:[{scryfallId:id,referenceId:id+":0",
      referenceStampState:"UNKNOWN",relation:"UNRESOLVED",stamp:{status:"UNREADABLE",reason:"UNKNOWN"},
      alignment:{status:"ALIGNED",quad:[[0,0],[999,0],[999,1396],[0,1396]],sourceCardWidth:1000,inliers:30,
        supportFraction:.5,medianReprojectionPixels:1}}]};
  const legacy=printingNativeSchema.parse(native);
  const observed={...native,candidates:[{...native.candidates[0],details:details(),
    referenceImage:{uri:`https://cards.scryfall.io/normal/front/1/1/${id}.jpg`,sha256:"a".repeat(64)}}]};
  const parsed=printingNativeSchema.parse(observed);
  assert.deepEqual(applyAcquisitionPrintingEvidence(proposals,parsed,cards),applyAcquisitionPrintingEvidence(proposals,legacy,cards));
  const summary=acquisitionPrintingSummary(parsed,cards).candidates[0];
  assert.equal(summary.referenceFace,0);
  assert(summary.referenceBoundary);
  assert.equal(summary.referenceImage?.sha256,"a".repeat(64));
  assert(!JSON.stringify(summary.details).includes("colorResidual"));
  assert(!printingNativeSchema.safeParse({...observed,candidates:[{...observed.candidates[0],referenceId:id+":1"}]}).success);
  assert(!printingNativeSchema.safeParse({...observed,candidates:[{...observed.candidates[0],alignment:{status:"UNREADABLE"}}]}).success);
  const icon={status:'SIMILAR',reason:'SHAPE_COMPARISON',matches:[
    {family:'a'.repeat(16),codes:['AFR','XDND'],similarity:.97},
    {family:'b'.repeat(16),codes:['SPM'],similarity:.8}],box:[40,30,50,50]};
  const setSymbol=setSymbolSchema.parse({version:'expansion-symbol-shapes-v1',bounds:[790,745,960,900],automaticAcceptance:false,
    query:icon,reference:icon,relation:'SIMILAR_SHAPE'});
  const withIcon=printingNativeSchema.parse({...observed,candidates:[{...observed.candidates[0],setSymbol}]});
  assert.deepEqual(applyAcquisitionPrintingEvidence(proposals,withIcon,cards),applyAcquisitionPrintingEvidence(proposals,legacy,cards));
  assert.deepEqual(acquisitionPrintingSummary(withIcon,cards).candidates[0].setSymbol,setSymbol);
  assert(!printingNativeSchema.safeParse({...observed,candidates:[{...observed.candidates[0],setSymbol,alignment:{status:'UNREADABLE'}}]}).success);
});
