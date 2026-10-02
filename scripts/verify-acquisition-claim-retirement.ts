import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {claimAcquisitionJobs, runAcquisitionJobsOnce, type ClaimedAcquisitionJob} from "../lib/acquisition-jobs";

// Real selection, lease CAS and turn transaction in the disposable PG fixture.
// All removable parents below are owned synthetic records, never source rows.
export async function verifyAcquisitionClaimRetirement(db: PrismaClient, source: ClaimedAcquisitionJob) {
  const originalRun = await db.acquisitionRun.findUniqueOrThrow({where:{id:source.runId}});
  const originalSession = await db.acquisitionSession.findUniqueOrThrow({where:{id:originalRun.sessionId}});
  const originalCandidate = await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}});
  const originalPhotos = await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}});
  const stock = await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const owned: {sessionId:string;runId:string;jobId:string;candidateId:string;artifactId:string}[] = [];
  async function create(stage:string, availableAt:number) {
    const id=randomUUID();
    const session=await db.acquisitionSession.create({data:{
      createdByUserId:originalSession.createdByUserId,ownerPlayerId:originalSession.ownerPlayerId,
      section:originalSession.section,requestKey:id,requestPayload:"controlled claim retirement",
      placement:{},policy:{},phase:"CAPTURING",
    }});
    const record={sessionId:session.id,runId:"",jobId:"",candidateId:"",artifactId:""};owned.push(record);
    const run=await db.acquisitionRun.create({data:{sessionId:session.id,sourceRunId:id,
      providerId:originalRun.providerId,enforcement:originalRun.enforcement,controls:originalRun.controls}});
    record.runId=run.id;
    const candidate=await db.acquisitionCandidate.create({data:{runId:run.id,physicalId:id,
      identityKind:originalCandidate.identityKind,acquisitionOrder:0,spatialOrder:0,
      expectedSides:originalCandidate.expectedSides,provisional:false,uncertainty:[],revision:0}});
    record.candidateId=candidate.id;
    const artifact=await db.acquisitionArtifact.create({data:{runId:run.id,sourceId:id,digest:"0".repeat(64)}});
    record.artifactId=artifact.id;
    const job=await db.acquisitionProcessingJob.create({data:{runId:run.id,candidateId:candidate.id,
      artifactId:artifact.id,candidateRevision:0,stage,versionKey:id,input:{},availableAt:new Date(availableAt)}});
    record.jobId=job.id;return record;
  }
  async function remove(record:typeof owned[number], depth="session") {
    if(record.jobId)await db.acquisitionProcessingJob.deleteMany({where:{id:record.jobId}});
    if(depth==="job")return;
    if(depth==="candidate"){
      await db.acquisitionCandidate.deleteMany({where:{id:record.candidateId}});return;
    }
    if(depth==="artifact"){
      await db.acquisitionArtifact.deleteMany({where:{id:record.artifactId}});return;
    }
    if(record.runId)await db.acquisitionProcessingTurn.deleteMany({where:{runId:record.runId}});
    if(record.candidateId)await db.acquisitionCandidate.deleteMany({where:{id:record.candidateId}});
    if(record.artifactId)await db.acquisitionArtifact.deleteMany({where:{id:record.artifactId}});
    if(record.runId)await db.acquisitionRun.deleteMany({where:{id:record.runId}});
    if(depth==="run")return;
    await db.acquisitionSession.deleteMany({where:{id:record.sessionId}});
  }
  try {
    for(const window of ["before-CAS","job","candidate","artifact","run","session","replaced-lease"]){
      const stage=`fixture-claim-retired-${randomUUID()}`;
      const retired=await create(stage,0),live=await create(stage,1);
      let boundaryReached=false;
      const boundary=new Proxy(db,{
        get(target,property){
          if(property==="$transaction")return async(...args:unknown[])=>{
            if(!boundaryReached&&window==="before-CAS"){
              boundaryReached=true;await remove(retired,"job");
            }
            const result=await Reflect.apply(target.$transaction,target,args);
            if(!boundaryReached){
              const leased=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:retired.jobId}});
              assert.equal(leased.status,"RUNNING");assert.equal(leased.attempts,1);assert(leased.leaseToken);
              boundaryReached=true;
              if(window==="replaced-lease")await db.acquisitionProcessingJob.update({where:{id:retired.jobId},
                data:{leaseToken:"controlled-other-worker"}});
              else await remove(retired,window);
            }
            return result;
          };
          const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
        },
      });
      const handled:string[]=[];
      const handlers={[stage]:async(job:ClaimedAcquisitionJob)=>{handled.push(job.id);return {fixture:"claim-retirement"};}};
      const result=await runAcquisitionJobsOnce(boundary,handlers,"retired-claim");
      assert(boundaryReached,`${window}: real CAS boundary must run`);
      assert.deepEqual(result,{claimed:1,complete:1,failed:0,superseded:0});
      assert.deepEqual(handled,[live.jobId],`${window}: only the next live job reaches the handler`);
      const completed=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:live.jobId}});
      assert.equal(completed.status,"COMPLETE");assert.equal(completed.attempts,1);assert.equal(completed.leaseToken,null);
      const successor=await create(stage,2);
      assert.deepEqual(await runAcquisitionJobsOnce(db,handlers,"successive-claim"),{claimed:1,complete:1,failed:0,superseded:0});
      assert.deepEqual(handled,[live.jobId,successor.jobId]);
      await remove(successor);
      assert.equal(await db.acquisitionProcessingTurn.count({where:{runId:live.runId,stage}}),1);
      assert.deepEqual(await claimAcquisitionJobs(db,{workerId:"second-pass",stages:[stage]},new Date()),[]);
      console.log(`PASS: claim ${window} retirement skipped; live next job retained with one lease/turn`);
      await remove(retired);await remove(live);
    }
    // A real database/provider failure must propagate, never become retirement.
    for(const method of ["findUnique","$transaction"]){
      const stage=`fixture-claim-error-${randomUUID()}`,live=await create(stage,0);
      const failure=Object.assign(new Error("controlled database failure"),{code:"P1001"});
      const boundary=new Proxy(db,{
        get(target,property){
          if(property==="$transaction"&&method==="$transaction")return async()=>{throw failure;};
          if(property==="acquisitionProcessingJob"&&method==="findUnique")return new Proxy(target.acquisitionProcessingJob,{
            get(model,operation){
              if(operation==="findUnique")return async()=>{throw failure;};
              const value=Reflect.get(model,operation);return typeof value==="function"?value.bind(model):value;
            },
          });
          const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
        },
      });
      await assert.rejects(()=>claimAcquisitionJobs(boundary,{workerId:"failure-control",stages:[stage]}),
        error=>error===failure,`${method}: genuine failures propagate`);
      await remove(live);
    }
    assert.deepEqual(await db.acquisitionRun.findUniqueOrThrow({where:{id:source.runId}}),originalRun);
    assert.deepEqual(await db.acquisitionSession.findUniqueOrThrow({where:{id:originalSession.id}}),originalSession);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}}),originalCandidate);
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}}),originalPhotos);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),stock);
    console.log("PASS: claim retirement source/review/photos/Inventory preserved; genuine DB failures propagate");
  } finally {for(const record of owned)await remove(record);}
}
