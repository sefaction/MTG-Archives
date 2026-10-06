import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { buildRestoreCredentialFence, buildRestoreWorkerLeaseFence } from "../lib/backup";
import { claimAcquisitionJobs, heartbeatAcquisitionJob, completeAcquisitionJob, failAcquisitionJob, type ClaimedAcquisitionJob } from "../lib/acquisition-jobs";
import { resolveCachedAcquisitionCatalog } from "../lib/acquisition-catalog-cache";
import type { CatalogLookupResult } from "../lib/acquisition-catalog-provider";

// Only the opt-in disposable database integrity runner calls this gate.
export async function verifyRestoreWorkers(db: PrismaClient, apply?: () => Promise<void>) {
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
  const tag = `restore-workers-${randomUUID()}`;
  const schema = `legacy-'"\\$fence$-${randomUUID()}`;
  const quoted = `"${schema.replaceAll('"', '""')}"`;
  const sessions: string[] = [];
  const runIds: string[] = [];
  const lookupKeys: string[] = [];
  let createdSchema = false;
  let release: ((value: CatalogLookupResult) => void) | undefined;
  let delayed: ReturnType<typeof resolveCachedAcquisitionCatalog> | undefined;
  const response: CatalogLookupResult = { status: "NOT_FOUND", cards: [], requestsMade: 1, printingCoverage: "CHECKED" };
  try {
    await db.player.create({ data: { id: tag, name: tag, displayName: tag } });
    await db.user.create({ data: { id: tag, username: tag, displayName: tag, playerId: tag, passwordHash: "not-a-login" } });
    async function fixture(count: number) {
      const session = await db.acquisitionSession.create({ data: {
        createdByUserId: tag, ownerPlayerId: tag, section: "", requestKey: randomUUID(),
        requestPayload: "{}", placement: {}, policy: { kind: "MANUAL", quantity: count }, phase: "CAPTURING",
      } });
      sessions.push(session.id);
      const run = await db.acquisitionRun.create({ data: { sessionId: session.id, sourceRunId: randomUUID(), providerId: "metadata-restore-fixture", enforcement: "LOGICAL_ALLOCATION", controls: [] } });
      runIds.push(run.id);
      const jobs = [];
      for (let n = 0; n < count; n++) {
        const artifact = await db.acquisitionArtifact.create({ data: { runId: run.id, sourceId: `artifact-${n}`, digest: "0".repeat(64) } });
        const candidate = await db.acquisitionCandidate.create({ data: { runId: run.id, physicalId: `candidate-${n}`, identityKind: "EPISODE", acquisitionOrder: n, spatialOrder: 0, expectedSides: ["FRONT"], provisional: true, uncertainty: ["fixture"], revision: 0 } });
        jobs.push(await db.acquisitionProcessingJob.create({ data: { runId: run.id, artifactId: artifact.id, candidateId: candidate.id, candidateRevision: 0, stage: tag, versionKey: "fixture-v1", input: { preserved: n } } }));
      }
      return { session, run, jobs };
    }
    const live = await fixture(8);
    const old: ClaimedAcquisitionJob[] = [];
    for (let n = 0; n < 2; n++) old.push(...await claimAcquisitionJobs(db, { workerId: tag, stages: [tag], limit: 2, leaseMs: 300000 }));
    assert.equal(old.length, 4);
    await db.acquisitionProcessingJob.update({ where: { id: old[3].id }, data: { attempts: 3, maxAttempts: 3, output: { preserved: "exhausted" } } });
    const controlIds = live.jobs.filter(j => !old.some(o => o.id === j.id)).map(j => j.id);
    for (const [i, status] of (["PENDING", "COMPLETE", "FAILED", "SUPERSEDED"] as const).entries()) {
      await db.acquisitionProcessingJob.update({ where: { id: controlIds[i] }, data: { status, output: { preserved: status } } });
    }
    const controls = await db.acquisitionProcessingJob.findMany({ where: { id: { in: controlIds } }, orderBy: { id: "asc" } });
    const blocked: string[] = [];
    for (const state of ["cancelledAt", "trashedAt", "deletedAt", "review"] as const) {
      const f = await fixture(1);
      await db.acquisitionProcessingJob.update({ where: { id: f.jobs[0].id }, data: { status: "RUNNING", attempts: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 300000) } });
      if (state === "review") await db.acquisitionCandidate.update({ where: { id: f.jobs[0].candidateId }, data: { review: { preserved: "human-selection" } } });
      else await db.acquisitionSession.update({ where: { id: f.session.id }, data: { [state]: new Date(), ...(state === "cancelledAt" ? { phase: "CANCELLED" as const } : {}) } });
      blocked.push(f.jobs[0].id);
    }
    const candidatesBefore = await db.acquisitionCandidate.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } });
    const sessionsBefore = await db.acquisitionSession.findMany({ where: { id: { in: sessions } }, orderBy: { id: "asc" } });
    const completeKey = `complete-${tag}`;
    lookupKeys.push(completeKey);
    const completeCache = await db.acquisitionCatalogLookup.create({ data: { key: completeKey, request: {}, status: "NOT_FOUND", result: { preserved: true }, expiresAt: new Date(Date.now() + 3600000) } });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<CatalogLookupResult>(resolve => { release = resolve; });
    delayed = resolveCachedAcquisitionCatalog(db, { kind: "name", name: tag }, AbortSignal.timeout(60000), async () => { entered(); return held; });
    await started;
    const runningCache = await db.acquisitionCatalogLookup.findFirstOrThrow({ where: { status: "RUNNING", request: { path: ["name"], equals: tag } } });
    lookupKeys.push(runningCache.key);
    const jobsBefore = await db.acquisitionProcessingJob.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } });
    const fence = buildRestoreWorkerLeaseFence("public");
    await assert.rejects(db.$transaction(async tx => { await tx.$executeRawUnsafe(fence); throw Error("fixture rollback"); }), /fixture rollback/);
    assert.deepEqual(await db.acquisitionProcessingJob.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } }), jobsBefore);
    assert.deepEqual(await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: runningCache.key } }), runningCache);
    if (apply) await apply();
    else await db.$transaction(tx => tx.$executeRawUnsafe(fence));
    assert.equal(await heartbeatAcquisitionJob(db, old[0]), false);
    assert.equal(await completeAcquisitionJob(db, old[1], { stale: true }), "STALE_LEASE");
    assert.equal(await failAcquisitionJob(db, old[2]), false);
    release!(response);
    assert.equal((await delayed).status, "PENDING");
    const after = await db.acquisitionProcessingJob.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } });
    const times = new Set<number>();
    for (const before of jobsBefore.filter(j => j.status === "RUNNING")) {
      const actual = after.find(j => j.id === before.id)!;
      assert.equal(actual.status, before.attempts < before.maxAttempts ? "PENDING" : "FAILED");
      assert.equal(actual.leaseToken, null);
      assert.equal(actual.leaseExpiresAt, null);
      assert.equal(actual.errorCode, "RESTORE_INTERRUPTED");
      assert.equal(actual.availableAt.getTime(), actual.updatedAt.getTime());
      times.add(actual.updatedAt.getTime());
      assert.deepEqual({ ...actual, status: before.status, leaseToken: before.leaseToken, leaseExpiresAt: before.leaseExpiresAt, availableAt: before.availableAt, updatedAt: before.updatedAt, errorCode: before.errorCode }, before);
    }
    assert.equal(times.size, 1);
    const cacheAfter = await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: runningCache.key } });
    assert.deepEqual({ ...cacheAfter, status: runningCache.status, leaseToken: runningCache.leaseToken, leaseExpiresAt: runningCache.leaseExpiresAt, expiresAt: runningCache.expiresAt, updatedAt: runningCache.updatedAt }, runningCache);
    assert.equal(cacheAfter.status, "PENDING");
    assert.equal(cacheAfter.leaseToken, null);
    assert.equal(cacheAfter.leaseExpiresAt, null);
    assert.equal(cacheAfter.expiresAt, null);
    assert.deepEqual(await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: completeKey } }), completeCache);
    assert.deepEqual(await db.acquisitionProcessingJob.findMany({ where: { id: { in: controlIds } }, orderBy: { id: "asc" } }), controls);
    assert.deepEqual(await db.acquisitionCandidate.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } }), candidatesBefore);
    assert.deepEqual(await db.acquisitionSession.findMany({ where: { id: { in: sessions } }, orderBy: { id: "asc" } }), sessionsBefore);
    await db.$executeRawUnsafe(fence);
    assert.deepEqual(await db.acquisitionProcessingJob.findMany({ where: { runId: { in: runIds } }, orderBy: { id: "asc" } }), after);
    assert.deepEqual(await db.acquisitionCatalogLookup.findUniqueOrThrow({ where: { key: runningCache.key } }), cacheAfter);
    const fresh = await claimAcquisitionJobs(db, { workerId: "after-restore", stages: [tag], limit: 2, leaseMs: 300000 });
    assert.equal(fresh.length, 2);
    assert.ok(fresh.every(j => !blocked.includes(j.id) && j.id !== old[3].id));
    for (const job of fresh) assert.equal(await completeAcquisitionJob(db, job, { fresh: true }), "COMPLETE");
    assert.equal((await resolveCachedAcquisitionCatalog(db, { kind: "name", name: tag }, AbortSignal.timeout(30000), async () => response)).status, "NOT_FOUND");
    await db.$executeRawUnsafe(`CREATE SCHEMA ${quoted}`);
    createdSchema = true;
    await db.$executeRawUnsafe(buildRestoreWorkerLeaseFence(schema));
    await db.$executeRawUnsafe(`CREATE TABLE ${quoted}."AcquisitionProcessingJob" (LIKE public."AcquisitionProcessingJob" INCLUDING ALL)`);
    await db.$executeRawUnsafe(`INSERT INTO ${quoted}."AcquisitionProcessingJob" SELECT * FROM public."AcquisitionProcessingJob" WHERE id='${old[3].id}'`);
    await db.$executeRawUnsafe(`UPDATE ${quoted}."AcquisitionProcessingJob" SET status='RUNNING', "leaseToken"='fixture', "leaseExpiresAt"=CURRENT_TIMESTAMP+interval '5 minutes'`);
    await db.$executeRawUnsafe(buildRestoreWorkerLeaseFence(schema));
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT status::text AS status, "leaseToken" FROM ${quoted}."AcquisitionProcessingJob"`), [{ status: "FAILED", leaseToken: null }]);
    await db.$executeRawUnsafe(`CREATE TABLE ${quoted}."AcquisitionCatalogLookup" (LIKE public."AcquisitionCatalogLookup" INCLUDING ALL)`);
    await db.$executeRawUnsafe(`INSERT INTO ${quoted}."AcquisitionCatalogLookup" SELECT * FROM public."AcquisitionCatalogLookup" WHERE key='${completeKey}'`);
    await db.$executeRawUnsafe(`UPDATE ${quoted}."AcquisitionCatalogLookup" SET status='RUNNING', "leaseToken"='fixture', "leaseExpiresAt"=CURRENT_TIMESTAMP+interval '5 minutes'`);
    await db.$executeRawUnsafe(buildRestoreWorkerLeaseFence(schema));
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT status, "leaseToken", "leaseExpiresAt", "expiresAt" FROM ${quoted}."AcquisitionCatalogLookup"`), [{ status: "PENDING", leaseToken: null, leaseExpiresAt: null, expiresAt: null }]);
    // A real SQL incompatibility must abort rather than partially revoke auth.
    await db.$executeRawUnsafe(`DROP TABLE ${quoted}."AcquisitionProcessingJob"`);
    await db.$executeRawUnsafe(`CREATE TABLE ${quoted}."AcquisitionProcessingJob" (id integer)`);
    await db.$executeRawUnsafe(`CREATE TABLE ${quoted}."AuthSession" (id integer)`);
    await db.$executeRawUnsafe(`INSERT INTO ${quoted}."AuthSession" VALUES (1)`);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(buildRestoreCredentialFence(schema));
      await tx.$executeRawUnsafe(buildRestoreWorkerLeaseFence(schema));
    }));
    assert.deepEqual(await db.$queryRawUnsafe(`SELECT id FROM ${quoted}."AuthSession"`), [{ id: 1 }]);
    assert.equal(await db.scannerRun.count({ where: { agent: { userId: tag } } }), 0);
    assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: tag } }), 0);
    console.log("PASS: restored worker claims reject stale heartbeat/completion/failure/provider publication; retry/exhaustion, rollback/idempotence, frozen reviews, retired sessions, full-field controls and quoted legacy schemas preserved");
  } finally {
    release?.(response);
    if (delayed) await delayed;
    if (createdSchema) await db.$executeRawUnsafe(`DROP SCHEMA ${quoted} CASCADE`);
    await db.acquisitionCatalogLookup.deleteMany({ where: { key: { in: lookupKeys } } });
    await db.acquisitionProcessingJob.deleteMany({ where: { runId: { in: runIds } } });
    await db.acquisitionCandidate.deleteMany({ where: { runId: { in: runIds } } });
    await db.acquisitionArtifact.deleteMany({ where: { runId: { in: runIds } } });
    await db.acquisitionRun.deleteMany({ where: { id: { in: runIds } } });
    await db.acquisitionSession.deleteMany({ where: { id: { in: sessions } } });
    await db.user.deleteMany({ where: { id: tag } });
    await db.player.deleteMany({ where: { id: tag } });
  }
}
