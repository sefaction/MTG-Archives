import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import type {ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {confirmStrongAcquisitionMatches} from "../lib/acquisition-auto-confirm";
import {CATALOG_RECONCILIATION_STAGE} from "../lib/acquisition-catalog-status";

// Legacy text-only interpretation is still supported, but the normal hybrid
// printing worker must stay review-only. This probe opts in only its process.
export async function verifyAutoConfirmRetirement(db:PrismaClient,source:ClaimedAcquisitionJob){
  const originalRun=await db.acquisitionRun.findUniqueOrThrow({where:{id:source.runId}});
  const originalSession=await db.acquisitionSession.findUniqueOrThrow({where:{id:originalRun.sessionId}});
  const originalCandidate=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}});
  const photos=await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}});
  const stock=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const owned:{sessionId:string;runId:string;candidateId:string;artifactId:string;jobId:string}[]=[];
  const previousPrinting=process.env.ACQUISITION_PRINTING_ENABLED,previousVisual=process.env.ACQUISITION_VISUAL_ENABLED;
  async function create(age:number){
    const id=randomUUID();
    const session=await db.acquisitionSession.create({data:{createdByUserId:originalSession.createdByUserId,
      ownerPlayerId:originalSession.ownerPlayerId,section:originalSession.section,requestKey:id,requestPayload:"controlled legacy retirement",
      placement:{},policy:{},phase:"CAPTURING",reviewDefaults:{finish:"NONFOIL",condition:"NM"}}});
    const record={sessionId:session.id,runId:"",candidateId:"",artifactId:"",jobId:""};owned.push(record);
    const run=await db.acquisitionRun.create({data:{sessionId:session.id,sourceRunId:id,providerId:"phone-photo-v1",
      enforcement:originalRun.enforcement,controls:originalRun.controls}});record.runId=run.id;
    const candidate=await db.acquisitionCandidate.create({data:{runId:run.id,physicalId:id,identityKind:originalCandidate.identityKind,
      acquisitionOrder:0,spatialOrder:0,expectedSides:originalCandidate.expectedSides,provisional:false,uncertainty:[],revision:0}});
    record.candidateId=candidate.id;
    const artifact=await db.acquisitionArtifact.create({data:{runId:run.id,sourceId:id,digest:"0".repeat(64)}});record.artifactId=artifact.id;
    const job=await db.acquisitionProcessingJob.create({data:{runId:run.id,candidateId:candidate.id,artifactId:artifact.id,
      candidateRevision:0,stage:CATALOG_RECONCILIATION_STAGE,versionKey:id,input:{},status:"COMPLETE",
      createdAt:new Date(Date.now()-age),output:{catalog:{status:"RESOLVED",printingCoverage:"CHECKED"},
        proposals:{version:4,status:"STRONG_MATCH",automaticAcceptance:false,totalProposals:0,truncated:false,proposals:[]}}}});
    record.jobId=job.id;return record;
  }
  async function remove(record:typeof owned[number],depth="session"){
    if(record.jobId)await db.acquisitionProcessingJob.deleteMany({where:{id:record.jobId}});
    if(depth==="job")return;
    if(record.candidateId)await db.acquisitionCandidate.deleteMany({where:{id:record.candidateId}});
    if(depth==="candidate")return;
    if(record.runId)await db.acquisitionCommand.deleteMany({where:{runId:record.runId}});
    if(record.artifactId)await db.acquisitionArtifact.deleteMany({where:{id:record.artifactId}});
    if(record.runId)await db.acquisitionRun.deleteMany({where:{id:record.runId}});
    await db.acquisitionSession.deleteMany({where:{id:record.sessionId}});
  }
  try{
    process.env.ACQUISITION_PRINTING_ENABLED="0";process.env.ACQUISITION_VISUAL_ENABLED="0";
    for(const window of ["selected-job","post-read-parents","locked-session-candidate"]){
      const retired=await create(2000),live=await create(1000);let boundaryReached=false;
      const boundary=new Proxy(db,{
        get(target,property){
          if(property==="$transaction")return async(callback:any,...rest:any[])=>{
            if(!boundaryReached&&window==="selected-job"){
              boundaryReached=true;await remove(retired,"job");
            }
            return Reflect.apply(target.$transaction,target,[async(tx:PrismaClient)=>callback(new Proxy(tx,{
              get(transaction,member){
                if(member==="acquisitionProcessingJob"||member==="acquisitionCandidate")return new Proxy(transaction[member],{
                  get(model,method){
                    if(method==="findUnique"||method==="findUniqueOrThrow")return async(...args:any[])=>{
                      if(!boundaryReached&&member==="acquisitionCandidate"&&window==="locked-session-candidate"&&args[0].where.id===retired.candidateId){
                        boundaryReached=true;await remove(retired,"candidate");
                      }
                      const row=await Reflect.apply(model[method] as any,model,args);
                      if(!boundaryReached&&member==="acquisitionProcessingJob"&&window==="post-read-parents"&&args[0].where.id===retired.jobId){
                        assert(row);boundaryReached=true;await remove(retired);
                      }
                      return row;
                    };
                    const value=Reflect.get(model,method);return typeof value==="function"?value.bind(model):value;
                  },
                });
                const value=Reflect.get(transaction,member);return typeof value==="function"?value.bind(transaction):value;
              },
            })),...rest]);
          };
          const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
        },
      });
      assert.equal(await confirmStrongAcquisitionMatches(boundary),0);assert(boundaryReached);
      // The following live row is interpreted exactly once, but synthetic
      // incomplete evidence cannot create a saved review or Inventory copy.
      assert.equal(await db.acquisitionCommand.count({where:{runId:live.runId}}),1);
      assert.equal((await db.acquisitionCandidate.findUniqueOrThrow({where:{id:live.candidateId}})).review,null);
      assert.equal(await confirmStrongAcquisitionMatches(db),0);
      assert.equal(await db.acquisitionCommand.count({where:{runId:live.runId}}),1);
      console.log(`PASS: legacy auto-confirm ${window} retirement skips safely and preserves review-only negative evidence`);
      await remove(retired);await remove(live);
    }
    const live=await create(0);process.env.ACQUISITION_PRINTING_ENABLED="1";
    assert.equal(await confirmStrongAcquisitionMatches(db),0);
    assert.equal(await db.acquisitionCommand.count({where:{runId:live.runId}}),0,"hybrid mode performs no auto-confirm admission");
    process.env.ACQUISITION_PRINTING_ENABLED="0";
    const failure=Object.assign(new Error("controlled database failure"),{code:"P1001"});
    const unavailable=new Proxy(db,{get(target,property){
      if(property==="$transaction")return async()=>{throw failure;};
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    }});
    await assert.rejects(()=>confirmStrongAcquisitionMatches(unavailable),error=>error===failure);
    await remove(live);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}}),originalCandidate);
    assert.deepEqual(await db.acquisitionSession.findUniqueOrThrow({where:{id:originalSession.id}}),originalSession);
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}}),photos);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),stock);
  }finally{
    if(previousPrinting===undefined)delete process.env.ACQUISITION_PRINTING_ENABLED;else process.env.ACQUISITION_PRINTING_ENABLED=previousPrinting;
    if(previousVisual===undefined)delete process.env.ACQUISITION_VISUAL_ENABLED;else process.env.ACQUISITION_VISUAL_ENABLED=previousVisual;
    for(const record of owned)await remove(record);
  }
}
