import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { claimFixtureJobs, type FixtureClaimDiagnostic } from "./acquisition-verification-queue";

export async function verifyAcquisitionClaimDiagnostics(db: PrismaClient, source: ClaimedAcquisitionJob) {
  const stage = `fixture-claim-diagnostic-${randomUUID()}`;
  const availableAt = new Date("2100-01-01T00:00:00Z");
  const job = await db.acquisitionProcessingJob.create({data: {
    runId: source.runId, artifactId: source.artifactId, candidateId: source.candidateId,
    candidateRevision: source.candidateRevision, stage, versionKey: randomUUID(),
    input: {privateSentinel: "DO_NOT_LOG_PROVIDER_INPUT"}, availableAt,
  }});
  const reports: FixtureClaimDiagnostic[] = [];
  const options = {workerId: "diagnostic-fixture", stages: [stage]};
  const expected = {candidateId: source.candidateId, onEmpty: (report: FixtureClaimDiagnostic) => reports.push(report)};
  try {
    // A deliberately future job produces an empty real claim. Diagnostics must
    // preserve that result and explain it, never retry/sleep/advance eligibility.
    assert.deepEqual(await claimFixtureJobs(db, options, expected), []);
    assert.equal(reports.length, 1);
    const report = reports[0];
    assert.equal(report.effectiveClaimAt.getTime(), report.databaseClock.getTime() + 1);
    assert(report.callerFinishedAt >= report.callerStartedAt);
    assert.deepEqual(report.claimTrace.events,[{operation:"SELECTION",count:0,heads:[]}]);
    assert.equal(report.claimTrace.droppedEvents,0);
    for (const rows of [report.rows]) {
      assert(Array.isArray(rows)); assert.equal(rows.length, 1);
      assert.equal(rows[0].id, job.id); assert.equal(rows[0].matchingJobs, 1);
      assert.equal(rows[0].status, "PENDING"); assert.equal(rows[0].attempts, 0);
      assert.equal(rows[0].availableAt.toISOString(), availableAt.toISOString());
      assert.equal(rows[0].leasePresent, false); assert.equal(rows[0].leaseExpiresAt, null);
      assert.equal(rows[0].currentRevision, source.candidateRevision);
      assert.equal(rows[0].ownerActive, true); assert.equal(rows[0].creatorActive, true);
      assert.equal(rows[0].reviewed, false); assert.equal(rows[0].committed, false);
    }
    const serialized = JSON.stringify(report);
    assert(!serialized.includes("DO_NOT_LOG_PROVIDER_INPUT"));
    assert(!serialized.includes(source.artifactId)); assert(!serialized.includes(source.candidateId));
    const preserved = await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: job.id}});
    assert.equal(preserved.availableAt.toISOString(), availableAt.toISOString());
    assert.equal(preserved.updatedAt.toISOString(), job.updatedAt.toISOString());
    assert.equal(preserved.attempts, 0); assert.equal(preserved.output, null);
    // Losing the post-claim snapshot must preserve the real empty result and
    // its already-observed selection, without exposing a failing query/error.
    let reads=0;
    const snapshotUnavailable=new Proxy(db,{get(target,property){
      if(property==="$queryRaw")return async(...args:unknown[])=>{
        if(++reads===3)throw new Error("DO_NOT_LOG_SNAPSHOT_ERROR");
        return Reflect.apply(target.$queryRaw,target,args);
      };
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    }});
    const unavailableReports:FixtureClaimDiagnostic[]=[];
    assert.deepEqual(await claimFixtureJobs(snapshotUnavailable,options,{candidateId:source.candidateId,
      onEmpty:diagnostic=>unavailableReports.push(diagnostic)}),[]);
    assert.equal(reads,3);assert.equal(unavailableReports.length,1);
    assert.deepEqual(unavailableReports[0].rows,{unavailable:true});
    assert.deepEqual(unavailableReports[0].claimTrace.events,[{operation:"SELECTION",count:0,heads:[]}]);
    assert(!JSON.stringify(unavailableReports).includes("DO_NOT_LOG_SNAPSHOT_ERROR"));
    // Even a malformed diagnostic code accessor cannot replace a genuine
    // selection failure with an empty result or a different exception.
    reads=0;
    const selectionFailure=Object.defineProperty(new Error("DO_NOT_LOG_SELECTION_ERROR"),"code",{
      get(){throw new Error("DO_NOT_LOG_CODE_ACCESSOR");},
    });
    const selectionUnavailable=new Proxy(db,{get(target,property){
      if(property==="$queryRaw")return async(...args:unknown[])=>{
        if(++reads===2)throw selectionFailure;
        return Reflect.apply(target.$queryRaw,target,args);
      };
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    }});
    await assert.rejects(()=>claimFixtureJobs(selectionUnavailable,options,expected),error=>error===selectionFailure);
    assert.equal(reports.length,1);
    // Once the fixture itself makes the job eligible, the original claim/CAS
    // grants one lease and no empty-claim diagnostic is emitted.
    await db.acquisitionProcessingJob.update({where: {id: job.id}, data: {availableAt: new Date(0)}});
    const claims = await claimFixtureJobs(db, options, expected);
    assert.equal(claims.length, 1); assert.equal(claims[0].id, job.id);
    assert.equal(claims[0].attempts, 1); assert(claims[0].leaseToken);
    assert.equal(reports.length, 1);
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where: {id: job.id, stage}});
  }
}
