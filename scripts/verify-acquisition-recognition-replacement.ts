import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, ingestAcquisitionEvent,
  type AcquisitionActor, type CreateAcquisitionInput } from "../lib/acquisition-store";
import { claimAcquisitionJobs, failAcquisitionJob } from "../lib/acquisition-jobs";
import { RECOGNITION_STAGE, retireReplacedRecognition } from "../lib/acquisition-recognition-worker";

// The enclosing runner requires an owned disposable PostgreSQL database.
export async function verifyRecognitionReplacement(db: PrismaClient, actor: AcquisitionActor, base: CreateAcquisitionInput) {
  const location = await db.inventoryLocation.create({ data: { ownerPlayerId: base.ownerPlayerId,
    name: randomUUID(), normalizedName: randomUUID(), type: "Box" } });
  const created = await createAcquisitionSession(db, actor, { ...base, requestKey: randomUUID(),
    locationId: location.id, section: "", policy: { kind: "MANUAL", quantity: 100 } });
  await executeAcquisitionCommand(db, actor, created.session.id, { requestKey: randomUUID(),
    revision: created.revision, command: "START" });
  const stage = RECOGNITION_STAGE, oldVersion = "a".repeat(64), currentVersion = "b".repeat(64);
  const oldAt = new Date("2020-01-01"), currentAt = new Date("2021-01-01"), now = new Date("2030-01-01");
  const oldIds: string[] = [], currentIds: string[] = [];
  for (let n = 0; n < 100; n++) {
    await ingestAcquisitionEvent(db, actor, created.session.id, { version: 1, providerId: base.run.providerId,
      runId: base.run.runId, eventId: `replacement-${n}`, artifacts: [{ id: `replacement-artifact-${n}`, digest: "d".repeat(64) }],
      sightings: [{ candidate: { id: `replacement-candidate-${n}`, identityKind: "NATIVE", order: [n,0],
        expectedSides: ["FRONT"], provisional: false }, observation: { id: `replacement-observation-${n}`,
        artifactId: `replacement-artifact-${n}`, side: "FRONT" }, uncertainty: [] }] });
  }
  const run = await db.acquisitionRun.findUniqueOrThrow({ where: { sessionId: created.session.id }, include: { candidates: true, artifacts: true } });
  assert.equal(run.candidates.length, 100);
  assert.equal(run.artifacts.length, 100);
  const rows: Prisma.AcquisitionProcessingJobCreateManyInput[] = [];
  for (let n = 0; n < 100; n++) {
    const candidate = run.candidates.find(c => c.physicalId === `replacement-candidate-${n}`)!;
    const artifact = run.artifacts.find(a => a.sourceId === `replacement-artifact-${n}`)!;
    assert.ok(candidate, `missing fixture candidate ${n}`);
    assert.ok(artifact, `missing fixture artifact ${n}`);
    const input = { photoId: randomUUID(), digest: "d".repeat(64), versions: { model: oldVersion } };
    const common = { runId: run.id, artifactId: artifact.id, candidateId: candidate.id,
      candidateRevision: candidate.revision, stage, availableAt: oldAt };
    const oldId = randomUUID(), currentId = randomUUID(); oldIds.push(oldId); currentIds.push(currentId);
    rows.push({ ...common, id: oldId, versionKey: oldVersion, input, createdAt: oldAt });
    rows.push({ ...common, id: currentId, versionKey: currentVersion,
      input: { ...input, versions: { model: currentVersion } }, createdAt: currentAt });
  }
  await db.acquisitionProcessingJob.createMany({ data: rows });
  const [baseline] = await claimAcquisitionJobs(db, { workerId: "generation-baseline", stages: [stage] }, now);
  assert(oldIds.includes(baseline.id), "before retirement, an unavailable older generation wins the claim");
  await failAcquisitionJob(db, baseline, now);

  // Positive cases include backed-off retries and exhausted expired attempts.
  await db.acquisitionProcessingJob.update({ where: { id: oldIds[1] }, data: { status: "RUNNING",
    attempts: 3, leaseToken: "expired-generation", leaseExpiresAt: new Date(now.getTime()-1) } });
  // Preserve live leases, completed observations, missing/currently obsolete
  // replacements, changed bytes and changed candidate revisions.
  await db.acquisitionProcessingJob.update({ where: { id: oldIds[2] }, data: { status: "RUNNING",
    leaseToken: "live-generation", leaseExpiresAt: new Date(now.getTime()+60000) } });
  const output = { observed: "preserve this completed observation" };
  await db.acquisitionProcessingJob.update({ where: { id: oldIds[3] }, data: { status: "COMPLETE", output } });
  await db.acquisitionProcessingJob.delete({ where: { id: currentIds[4] } });
  await db.acquisitionProcessingJob.update({ where: { id: currentIds[5] }, data: { createdAt: new Date("2019-01-01") } });
  await db.acquisitionProcessingJob.update({ where: { id: currentIds[6] }, data: { input: { ...(rows[13].input as object), digest: "e".repeat(64) } } });
  await db.acquisitionProcessingJob.update({ where: { id: currentIds[7] }, data: { candidateRevision: 999 } });
  await db.acquisitionProcessingJob.update({ where: { id: currentIds[8] }, data: { status: "SUPERSEDED" } });
  const beforeCandidates = await db.acquisitionCandidate.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } });
  const beforeArtifacts = await db.acquisitionArtifact.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } });
  const inventoryBefore = await db.inventoryItem.count({ where: { currentOwnerId: base.ownerPlayerId } });
  const retired = await retireReplacedRecognition(db, currentVersion, now);
  assert.equal(retired, 93, "only93 proven replaced queued/expired attempts may retire");
  assert.equal(await retireReplacedRecognition(db, currentVersion, now), 0, "repeated recovery is idempotent");
  const old = await db.acquisitionProcessingJob.findMany({ where: { id: { in: oldIds } } });
  for (const n of [2,3,4,5,6,7,8]) assert.notEqual(old.find(j=>j.id===oldIds[n])!.status, "SUPERSEDED");
  assert.equal(old.find(j=>j.id===oldIds[2])!.leaseToken, "live-generation");
  assert.deepEqual(old.find(j=>j.id===oldIds[3])!.output, output);
  for (const n of [0,1,9,99]) assert.equal(old.find(j=>j.id===oldIds[n])!.errorCode, "GENERATION_REPLACED");
  // Ordering follows attempt creation: an older attempt never retires a newer one.
  assert.equal(await retireReplacedRecognition(db, oldVersion, now), 1,
    "only the intentionally earlier replacement5 can retire; all newer current attempts survive");
  assert.equal(await db.acquisitionProcessingJob.count({ where: { id: { in: currentIds.filter((_,n)=>n!==4 && n!==5 && n!==8) }, status: "PENDING" } }), 97);
  assert.deepEqual(await db.acquisitionCandidate.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } }), beforeCandidates);
  assert.deepEqual(await db.acquisitionArtifact.findMany({ where: { runId: run.id }, orderBy: { id: "asc" } }), beforeArtifacts);
  assert.equal(await db.inventoryItem.count({ where: { currentOwnerId: base.ownerPlayerId } }), inventoryBefore);
  // Leave the deliberately retained old guards for their original workers; the
  // owned fixture cancellation keeps them from affecting later integrity checks.
  await db.acquisitionSession.update({ where: { id: created.session.id }, data: { phase: "CANCELLED" } });
  console.log("PASS:100-card generation recovery retires93 backed-off/expired attempts before inference; leases, observations, bytes, revisions, Inventory and rolling-worker order remain intact");
}
