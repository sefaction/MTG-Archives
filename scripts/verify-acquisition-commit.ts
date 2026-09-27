import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { purgeCommittedAcquisitionPhotos } from "../lib/acquisition-photo-retention";
import {
  writeAcquisitionPhotoBytes,
  readAcquisitionPhotoBytes,
  photoDigest,
} from "../lib/acquisition-files";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import {
  createAcquisitionSession,
  executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto,
  finalizeAcquisitionPhoto,
  saveAcquisitionReview,
  getAcquisitionCardReview,
  getAcquisitionProgress,
  reviewAcquisitionCandidate,
  type AcquisitionActor,
  type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import {
  commitAcquisitionCards,
  previewAcquisitionCommit,
} from "../lib/acquisition-commit-service";
import { candidateKey } from "../lib/acquisition-domain";

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
    locations: string[] = [];
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
  const metadata = {
    digest: "a".repeat(64),
    bytes: 100,
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
    for (const table of [
      "InventoryAuditLog",
      "AcquisitionCommitMember",
    ] as const) {
      const fault = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, args, query }) {
              if (model === table) throw new Error("injected commit failure");
              return query(args);
            },
          },
        },
      }) as unknown as PrismaClient;
      await assert.rejects(
        commitAcquisitionCards(fault, actor, first.id, request),
        /injected/,
      );
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
    const retained = first.photos[0],
      bytes = Buffer.from("owned retention fixture"),
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
    console.log(
      "PASS: explicit scan subset commit, atomic receipt/audit/membership rollback, retry replay, immutable membership, fresh capacity/overfill, competing sessions and seven-day expiry, exact private-file removal and crash-safe purge retry",
    );
  } finally {
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
    await db.inventoryItem.deleteMany({ where: { cardId: card.id } });
    await db.inventoryLocation.deleteMany({ where: { id: { in: locations } } });
    await db.card.delete({ where: { id: card.id } });
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
