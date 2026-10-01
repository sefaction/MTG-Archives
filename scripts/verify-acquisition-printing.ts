import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { completeAcquisitionJob, runAcquisitionJobsOnce, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { claimFixtureJobs as claimAcquisitionJobs } from "./acquisition-verification-queue";
import { enqueueReadyPrinting, observeAcquisitionPrinting } from "../lib/acquisition-printing-worker";
import { PRINTING_STAGE, PRINTING_POLICY_VERSION } from "../lib/acquisition-printing";
import { getAcquisitionCardReview, type AcquisitionActor } from "../lib/acquisition-store";
import { verifyAcquisitionPrintingReuse } from "./verify-acquisition-printing-reuse";

// Real database/file transport and revision fences. Native observations below
// are synthetic protocol fixtures; algorithm accuracy is measured separately.
export async function verifyAcquisitionPrinting(
  db: PrismaClient, actor: AcquisitionActor, sessionId: string, photoId: string,
  source: ClaimedAcquisitionJob,
) {
  const model = "c".repeat(64);
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: photoId}});
  const legacy = await db.acquisitionProcessingJob.create({data: {
    runId: source.runId, artifactId: source.artifactId, candidateId: source.candidateId,
    candidateRevision: source.candidateRevision, stage: PRINTING_STAGE, versionKey: randomUUID(),
    status: "COMPLETE", input: {photoId, digest: photo.digest, catalogJobId: source.id, model},
    output: {legacyFixture: true},
  }});
  const count = await Promise.all([enqueueReadyPrinting(db, model), enqueueReadyPrinting(db, model)]);
  assert.equal(count.reduce((sum, n)=>sum+n, 0), 1, "concurrent stage enqueue is duplicate safe");
  const [job] = await claimAcquisitionJobs(db, {workerId: "printing-fixture", stages: [PRINTING_STAGE]});
  assert(job);
  const original = await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: source.id}});
  let requests = 0;
  const worker = {request: async (frame: Buffer) => {
    requests++;
    const length = frame.readUInt32BE();
    const metadata = JSON.parse(frame.subarray(4, 4+length).toString());
    assert.deepEqual(Object.keys(metadata), ["scryfallIds"], "ground truth and account metadata do not enter native worker");
    assert.equal(createHash("sha256").update(frame.subarray(4+length)).digest("hex"), photo.digest);
    const candidates = await db.card.findMany({where: {scryfallId: {in: metadata.scryfallIds}}});
    return {version: "registered-printing-runtime-v1", descriptor: model, photoDigest: photo.digest,
      milliseconds: 1, observedStamp: "PRESENT", conflictingObservations: false, automaticAcceptance: false,
      candidates: candidates.map(c=>({scryfallId: c.scryfallId, referenceId: `${c.scryfallId}:0`,
        referenceStampState: "UNKNOWN", relation: "UNRESOLVED",
        alignment: {status: "ALIGNED", stampVisible: true, footerVisible: true, sourceCardWidth: 1000},
        stamp: {status: "PRESENT", reason: "LOCAL_SYMBOL_SHAPE"}}))};
  }};
  await assert.rejects(observeAcquisitionPrinting(db, {...job, input: {...job.input as Prisma.InputJsonObject, model: "d".repeat(64)}},
    AbortSignal.timeout(30000), model, worker), /version superseded/);
  assert.equal(requests, 0);
  for (const policy of [undefined, "obsolete-policy-v0"])
    await assert.rejects(observeAcquisitionPrinting(db, {...job, input: {...job.input as Prisma.InputJsonObject, policy}},
      AbortSignal.timeout(30000), model, worker), /interpretation version superseded/);
  assert.equal(requests, 0, "obsolete interpretations are rejected before reading pixels/native work");
  const result = await observeAcquisitionPrinting(db, job, AbortSignal.timeout(30000), model, worker);
  assert.deepEqual(result.native, (original.output as Prisma.InputJsonObject).native, "OCR bytes/evidence are preserved");
  assert.equal((result.proposals as {automaticAcceptance: boolean}).automaticAcceptance, false);
  assert.equal(result.sourceCatalogJobId, source.id);
  assert.equal((result.versions as Prisma.InputJsonObject).printingPolicy, PRINTING_POLICY_VERSION);
  assert.equal((result.printing as {candidates:{referenceStampState:string;expectationSource:string}[]}).candidates
    .find(c=>c.expectationSource==="CATALOG_LIST_REPRINT")?.referenceStampState,"UNKNOWN");
  assert.equal(await completeAcquisitionJob(db, job, result), "COMPLETE");
  assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: source.id}})).output,
    original.output, "source output remains immutable");
  const view = await getAcquisitionCardReview(db, actor, sessionId, photoId);
  assert.equal(view.printingStatus, "COMPLETE");
  assert.equal(view.evidence?.printing?.observedStamp, "PRESENT");
  assert.equal(view.suggestions[0].printing.setCode, "plst", "contradicted original is demoted but retained");
  assert(view.suggestions.some(s=>s.reasons.includes("STAMP_CONTRADICTION")));
  assert.equal(await enqueueReadyPrinting(db, model), 0);
  assert.deepEqual((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:legacy.id}})).output,
    {legacyFixture:true}, "old completed history is preserved; the new policy queues separately");
  const obsolete = await db.acquisitionProcessingJob.create({data: {
    runId: job.runId, artifactId: job.artifactId, candidateId: job.candidateId,
    candidateRevision: job.candidateRevision, stage: PRINTING_STAGE, versionKey: randomUUID(),
    input: {...job.input as Prisma.InputJsonObject, policy:"obsolete-policy-v0"}, availableAt:new Date(0),
  }});
  try {
    requests=0;
    const terminal=await runAcquisitionJobsOnce(db, {
      [PRINTING_STAGE]:(current,signal)=>observeAcquisitionPrinting(db,current,signal,model,worker),
    },"printing-policy-superseded-fixture");
    assert.deepEqual(terminal,{claimed:1,complete:0,failed:0,superseded:1});
    assert.equal(requests,0);
    assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where:{id:obsolete.id}})).status,"SUPERSEDED");
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where:{id:{in:[obsolete.id,legacy.id]}}});
  }
  await verifyAcquisitionPrintingReuse(db, job, result, model);
  const changed = await db.acquisitionProcessingJob.create({data: {
    runId: source.runId, artifactId: source.artifactId, candidateId: source.candidateId,
    candidateRevision: source.candidateRevision, stage: source.stage, versionKey: randomUUID(),
    input: source.input as Prisma.InputJsonObject,
  }});
  const stale = await db.acquisitionProcessingJob.create({data: {
    runId: job.runId, artifactId: job.artifactId, candidateId: job.candidateId,
    candidateRevision: job.candidateRevision, stage: PRINTING_STAGE, versionKey: randomUUID(),
    input: job.input as Prisma.InputJsonObject,
    availableAt: new Date(0), // Explicitly eligible; do not race database/default wall clocks.
  }});
  try {
    requests = 0;
    const result = await runAcquisitionJobsOnce(db, {
      [PRINTING_STAGE]: (current, signal)=>observeAcquisitionPrinting(db, current, signal, model, worker),
    }, "printing-superseded-fixture");
    assert.deepEqual(result, {claimed: 1, complete: 0, failed: 0, superseded: 1});
    assert.equal(requests, 0, "obsolete source is rejected before native CPU work");
    assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: stale.id}})).status, "SUPERSEDED");
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where: {id: {in: [changed.id, stale.id]}}});
  }
  console.log("PASS: printing stage duplicate-safe enqueue, unchanged photo envelope, immutable sources, stable identities and review-only result");
  console.log("PASS: obsolete catalog jobs become terminal SUPERSEDED before native work, without retry failures");
}
