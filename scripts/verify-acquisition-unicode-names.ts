import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Prisma, type PrismaClient, type Card} from "@prisma/client";
import {completeAcquisitionJob, type ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {createCatalogReconciliationHandler, enqueueCatalogReconciliation} from "../lib/acquisition-catalog-reconciliation";
import {CATALOG_RECONCILIATION_STAGE, CATALOG_RESOLVER_VERSION} from "../lib/acquisition-catalog-status";
import {ACQUISITION_TEXT_RESOLVER_VERSION} from "../lib/acquisition-recognition";
import {getAcquisitionCardReview, type AcquisitionActor} from "../lib/acquisition-store";
import {resolveCachedAcquisitionCatalog} from "../lib/acquisition-catalog-cache";
import {catalogQueryKey} from "../lib/acquisition-catalog-queries";
import {type ScryfallCard} from "../lib/scryfall";
import {cardWriteData} from "../lib/card-import";
import {claimFixtureJobs} from "./acquisition-verification-queue";

// Saved synthetic OCR and real metadata refresh; no native or network work.
export async function verifyAcquisitionUnicodeNames(db:PrismaClient, actor:AcquisitionActor,
  sessionId:string, templatePhotoId:string, templateJob:ClaimedAcquisitionJob){
  const suffix=randomUUID().slice(0,8),ids=[randomUUID(),randomUUID()],keys=new Set<string>();
  const cards:ScryfallCard[]=ids.map((id,i)=>({object:"card",id,name:`Unicode ${i} ${suffix}`,
    printed_name:(i?"Совсем другая ":"Верная карта ")+suffix+" 123",set:i?"uxyz":"uabc",
    collector_number:i?"8":"7",lang:"ru",set_name:"Fixture",digital:false,type_line:"Creature",
    finishes:["nonfoil"],rarity:"common",cmc:1,color_identity:[]}));
  const template=await db.acquisitionPhoto.findUniqueOrThrow({where:{id:templatePhotoId}});
  const ct=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:templateJob.candidateId}});
  const stock=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const slot=await db.acquisitionCaptureSlot.create({data:{runId:templateJob.runId,requestKey:randomUUID(),position:2501,generation:1}});
  let photoId:string|undefined,artifactId:string|undefined,candidateId:string|undefined;
  try{
    const local:Card[]=[];for(const card of cards)local.push(await db.card.create({data:{...(cardWriteData(card) as Omit<Prisma.CardCreateManyInput,"scryfallId">),scryfallId:card.id,firstCachedAt:new Date()}}));
    const photo=await db.acquisitionPhoto.create({data:{runId:templateJob.runId,slotId:slot.id,uploadKey:randomUUID(),generation:1,digest:template.digest,bytes:template.bytes,mediaType:template.mediaType,width:template.width,height:template.height,ready:true,readyAt:new Date()}});photoId=photo.id;
    const artifact=await db.acquisitionArtifact.create({data:{runId:templateJob.runId,sourceId:photo.id,digest:photo.digest}});artifactId=artifact.id;
    const candidate=await db.acquisitionCandidate.create({data:{runId:templateJob.runId,physicalId:slot.id,identityKind:ct.identityKind,acquisitionOrder:2501,spatialOrder:0,expectedSides:ct.expectedSides,provisional:ct.provisional,uncertainty:ct.uncertainty,revision:0}});candidateId=candidate.id;
    const text={title:[cards[1].printed_name!],footer:["UABC RU","C 7"]};
    const native={version:1,descriptor:"a".repeat(64),descriptorDetails:{},photoDigest:photo.digest,text,orientations:[{rotationDegrees:0,text,lines:[]},{rotationDegrees:180,text:{title:[],footer:[]},lines:[]}],geometry:{status:"ACCEPTED"},lines:[],milliseconds:1,automaticAcceptance:false};
    const legacy={version:4,status:"STRONG_MATCH",automaticAcceptance:true,finish:"UNKNOWN",condition:"UNKNOWN",catalogCoverage:"NOT_ESTABLISHED",orientation:{status:"SELECTED",rotationDegrees:0},evidence:{setCodes:["uabc"],collectors:["7"],languages:["ru"]},totalProposals:1,truncated:false,proposals:[{card:{id:local[0].id,name:local[0].name,setCode:"uabc",collectorNumber:"7",lang:"ru"},nameDistance:null,reasons:["SET_AND_COLLECTOR_TEXT","TITLE_EXACT","STRONG_EXACT_PRINTING"]}]};
    const source={version:1,photoId:photo.id,native,versions:{model:"a".repeat(64)},proposals:legacy};
    const common={runId:templateJob.runId,artifactId:artifact.id,candidateId:candidate.id,candidateRevision:0,versionKey:randomUUID(),input:{photoId:photo.id,digest:photo.digest},status:"COMPLETE" as const};
    const raw=await db.acquisitionProcessingJob.create({data:{...common,stage:"photo-recognition-v1",output:source as unknown as Prisma.InputJsonObject}});
    await db.acquisitionProcessingJob.create({data:{...common,versionKey:randomUUID(),stage:CATALOG_RECONCILIATION_STAGE,input:{...common.input,recognitionJobId:raw.id,resolverVersion:"catalog-reconciliation-footer-pairs-v8"},output:{...source,sourceRecognitionJobId:raw.id,versions:{...source.versions,resolver:"catalog-reconciliation-footer-pairs-v8"}} as unknown as Prisma.InputJsonObject}});
    assert.equal(await enqueueCatalogReconciliation(db,new Date(),false),1);
    const [job]=await claimFixtureJobs(db,{workerId:"unicode-name-fixture",stages:[CATALOG_RECONCILIATION_STAGE]},{candidateId:candidate.id});assert.equal(job?.candidateId,candidate.id);
    let calls=0;const handler=createCatalogReconciliationHandler(db,async(query,signal)=>{keys.add(catalogQueryKey(query));return resolveCachedAcquisitionCatalog(db,query,signal,async()=>{calls++;return{status:"FOUND",cards:query.kind==="printing"?cards.filter(c=>c.set===query.set&&c.lang===query.language):cards,requestsMade:1,printingCoverage:"CHECKED"};});});
    await assert.rejects(handler({...job,input:{...job.input as Prisma.InputJsonObject,resolverVersion:"catalog-reconciliation-footer-pairs-v8"}},AbortSignal.timeout(30000)),/interpretation version superseded/);assert.equal(calls,0);
    const output=await handler(job,AbortSignal.timeout(30000)),proposals=output.proposals as any;
    assert.equal(proposals.status,"CONFLICT");assert.equal(proposals.automaticAcceptance,false);
    const wrong=proposals.proposals.find((p:any)=>p.card.id===local[0].id);assert(wrong.reasons.includes("TITLE_CONTRADICTION"));assert(!wrong.reasons.includes("TITLE_EXACT"));assert(proposals.proposals.some((p:any)=>p.card.id===local[1].id));
    assert.deepEqual(output.native,native);assert.equal((output.versions as Prisma.InputJsonObject).resolver,CATALOG_RESOLVER_VERSION);assert.equal((output.versions as Prisma.InputJsonObject).textResolver,ACQUISITION_TEXT_RESOLVER_VERSION);
    assert.equal(await completeAcquisitionJob(db,job,output),"COMPLETE");
    const review=await getAcquisitionCardReview(db,actor,sessionId,photo.id);assert.equal(review.review,null);assert.equal(review.recognitionStatus,"CONFLICT");assert.deepEqual(new Set(review.suggestions.map(s=>s.printing.id)),new Set(local.map(c=>c.id)));
    const warm=calls;await handler(job,AbortSignal.timeout(30000));assert.equal(calls,warm);assert.equal(await enqueueCatalogReconciliation(db,new Date(),false),0);
    assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:raw.id}})).output,source);assert.equal(await db.acquisitionProcessingJob.count({where:{candidateId:candidate.id,stage:"photo-recognition-v1"}}),1);assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),stock);
    console.log("PASS: Unicode title collision refresh, obsolete-generation rejection, real normalized aliases, cache reuse, immutable OCR and human/Inventory boundary");
  }finally{
    if(candidateId)await db.acquisitionProcessingJob.deleteMany({where:{candidateId}});if(photoId)await db.acquisitionPhoto.deleteMany({where:{id:photoId}});if(candidateId)await db.acquisitionCandidate.deleteMany({where:{id:candidateId}});if(artifactId)await db.acquisitionArtifact.deleteMany({where:{id:artifactId}});await db.acquisitionCaptureSlot.deleteMany({where:{id:slot.id}});await db.acquisitionCatalogLookup.deleteMany({where:{key:{in:[...keys]}}});await db.card.deleteMany({where:{scryfallId:{in:ids}}});
  }
}
