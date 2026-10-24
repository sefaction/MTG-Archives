import { confirmStrongAcquisitionMatches } from "../lib/acquisition-auto-confirm";
import {verifyAcquisitionLanguage} from "./verify-acquisition-language";
import { runCorrectionCaptureOnce } from "../lib/acquisition-correction-worker";
import {
  createAcquisitionRecognitionIndex,
  proposeAcquisitionPrintings,
} from "../lib/acquisition-recognition";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { purgeCommittedAcquisitionPhotos, purgeTrashedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import { manageAcquisitionBatch } from "../lib/acquisition-batch-lifecycle";
import {
  writeAcquisitionPhotoBytes,
  readAcquisitionPhotoBytes,
  photoDigest,
} from "../lib/acquisition-files";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { setTimeout } from "node:timers/promises";
import { commitImportBatch } from "../lib/import-commit";
import { verifyAcquisitionWriterCompositions } from "./verify-acquisition-writers";
import {
  createAcquisitionSession,
  executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto,
  finalizeAcquisitionPhoto,
  saveAcquisitionReview,
  getAcquisitionCardReview,
  getAcquisitionProgress,
  correctAcquisitionCount,
  reviewAcquisitionCandidate,
  type AcquisitionActor,
  type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import {
  commitAcquisitionCards,
  previewAcquisitionCommit,
} from "../lib/acquisition-commit-service";
import { candidateKey } from "../lib/acquisition-domain";
import { acquisitionReviewCounts, acquisitionSlotReviewState } from "../lib/acquisition-review-display";

export async function verifyAcquisitionCommit(
  db: PrismaClient,
  actor: AcquisitionActor,
  stranger: AcquisitionActor,
  base: CreateAcquisitionInput,
) {
  const parent = path.resolve(".local-data");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "acq-commit-db-")),
    oldRoot = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const tag = `commit-${randomUUID()}`,
    runs: string[] = [],
    locations: string[] = [],
    importBatches: string[] = [],
    extraCards: string[] = [];
  const card = await db.card.create({
    data: {
      scryfallId: tag,
      name: tag,
      setCode: "cfx",
      collectorNumber: "1",
      typeLine: "Creature",
      rarity: "common",
      lang: "en",
      digital: false,
      finishes: ["nonfoil"],
    },
  });
  const decision = {
    cardId: card.id,
    language: "en",
    finish: "NONFOIL",
    condition: "NM",
  };
  const retentionBytes = Buffer.from("owned retention fixture");
  const metadata = {
    digest: photoDigest(retentionBytes),
    bytes: retentionBytes.length,
    mediaType: "image/jpeg" as const,
    width: 100,
    height: 140,
  };
  async function location(capacity: number) {
    const row = await db.inventoryLocation.create({
      data: {
        ownerPlayerId: base.ownerPlayerId,
        name: randomUUID(),
        normalizedName: randomUUID(),
        type: "Box",
        storageLayout: { capacity, sections: [{ name: "A", capacity }] },
      },
    });
    locations.push(row.id);
    return row.id;
  }
  async function capture(
    locationId: string,
    count: number,
    unfinishedRetake = false,
  ) {
    const state = await createAcquisitionSession(db, actor, {
      ...base,
      locationId,
      requestKey: randomUUID(),
      policy: { kind: "MANUAL", quantity: count },
      run: { ...base.run, providerId: "phone-photo-v1" },
    });
    const id = state.session.id;
    runs.push(
      (await db.acquisitionRun.findUniqueOrThrow({ where: { sessionId: id } }))
        .id,
    );
    await executeAcquisitionCommand(db, actor, id, {
      requestKey: randomUUID(),
      revision: 0,
      command: "START",
    });
    const photos: Awaited<ReturnType<typeof beginAcquisitionPhoto>>[] = [];
    for (let i = 0; i < count; i++) {
      const { slot } = await reserveAcquisitionCaptureSlot(
        db,
        actor,
        id,
        randomUUID(),
      );
      if (unfinishedRetake && i === 0)
        await beginAcquisitionPhoto(db, actor, id, {
          slotId: slot.id,
          uploadKey: randomUUID(),
          generation: 0,
          metadata,
        });
      const photo = await beginAcquisitionPhoto(db, actor, id, {
        slotId: slot.id,
        uploadKey: randomUUID(),
        generation: unfinishedRetake && i === 0 ? 1 : 0,
        replacePending: unfinishedRetake && i === 0,
        metadata,
      });
      await finalizeAcquisitionPhoto(db, actor, id, photo.id);
      photos.push(photo);
    }
    return { id, photos };
  }
  async function review(id: string, photoId: string) {
    const state = await getAcquisitionCardReview(db, actor, id, photoId);
    await saveAcquisitionReview(db, actor, id, {
      action: "accept",
      photoId,
      revision: state.revision,
      decision,
    });
  }
  async function stop(id: string) {
    const state = await getAcquisitionProgress(db, actor, id);
    await executeAcquisitionCommand(db, actor, id, {
      requestKey: randomUUID(),
      revision: state.revision,
      command: "STOP",
    });
  }
  try {
    // Persisted progress must not advertise accepted-but-uncertain or overflow
    // copies as ready. These are owned synthetic physical-state controls.
    const physicalDestination = await location(3);
    const physical = await capture(physicalDestination, 2);
    for (const photo of physical.photos) await review(physical.id, photo.id);
    let physicalProgress = await getAcquisitionProgress(db, actor, physical.id);
    assert.equal(acquisitionReviewCounts(physicalProgress.slots).ready, 0);
    assert.ok(physicalProgress.slots[0].physicalReadiness.reasons.includes("ACQUISITION_NOT_SETTLED"));
    await stop(physical.id);
    const physicalRun = await db.acquisitionRun.findUniqueOrThrow({ where: { sessionId: physical.id } });
    await db.acquisitionCandidate.updateMany({ where: { runId: physicalRun.id, physicalId: physicalProgress.slots[0].id },
      data: { uncertainty: ["MULTIFEED"], countConfirmed: false } });
    await db.acquisitionSession.update({ where: { id: physical.id }, data: { target: 1 } });
    physicalProgress = await getAcquisitionProgress(db, actor, physical.id);
    const savedReview = physicalProgress.slots[0].review;
    assert.ok(physicalProgress.slots[0].physicalReadiness.reasons.includes("COUNT_UNCERTAIN"));
    assert.ok(physicalProgress.slots[1].physicalReadiness.reasons.includes("OVERFLOW"));
    assert.deepEqual(acquisitionReviewCounts(physicalProgress.slots), { all: 2, awaiting: 2, ready: 0, added: 0 });
    const physicalSelection = { locationId: physicalDestination, section: "A", photoIds: [physical.photos[0].id] };
    await assert.rejects(previewAcquisitionCommit(db, actor, physical.id, physicalSelection), /confirmed physical count/);
    await assert.rejects(previewAcquisitionCommit(db, actor, physical.id, { ...physicalSelection, photoIds: [physical.photos[1].id] }), /confirmed physical count/);
    assert.equal(await db.inventoryItem.count({ where: { locationId: physicalDestination } }), 0);
    const uncertain = physicalProgress.session.candidates.find(c => c.input.id === physicalProgress.slots[0].id)!;
    await correctAcquisitionCount(db, actor, physical.id, physicalProgress.revision, {
      candidateKey: uncertain.key, revision: uncertain.revision, action: "CONFIRM_COUNT", reason: "Owned physical readiness test",
    });
    physicalProgress = await getAcquisitionProgress(db, actor, physical.id);
    assert.deepEqual(physicalProgress.slots[0].review, savedReview);
    assert.equal(acquisitionSlotReviewState(physicalProgress.slots[0]), "ready");
    assert.equal(acquisitionSlotReviewState(physicalProgress.slots[1]), "awaiting");
    assert.equal((await previewAcquisitionCommit(db, actor, physical.id, physicalSelection)).count, 1);
    assert.equal(await db.inventoryItem.count({ where: { locationId: physicalDestination } }), 0);
    const destination = await location(3),
      first = await capture(destination, 3, true);
    await review(first.id, first.photos[0].id);
    await review(first.id, first.photos[1].id);
    const selection = {
      photoIds: first.photos.slice(0, 2).map((p) => p.id),
      locationId: destination,
      section: "A",
    };
    await assert.rejects(
      previewAcquisitionCommit(db, actor, first.id, selection),
      /stopped/,
    );
    await stop(first.id);
    await assert.rejects(
      previewAcquisitionCommit(db, stranger, first.id, selection),
      /unavailable/,
    );
    await assert.rejects(
      previewAcquisitionCommit(db, actor, first.id, {
        ...selection,
        photoIds: [first.photos[2].id],
      }),
      /reviewed/,
    );
    let preview = await previewAcquisitionCommit(
      db,
      actor,
      first.id,
      selection,
    );
    assert.equal(preview.count, 2);
    assert.equal(preview.overfill, 0);
    assert.equal(preview.destination.remaining, 3);
    const request = {
      ...selection,
      requestKey: randomUUID(),
      previewToken: preview.token,
      overfillReason: null,
    };
    // Persisted changes between preview and the complete commit must reject
    // before any receipt effects. These are explicit fixture mutations, not
    // claims about the ownership/layout editing routes or concurrent schedules.
    async function commitState() {
      return Promise.all([
        db.acquisitionSession.findUniqueOrThrow({ where: { id: first.id } }),
        db.acquisitionCandidate.findMany({ where: { runId: { in: runs } }, orderBy: { id: "asc" } }),
        db.acquisitionPhoto.findMany({ where: { runId: { in: runs } }, orderBy: { id: "asc" } }),
        db.inventoryItem.findMany({ where: { cardId: card.id }, orderBy: { id: "asc" } }),
        db.inventoryAuditLog.findMany({ where: { changedByUserId: actor.userId }, orderBy: { id: "asc" } }),
        db.acquisitionCommit.findMany({ where: { runId: { in: runs } }, orderBy: { id: "asc" } }),
        db.acquisitionCommitMember.findMany({ where: { runId: { in: runs } }, orderBy: { candidateId: "asc" } }),
      ]);
    }
    async function refusedWithoutEffects(expected: RegExp) {
      const before = await commitState();
      await assert.rejects(commitAcquisitionCards(db, actor, first.id, request), expected);
      assert.deepEqual(await commitState(), before, "Refused complete commit must preserve all receipt/input rows and fields");
    }
    const foreignOwner = await db.user.findUniqueOrThrow({ where: { id: stranger.userId } });
    assert.ok(foreignOwner.playerId && foreignOwner.playerId !== base.ownerPlayerId);
    await db.acquisitionSession.update({ where: { id: first.id }, data: { ownerPlayerId: foreignOwner.playerId } });
    try {
      await refusedWithoutEffects(/unavailable|access|permission|owner/i);
    } finally {
      await db.acquisitionSession.update({ where: { id: first.id }, data: { ownerPlayerId: base.ownerPlayerId } });
    }
    const savedLayout = (await db.inventoryLocation.findUniqueOrThrow({ where: { id: destination } })).storageLayout;
    request.previewToken = (await previewAcquisitionCommit(db, actor, first.id, selection)).token;
    await db.inventoryLocation.update({ where: { id: destination }, data: { storageLayout: { capacity: 4, sections: [{ name: "A", capacity: 4 }] } } });
    try {
      await refusedWithoutEffects(/preview changed/);
    } finally {
      await db.inventoryLocation.update({ where: { id: destination }, data: { storageLayout: savedLayout as Prisma.InputJsonValue } });
    }
    request.previewToken = (await previewAcquisitionCommit(db, actor, first.id, selection)).token;
    await db.card.update({ where: { id: card.id }, data: { finishes: ["nonfoil", "foil"] } });
    try {
      const current = await getAcquisitionCardReview(db, actor, first.id, first.photos[0].id);
      await saveAcquisitionReview(db, actor, first.id, { action: "accept", photoId: first.photos[0].id,
        revision: current.revision, decision: { ...decision, finish: "FOIL" } });
      await refusedWithoutEffects(/preview changed/);
      const refreshed = await previewAcquisitionCommit(db, actor, first.id, selection);
      assert.notEqual(refreshed.token, request.previewToken);
      assert.equal(refreshed.cards.find(value => value.photoId === first.photos[0].id)!.finish, "FOIL");
    } finally {
      await review(first.id, first.photos[0].id);
      await db.card.update({ where: { id: card.id }, data: { finishes: ["nonfoil"] } });
    }
    request.previewToken = (await previewAcquisitionCommit(db, actor, first.id, selection)).token;
    console.log("PASS: complete commit refuses changed owner, layout and saved finish without receipt/input effects; fresh preview exposes current finish");
    for (const table of [
      "InventoryAuditLog",
      "AcquisitionCommit",
      "AcquisitionCommitMember",
    ] as const) {
      const fault = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              if (model === table && (operation === "create" || operation === "createMany")) throw new Error("injected commit failure");
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      const beforeFault = await commitState();
      await assert.rejects(
        commitAcquisitionCards(fault, actor, first.id, request),
        /injected/,
      );
      assert.deepEqual(await commitState(), beforeFault, `${table} failure must roll back every receipt/input field`);
      assert.equal(
        await db.inventoryItem.count({ where: { cardId: card.id } }),
        0,
      );
      assert.equal(
        await db.acquisitionCommit.count({ where: { runId: { in: runs } } }),
        0,
      );
      assert.equal(
        await db.inventoryAuditLog.count({
          where: {
            changeType: "acquisition_committed",
            changedByUserId: actor.userId,
          },
        }),
        0,
      );
      assert.equal(
        (
          await db.acquisitionPhoto.findUniqueOrThrow({
            where: { id: first.photos[0].id },
          })
        ).purgeAfter,
        null,
      );
    }
    // A different writer changes occupancy between preview and explicit commit.
    const resident = await db.inventoryItem.create({
      data: {
        cardId: card.id,
        currentOwnerId: base.ownerPlayerId,
        originalOpenerId: base.ownerPlayerId,
        quantity: 1,
        condition: "NM",
        locationId: destination,
        locationSection: "A",
        sourceType: "MANUAL",
      },
    });
    await assert.rejects(
      commitAcquisitionCards(db, actor, first.id, request),
      /preview changed/,
    );
    preview = await previewAcquisitionCommit(db, actor, first.id, selection);
    request.previewToken = preview.token;
    const pair = await Promise.all([
      commitAcquisitionCards(db, actor, first.id, request),
      commitAcquisitionCards(db, actor, first.id, request),
    ]);
    assert.equal(pair[0].id, pair[1].id);
    assert.equal(pair.filter((r) => r.replay).length, 1);
    const receipt = pair[0];
    assert.equal(receipt.count, 2);
    const lot = await db.inventoryItem.findUniqueOrThrow({
      where: { id: receipt.inventoryItemIds[0] },
    });
    assert.equal(lot.quantity, 2);
    assert.equal(lot.originalOpenerId, null);
    assert.equal(lot.sourceType, "ACQUISITION");
    assert.notEqual(lot.id, resident.id);
    const members = await db.acquisitionCommitMember.findMany({
      where: { commitId: receipt.id },
    });
    assert.equal(members.length, 2);
    const operation = await db.acquisitionCommit.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    const firstPhoto = await db.acquisitionPhoto.findUniqueOrThrow({
      where: { id: first.photos[0].id },
    });
    assert.equal(
      firstPhoto.purgeAfter!.getTime() - operation.createdAt.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(
      (
        await db.acquisitionPhoto.findUniqueOrThrow({
          where: { id: first.photos[2].id },
        })
      ).purgeAfter,
      null,
    );
    await assert.rejects(
      commitAcquisitionCards(db, actor, first.id, {
        ...request,
        requestKey: randomUUID(),
      }),
      /already committed/,
    );
    await assert.rejects(
      commitAcquisitionCards(db, actor, first.id, {
        ...request,
        overfillReason: "changed",
      }),
      /identity conflict/,
    );
    await assert.rejects(
      saveAcquisitionReview(db, actor, first.id, {
        action: "pending",
        photoId: first.photos[0].id,
        revision: 99,
      }),
      /already committed/,
    );
    await assert.rejects(
      beginAcquisitionPhoto(db, actor, first.id, {
        slotId: firstPhoto.slotId,
        uploadKey: randomUUID(),
        generation: firstPhoto.generation,
        metadata,
      }),
      /already committed/,
    );
    const abandoned = await db.acquisitionPhoto.findFirstOrThrow({
      where: { slotId: firstPhoto.slotId, ready: false },
    });
    await assert.rejects(
      beginAcquisitionPhoto(db, actor, first.id, {
        slotId: abandoned.slotId,
        uploadKey: abandoned.uploadKey,
        generation: abandoned.generation - 1,
        metadata,
      }),
      /already committed/,
    );
    const state = await getAcquisitionProgress(db, actor, first.id);
    const candidate = state.session.candidates.find(
      (c) => c.input.id === firstPhoto.slotId,
    )!;
    await assert.rejects(
      reviewAcquisitionCandidate(
        db,
        actor,
        first.id,
        state.revision,
        candidateKey(state.session.run.runId, firstPhoto.slotId),
        candidate.revision,
        { ...decision, finish: "NONFOIL" },
      ),
      /already committed/,
    );
    await db.user.update({
      where: { id: actor.userId },
      data: { isActive: false },
    });
    try {
      await assert.rejects(
        commitAcquisitionCards(db, actor, first.id, request),
        /unavailable/,
      );
    } finally {
      await db.user.update({
        where: { id: actor.userId },
        data: { isActive: true },
      });
    }
    await review(first.id, first.photos[2].id);
    const lastSelection = { ...selection, photoIds: [first.photos[2].id] };
    let full = await previewAcquisitionCommit(
      db,
      actor,
      first.id,
      lastSelection,
    );
    assert.equal(full.overfill, 1);
    const lastRequest = {
      ...lastSelection,
      requestKey: randomUUID(),
      previewToken: full.token,
      overfillReason: null as string | null,
    };
    await assert.rejects(
      commitAcquisitionCards(db, actor, first.id, lastRequest),
      /confirm overfill/,
    );
    await db.inventoryLocation.update({
      where: { id: destination },
      data: { name: "Changed destination" },
    });
    lastRequest.overfillReason = "Physically checked room for one more";
    await assert.rejects(
      commitAcquisitionCards(db, actor, first.id, lastRequest),
      /preview changed/,
    );
    full = await previewAcquisitionCommit(db, actor, first.id, lastSelection);
    lastRequest.previewToken = full.token;
    const extra = await commitAcquisitionCards(
      db,
      actor,
      first.id,
      lastRequest,
    );
    const audit = await db.inventoryAuditLog.findFirstOrThrow({
      where: { inventoryItemId: extra.inventoryItemIds[0] },
    });
    assert.equal(audit.reason, lastRequest.overfillReason);
    assert.equal((audit.afterJson as any).overfill, 1);
    // Inventory edits/deletion cannot erase historical membership or replay it.
    await db.inventoryItem.delete({ where: { id: lot.id } });
    assert.equal(
      (await commitAcquisitionCards(db, actor, first.id, request)).id,
      receipt.id,
    );
    assert.equal(
      await db.acquisitionCommitMember.count({
        where: { commitId: receipt.id },
      }),
      2,
    );
    const raceLocation = await location(1),
      a = await capture(raceLocation, 1),
      b = await capture(raceLocation, 1);
    for (const batch of [a, b]) {
      await review(batch.id, batch.photos[0].id);
      await stop(batch.id);
    }
    const inputs = await Promise.all(
      [a, b].map(async (batch) => {
        const selected = {
          photoIds: [batch.photos[0].id],
          locationId: raceLocation,
          section: "A",
        };
        const p = await previewAcquisitionCommit(db, actor, batch.id, selected);
        return {
          ...selected,
          requestKey: randomUUID(),
          previewToken: p.token,
          overfillReason: null,
        };
      }),
    );
    const race = await Promise.allSettled([
      commitAcquisitionCards(db, actor, a.id, inputs[0]),
      commitAcquisitionCards(db, actor, b.id, inputs[1]),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      String(
        (race.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason,
      ),
      /preview changed/,
    );
    assert.equal(
      (
        await db.inventoryItem.aggregate({
          where: { locationId: raceLocation },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      1,
    );
    // Reverse order: hold the complete acquisition receipt, then let the
    // complete ordinary CSV service retain its advisory-capacity semantics.
    {
      const destination = await location(1), captured = await capture(destination, 1);
      await review(captured.id, captured.photos[0].id); await stop(captured.id);
      const selection = { photoIds: [captured.photos[0].id], locationId: destination, section: "A" };
      const preview = await previewAcquisitionCommit(db, actor, captured.id, selection);
      const request = { ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null };
      const batch = await db.importBatch.create({ data: {
        filename: tag + "-reverse", importType: "inventory_csv:separate", selectedPlayerId: base.ownerPlayerId,
        selectedOriginalOpenerId: base.ownerPlayerId, createdByUserId: actor.userId, status: "PREVIEW",
        items: { create: { rowNumber: 2, status: "matched", cardPrintingId: card.id, parsedCondition: "NM",
          parsedFoilStatus: "NONFOIL", rawRowJson: {}, parsedRowJson: { quantity: 1, condition: "NM", language: "EN", notes: "CSV after acquisition" } } },
      } });
      importBatches.push(batch.id);
      let signalHeld!: () => void, releaseWriter!: () => void;
      const held = new Promise<void>(resolve => { signalHeld = resolve; }), release = new Promise<void>(resolve => { releaseWriter = resolve; });
      const heldLabel = `capture-csv-holding-${randomUUID()}`, waitingLabel = `capture-csv-waiting-${randomUUID()}`;
      const connection = (label: string) => { const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("application_name", label); return new PrismaClient({ datasourceUrl: url.href }); };
      const captureDb = connection(heldLabel), importDb = connection(waitingLabel);
      const protectedLedger = async (p: Prisma.TransactionClient, id: string) => ({
        receipt: await p.acquisitionCommit.findUniqueOrThrow({ where: { id } }),
        members: await p.acquisitionCommitMember.findMany({ where: { commitId: id }, orderBy: { candidateId: "asc" } }),
        audits: await p.inventoryAuditLog.findMany({ where: { changeType: "acquisition_committed", inventoryItem: { locationId: destination } }, orderBy: { id: "asc" } }),
        photos: await p.acquisitionPhoto.findMany({ where: { run: { sessionId: captured.id } }, orderBy: { id: "asc" } }),
      });
      let original: Awaited<ReturnType<typeof protectedLedger>> | undefined;
      const heldCapture = new Proxy(captureDb, { get(target, key) {
        if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<Awaited<ReturnType<typeof commitAcquisitionCards>>>, options: unknown) =>
          Reflect.apply(target.$transaction, target, [async (tx: Prisma.TransactionClient) => {
            const result = await work(tx); original = await protectedLedger(tx, result.id);
            signalHeld(); await release; return result;
          }, options]);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const importingInput = { batchId: batch.id, actingUserId: actor.userId, playerId: base.ownerPlayerId,
        isAdmin: false, destinationLocationId: destination, destinationLocationSection: "A" };
      const capturing = commitAcquisitionCards(heldCapture, actor, captured.id, request);
      void capturing.catch(() => {});
      let importing: ReturnType<typeof commitImportBatch> | undefined;
      const errors: unknown[] = [];
      try {
        await Promise.race([held, capturing.then(() => { throw new Error("Capture left its held complete receipt early"); })]);
        importing = commitImportBatch(importDb, importingInput); void importing.catch(() => {});
        let waiting = false; const deadline = Date.now() + 5000;
        do {
          const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(
            SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid))
            WHERE w.application_name=${waitingLabel} AND h.application_name=${heldLabel} AND w.wait_event_type='Lock') AS waiting`;
          waiting = row.waiting; if (!waiting) await setTimeout(20);
        } while (!waiting && Date.now() < deadline);
        assert(waiting, "complete CSV must wait for the actual complete acquisition receipt");
        releaseWriter(); const receipt = await capturing; assert.equal((await importing).committedRows, 1);
        assert(original); assert.deepEqual(await protectedLedger(db, receipt.id), original);
        const snapshot = async () => ({
          capture: await protectedLedger(db, receipt.id),
          stock: await db.inventoryItem.findMany({ where: { locationId: destination }, orderBy: { id: "asc" } }),
          audits: await db.inventoryAuditLog.findMany({ where: { inventoryItem: { locationId: destination } }, orderBy: { id: "asc" } }),
          batch: await db.importBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { items: { orderBy: { rowNumber: "asc" } } } }),
        });
        const after = await snapshot();
        assert.equal(after.stock.length, 2); assert.equal(after.stock.reduce((sum, row) => sum + row.quantity, 0), 2);
        assert.equal(after.audits.length, 2); assert.equal(after.batch.status, "IMPORTED");
        assert.equal(after.batch.items[0].status, "imported");
        const imported = after.stock.find(row => row.sourceType === "CSV_PULL_IMPORT")!;
        assert.equal(imported.quantity, 1); assert.equal(imported.notes, "CSV after acquisition");
        assert.equal(imported.originalOpenerId, base.ownerPlayerId); assert.equal(after.batch.items[0].inventoryItemId, imported.id);
        assert.equal(after.stock.find(row => row.sourceType === "ACQUISITION")!.id, receipt.inventoryItemIds[0]);
        const replay = await commitAcquisitionCards(db, actor, captured.id, request); assert(replay.replay); assert.equal(replay.id, receipt.id);
        assert.equal((await commitImportBatch(db, importingInput)).committedRows, 0);
        assert.deepEqual(await snapshot(), after, "both full-service replays preserve receipt/import/audit/stock state");
        console.log("PASS: complete acquisition-first CSV lock pair, unchanged capture receipt/photo/audit, separate import provenance/status and both effect-free replays");
      } catch (error) { errors.push(error); }
      finally {
        releaseWriter();
        for (const result of await Promise.allSettled(importing ? [capturing, importing] : [capturing])) if (result.status === "rejected" && !errors.includes(result.reason)) errors.push(result.reason);
        for (const result of await Promise.allSettled([captureDb.$disconnect(), importDb.$disconnect()])) if (result.status === "rejected") errors.push(result.reason);
      }
      if (errors.length) throw new AggregateError(errors, "Reverse complete CSV/acquisition verification failed", { cause: errors[0] });
    }
    // Compose both actual domain services, rather than treating a
    // capacity helper alone as proof of capture-versus-CSV admission.
    const csvLocation = await location(1), csvCapture = await capture(csvLocation, 1);
    await review(csvCapture.id, csvCapture.photos[0].id);
    await stop(csvCapture.id);
    const csvSelection = { photoIds: [csvCapture.photos[0].id], locationId: csvLocation, section: "A" };
    const csvPreview = await previewAcquisitionCommit(db, actor, csvCapture.id, csvSelection);
    const csvBatch = await db.importBatch.create({ data: {
      filename: tag, importType: "inventory_csv:separate", selectedPlayerId: base.ownerPlayerId,
      selectedOriginalOpenerId: base.ownerPlayerId, createdByUserId: actor.userId, status: "PREVIEW",
      items: { create: { rowNumber: 2, status: "matched", cardPrintingId: card.id,
        parsedCondition: "NM", parsedFoilStatus: "NONFOIL", rawRowJson: {},
        parsedRowJson: { quantity: 1, condition: "NM", language: "EN", notes: "CSV capacity race" } } },
    } });
    importBatches.push(csvBatch.id);
    let writerHeld!: () => void, releaseWriter!: () => void;
    const held = new Promise<void>(resolve => { writerHeld = resolve; });
    const release = new Promise<void>(resolve => { releaseWriter = resolve; });
    // Pause only after the real import's transaction body has written its stock,
    // audit and imported-row status, before that transaction commits.
    const heldImportDb = new Proxy(db, { get(target, property) {
      if (property === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
        Reflect.apply(target.$transaction, target, [async (tx: Prisma.TransactionClient) => {
          const result = await work(tx); writerHeld(); await release; return result;
        }, options]);
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    const label = `csv-capture-${randomUUID()}`, captureUrl = new URL(process.env.DATABASE_URL!);
    captureUrl.searchParams.set("application_name", label);
    const captureDb = new PrismaClient({ datasourceUrl: captureUrl.href });
    const importing = commitImportBatch(heldImportDb, { batchId: csvBatch.id, actingUserId: actor.userId,
      playerId: base.ownerPlayerId, isAdmin: false, destinationLocationId: csvLocation, destinationLocationSection: "A" });
    let capturing: Promise<unknown> | undefined;
    try {
      await Promise.race([held, importing.then(() => { throw new Error("Import finished before its controlled boundary"); })]);
      capturing = commitAcquisitionCards(captureDb, actor, csvCapture.id, { ...csvSelection,
        requestKey: randomUUID(), previewToken: csvPreview.token, overfillReason: null }).then(() => null, error => error);
      const deadline = Date.now() + 5000;
      let waiting = false;
      do {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${label} AND wait_event_type = 'Lock') AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await setTimeout(20);
      } while (!waiting && Date.now() < deadline);
      assert.ok(waiting, "actual acquisition commit must wait behind the actual CSV writer");
      releaseWriter();
      assert.equal((await importing).committedRows, 1);
      assert.match(String(await capturing), /preview changed/);
      const csvStock = await db.inventoryItem.findMany({ where: { locationId: csvLocation } });
      assert.equal(csvStock.length, 1); assert.equal(csvStock[0].quantity, 1);
      assert.equal(csvStock[0].sourceType, "CSV_PULL_IMPORT");
      assert.equal(await db.acquisitionCommit.count({ where: { run: { sessionId: csvCapture.id } } }), 0);
      assert.equal(await db.acquisitionCommitMember.count({ where: { candidate: { run: { sessionId: csvCapture.id } } } }), 0);
      assert.equal(await db.inventoryAuditLog.count({ where: { inventoryItem: { locationId: csvLocation } } }), 1);
      const fresh = await previewAcquisitionCommit(db, actor, csvCapture.id, csvSelection);
      assert.equal(fresh.destination.remaining, 0); assert.equal(fresh.overfill, 1);
      const confirmed = await commitAcquisitionCards(db, actor, csvCapture.id, { ...csvSelection,
        requestKey: randomUUID(), previewToken: fresh.token, overfillReason: "Checked one additional physical space after CSV import" });
      assert.equal(confirmed.count, 1);
      assert.equal((await db.inventoryItem.aggregate({ where: { locationId: csvLocation }, _sum: { quantity: true } }))._sum.quantity, 2);
      const confirmedAudit = await db.inventoryAuditLog.findFirstOrThrow({ where: { inventoryItemId: confirmed.inventoryItemIds[0] } });
      assert.equal((confirmedAudit.afterJson as { overfill: number }).overfill, 1);
      assert.equal(confirmedAudit.reason, "Checked one additional physical space after CSV import");
      console.log("PASS: actual CSV writer blocks acquisition commit, stale preview has zero partial receipt/audit effects, fresh explicit overfill is audited");
    } finally {
      releaseWriter();
      await Promise.allSettled(capturing ? [importing, capturing] : [importing]);
      await captureDb.$disconnect();
    }
    await verifyAcquisitionWriterCompositions(db, actor, base.ownerPlayerId, {
      cardId: card.id, location,
      capture: async destination => {
        const created = await capture(destination, 1);
        await review(created.id, created.photos[0].id);
        await stop(created.id);
        return { sessionId: created.id, photoId: created.photos[0].id };
      },
    });
    const retained = first.photos[0],
      bytes = retentionBytes,
      bytesDigest = photoDigest(bytes);
    await writeAcquisitionPhotoBytes(retained.id, bytes, "raw", bytesDigest);
    await writeAcquisitionPhotoBytes(
      retained.id,
      bytes,
      "preview",
      bytesDigest,
    );
    // An uncommitted capture with an accidentally populated expiry remains safe.
    const loser = race[0].status === "rejected" ? a : b;
    const pendingId = loser.photos[0].id;
    await writeAcquisitionPhotoBytes(pendingId, bytes, "raw", bytesDigest);
    // Unknown-display human saves are preserved by the correction library.
    // Finish that real byte copy before testing ordinary receipt expiry; no
    // production pin is disabled and all former cleanup assertions remain.
    const correction = await db.correctionBlob.findUniqueOrThrow({ where: {
      ownerPlayerId_digest: { ownerPlayerId: base.ownerPlayerId, digest: metadata.digest },
    } });
    await db.correctionCaptureOutbox.update({ where: { blobId: correction.id }, data: { availableAt: new Date(0) } });
    assert.equal((await runCorrectionCaptureOnce(db)).preserved, 1);
    assert.equal((await db.correctionBlob.findUniqueOrThrow({ where: { id: correction.id } })).state, "PRESERVED");
    const expiration = firstPhoto.purgeAfter!;
    await db.acquisitionPhoto.update({
      where: { id: pendingId },
      data: { purgeAfter: operation.createdAt },
    });
    assert.equal(
      (
        await purgeCommittedAcquisitionPhotos(
          db,
          new Date(expiration.getTime() - 1),
        )
      ).purged,
      0,
    );
    assert.deepEqual(
      await readAcquisitionPhotoBytes(retained.id, "raw", bytesDigest),
      bytes,
    );
    // Trash can begin after retention selected a committed photo. Recheck the
    // session under lock before unlink, preserving the full restore window.
    let racedTrash = false;
    const retentionRace = new Proxy(db, {get(target, property) {
      if (property === "$queryRaw") return async (...args: unknown[]) => {
        const rows = await Reflect.apply(target.$queryRaw, target, args) as {id: string}[];
        if (!racedTrash && rows.some(row => row.id === retained.id)) {
          await manageAcquisitionBatch(db, actor, first.id, "trash", expiration); racedTrash = true;
        }
        return rows;
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    }});
    await purgeCommittedAcquisitionPhotos(retentionRace, expiration);
    assert.ok(racedTrash);
    assert.deepEqual(await readAcquisitionPhotoBytes(retained.id, "raw", bytesDigest), bytes);
    await manageAcquisitionBatch(db, actor, first.id, "restore", expiration);
    const failureDb = db.$extends({
      query: {
        acquisitionPhoto: {
          async updateMany() {
            throw new Error("injected purge marking failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    assert.ok(
      (await purgeCommittedAcquisitionPhotos(failureDb, expiration)).failed >=
        1,
    );
    assert.equal(
      (
        await db.acquisitionPhoto.findUniqueOrThrow({
          where: { id: retained.id },
        })
      ).purgedAt,
      null,
    );
    assert.ok(
      (await purgeCommittedAcquisitionPhotos(db, expiration)).purged >= 2,
    );
    await assert.rejects(readAcquisitionPhotoBytes(retained.id, "raw"), {
      code: "ENOENT",
    });
    await assert.rejects(readAcquisitionPhotoBytes(retained.id, "preview"), {
      code: "ENOENT",
    });
    assert.deepEqual(
      await readAcquisitionPhotoBytes(pendingId, "raw", bytesDigest),
      bytes,
    );
    assert.equal(
      (
        await db.acquisitionPhoto.findUniqueOrThrow({
          where: { id: pendingId },
        })
      ).purgedAt,
      null,
    );
    assert.equal(
      (await purgeCommittedAcquisitionPhotos(db, expiration)).purged,
      0,
    );
    assert.equal(
      await db.acquisitionCommitMember.count({
        where: { commitId: receipt.id },
      }),
      2,
    );
    const retainedInventory = await db.inventoryItem.findMany({where: {cardId: card.id}, orderBy: {id: "asc"}});
    const retainedReceipts = await db.acquisitionCommit.findMany({where: {runId: {in: runs}}, orderBy: {id: "asc"}, include: {members: true}});
    await manageAcquisitionBatch(db, actor, first.id, "trash", expiration);
    await purgeTrashedAcquisitionPhotos(db, new Date(expiration.getTime() + 7 * 86400000));
    assert.deepEqual(await db.inventoryItem.findMany({where: {cardId: card.id}, orderBy: {id: "asc"}}), retainedInventory);
    assert.deepEqual(await db.acquisitionCommit.findMany({where: {runId: {in: runs}}, orderBy: {id: "asc"}, include: {members: true}}), retainedReceipts);
    console.log("PASS: Trash fences concurrent committed retention; expiry conserves Inventory and immutable acquisition receipts");
    // Strong-match confirmation is staged, editable and never a receipt.
    const auto = await capture(await location(10), 4);
    async function evidence(photoId: string, strong = true) {
      const canonical = await db.acquisitionProcessingJob.findFirstOrThrow({
        where: { artifact: { sourceId: photoId }, stage: "photo-canonical-v1" },
        include: { candidate: true },
      });
      return db.acquisitionProcessingJob.create({
        data: {
          runId: canonical.runId,
          artifactId: canonical.artifactId,
          candidateId: canonical.candidateId,
          candidateRevision: canonical.candidate.revision,
          stage: "photo-catalog-reconciliation-v1",
          versionKey: randomUUID(),
          status: "COMPLETE",
          input: canonical.input!,
          output: {
            catalog: { status: "RESOLVED", printingCoverage: "CHECKED" },
            proposals: proposeAcquisitionPrintings(
              createAcquisitionRecognitionIndex([card]),
              { title: [card.name], footer: strong ? ["C 1", "CFX EN"] : [] },
            ),
          },
        },
      });
    }
    for (let i = 0; i < 4; i++) await evidence(auto.photos[i].id, i !== 3);
    assert.equal(
      await confirmStrongAcquisitionMatches(db),
      0,
      "unknown defaults never invented",
    );
    await saveAcquisitionReview(db, actor, auto.id, {
      action: "defaults",
      revision: 0,
      defaults: { finish: "FOIL", condition: "NM" },
    });
    assert.equal(
      await confirmStrongAcquisitionMatches(db),
      0,
      "unsupported batch finish requires review",
    );
    // Human pending before the worker must persist even through reprocessing.
    let pending = await getAcquisitionCardReview(
      db,
      actor,
      auto.id,
      auto.photos[1].id,
    );
    await saveAcquisitionReview(db, actor, auto.id, {
      action: "pending",
      photoId: pending.photoId,
      revision: pending.revision,
    });
    await evidence(pending.photoId);
    // A started retake invalidates completed output for the former generation.
    await beginAcquisitionPhoto(db, actor, auto.id, {
      slotId: auto.photos[2].slotId,
      uploadKey: randomUUID(),
      generation: 1,
      metadata,
    });
    await saveAcquisitionReview(db, actor, auto.id, {
      action: "defaults",
      revision: 1,
      defaults: { finish: "NONFOIL", condition: "NM" },
    });
    // Old OCR evidence predates the stamped-reprint ambiguity guard. It must
    // not be auto-confirmed later merely because defaults became available.
    const legacy = await db.acquisitionProcessingJob.findFirstOrThrow({
      where: {
        artifact: { sourceId: auto.photos[0].id },
        stage: "photo-catalog-reconciliation-v1",
      },
    });
    const currentEvidence = legacy.output as { proposals: { version: number } };
    await db.acquisitionProcessingJob.update({
      where: { id: legacy.id },
      data: {
        output: {
          ...currentEvidence,
          proposals: { ...currentEvidence.proposals, version: 3 },
        },
      },
    });
    assert.equal(
      await confirmStrongAcquisitionMatches(db),
      0,
      "legacy OCR evidence cannot auto-confirm",
    );
    await db.acquisitionProcessingJob.update({
      where: { id: legacy.id },
      data: { output: currentEvidence },
    });
    // Selection is only a snapshot: newer work arriving before the session
    // lock must keep the older match pending, without consuming its command.
    for (const status of ["PENDING", "FAILED", "COMPLETE"] as const) {
      const beforeCandidate = await db.acquisitionCandidate.findUniqueOrThrow({ where: { id: legacy.candidateId } });
      const beforeSession = await db.acquisitionSession.findUniqueOrThrow({ where: { id: auto.id } });
      const commands = await db.acquisitionCommand.findMany({ where: { runId: legacy.runId }, orderBy: { id: "asc" } });
      const events = await db.correctionReviewEvent.findMany({ where: { sourceCandidateId: legacy.candidateId }, orderBy: { id: "asc" } });
      const failures: unknown[] = [];
      let newerId: string | undefined, selected = false;
      const boundary = new Proxy(db, { get(target, property) {
        if (property === "$transaction") return async (callback: any, ...rest: any[]) => {
          if (!selected) {
            selected = true;
            const newer = await target.acquisitionProcessingJob.create({ data: {
              runId: legacy.runId, artifactId: legacy.artifactId, candidateId: legacy.candidateId,
              candidateRevision: legacy.candidateRevision, stage: "photo-recognition-v1",
              versionKey: randomUUID(), status, input: legacy.input!,
              createdAt: new Date(legacy.createdAt.getTime() + 1),
            } });
            newerId = newer.id;
          }
          return Reflect.apply(target.$transaction, target, [callback, ...rest]);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      try {
        assert.equal(await confirmStrongAcquisitionMatches(boundary), 0,
          "newer " + status + " analysis admitted after selection must fence an older automatic review");
        assert(selected, "the actual SQL selection reached the controlled transaction boundary");
        assert.deepEqual(await db.acquisitionCandidate.findUniqueOrThrow({ where: { id: legacy.candidateId } }), beforeCandidate);
        assert.deepEqual(await db.acquisitionSession.findUniqueOrThrow({ where: { id: auto.id } }), beforeSession);
        assert.deepEqual(await db.acquisitionCommand.findMany({ where: { runId: legacy.runId }, orderBy: { id: "asc" } }), commands);
        assert.deepEqual(await db.correctionReviewEvent.findMany({ where: { sourceCandidateId: legacy.candidateId }, orderBy: { id: "asc" } }), events);
      } catch (error) { failures.push(error); } finally {
        try { if (newerId) await db.acquisitionProcessingJob.deleteMany({ where: { id: newerId } }); }
        catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Freshness verification and cleanup failed", { cause: failures[0] });
    }
    console.log("PASS: newer analysis at the real SQL selection boundary preserves pending review, command and correction authority");
    const fault = db.$extends({
      query: {
        acquisitionCandidate: {
          async update() {
            throw new Error("injected automatic review failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    await assert.rejects(confirmStrongAcquisitionMatches(fault), /injected/);
    assert.equal(
      (await getAcquisitionCardReview(db, actor, auto.id, auto.photos[0].id))
        .review,
      null,
    );
    assert.equal(
      (
        await Promise.all([
          confirmStrongAcquisitionMatches(db),
          confirmStrongAcquisitionMatches(db),
        ])
      ).reduce((a, b) => a + b, 0),
      1,
    );
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    const confirmed = await getAcquisitionCardReview(
      db,
      actor,
      auto.id,
      auto.photos[0].id,
    );
    assert.equal(confirmed.review?.source, "AUTO_STRONG_MATCH");
    assert.equal(confirmed.review?.condition, "NM");
    assert.equal(
      (await getAcquisitionCardReview(db, actor, auto.id, auto.photos[3].id))
        .review,
      null,
      "name-only stays pending",
    );
    assert.equal(
      (await getAcquisitionCardReview(db, actor, auto.id, auto.photos[1].id))
        .review,
      null,
      "human pending survives",
    );
    await stop(auto.id);
    const chosen = {
      photoIds: [auto.photos[0].id],
      locationId: (await getAcquisitionProgress(db, actor, auto.id)).session
        .placement.locationId,
      section: base.section,
    };
    const oldPreview = await previewAcquisitionCommit(
      db,
      actor,
      auto.id,
      chosen,
    );
    await saveAcquisitionReview(db, actor, auto.id, {
      action: "accept",
      photoId: confirmed.photoId,
      revision: confirmed.revision,
      decision: { ...decision, condition: "LP" },
    });
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    assert.equal(
      (await getAcquisitionCardReview(db, actor, auto.id, confirmed.photoId))
        .review?.condition,
      "LP",
    );
    await assert.rejects(
      commitAcquisitionCards(db, actor, auto.id, {
        ...chosen,
        requestKey: randomUUID(),
        previewToken: oldPreview.token,
        overfillReason: null,
      }),
      /changed|preview/i,
    );
    const fresh = await previewAcquisitionCommit(db, actor, auto.id, chosen);
    const added = await commitAcquisitionCards(db, actor, auto.id, {
      ...chosen,
      requestKey: randomUUID(),
      previewToken: fresh.token,
      overfillReason: null,
    });
    assert.equal(added.count, 1);
    assert.equal(
      (
        await db.inventoryItem.findUniqueOrThrow({
          where: { id: added.inventoryItemIds[0] },
        })
      ).condition,
      "LP",
    );
    assert.equal(await confirmStrongAcquisitionMatches(db), 0);
    console.log(
      "PASS: strong-match defaults, finish compatibility, atomic rollback, concurrent retry, pending/retake fences, editable confirmation and corrected explicit receipt",
    );
    await verifyAcquisitionLanguage(db,actor,stranger,card,async count=>capture(await location(20),count),id=>extraCards.push(id));
    console.log(
      "PASS: explicit scan subset commit, atomic receipt/audit/membership rollback, retry replay, immutable membership, fresh capacity/overfill, competing sessions and seven-day expiry, exact private-file removal and crash-safe purge retry",
    );
  } finally {
    await db.importBatchItem.deleteMany({ where: { importBatchId: { in: importBatches } } });
    await db.importBatch.deleteMany({ where: { id: { in: importBatches } } });
    await db.inventoryAuditLog.deleteMany({ where: { changeType: "import_committed", inventoryItem: { cardId: card.id } } });
    await db.acquisitionCommitMember.deleteMany({
      where: { runId: { in: runs } },
    });
    await db.acquisitionCommit.deleteMany({ where: { runId: { in: runs } } });
    await db.inventoryAuditLog.deleteMany({
      where: {
        changedByUserId: actor.userId,
        changeType: "acquisition_committed",
      },
    });
    await db.inventoryItem.deleteMany({ where: { cardId: {in:[card.id,...extraCards]} } });
    await db.inventoryLocation.deleteMany({ where: { id: { in: locations } } });
    await db.card.deleteMany({ where: { id: {in:[card.id,...extraCards]} } });
    if (oldRoot === undefined) delete process.env.UPLOADS_DATA_PATH;
    else process.env.UPLOADS_DATA_PATH = oldRoot;
    if (
      !root.startsWith(parent + path.sep) ||
      !path.basename(root).startsWith("acq-commit-db-")
    )
      throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
}
