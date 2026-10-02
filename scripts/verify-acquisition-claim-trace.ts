import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import type {ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import type {FixtureClaimTrace} from "./acquisition-claim-trace";
import {claimFixtureJobs, type FixtureClaimDiagnostic} from "./acquisition-verification-queue";

export async function verifyAcquisitionClaimTrace(db:PrismaClient,source:ClaimedAcquisitionJob){
  for(const control of ["CAS_LOST","LOOKUP_RETIRED"]){
    const stage=`fixture-claim-trace-${randomUUID()}`;
    const job=await db.acquisitionProcessingJob.create({data:{runId:source.runId,
      candidateId:source.candidateId,artifactId:source.artifactId,candidateRevision:source.candidateRevision,
      stage,versionKey:randomUUID(),availableAt:new Date(0),input:{privateSentinel:"NEVER_LOG_INPUT"}}});
    let boundaryReached=false;
    const reports:FixtureClaimDiagnostic[]=[];
    const boundary=new Proxy(db,{
      get(target,property){
        if(property==="$queryRaw"&&control==="CAS_LOST")return async(...args:any[])=>{
          const rows=await Reflect.apply(target.$queryRaw,target,args);
          if(Array.isArray(rows)&&rows.some(row=>row.id===job.id)&&!boundaryReached){
            boundaryReached=true;
            assert.equal((await db.acquisitionProcessingJob.updateMany({where:{id:job.id,status:"PENDING"},
              data:{status:"RUNNING",attempts:{increment:1},leaseToken:"PRIVATE_OTHER_LEASE",
                leaseExpiresAt:new Date("2100-01-01T00:00:00Z")}})).count,1);
          }
          return rows;
        };
        if(property==="$transaction"&&control==="LOOKUP_RETIRED")return async(...args:any[])=>{
          const result=await Reflect.apply(target.$transaction,target,args);
          if(!boundaryReached){boundaryReached=true;await db.acquisitionProcessingJob.delete({where:{id:job.id}});}
          return result;
        };
        const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
      },
    });
    try{
      const claims=await claimFixtureJobs(boundary,{workerId:"trace-probe",stages:[stage]},
        {candidateId:source.candidateId,onEmpty:report=>reports.push(report)});
      assert.deepEqual(claims,[]);assert(boundaryReached);assert.equal(reports.length,1);
      const report=reports[0] as FixtureClaimDiagnostic & {claimTrace:FixtureClaimTrace};
      assert(report.claimTrace,"the actual selection/CAS/lookup trace must be retained before cleanup");
      assert.equal(report.claimTrace.droppedEvents,0);
      const events=report.claimTrace.events;
      assert.deepEqual(events.find(event=>event.operation==="SELECTION"),{operation:"SELECTION",count:1,
        heads:[{id:job.id,stage,candidateRevision:source.candidateRevision}]});
      assert.deepEqual(events.find(event=>event.operation==="LEASE_CAS"),
        {operation:"LEASE_CAS",id:job.id,count:control==="CAS_LOST"?0:1});
      assert.deepEqual(events.find(event=>event.operation==="TRANSACTION"),{operation:"TRANSACTION",committed:true});
      if(control==="CAS_LOST")assert.equal(events.filter(event=>event.operation==="LEASE_LOOKUP").length,0);
      else assert.deepEqual(events.find(event=>event.operation==="LEASE_LOOKUP"),{operation:"LEASE_LOOKUP",
        id:job.id,present:false,status:null,attempts:null,leasePresent:false,sameLease:false});
      const serialized=JSON.stringify(report);
      for(const forbidden of ["NEVER_LOG_INPUT","PRIVATE_OTHER_LEASE",source.leaseToken,source.artifactId,source.candidateId])
        assert(!serialized.includes(forbidden));
      console.log(`PASS: empty-claim ${control} retains actual selected head/CAS/commit/lookup; private payloads omitted`);
    }finally{
      await db.acquisitionProcessingJob.deleteMany({where:{id:job.id}});
      await db.acquisitionProcessingTurn.deleteMany({where:{runId:source.runId,stage}});
    }
  }
}
