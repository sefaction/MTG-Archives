import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  createAcquisitionSession,
  executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot,
  enqueueAcquisitionProcessing,
  ingestAcquisitionEvent,
  getAcquisitionSession,
  getAcquisitionProgress,
  reviewAcquisitionCandidate,
  type AcquisitionActor,
  type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import {
  claimAcquisitionJobs,
  completeAcquisitionJob,
  failAcquisitionJob,
  heartbeatAcquisitionJob,
  runAcquisitionJobsOnce,
} from "../lib/acquisition-jobs";
import {
  candidateKey,
  captureSummary,
  consumeExactFixture,
  type AcquisitionEvent,
} from "../lib/acquisition-domain";

// Invoked only by the guarded, disposable PostgreSQL fixture runner.
export async function verifyAcquisitionOrchestration(
  db: PrismaClient,
  actor: AcquisitionActor,
  base: CreateAcquisitionInput,
) {
  const versions = {
    pipeline: "fixture-v1",
    runtime: "test",
    model: "none",
    catalog: "none",
    index: "none",
    execution: "CPU" as const,
  };
  async function create(
    providerId = "fixture",
    quantity?: number,
    exact = false,
  ) {
    return createAcquisitionSession(db, actor, {
      ...base,
      requestKey: randomUUID(),
      policy: quantity ? { kind: "MANUAL", quantity } : { kind: "FILL" },
      run: {
        ...base.run,
        providerId,
        enforcement: exact ? "EXACT_BEFORE_NEXT_ITEM" : "LOGICAL_ALLOCATION",
      },
    });
  }
  async function command(
    id: string,
    command: "START" | "STOP" | "CANCEL" | "COMPLETE",
  ) {
    const current = await getAcquisitionSession(db, actor, id);
    return executeAcquisitionCommand(db, actor, id, {
      requestKey: randomUUID(),
      revision: current.revision,
      command,
    });
  }
  function event(
    n: number,
    providerId = "fixture",
    physicalId = `c${n}`,
  ): AcquisitionEvent {
    return {
      version: 1,
      providerId,
      runId: base.run.runId,
      eventId: `e${n}`,
      artifacts: [
        { id: `a${n}`, digest: "same-bytes-do-not-deduplicate-copies" },
      ],
      sightings: [
        {
          candidate: {
            id: physicalId,
            identityKind: "NATIVE",
            order: [n, 0],
            expectedSides: ["FRONT"],
            provisional: false,
          },
          observation: { id: `o${n}`, artifactId: `a${n}`, side: "FRONT" },
          uncertainty: [],
        },
      ],
    };
  }
  await assert.rejects(create("phone-photo-v1", 73), /remaining capacity/);
  const phone = await create("phone-photo-v1");
  assert.equal(phone.session.target, 72);
  const start = {
    requestKey: "start",
    revision: phone.revision,
    command: "START" as const,
  };
  const starts = await Promise.all(
    [1, 2].map(() =>
      executeAcquisitionCommand(db, actor, phone.session.id, start),
    ),
  );
  assert.equal(starts.filter((s) => !s.replay).length, 1);
  await assert.rejects(
    executeAcquisitionCommand(db, actor, phone.session.id, {
      ...start,
      command: "CANCEL",
    }),
    /identity conflict/,
  );
  for (let n = 0; n < 71; n++)
    await reserveAcquisitionCaptureSlot(
      db,
      actor,
      phone.session.id,
      `photo-${n}`,
    );
  const last = await Promise.allSettled(
    Array.from({ length: 6 }, (_, n) =>
      reserveAcquisitionCaptureSlot(db, actor, phone.session.id, `last-${n}`),
    ),
  );
  assert.equal(last.filter((r) => r.status === "fulfilled").length, 1);
  for (const result of last)
    if (result.status === "rejected")
      assert.match(result.reason.message, /batch is full/);
  const progress = await getAcquisitionProgress(db, actor, phone.session.id);
  assert.equal(progress.reservedSlots, 72);
  assert.equal(progress.availableSlots, 0);
  assert.equal(progress.slots.filter((s) => s.received).length, 0);
  const first = await reserveAcquisitionCaptureSlot(
    db,
    actor,
    phone.session.id,
    "photo-0",
  );
  assert.equal(first.replay, true);
  await assert.rejects(
    ingestAcquisitionEvent(
      db,
      actor,
      phone.session.id,
      event(0, "phone-photo-v1"),
    ),
    /reserved capture slot/,
  );
  await ingestAcquisitionEvent(
    db,
    actor,
    phone.session.id,
    event(0, "phone-photo-v1", first.slot.id),
  );
  assert.equal(
    (await getAcquisitionProgress(db, actor, phone.session.id)).slots.filter(
      (s) => s.received,
    ).length,
    1,
  );
  await command(phone.session.id, "STOP");
  assert.equal(
    (await executeAcquisitionCommand(db, actor, phone.session.id, start))
      .replay,
    true,
  );
  assert.equal(
    (
      await reserveAcquisitionCaptureSlot(
        db,
        actor,
        phone.session.id,
        "photo-0",
      )
    ).slot.id,
    first.slot.id,
  );
  await assert.rejects(
    reserveAcquisitionCaptureSlot(db, actor, phone.session.id, "extra"),
    /not accepting/,
  );
  console.log(
    "PASS: 72 slots including in-flight reservations, last-slot race, replay and stop recovery",
  );

  // A versioned deterministic source manifest uses physical identity independent
  // of worker order. Exact mode does not create events for untouched source items.
  for (const exact of [true, false]) {
    const capture = await create("fixture", 263, exact);
    await command(capture.session.id, "START");
    const manifest = {
      version: 1,
      inputs: Array.from({ length: 300 }, (_, n) => event(n)),
    };
    const current = await getAcquisitionSession(db, actor, capture.session.id);
    const untouched = exact
      ? consumeExactFixture(current.session, manifest.inputs).unconsumed
      : [];
    const accepted = manifest.inputs.slice(
      0,
      manifest.inputs.length - untouched.length,
    );
    const batches: AcquisitionEvent[] = [];
    for (let offset = 0; offset < accepted.length; offset += 50) {
      const group = accepted.slice(offset, offset + 50);
      batches.push({
        ...group[0],
        eventId: `batch-${offset}`,
        artifacts: group.flatMap((e) => e.artifacts),
        sightings: group.flatMap((e) => e.sightings),
      });
    }
    // Out-of-order ACK delivery/reconnect doesn't change stable physical order.
    for (const batch of [...batches].reverse())
      await ingestAcquisitionEvent(db, actor, capture.session.id, batch);
    const reconnect = new (db.constructor as typeof PrismaClient)();
    try {
      for (const batch of batches)
        assert.equal(
          (
            await ingestAcquisitionEvent(
              reconnect,
              actor,
              capture.session.id,
              batch,
            )
          ).replay,
          true,
        );
    } finally {
      await reconnect.$disconnect();
    }
    const summary = captureSummary(
      (await getAcquisitionSession(db, actor, capture.session.id)).session,
    );
    assert.equal(summary.physicalCandidates, exact ? 263 : 300);
    assert.equal(summary.allocated.length, 263);
    assert.equal(summary.overflow.length, exact ? 0 : 37);
    assert.equal(untouched.length, exact ? 37 : 0);
    assert.equal(summary.allocated[146], candidateKey(base.run.runId, "c146"));
    await command(capture.session.id, "COMPLETE");
  }
  console.log(
    "PASS: durable exact 263/37 untouched and best-effort 263/37 retained, reversed delivery and reconnect",
  );

  const work = await create();
  await command(work.session.id, "START");
  await ingestAcquisitionEvent(db, actor, work.session.id, event(147));
  const enqueue = (stage: string, pipeline = "fixture-v1") =>
    enqueueAcquisitionProcessing(db, actor, work.session.id, {
      artifactSourceId: "a147",
      physicalId: "c147",
      stage,
      versions: { ...versions, pipeline },
    });
  const duplicate = await Promise.all([enqueue("fixture"), enqueue("fixture")]);
  assert.equal(duplicate[0].id, duplicate[1].id);
  await enqueue("fixture", "fixture-v2");
  const now = new Date(Date.now() + 1000);
  const claims = (
    await Promise.all(
      ["worker-a", "worker-b"].map((workerId) =>
        claimAcquisitionJobs(
          db,
          { workerId, stages: ["fixture"], leaseMs: 1000 },
          now,
        ),
      ),
    )
  ).flat();
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].id, claims[1].id);
  const recovered = await claimAcquisitionJobs(
    db,
    { workerId: "replacement", stages: ["fixture"], limit: 2, leaseMs: 10000 },
    new Date(now.getTime() + 1001),
  );
  assert.equal(recovered.length, 2);
  assert.equal(
    await heartbeatAcquisitionJob(
      db,
      claims[0],
      1000,
      new Date(now.getTime() + 1002),
    ),
    false,
  );
  assert.equal(
    await completeAcquisitionJob(
      db,
      claims[0],
      { result: "old" },
      new Date(now.getTime() + 1002),
    ),
    "STALE_LEASE",
  );
  assert.equal(
    await failAcquisitionJob(db, claims[0], new Date(now.getTime() + 1002)),
    false,
  );
  assert.equal(
    await completeAcquisitionJob(
      db,
      recovered[0],
      { result: "new" },
      new Date(now.getTime() + 1002),
    ),
    "COMPLETE",
  );
  const reviewState = await getAcquisitionSession(db, actor, work.session.id);
  await reviewAcquisitionCandidate(
    db,
    actor,
    work.session.id,
    reviewState.revision,
    candidateKey(base.run.runId, "c147"),
    reviewState.session.candidates[0].revision,
    { cardId: null, language: "EN", finish: "UNKNOWN", condition: "NM" },
  );
  assert.equal(
    await completeAcquisitionJob(
      db,
      recovered[1],
      { result: "stale-after-review" },
      new Date(now.getTime() + 1002),
    ),
    "SUPERSEDED",
  );
  assert.equal(
    captureSummary(
      (await getAcquisitionSession(db, actor, work.session.id)).session,
    ).physicalCandidates,
    1,
  );
  console.log(
    "PASS: immediate versioned enqueue, two-worker claims, lease handoff and preserved human review",
  );

  const failure = await enqueue("failure");
  await assert.rejects(db.acquisitionProcessingJob.update({ where: { id: failure.id }, data: { leaseToken: "partial" } }));
  const failureStart = Date.now() + 1000;
  for (let n = 0; n < 3; n++) {
    const when = new Date(failureStart + 20000 * n);
    const [job] = await claimAcquisitionJobs(
      db,
      { workerId: "fail-worker", stages: ["failure"] },
      when,
    );
    assert.ok(job);
    assert.equal(await failAcquisitionJob(db, job, when), true);
  }
  assert.equal(
    (
      await db.acquisitionProcessingJob.findUniqueOrThrow({
        where: { id: failure.id },
      })
    ).status,
    "FAILED",
  );
  const crash = await enqueue("crash");
  for (let n = 0; n < 3; n++)
    assert.equal(
      (
        await claimAcquisitionJobs(
          db,
          { workerId: "crash", stages: ["crash"], leaseMs: 1000 },
          new Date(now.getTime() + 100000 + n * 1001),
        )
      ).length,
      1,
    );
  assert.equal(
    (
      await claimAcquisitionJobs(
        db,
        { workerId: "recover", stages: ["crash"] },
        new Date(now.getTime() + 104000),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await db.acquisitionProcessingJob.findUniqueOrThrow({
        where: { id: crash.id },
      })
    ).status,
    "FAILED",
  );
  await enqueue("timeout");
  let aborted = false;
  const tick = await runAcquisitionJobsOnce(
    db,
    {
      timeout: async (_job, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    },
    "timeout-worker",
    { timeoutMs: 100, leaseMs: 1000 },
  );
  assert.equal(tick.failed, 1);
  assert.equal(aborted, true);
  await enqueue("cancelled");
  await command(work.session.id, "CANCEL");
  assert.equal(
    (
      await claimAcquisitionJobs(db, {
        workerId: "cancelled",
        stages: ["cancelled"],
      })
    ).length,
    0,
  );
  console.log(
    "PASS: bounded retries, crashed worker exhaustion, timeout abort and cancellation; unresolved copy retained",
  );
}
