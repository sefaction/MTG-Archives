import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { completeAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { observeAcquisitionPrinting } from "../lib/acquisition-printing-worker";
import { PRINTING_STAGE } from "../lib/acquisition-printing";
import { readAcquisitionPhotoBytes } from "../lib/acquisition-files";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyAcquisitionPrintingReuse(db: PrismaClient, original: ClaimedAcquisitionJob,
  expected: Prisma.InputJsonObject, model: string) {
  const input = original.input as {photoId: string; digest: string; catalogJobId: string};
  const template = await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: input.catalogJobId}});
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: input.photoId}, include: {slot: true}});
  const candidate = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: original.candidateId}});
  const run = await db.acquisitionRun.findUniqueOrThrow({where: {id: original.runId}, include: {session: true}});
  const owned: string[] = [];
  let requests = 0, sequence = 0;
  const otherOwner = `printing-reuse-${randomUUID()}`;
  await db.player.create({data: {id: otherOwner, name: otherOwner, displayName: otherOwner}});
  const worker = {request: async () => {requests++; return expected.printingNative;}};
  async function attempt(output = template.output) {
    const source = await db.acquisitionProcessingJob.create({data: {
      runId: template.runId, artifactId: template.artifactId, candidateId: template.candidateId,
      candidateRevision: template.candidateRevision, stage: template.stage, versionKey: randomUUID(),
      input: template.input as Prisma.InputJsonObject, status: "COMPLETE", output: output as Prisma.InputJsonObject,
      createdAt: new Date(template.createdAt.getTime() + ++sequence * 1000),
    }});
    owned.push(source.id);
    const job = await db.acquisitionProcessingJob.create({data: {
      runId: original.runId, artifactId: original.artifactId, candidateId: original.candidateId,
      candidateRevision: original.candidateRevision, stage: PRINTING_STAGE, versionKey: randomUUID(),
      input: {...original.input as Prisma.InputJsonObject, catalogJobId: source.id},
      status: "RUNNING", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 180000),
    }}) as ClaimedAcquisitionJob;
    owned.push(job.id);
    return job;
  }
  const observe = (job: ClaimedAcquisitionJob, client = db) => observeAcquisitionPrinting(client, job, AbortSignal.timeout(30000), model, worker);
  try {
    for (let n = 0; n < 3; n++) {
      const job = await attempt();
      const output = await observe(job);
      assert.deepEqual(output.printingNative, expected.printingNative);
      assert.deepEqual(output.printing, expected.printing);
      assert.deepEqual(output.proposals, expected.proposals);
      assert.deepEqual(output.native, expected.native);
      assert.equal(output.sourceCatalogJobId, (job.input as {catalogJobId: string}).catalogJobId);
      assert.equal((output.printingExecution as {inferenceRequests: number}).inferenceRequests, 0);
      assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    }
    assert.equal(requests, 0, "different catalog jobs reuse completed persisted observations without inference");
    const ownerJob = await attempt();
    await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: otherOwner}});
    try {
      const other = await observe(ownerJob);
      assert.equal((other.printingExecution as {reused: boolean}).reused, false, "another owner performs inference");
      assert.equal(requests, 1);
    } finally { await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: run.session.ownerPlayerId}}); }
    // Any different native descriptor represents a changed runtime/reference/
    // annotation/detector generation and must perform inference again.
    const changedModel = "e".repeat(64), versionJob = await attempt();
    await db.acquisitionProcessingJob.update({where: {id: versionJob.id}, data: {input: {...versionJob.input as Prisma.InputJsonObject, model: changedModel}}});
    versionJob.input = {...versionJob.input as Prisma.InputJsonObject, model: changedModel};
    const miss = await observeAcquisitionPrinting(db, versionJob, AbortSignal.timeout(30000), changedModel, {
      request: async () => {requests++; return {...expected.printingNative as Prisma.InputJsonObject, descriptor: changedModel};},
    });
    assert.equal((miss.printingExecution as {inferenceRequests: number}).inferenceRequests, 1);
    assert.equal(requests, 2);

    const narrowed = structuredClone(template.output) as any;
    narrowed.proposals.proposals = narrowed.proposals.proposals.slice(0, 1);
    const narrowJob = await attempt(narrowed);
    let narrowCalls = 0;
    const narrowResult = await observeAcquisitionPrinting(db, narrowJob, AbortSignal.timeout(30000), model, {
      request: async (frame: Buffer) => {
        narrowCalls++;
        const ids: string[] = JSON.parse(frame.subarray(4, 4 + frame.readUInt32BE()).toString()).scryfallIds;
        return {...expected.printingNative as any, candidates: (expected.printingNative as any).candidates.filter((c: any) => ids.includes(c.scryfallId))};
      },
    });
    assert.equal(narrowCalls, 1, "changed candidate membership performs inference");
    assert.equal((narrowResult.printingExecution as {reused: boolean}).reused, false);
    const reordered = await attempt();
    const orderClient = db.$extends({query: {card: {findMany: async ({args, query}) => (await query(args)).reverse()}}}) as unknown as PrismaClient;
    let orderCalls = 0;
    const orderResult = await observeAcquisitionPrinting(orderClient, reordered, AbortSignal.timeout(30000), model, {
      request: async () => {orderCalls++; return expected.printingNative;},
    });
    assert.equal(orderCalls, 1, "a changed ordered native envelope performs inference");
    assert.equal((orderResult.printingExecution as {reused: boolean}).reused, false);

    const originalBytes = await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest);
    const changedBytes = Buffer.concat([originalBytes, Buffer.from([0])]);
    const changedDigest = createHash("sha256").update(changedBytes).digest("hex");
    const file = path.join(process.env.UPLOADS_DATA_PATH!, "acquisition-v1", `${photo.id}.original`);
    const changedOutput = structuredClone(template.output) as any;
    changedOutput.native.photoDigest = changedDigest;
    const digestJob = await attempt(changedOutput);
    const catalogId = (digestJob.input as {catalogJobId: string}).catalogJobId;
    digestJob.input = {...digestJob.input as Prisma.InputJsonObject, digest: changedDigest};
    await db.acquisitionProcessingJob.update({where: {id: digestJob.id}, data: {input: digestJob.input as Prisma.InputJsonObject}});
    await db.acquisitionProcessingJob.update({where: {id: catalogId}, data: {input: {...template.input as Prisma.InputJsonObject, digest: changedDigest}}});
    await db.acquisitionPhoto.update({where: {id: photo.id}, data: {digest: changedDigest, bytes: changedBytes.length}});
    await writeFile(file, changedBytes);
    let digestCalls = 0;
    try {
      const different = await observeAcquisitionPrinting(db, digestJob, AbortSignal.timeout(30000), model, {
        request: async () => {digestCalls++; return {...expected.printingNative as Prisma.InputJsonObject, photoDigest: changedDigest};},
      });
      assert.equal(digestCalls, 1, "changed original bytes perform inference even when decoded pixels agree");
      assert.equal((different.printingExecution as {reused: boolean}).reused, false);
    } finally {
      await writeFile(file, originalBytes);
      await db.acquisitionPhoto.update({where: {id: photo.id}, data: {digest: photo.digest, bytes: photo.bytes}});
    }

    const mutations = [
      {name: "candidate revision", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: {increment: 1}}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: candidate.revision}})},
      {name: "saved review", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {review: {fixture: true}}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {review: Prisma.DbNull}})},
      {name: "excluded candidate", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {excluded: true}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {excluded: false}})},
      {name: "physical generation", change: () => db.acquisitionCaptureSlot.update({where: {id: photo.slotId}, data: {generation: {increment: 1}}}), restore: () => db.acquisitionCaptureSlot.update({where: {id: photo.slotId}, data: {generation: photo.slot.generation}})},
      {name: "purged original", change: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: new Date()}}), restore: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: null}})},
      {name: "cancelled session", change: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {phase: "CANCELLED"}}), restore: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {phase: run.session.phase}})},
      {name: "inactive owner", change: () => db.player.update({where: {id: run.session.ownerPlayerId}, data: {active: false}}), restore: () => db.player.update({where: {id: run.session.ownerPlayerId}, data: {active: true}})},
      {name: "inactive user", change: () => db.user.update({where: {id: run.session.createdByUserId}, data: {isActive: false}}), restore: () => db.user.update({where: {id: run.session.createdByUserId}, data: {isActive: true}})},
      {name: "password reset", change: () => db.user.update({where: {id: run.session.createdByUserId}, data: {forcePasswordChange: true}}), restore: () => db.user.update({where: {id: run.session.createdByUserId}, data: {forcePasswordChange: false}})},
      {name: "committed candidate", change: () => db.$transaction(async tx => {
        await tx.acquisitionCommit.create({data: {id: otherOwner, runId: run.id, actorUserId: run.session.createdByUserId, requestKey: randomUUID(), requestDigest: "fixture", snapshot: {}}});
        return tx.acquisitionCommitMember.create({data: {candidateId: candidate.id, runId: run.id, commitId: otherOwner, inventoryItemId: "fixture-no-inventory-write", snapshot: {}}});
      }), restore: async () => {await db.acquisitionCommitMember.deleteMany({where: {commitId: otherOwner}}); await db.acquisitionCommit.deleteMany({where: {id: otherOwner}});}},
    ];
    for (const mutation of mutations) {
      const before = await attempt();
      await mutation.change();
      try { await assert.rejects(observe(before), /superseded/, mutation.name + " rejected before reuse"); }
      finally { await mutation.restore(); }
      const during = await attempt();
      const fault = db.$extends({query: {$queryRaw: async ({args, query}) => {
        const result = await query(args);
        if ((args as Prisma.Sql).strings?.join("").includes("printingReuse")) await mutation.change();
        return result;
      }}}) as unknown as PrismaClient;
      try { await assert.rejects(observe(during, fault), /superseded/, mutation.name + " rejected after cache lookup"); }
      finally { await mutation.restore(); }
      const after = await attempt();
      const output = await observe(after);
      await mutation.change();
      try {
        assert.equal(await completeAcquisitionJob(db, after, output), "SUPERSEDED", mutation.name + " rejected at publication");
        assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: after.id}})).output, null);
      } finally { await mutation.restore(); }
    }
    const stale = await attempt(), staleOutput = await observe(stale);
    await attempt(); // new catalog source between handler and completion
    assert.equal(await completeAcquisitionJob(db, stale, staleOutput), "SUPERSEDED");
    assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: stale.id}})).output, null);
    const publication = await attempt(), publicationOutput = await observe(publication);
    const publicationFault = db.$extends({query: {$executeRaw: async ({args, query}) => {
      if ((args as Prisma.Sql).strings?.join("").includes("SET status='COMPLETE'")) await attempt();
      return query(args);
    }}}) as unknown as PrismaClient;
    assert.equal(await completeAcquisitionJob(publicationFault, publication, publicationOutput), "SUPERSEDED",
      "new catalog inserted inside completion is rejected by the atomic update predicate");
    assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: publication.id}})).output, null);
    const afterLookup = await attempt();
    const catalogFault = db.$extends({query: {$queryRaw: async ({args, query}) => {
      const result = await query(args);
      if ((args as Prisma.Sql).strings?.join("").includes("printingReuse")) await attempt();
      return result;
    }}}) as unknown as PrismaClient;
    await assert.rejects(observe(afterLookup, catalogFault), /catalog input superseded/);
    const ownerRace = await attempt();
    const ownerFault = db.$extends({query: {$queryRaw: async ({args, query}) => {
      const result = await query(args);
      if ((args as Prisma.Sql).strings?.join("").includes("printingReuse"))
        await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: otherOwner}});
      return result;
    }}}) as unknown as PrismaClient;
    try { await assert.rejects(observe(ownerRace, ownerFault), /superseded/); }
    finally { await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: run.session.ownerPlayerId}}); }
    const ownerLate = await attempt(), ownerOutput = await observe(ownerLate);
    await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: otherOwner}});
    try { assert.equal(await completeAcquisitionJob(db, ownerLate, ownerOutput), "SUPERSEDED"); }
    finally { await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: run.session.ownerPlayerId}}); }

    const lease = await attempt(), leaseOutput = await observe(lease);
    await db.acquisitionProcessingJob.update({where: {id: lease.id}, data: {leaseToken: randomUUID()}});
    await assert.rejects(observe(lease), /superseded/);
    assert.equal(await completeAcquisitionJob(db, lease, leaseOutput), "STALE_LEASE");
    const expired = await attempt(), expiredOutput = await observe(expired);
    await db.acquisitionProcessingJob.update({where: {id: expired.id}, data: {leaseExpiresAt: new Date(Date.now() - 1000)}});
    await assert.rejects(observe(expired), /superseded/);
    assert.equal(await completeAcquisitionJob(db, expired, expiredOutput, new Date(0)), "STALE_LEASE",
      "database-clock expiry cannot be bypassed by an earlier caller timestamp");
    const changedJob = await attempt(), changedJobOutput = await observe(changedJob);
    await db.acquisitionProcessingJob.update({where: {id: changedJob.id}, data: {input: {...changedJob.input as Prisma.InputJsonObject, model: "d".repeat(64)}}});
    await assert.rejects(observe(changedJob), /superseded/);
    assert.equal(await completeAcquisitionJob(db, changedJob, changedJobOutput), "SUPERSEDED");
    const aborted = await attempt();
    await assert.rejects(observeAcquisitionPrinting(db, aborted, AbortSignal.abort(), model, worker));
    const corrupt = await attempt(), bytes = await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest);
    await writeFile(file, Buffer.from("corrupted fixture"));
    try { await assert.rejects(observe(corrupt), /integrity check/); }
    finally { await writeFile(file, bytes); }
    assert.deepEqual(await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest), bytes);
    assert.equal(requests, 2, "all reuse and stale cases spend no inference; owner and version misses spend one each");
    console.log("PASS: durable native reuse equals fresh evidence/proposals, zero inference; generation and membership misses infer");
    console.log("PASS: reuse before/after/publication fences for catalog, revision, review, exclusion, physical generation, purge, cancellation, owner/user, lease, abort and corrupt original");
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where: {id: {in: owned}}});
    await db.player.delete({where: {id: otherOwner}});
  }
}
