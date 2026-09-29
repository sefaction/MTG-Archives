import { verifyAcquisitionCommit } from "./verify-acquisition-commit";
import assert from "node:assert/strict";
import { verifyAcquisitionPhotos } from "./verify-acquisition-photos";
import { verifyAcquisitionCatalog } from "./verify-acquisition-catalog";
import { verifyAcquisitionCatalogCache } from "./verify-acquisition-catalog-cache";
import { verifyAcquisitionOrchestration } from "./verify-acquisition-orchestration";
import { verifyAcquisitionOwnerFairness } from "./verify-acquisition-owner-fairness";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  createAcquisitionSession,
  getAcquisitionSession,
  ingestAcquisitionEvent,
  controlAcquisitionSession,
  correctAcquisitionCount,
  reviewAcquisitionCandidate,
  proposeAcquisitionCandidate,
  type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import {
  candidateKey,
  captureSummary,
  type AcquisitionEvent,
} from "../lib/acquisition-domain";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  process.env.MTG_LOCAL_PILOT_TEST !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !url.pathname.startsWith("/acquisition_")
)
  throw new Error(
    "Requires opt-in and a disposable local acquisition_* database",
  );
const db = new PrismaClient();
const tag = `acquisition-${randomUUID()}`;
const owner = tag + "-owner",
  otherOwner = tag + "-other",
  userId = tag + "-user",
  otherUser = tag + "-other-user",
  adminId = tag + "-admin",
  locationId = tag + "-box",
  cardId = tag + "-card";
const actor = { userId, adminMode: false };
const stranger = { userId: otherUser, adminMode: false };
const admin = { userId: adminId, adminMode: true };
function input(requestKey = randomUUID()): CreateAcquisitionInput {
  return {
    requestKey,
    ownerPlayerId: owner,
    locationId,
    section: "A",
    policy: { kind: "FILL" },
    run: {
      providerId: "fixture",
      runId: "run",
      enforcement: "LOGICAL_ALLOCATION",
      controls: ["STOP", "CANCEL", "PAUSE", "RESUME"],
    },
  };
}
function event(n: number): AcquisitionEvent {
  return {
    version: 1,
    providerId: "fixture",
    runId: "run",
    eventId: `e${n}`,
    artifacts: [
      { id: `a${n}`, digest: "identical-bytes-are-not-copy-identity" },
    ],
    sightings: [
      {
        candidate: {
          id: `c${n}`,
          identityKind: "DETECTION",
          order: [n, 0],
          expectedSides: ["FRONT"],
          provisional: true,
        },
        observation: { id: `o${n}`, artifactId: `a${n}`, side: "FRONT" },
        uncertainty: [],
      },
    ],
  };
}
const key = (n: number) => candidateKey("run", `c${n}`);
const known = {
  cardId,
  language: "EN",
  finish: "NONFOIL" as const,
  condition: "NM",
};

async function run() {
  for (const playerId of [owner, otherOwner])
    await db.player.create({
      data: { id: playerId, name: playerId, displayName: playerId },
    });
  for (const [id, playerId, role] of [
    [userId, owner, "PLAYER"],
    [otherUser, otherOwner, "PLAYER"],
    [adminId, otherOwner, "ADMIN"],
  ] as const)
    await db.user.create({
      data: {
        id,
        username: id,
        displayName: id,
        playerId,
        role,
        passwordHash: "not-a-login-hash",
      },
    });
  await db.inventoryLocation.create({
    data: {
      id: locationId,
      ownerPlayerId: owner,
      name: tag,
      normalizedName: tag,
      type: "Box",
      storageLayout: {
        capacity: 800,
        sections: [{ name: "A", capacity: 100 }],
      },
    },
  });
  await db.card.create({
    data: {
      id: cardId,
      scryfallId: randomUUID(),
      name: tag,
      typeLine: "Basic Land",
      setCode: "tst",
      collectorNumber: "1",
      rarity: "common",
    },
  });
  await db.inventoryItem.create({
    data: {
      cardId,
      currentOwnerId: owner,
      originalOpenerId: owner,
      locationId,
      locationSection: "A",
      quantity: 28,
      condition: "NM",
      sourceType: "MANUAL",
    },
  });

  await assert.rejects(
    createAcquisitionSession(db, stranger, input()),
    /unavailable/,
  );
  await assert.rejects(
    createAcquisitionSession(db, { ...stranger, adminMode: true }, input()),
    /unavailable/,
  );
  await assert.rejects(
    createAcquisitionSession(db, { ...admin, adminMode: false }, input()),
    /unavailable/,
  );
  const request = input();
  const [one, replay] = await Promise.all([
    createAcquisitionSession(db, actor, request),
    createAcquisitionSession(db, actor, request),
  ]);
  assert.equal(one.session.id, replay.session.id);
  assert.equal(one.session.target, 72);
  assert.equal(one.session.placement.committedDirect, 28);
  await assert.rejects(
    createAcquisitionSession(db, actor, { ...request, section: "B" }),
    /identity conflict/,
  );
  const adminCreated = await createAcquisitionSession(db, admin, input());
  await assert.rejects(
    getAcquisitionSession(db, stranger, one.session.id),
    /unavailable/,
  );
  await assert.rejects(
    getAcquisitionSession(db, { ...admin, adminMode: false }, one.session.id),
    /unavailable/,
  );
  assert.equal(
    (await getAcquisitionSession(db, admin, one.session.id)).session.id,
    one.session.id,
  );
  console.log(
    "PASS: live owner/Admin Mode authorization, 72-slot section snapshot, concurrent creation replay",
  );

  let state = await controlAcquisitionSession(
    db,
    actor,
    one.session.id,
    0,
    "START",
  );
  const duplicates = await Promise.all([
    ingestAcquisitionEvent(db, actor, one.session.id, event(0)),
    ingestAcquisitionEvent(db, actor, one.session.id, event(0)),
  ]);
  assert.equal(duplicates.filter((s) => s.replay).length, 1);
  assert.equal(
    (await getAcquisitionSession(db, actor, one.session.id)).revision,
    2,
  );
  const freshClient = new PrismaClient();
  try {
    const restored = await getAcquisitionSession(
      freshClient,
      actor,
      one.session.id,
    );
    assert.equal(captureSummary(restored.session).physicalCandidates, 1);
    assert.equal(restored.session.artifacts.length, 1);
    assert.equal(
      (
        await ingestAcquisitionEvent(
          freshClient,
          actor,
          one.session.id,
          event(0),
        )
      ).replay,
      true,
    );
  } finally {
    await freshClient.$disconnect();
  }
  const conflict = event(1);
  conflict.artifacts[0].digest = "conflicting bytes";
  const race = await Promise.allSettled([
    ingestAcquisitionEvent(db, actor, one.session.id, event(1)),
    ingestAcquisitionEvent(db, actor, one.session.id, conflict),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    String(
      (race.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ),
    /identity conflict/,
  );
  await Promise.all([
    ingestAcquisitionEvent(db, actor, one.session.id, event(3)),
    ingestAcquisitionEvent(db, actor, one.session.id, event(2)),
  ]);
  state = (await getAcquisitionSession(
    db,
    actor,
    one.session.id,
  )) as typeof state;
  assert.deepEqual(
    captureSummary(state.session).allocated,
    [0, 1, 2, 3].map(key),
  );
  assert.equal(state.session.receipts.length, 4);
  console.log(
    "PASS: persisted replay after reconnect, conflicting receipt race and ordered concurrent events",
  );

  const beforeFailure = await getAcquisitionSession(db, actor, one.session.id);
  const injected = db.$extends({
    query: {
      acquisitionObservation: {
        async create() {
          throw new Error("injected observation failure");
        },
      },
    },
  }) as unknown as PrismaClient;
  await assert.rejects(
    ingestAcquisitionEvent(injected, actor, one.session.id, event(9)),
    /injected observation failure/,
  );
  assert.deepEqual(
    await getAcquisitionSession(db, actor, one.session.id),
    beforeFailure,
  );
  console.log(
    "PASS: transaction rollback preserves receipt/revision/artifact/candidate state after injected partial write",
  );

  const revision = beforeFailure.revision;
  const controls = await Promise.allSettled([
    controlAcquisitionSession(db, actor, one.session.id, revision, "PAUSE"),
    controlAcquisitionSession(db, actor, one.session.id, revision, "STOP"),
  ]);
  assert.equal(controls.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    String(
      (controls.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ),
    /Stale/,
  );
  let current = await getAcquisitionSession(db, actor, one.session.id);
  current = await correctAcquisitionCount(
    db,
    actor,
    one.session.id,
    current.revision,
    {
      candidateKey: key(0),
      revision: 1,
      action: "CONFIRM_COUNT",
      reason: "Physically checked one card",
    },
  );
  current = await reviewAcquisitionCandidate(
    db,
    actor,
    one.session.id,
    current.revision,
    key(0),
    2,
    known,
  );
  current = await proposeAcquisitionCandidate(
    db,
    actor,
    one.session.id,
    current.revision,
    key(0),
    3,
    { ...known, finish: "UNKNOWN" },
  );
  assert.equal(
    current.session.candidates.find((c) => c.key === key(0))?.review?.finish,
    "NONFOIL",
  );
  assert.equal(current.session.corrections[0].actorId, userId);
  current = await correctAcquisitionCount(
    db,
    actor,
    one.session.id,
    current.revision,
    {
      candidateKey: key(3),
      revision: 1,
      action: "EXCLUDE_FALSE_DETECTION",
      reason: "Background rectangle",
    },
  );
  current = await controlAcquisitionSession(
    db,
    actor,
    one.session.id,
    current.revision,
    "CANCEL",
  );
  assert.equal(current.session.artifacts.length, 4);
  assert.equal(current.session.candidates.length, 4);
  assert.equal(captureSummary(current.session).physicalCandidates, 3);
  assert.equal(
    (await ingestAcquisitionEvent(db, actor, one.session.id, event(0))).replay,
    true,
  );
  await assert.rejects(
    ingestAcquisitionEvent(db, actor, one.session.id, event(4)),
    /cannot receive/,
  );
  const another = await createAcquisitionSession(db, actor, input());
  assert.equal(another.session.placement.otherSessionPending, 3);
  await verifyAcquisitionOrchestration(db, actor, input());
  await verifyAcquisitionOwnerFairness(db);
  await verifyAcquisitionPhotos(db, actor, stranger, input());
  await verifyAcquisitionCatalog(db, admin, actor, cardId);
  await verifyAcquisitionCatalogCache(db);
  console.log(
    "PASS: optimistic commands, persisted human review/correction precedence, cancellation conservation, other-session pending",
  );

  await db.user.update({ where: { id: userId }, data: { isActive: false } });
  await assert.rejects(
    ingestAcquisitionEvent(db, actor, one.session.id, event(0)),
    /unavailable/,
  );
  await db.user.update({ where: { id: userId }, data: { isActive: true } });
  await db.user.update({ where: { id: adminId }, data: { role: "PLAYER" } });
  await assert.rejects(
    getAcquisitionSession(db, admin, one.session.id),
    /unavailable/,
  );
  console.log(
    "PASS: revoked accounts and demoted admins lose access even for replay",
  );

  await db.inventoryLocation.update({
    where: { id: locationId },
    data: {
      storageLayout: { capacity: 800, sections: [{ name: "A", capacity: 80 }] },
    },
  });
  assert.equal(
    (await getAcquisitionSession(db, actor, another.session.id))
      .destinationCurrent,
    false,
  );
  await assert.rejects(
    controlAcquisitionSession(db, actor, another.session.id, 0, "START"),
    /Destination changed/,
  );
  const emptyLocation = await db.inventoryLocation.create({
    data: {
      ownerPlayerId: owner,
      name: tag + "-empty",
      normalizedName: tag + "-empty",
    },
  });
  const removable = await createAcquisitionSession(db, actor, {
    ...input(),
    locationId: emptyLocation.id,
    policy: { kind: "MANUAL", quantity: 2 },
  });
  await db.inventoryLocation.delete({ where: { id: emptyLocation.id } });
  const retained = await getAcquisitionSession(db, actor, removable.session.id);
  assert.equal(retained.destinationCurrent, false);
  assert.equal(retained.session.placement.locationId, emptyLocation.id);
  console.log(
    "PASS: edited or removed destinations invalidate placement without deleting capture evidence",
  );

  await controlAcquisitionSession(db, actor, another.session.id, 0, "CANCEL");
  // Independent run for database membership/uniqueness tests.
  const independent = await createAcquisitionSession(db, actor, input());
  await controlAcquisitionSession(
    db,
    actor,
    independent.session.id,
    0,
    "START",
  );
  await ingestAcquisitionEvent(db, actor, independent.session.id, event(0));
  const runA = await db.acquisitionRun.findUniqueOrThrow({
    where: { sessionId: one.session.id },
    include: { artifacts: true, candidates: true, events: true },
  });
  const runB = await db.acquisitionRun.findUniqueOrThrow({
    where: { sessionId: independent.session.id },
    include: { artifacts: true },
  });
  await assert.rejects(
    db.acquisitionObservation.create({
      data: {
        runId: runA.id,
        sourceId: "foreign-link",
        artifactId: runB.artifacts[0].id,
        candidateId: runA.candidates[0].id,
        side: "FRONT",
      },
    }),
  );
  await assert.rejects(
    db.acquisitionEvent.create({
      data: {
        runId: runA.id,
        sourceEventId: runA.events[0].sourceEventId,
        payload: "bad",
        sessionRevision: 999,
      },
    }),
  );
  await assert.rejects(
    db.acquisitionCandidate.update({
      where: { id: runA.candidates[0].id },
      data: { acquisitionOrder: -1 },
    }),
  );
  assert.equal(
    await db.inventoryAuditLog.count({ where: { changedByUserId: userId } }),
    0,
  );
  assert.equal(
    (
      await db.inventoryItem.aggregate({
        where: { currentOwnerId: owner },
        _sum: { quantity: true },
      })
    )._sum.quantity,
    28,
  );
  assert.ok(adminCreated.session.id);
  console.log(
    "PASS: database foreign-run/duplicate/negative-order constraints and zero inventory/audit effects",
  );
  await verifyAcquisitionCommit(db, actor, stranger, input());
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const sessions = await db.acquisitionSession.findMany({
      where: { ownerPlayerId: owner },
      select: { id: true },
    });
    const runs = await db.acquisitionRun.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { id: true },
    });
    const where = { runId: { in: runs.map((r) => r.id) } };
    await db.acquisitionCommitMember.deleteMany({ where });
    await db.acquisitionCommit.deleteMany({ where });
    await db.acquisitionProcessingJob.deleteMany({ where });
    await db.acquisitionCommand.deleteMany({ where });
    await db.acquisitionPhoto.deleteMany({ where });
    await db.acquisitionCaptureSlot.deleteMany({ where });
    await db.acquisitionCountCorrection.deleteMany({ where });
    await db.acquisitionObservation.deleteMany({ where });
    await db.acquisitionEvent.deleteMany({ where });
    await db.acquisitionCandidate.deleteMany({ where });
    await db.acquisitionArtifact.deleteMany({ where });
    await db.acquisitionRun.deleteMany({
      where: { id: { in: runs.map((r) => r.id) } },
    });
    await db.acquisitionSession.deleteMany({
      where: { id: { in: sessions.map((s) => s.id) } },
    });
    await db.inventoryItem.deleteMany({ where: { currentOwnerId: owner } });
    await db.inventoryLocation.deleteMany({ where: { ownerPlayerId: owner } });
    await db.user.deleteMany({
      where: { id: { in: [userId, otherUser, adminId] } },
    });
    await db.player.deleteMany({ where: { id: { in: [owner, otherOwner] } } });
    await db.card.deleteMany({ where: { id: cardId } });
    await db.$disconnect();
    console.log("Fixture-owned rows cleaned up.");
  });
