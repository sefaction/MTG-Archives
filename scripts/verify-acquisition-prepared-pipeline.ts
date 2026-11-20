import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {completeAcquisitionJob,type ClaimedAcquisitionJob} from '../lib/acquisition-jobs';
import {enqueueReadyVisual,enqueueFailedIdentifierFallback,retrieveAcquisitionVisual} from '../lib/acquisition-visual-worker';
import {enqueueReadyPrinting,observeAcquisitionPrinting} from '../lib/acquisition-printing-worker';
import {preparedCardSchema,PREPARED_CARD_POLICY} from '../lib/acquisition-prepared-card';
import {acquisitionRefreshPriority} from '../lib/acquisition-processing-priority';
import {readAcquisitionPhotoBytes} from '../lib/acquisition-files';

// Real SQL/bytes/provenance/fallback proof with synthetic engine observations.
// Optical accuracy is a separate native-original replay, not this fixture.
export async function verifyAcquisitionPreparedPipeline(db:PrismaClient,raw:ClaimedAcquisitionJob,photoId:string,scryfallId:string){
  const model=createHash('sha256').update(randomUUID()).digest('hex');
  const photo=await db.acquisitionPhoto.findUniqueOrThrow({where:{id:photoId}});
  const before=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:raw.candidateId}});
  const inventory=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const original=await readAcquisitionPhotoBytes(photoId,'raw',photo.digest);
  const card=await db.card.findUniqueOrThrow({where:{scryfallId},select:{id:true,name:true,setCode:true,collectorNumber:true,scryfallId:true,lang:true}});
  const source=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:raw.id}});
  const sourceHash=JSON.stringify(source.output);
  const preparation=preparedCardSchema.parse({version:1,policy:PREPARED_CARD_POLICY,photoDigest:photo.digest,
    sourceWidth:photo.width,sourceHeight:photo.height,region:{version:1,quad:[[0,0],[1,0],[1,1],[0,1]]},
    rotationDegrees:0,sourceMethod:'full-frame',boundary:'INFERRED'});
  const input={photoId,digest:photo.digest,manualAnalysis:null,model};
  const output={...(source.output as Prisma.JsonObject),photoId,preparation,
    native:{...((source.output as Prisma.JsonObject).native as Prisma.JsonObject),photoDigest:photo.digest,
      geometry:{status:'PROPOSED',method:'full-frame',quad:[[0,0],[photo.width-1,0],[photo.width-1,photo.height-1],[0,photo.height-1]],
        sourceFrame:{width:photo.width,height:photo.height}}},
    proposals:{version:4,status:'STRONG_MATCH',automaticAcceptance:false,totalProposals:1,
      finish:'UNKNOWN',condition:'UNKNOWN',catalogCoverage:'AVAILABLE',truncated:false,orientation:{status:'SELECTED',rotationDegrees:0},
      evidence:{setCodes:[card.setCode],collectors:[card.collectorNumber],languages:[card.lang??'en']},
      proposals:[{card,reasons:['TITLE_EXACT','SET_AND_COLLECTOR_TEXT','STRONG_EXACT_PRINTING'],nameDistance:0}]}};
  const owned=new Set<string>();
  // Keep real eligibility SQL and constrain only the returned fixture sources.
  const scoped=new Proxy(db,{get(target,key){
    if(key==='$queryRaw')return async(...args:unknown[])=>{
      const rows=await Reflect.apply(target.$queryRaw,target,args) as {id:string}[];
      const sources=await db.acquisitionProcessingJob.findMany({where:{id:{in:rows.map(r=>r.id)},candidateId:raw.candidateId},select:{id:true}});
      return rows.filter(r=>sources.some(s=>s.id===r.id));
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  async function running(id:string){return await db.acquisitionProcessingJob.update({where:{id},data:{status:'RUNNING',
    attempts:1,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+120000)}}) as ClaimedAcquisitionJob;}
  function nativeFrame(frame:Buffer){const n=frame.readUInt32BE();assert.deepEqual(frame.subarray(4+n),original);
    return JSON.parse(frame.subarray(4,4+n).toString());}
  async function priority(id:string){
    const expression=acquisitionRefreshPriority(Prisma.sql`j."artifactId"`,Prisma.sql`j."candidateId"`,Prisma.sql`j.stage`,Prisma.sql`j.input->>'forceFullSearch'='true'`);
    return (await db.$queryRaw<{priority:number}[]>`SELECT ${expression} AS priority FROM "AcquisitionProcessingJob" j WHERE j.id=${id}`)[0].priority;
  }
  try{
    const recognition=await db.acquisitionProcessingJob.create({data:{runId:raw.runId,artifactId:raw.artifactId,candidateId:raw.candidateId,
      candidateRevision:raw.candidateRevision,stage:'photo-recognition-v1',versionKey:randomUUID(),input,
      status:'COMPLETE',output:output as unknown as Prisma.InputJsonObject}});owned.add(recognition.id);
    assert.equal(await enqueueReadyVisual(scoped,model),1);
    const queued=await db.acquisitionProcessingJob.findFirstOrThrow({where:{candidateId:raw.candidateId,stage:'photo-visual-retrieval-v1',input:{path:['model'],equals:model}}});owned.add(queued.id);
    const visualJob=await running(queued.id);
    const native=(metadata:ReturnType<typeof nativeFrame>)=>({version:1,descriptor:model,photoDigest:photo.digest,
      referenceCount:1,unavailableCount:0,geometry:{status:'PROPOSED',preparedFrame:metadata.preparedFrame},inputRegion:'CARD',
      candidates:[{scryfallId,referenceId:scryfallId+':0',name:card.name,setCode:card.setCode,collectorNumber:card.collectorNumber,distance:.1,rotationDegrees:0}],
      retrieval:{strategy:metadata.candidateScryfallIds?'EXACT_CANDIDATES':'FULL_INDEX',requestedScryfallIds:metadata.candidateScryfallIds??[]},
      milliseconds:1,automaticAcceptance:false});
    let requested=0;
    const visual=await retrieveAcquisitionVisual(db,visualJob,AbortSignal.timeout(30000),model,{request:async frame=>{
      const metadata=nativeFrame(frame);assert.deepEqual(metadata.preparedFrame,preparation);
      assert.deepEqual(metadata.candidateScryfallIds,[scryfallId]);requested++;return native(metadata);
    }});
    assert.equal(await completeAcquisitionJob(db,visualJob,visual),'COMPLETE');
    const catalog=await db.acquisitionProcessingJob.create({data:{runId:raw.runId,artifactId:raw.artifactId,candidateId:raw.candidateId,
      candidateRevision:raw.candidateRevision,stage:'photo-catalog-reconciliation-v1',versionKey:randomUUID(),status:'COMPLETE',
      input:{...input,recognitionJobId:recognition.id,visualJobId:visualJob.id},
      output:{...output,sourceVisualJobId:visualJob.id,visual:visual.visual} as unknown as Prisma.InputJsonObject}});owned.add(catalog.id);
    assert.equal(await enqueueReadyPrinting(scoped,model),1);
    const printQueued=await db.acquisitionProcessingJob.findFirstOrThrow({where:{candidateId:raw.candidateId,stage:'photo-printing-evidence-v1',input:{path:['model'],equals:model}}});owned.add(printQueued.id);
    const printJob=await running(printQueued.id);
    const printing=await observeAcquisitionPrinting(db,printJob,AbortSignal.timeout(30000),model,{request:async frame=>{
      const metadata=nativeFrame(frame);assert.deepEqual(metadata.preparedFrame,preparation);
      return {version:'registered-printing-runtime-v1',descriptor:model,photoDigest:photo.digest,milliseconds:1,
        sourceSize:[photo.width,photo.height],preparedFrame:preparation,observedStamp:'UNREADABLE',conflictingObservations:false,automaticAcceptance:false,
        candidates:[{scryfallId,referenceId:scryfallId+':0',referenceStampState:'UNKNOWN',relation:'UNRESOLVED',alignment:{status:'UNREADABLE'},
          stamp:{status:'UNREADABLE',reason:'ALIGNMENT_UNAVAILABLE'},finalComparison:{version:'final-card-comparison-v1',status:'UNREADABLE',measuredRegions:0,differentRegions:[],automaticAcceptance:false}}]};
    }});
    assert.equal(await completeAcquisitionJob(db,printJob,printing),'COMPLETE');
    const admitted=await Promise.all([enqueueFailedIdentifierFallback(scoped,model),enqueueFailedIdentifierFallback(scoped,model)]);
    assert.equal(admitted.reduce((a,b)=>a+b,0),1,'failed candidate verification admits one duplicate-safe broad fallback');
    const fallback=await db.acquisitionProcessingJob.findFirstOrThrow({where:{candidateId:raw.candidateId,stage:'photo-visual-retrieval-v1',input:{path:['fallbackPrintingJobId'],equals:printJob.id}}});owned.add(fallback.id);
    assert.equal(await priority(fallback.id),0,'first full retrieval is not starved behind refreshes after a provisional candidate check');
    const fallbackJob=await running(fallback.id);
    const broad=await retrieveAcquisitionVisual(db,fallbackJob,AbortSignal.timeout(30000),model,{request:async frame=>{
      const metadata=nativeFrame(frame);assert.deepEqual(metadata.preparedFrame,preparation);assert.equal(metadata.candidateScryfallIds,undefined);
      requested++;return native(metadata);
    }});
    assert.equal(requested,2,'broad fallback cannot reuse candidate-only evidence');
    assert.equal(await completeAcquisitionJob(db,fallbackJob,broad),'COMPLETE');
    assert.equal(await priority(fallback.id),1,'completed full retrieval returns later work to normal refresh priority');
    assert.equal(await enqueueFailedIdentifierFallback(scoped,model),0,'fallback is bounded rather than self-reenqueuing');
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:raw.candidateId}}),before);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),inventory);
    assert.deepEqual(await readAcquisitionPhotoBytes(photoId,'raw',photo.digest),original);
    assert.equal(JSON.stringify((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:source.id}})).output),sourceHash);
    console.log('PASS: shared original-bound frame -> exact candidate verification -> registered printing -> duplicate-safe full fallback; first-full priority, immutable evidence and review/Inventory conserved');
  }finally{
    await db.acquisitionProcessingJob.deleteMany({where:{candidateId:raw.candidateId,OR:[{id:{in:[...owned]}},{input:{path:['model'],equals:model}}]}});
  }
}
