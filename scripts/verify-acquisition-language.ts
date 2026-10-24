import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {type Card,Prisma,type PrismaClient} from "@prisma/client";
import {createAcquisitionRecognitionIndex,proposeOrientedAcquisitionPrintings} from "../lib/acquisition-recognition";
import {createCatalogReconciliationHandler} from "../lib/acquisition-catalog-reconciliation";
import {CATALOG_RECONCILIATION_STAGE,CATALOG_RESOLVER_VERSION} from "../lib/acquisition-catalog-status";
import {completeAcquisitionJob} from "../lib/acquisition-jobs";
import {confirmStrongAcquisitionMatches} from "../lib/acquisition-auto-confirm";
import {getAcquisitionCardReview,getAcquisitionProgress,saveAcquisitionReview,executeAcquisitionCommand,type AcquisitionActor} from "../lib/acquisition-store";
import {previewAcquisitionCommit,commitAcquisitionCards} from "../lib/acquisition-commit-service";
import type {ScryfallCard} from "../lib/scryfall";

export async function verifyAcquisitionLanguage(db:PrismaClient,actor:AcquisitionActor,stranger:AcquisitionActor,
  card:Card,capture:(count:number)=>Promise<{id:string;photos:{id:string}[]}>,registerCard:(id:string)=>void) {
  const french=await db.card.create({data:{scryfallId:randomUUID(),name:card.name,setCode:card.setCode,
    collectorNumber:card.collectorNumber,lang:"fr",digital:false,finishes:["nonfoil"],typeLine:card.typeLine,rarity:card.rarity}});
  registerCard(french.id);
  const batch=await capture(9),index=createAcquisitionRecognitionIndex([card,french].map(({id,name,setCode,collectorNumber,lang,digital})=>({id,name,setCode,collectorNumber,lang,digital})));
  const stock=()=>db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const before=await stock(),outputs:{id:string;output:Prisma.JsonValue}[]=[];
  const records:ScryfallCard[]=[card,french].map(row=>({object:"card",id:row.scryfallId,name:row.name,
    set:row.setCode,set_name:"Fixture",collector_number:row.collectorNumber,lang:row.lang!,digital:false,
    finishes:["nonfoil"],type_line:row.typeLine,rarity:row.rarity,cmc:1,color_identity:[]}));
  async function publish(position:number,kind="unreadable") {
    const canonical=await db.acquisitionProcessingJob.findFirstOrThrow({where:{artifact:{sourceId:batch.photos[position].id},stage:"photo-canonical-v1"},include:{candidate:true}});
    const text={title:kind==="title-missing"?[]:[card.name],footer:[`C ${card.collectorNumber}`,
      card.setCode.toUpperCase()+(kind==="readable-fr"?" FR":kind==="other-language"?" EN":"")]};
    const orientations=[{rotationDegrees:0,text,lines:[]},
      {rotationDegrees:180,text:kind==="orientation"?text:{title:[],footer:kind==="other-language"?["ZZZ FR"]:[]},lines:[]}];
    const native={version:1,descriptor:"a".repeat(64),descriptorDetails:{},photoDigest:(canonical.input as {digest:string}).digest,
      text,orientations,geometry:{status:"ACCEPTED"},lines:[],milliseconds:1,automaticAcceptance:false};
    const source={version:1,photoId:batch.photos[position].id,native,versions:{catalog:"b".repeat(64),model:"a".repeat(64)},
      proposals:proposeOrientedAcquisitionPrintings(index,orientations)};
    const common={runId:canonical.runId,artifactId:canonical.artifactId,candidateId:canonical.candidateId,
      candidateRevision:canonical.candidate.revision,input:canonical.input!};
    const raw=await db.acquisitionProcessingJob.create({data:{...common,stage:"photo-recognition-v1",versionKey:randomUUID(),status:"COMPLETE",output:source as unknown as Prisma.InputJsonObject}});
    const leaseToken=randomUUID();
    const job=await db.acquisitionProcessingJob.create({data:{...common,stage:CATALOG_RECONCILIATION_STAGE,versionKey:randomUUID(),
      status:"RUNNING",leaseToken,leaseExpiresAt:new Date(Date.now()+60000),attempts:1,
      input:{...(canonical.input as Prisma.InputJsonObject),recognitionJobId:raw.id,resolverVersion:CATALOG_RESOLVER_VERSION}}});
    const handler=createCatalogReconciliationHandler(db,async query=>kind==="provider-error"
      ? {status:"PROVIDER_ERROR",cards:[],requestsMade:0,printingCoverage:"UNRESOLVED",cacheHit:true,lookupKey:"controlled-language"}
      : query.kind==="printing" && query.set==="zzz"
      ? {status:"NOT_FOUND",cards:[],requestsMade:0,printingCoverage:"UNRESOLVED",cacheHit:true,lookupKey:"controlled-language"}
      : {status:"FOUND",cards:records,requestsMade:0,printingCoverage:"CHECKED",cacheHit:true,lookupKey:"controlled-language"});
    const output=await handler({...job,leaseToken},AbortSignal.timeout(30000));
    assert.deepEqual(output.native,native);assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:raw.id}})).output,source);
    assert.equal(await completeAcquisitionJob(db,{...job,leaseToken},output),"COMPLETE");
    outputs.push({id:raw.id,output:source as unknown as Prisma.JsonValue},{id:job.id,output:output as Prisma.JsonValue});
    if(kind==="unreadable"){
      assert.equal((output.proposals as any).automaticAcceptance,false);
      assert.deepEqual((output.batchLanguageProposals as any).options.map((option:any)=>option.language),["en","fr"]);
    }else assert.equal(output.batchLanguageProposals,undefined,"other uncertainty or readable language cannot borrow confirmation");
    return job.id;
  }
  async function defaults(language:string|null,revision:number){
    await saveAcquisitionReview(db,actor,batch.id,{action:"defaults",revision,defaults:{finish:"NONFOIL",condition:"NM",language}});
  }
  const review=(position:number)=>getAcquisitionCardReview(db,actor,batch.id,batch.photos[position].id);
  await assert.rejects(saveAcquisitionReview(db,stranger,batch.id,{action:"defaults",revision:0,defaults:{finish:"NONFOIL",condition:"NM",language:"en"}}));
  await defaults(null,0);const firstJob=await publish(0);
  assert.equal(await confirmStrongAcquisitionMatches(db),0,"missing language is not invented without explicit confirmation");
  await defaults("en",1);assert.equal(await confirmStrongAcquisitionMatches(db),1);
  assert.equal((await review(0)).review?.language,"en");
  const first=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:firstJob}});
  const command=await db.acquisitionCommand.findUniqueOrThrow({where:{runId_requestKey:{runId:first.runId,requestKey:`auto-confirm:${first.id}:2`}}});
  assert.deepEqual(JSON.parse(command.payload).languageConfirmation,{source:"CONFIRMED_BATCH",language:"en",defaultsRevision:2,usedForUnreadableLanguage:true});
  assert.equal(await confirmStrongAcquisitionMatches(db),0,"automatic review is replay safe");
  await saveAcquisitionReview(db,actor,batch.id,{action:"defaults",revision:2,defaults:{finish:"NONFOIL",condition:"NM"}});
  assert.equal((await getAcquisitionProgress(db,actor,batch.id)).defaults.language,"en","an older client omitting language cannot clear confirmation");
  for(const [position,kind] of [[1,"readable-fr"],[2,"orientation"],[3,"title-missing"],[4,"unreadable"],[5,"unreadable"],[7,"provider-error"],[8,"other-language"]] as const)await publish(position,kind);
  const pending=await review(4);await saveAcquisitionReview(db,actor,batch.id,{action:"pending",photoId:pending.photoId,revision:pending.revision});
  const override=await review(5);await saveAcquisitionReview(db,actor,batch.id,{action:"accept",photoId:override.photoId,revision:override.revision,
    decision:{cardId:french.id,language:"fr",finish:"NONFOIL",condition:"NM"}});
  assert.equal(await confirmStrongAcquisitionMatches(db),0,"readable conflict, ambiguity, missing title/provider coverage and human pending are vetoes");
  assert((await getAcquisitionProgress(db,actor,batch.id)).slots[1].reviewProblems.includes("conflict"),"readable/default mismatch remains in the bounded conflict filter");
  assert((await getAcquisitionProgress(db,actor,batch.id)).slots[8].reviewProblems.includes("conflict"),"conflicting readable language in another direction is not hidden");
  for(const position of [1,2,3,4,7,8])assert.equal((await review(position)).review,null);
  await defaults("fr",3);await publish(6);
  assert.equal(await confirmStrongAcquisitionMatches(db),2,"new explicit language supports missing language and now-agreeing readable evidence");
  const saved=await Promise.all([0,1,5,6].map(async position=>(await review(position)).review));
  assert.deepEqual(saved.map(row=>row?.language),["en","fr","fr","fr"]);
  await defaults("en",4);assert.equal(await confirmStrongAcquisitionMatches(db),0);
  assert.deepEqual(await Promise.all([0,1,5,6].map(async position=>(await review(position)).review)),saved,"defaults never rewrite saved decisions");
  assert.deepEqual(await stock(),before,"automatic and manual reviews do not write Inventory");
  await defaults(null,5);assert.equal((await getAcquisitionProgress(db,actor,batch.id)).defaults.language,null,"explicit null clears only future batch confirmation");
  const progress=await getAcquisitionProgress(db,actor,batch.id);await executeAcquisitionCommand(db,actor,batch.id,{requestKey:randomUUID(),revision:progress.revision,command:"STOP"});
  const session=await db.acquisitionSession.findUniqueOrThrow({where:{id:batch.id}});
  const chosen={photoIds:[0,1,5,6].map(position=>batch.photos[position].id),locationId:session.locationId!,section:session.section??""};
  const preview=await previewAcquisitionCommit(db,actor,batch.id,chosen);
  assert.deepEqual(preview.cards.map(row=>row.language).sort(),["en","fr","fr","fr"]);
  const request={...chosen,requestKey:randomUUID(),previewToken:preview.token,overfillReason:null};
  const receipt=await commitAcquisitionCards(db,actor,batch.id,request);assert.equal(receipt.count,4);
  const lots=await db.inventoryItem.findMany({where:{id:{in:receipt.inventoryItemIds}}});
  assert.deepEqual(lots.map(row=>[row.language.toLowerCase(),row.quantity]).sort(),[["en",1],["fr",3]]);
  assert.equal(await db.acquisitionCommitMember.count({where:{commitId:receipt.id}}),4);
  assert.deepEqual(await commitAcquisitionCards(db,actor,batch.id,request),{...receipt,replay:true});
  for(const output of outputs)assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:output.id}})).output,output.output,"native and conditional interpretation remain immutable");
  console.log("PASS: explicit batch language, unreadable confirmation, readable conflict, human override/pending, saved-language preservation, immutable evidence, exact preview/lots/membership and replay");
}
