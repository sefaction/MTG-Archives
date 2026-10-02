import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { completeAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { retrieveAcquisitionVisual } from "../lib/acquisition-visual-worker";
import { readAcquisitionPhotoBytes } from "../lib/acquisition-files";

// Disposable PostgreSQL/file transport proof; observations are synthetic and
// do not measure recognition accuracy. Existing source jobs are never changed.
export async function verifyAcquisitionVisualReuse(db: PrismaClient, template: ClaimedAcquisitionJob,
  native: Prisma.InputJsonObject) {
  const input = template.input as {photoId: string; digest: string; model: string};
  const run = await db.acquisitionRun.findUniqueOrThrow({where: {id: template.runId}, include: {session: true}});
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: input.photoId}, include: {slot: true}});
  const candidate = await db.acquisitionCandidate.findUniqueOrThrow({where: {id: template.candidateId}});
  const owned: string[] = [];
  const otherOwner = `visual-reuse-${randomUUID()}`;
  let requests = 0;
  await db.player.create({data: {id: otherOwner, name: otherOwner, displayName: otherOwner}});
  const worker = {request: async () => {requests++; return native;}};
  const attempt = async () => {
    const job = await db.acquisitionProcessingJob.create({data: {
      runId: template.runId, artifactId: template.artifactId, candidateId: template.candidateId,
      candidateRevision: template.candidateRevision, stage: template.stage, versionKey: randomUUID(),
      input: template.input as Prisma.InputJsonObject, status: "RUNNING", leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 180000),
    }}) as ClaimedAcquisitionJob;
    owned.push(job.id);
    return job;
  };
  const observe = (job: ClaimedAcquisitionJob, client = db) =>
    retrieveAcquisitionVisual(client, job, AbortSignal.timeout(30000), input.model, worker);
  try {
    const first = await attempt(), fresh = await observe(first);
    assert.equal(requests, 1);
    assert.equal(await completeAcquisitionJob(db, first, fresh), "COMPLETE");
    for (let n = 0; n < 3; n++) {
      const job = await attempt(), output = await observe(job);
      assert.deepEqual(output.visual, fresh.visual, "reused evidence preserves uncertainty and native timing");
      assert.equal(requests, 1, "identical owner/bytes/model/input kind reuse completed observations");
      assert.equal((output.visualExecution as {inferenceRequests: number}).inferenceRequests, 0);
      assert.equal(await completeAcquisitionJob(db, job, output), "COMPLETE");
    }
    const other = await attempt();
    await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: otherOwner}});
    try {
      const output = await observe(other);
      assert.equal((output.visualExecution as {reused: boolean}).reused, false);
      assert.equal(requests, 2, "another owner performs inference");
    } finally { await db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: run.session.ownerPlayerId}}); }

    const changedModel = "e".repeat(64), version = await attempt();
    version.input = {...version.input as Prisma.InputJsonObject, model: changedModel};
    await db.acquisitionProcessingJob.update({where: {id: version.id}, data: {input: version.input as Prisma.InputJsonObject}});
    let modelCalls = 0;
    const changed = await retrieveAcquisitionVisual(db, version, AbortSignal.timeout(30000), changedModel,
      {request: async () => {modelCalls++; return {...native, descriptor: changedModel};}});
    assert.equal(modelCalls, 1);
    assert.equal((changed.visualExecution as {reused: boolean}).reused, false);
    const kind = await attempt();
    await db.acquisitionPhoto.update({where: {id: photo.id}, data: {inputKind: photo.inputKind === "PHOTO" ? "CARD_SCAN" : "PHOTO"}});
    try {
      const output = await observe(kind);
      assert.equal((output.visualExecution as {reused: boolean}).reused, false);
      assert.equal(requests, 3, "PHOTO/CARD_SCAN decoding envelopes cannot share results");
    } finally { await db.acquisitionPhoto.update({where: {id: photo.id}, data: {inputKind: photo.inputKind}}); }

    const mutations = [
      {name: "revision", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: {increment: 1}}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: candidate.revision}})},
      {name: "review", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {review: {fixture: true}}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {review: Prisma.DbNull}})},
      {name: "exclusion", change: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {excluded: true}}), restore: () => db.acquisitionCandidate.update({where: {id: candidate.id}, data: {excluded: false}})},
      {name: "generation", change: () => db.acquisitionCaptureSlot.update({where: {id: photo.slotId}, data: {generation: {increment: 1}}}), restore: () => db.acquisitionCaptureSlot.update({where: {id: photo.slotId}, data: {generation: photo.slot.generation}})},
      {name: "purge", change: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: new Date()}}), restore: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {purgedAt: null}})},
      {name: "cancellation", change: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {phase: "CANCELLED"}}), restore: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {phase: run.session.phase}})},
      {name: "owner", change: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: otherOwner}}), restore: () => db.acquisitionSession.update({where: {id: run.sessionId}, data: {ownerPlayerId: run.session.ownerPlayerId}})},
      {name: "input kind", change: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {inputKind: photo.inputKind === "PHOTO" ? "CARD_SCAN" : "PHOTO"}}), restore: () => db.acquisitionPhoto.update({where: {id: photo.id}, data: {inputKind: photo.inputKind}})},
      {name: "owner inactive", change: () => db.player.update({where: {id: run.session.ownerPlayerId}, data: {active: false}}), restore: () => db.player.update({where: {id: run.session.ownerPlayerId}, data: {active: true}})},
      {name: "user inactive", change: () => db.user.update({where: {id: run.session.createdByUserId}, data: {isActive: false}}), restore: () => db.user.update({where: {id: run.session.createdByUserId}, data: {isActive: true}})},
      {name: "password reset", change: () => db.user.update({where: {id: run.session.createdByUserId}, data: {forcePasswordChange: true}}), restore: () => db.user.update({where: {id: run.session.createdByUserId}, data: {forcePasswordChange: false}})},
      {name: "committed candidate", change: () => db.$transaction(async tx => {
        await tx.acquisitionCommit.create({data: {id: otherOwner, runId: run.id, actorUserId: run.session.createdByUserId,
          requestKey: randomUUID(), requestDigest: "fixture", snapshot: {}}});
        return tx.acquisitionCommitMember.create({data: {candidateId: candidate.id, runId: run.id, commitId: otherOwner,
          inventoryItemId: "fixture-no-inventory-write", snapshot: {}}});
      }), restore: async () => {await db.acquisitionCommitMember.deleteMany({where: {commitId: otherOwner}});
        await db.acquisitionCommit.deleteMany({where: {id: otherOwner}});}},
    ];
    for (const mutation of mutations) {
      // Changing owner before handling is a legitimate fresh owner request;
      // changing it after observation/lookup must never publish another owner's.
      if (!["owner", "input kind"].includes(mutation.name)) {
        const before = await attempt();
        await mutation.change();
        try { await assert.rejects(observe(before), /superseded/, mutation.name); }
        finally { await mutation.restore(); }
      }
      const during = await attempt();
      const fault = db.$extends({query: {$queryRaw: async ({args, query}) => {
        const output = await query(args);
        if ((args as Prisma.Sql).strings?.join("").includes("visualReuse")) await mutation.change();
        return output;
      }}}) as unknown as PrismaClient;
      try { await assert.rejects(observe(during, fault), /superseded/, mutation.name + " after lookup"); }
      finally { await mutation.restore(); }
      const after = await attempt(), output = await observe(after);
      await mutation.change();
      try {
        assert.equal(await completeAcquisitionJob(db, after, output), "SUPERSEDED", mutation.name + " at publication");
        assert.equal((await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: after.id}})).output, null);
      } finally { await mutation.restore(); }
    }
    const lease = await attempt(), leaseOutput = await observe(lease);
    await db.acquisitionProcessingJob.update({where: {id: lease.id}, data: {leaseToken: randomUUID()}});
    await assert.rejects(observe(lease), /superseded/);
    assert.equal(await completeAcquisitionJob(db, lease, leaseOutput), "STALE_LEASE");
    const expired = await attempt(), expiredOutput = await observe(expired);
    await db.acquisitionProcessingJob.update({where: {id: expired.id}, data: {leaseExpiresAt: new Date(Date.now() - 1000)}});
    await assert.rejects(observe(expired), /superseded/);
    assert.equal(await completeAcquisitionJob(db, expired, expiredOutput, new Date(0)), "STALE_LEASE");
    const changedJob = await attempt(), changedJobOutput = await observe(changedJob);
    await db.acquisitionProcessingJob.update({where: {id: changedJob.id}, data: {
      input: {...changedJob.input as Prisma.InputJsonObject, model: "d".repeat(64)},
    }});
    await assert.rejects(observe(changedJob), /superseded/);
    assert.equal(await completeAcquisitionJob(db, changedJob, changedJobOutput), "SUPERSEDED");
    const atomic = await attempt(), atomicOutput = await observe(atomic);
    const publicationFault = db.$extends({query: {$executeRaw: async ({args, query}) => {
      if ((args as Prisma.Sql).strings?.join("").includes("SET status='COMPLETE'"))
        await db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: {increment: 1}}});
      return query(args);
    }}}) as unknown as PrismaClient;
    try { assert.equal(await completeAcquisitionJob(publicationFault, atomic, atomicOutput), "SUPERSEDED"); }
    finally { await db.acquisitionCandidate.update({where: {id: candidate.id}, data: {revision: candidate.revision}}); }
    const aborted = await attempt();
    await assert.rejects(retrieveAcquisitionVisual(db, aborted, AbortSignal.abort(), input.model, worker));
    const originalBytes = await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest);
    const originalFile = path.join(process.env.UPLOADS_DATA_PATH!, "acquisition-v1", `${photo.id}.original`);
    const corrupt = await attempt();
    await writeFile(originalFile, Buffer.from("corrupted visual fixture"));
    try { await assert.rejects(observe(corrupt), /integrity check/); }
    finally { await writeFile(originalFile, originalBytes); }
    assert.equal(requests, 3, "all guarded reuse paths avoid native inference");
    console.log("PASS: durable visual reuse, owner/model/input-kind misses, review/generation/lease/owner publication fences and original integrity");
  } finally {
    await db.acquisitionProcessingJob.deleteMany({where: {id: {in: owned}}});
    await db.player.delete({where: {id: otherOwner}});
  }
}
