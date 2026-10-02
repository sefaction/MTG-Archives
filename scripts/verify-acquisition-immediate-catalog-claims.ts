import assert from "node:assert/strict";
import type {PrismaClient} from "@prisma/client";
import type {ClaimedAcquisitionJob} from "../lib/acquisition-jobs";
import {enqueueCatalogReconciliation} from "../lib/acquisition-catalog-reconciliation";
import {CATALOG_RECONCILIATION_STAGE} from "../lib/acquisition-catalog-status";
import {claimFixtureJobs, type FixtureClaimDiagnostic} from "./acquisition-verification-queue";

// Repeated initial catalog admission/claim with actual concurrent enqueue and
// actual DB-clock fixture policy. No delay/retry, provider call or native work.
// Passing this bounded probe does not explain the historical unexplained miss.
export async function verifyImmediateCatalogClaims(db:PrismaClient,source:ClaimedAcquisitionJob){
  const where={runId:source.runId,stage:CATALOG_RECONCILIATION_STAGE};
  assert.equal(await db.acquisitionProcessingJob.count({where}),0,"probe precedes ordinary catalog admission");
  const sourceRow=await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:source.id}});
  const candidate=await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}});
  const photos=await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}});
  const stock=await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}});
  const priorTurn=await db.acquisitionProcessingTurn.findUnique({where:{runId_stage:where}});
  const reports:FixtureClaimDiagnostic[]=[];
  const options={workerId:"immediate-catalog-probe",stages:[CATALOG_RECONCILIATION_STAGE]};
  const expected={candidateId:source.candidateId,onEmpty:(report:FixtureClaimDiagnostic)=>{
    reports.push(report);console.error(`ACQUISITION_EXPECTED_CLAIM_EMPTY ${JSON.stringify(report)}`);
  }};
  try{
    for(let index=0;index<200;index++){
      const added=await Promise.all([enqueueCatalogReconciliation(db,new Date(),false),
        enqueueCatalogReconciliation(db,new Date(),false)]);
      assert.equal(added.reduce((a,b)=>a+b,0),1,"concurrent admission creates exactly one job");
      const claims=await claimFixtureJobs(db,options,expected);
      assert.equal(claims.length,1,`immediate catalog claim ${index+1} must grant one lease`);
      assert.equal(claims[0].candidateId,source.candidateId);
      assert.equal((claims[0].input as {recognitionJobId:string}).recognitionJobId,source.id);
      assert.equal(claims[0].attempts,1);
      await db.acquisitionProcessingJob.delete({where:{id:claims[0].id}});
      if((index+1)%50===0)console.log(`PASS: ${index+1}/200 concurrent-admission immediate catalog claims; no retry/sleep`);
    }
    assert.equal(reports.length,0);
    assert.deepEqual(await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:source.id}}),sourceRow);
    assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({where:{id:source.candidateId}}),candidate);
    assert.deepEqual(await db.acquisitionPhoto.findMany({where:{runId:source.runId},orderBy:{id:"asc"}}),photos);
    assert.deepEqual(await db.inventoryItem.aggregate({_count:{_all:true},_sum:{quantity:true}}),stock);
  }finally{
    // This controlled fixture starts without catalog jobs. Delete only jobs
    // admitted from its exact source, even if the claim itself returned empty.
    await db.acquisitionProcessingJob.deleteMany({where:{...where,
      input:{path:["recognitionJobId"],equals:source.id}}});
    if(priorTurn)await db.acquisitionProcessingTurn.upsert({where:{runId_stage:where},
      create:priorTurn,update:{lastClaimedAt:priorTurn.lastClaimedAt}});
    else await db.acquisitionProcessingTurn.deleteMany({where});
  }
}
