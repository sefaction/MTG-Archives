import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedBulkCleanup, seedBulkScans } from "./verify-bulk-cleanup";
import { getBulkContext } from "../lib/bulk-cleanup-service";
import {
  performBulkAction,
  saveBulkSettings,
} from "../lib/bulk-cleanup-actions";
import { changeBulkLocation } from "../lib/bulk-locations";
import {
  previewConfirmedAcquisitionCommit,
  commitAcquisitionCards,
} from "../lib/acquisition-commit-service";
import type { BulkActionInput, BulkContext } from "../lib/bulk-cleanup-policy";

const picked = (context: BulkContext) =>
  context.plan!.items.map((row) => ({
    id: row.id,
    quantity: row.quantity,
    group: row.group,
    groupStamp: row.groupStamp,
    stamp: row.stamp,
  }));
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.MTG_MARKED_PULLS_TEST !== "1" ||
    url.hostname !== "marked-pulls-db" ||
    url.pathname !== "/marked_pulls_fixture"
  )
    throw Error("Use the isolated marked-pulls fixture database.");
  const db = new PrismaClient();
  try {
    const f = await seedBulkCleanup(db, `marked-${randomUUID().slice(0, 8)}`);
    await saveBulkSettings(db, f.owner, {
      action: "SETTINGS",
      enabled: true,
      maxCopies: 4,
      includeDecks: false,
      revision: 0,
    });
    const destination = await changeBulkLocation(db, f.owner, {
      action: "CREATE",
      name: "Bulk-0001",
      capacity: 1000,
    });
    const scans = await seedBulkScans(db, f, 5);
    // The ordinary receipt path must retain original opener facts too.
    await db.acquisitionCandidate.update({
      where: { id: scans.photos[2].candidate.id },
      data: {
        review: {
          ...(scans.photos[2].candidate.review as object),
          openerPlayerId: f.recipient,
        },
      },
    });
    const original = await db.acquisitionPhoto.findMany({
      where: { runId: scans.run.id },
      select: {
        id: true,
        slotId: true,
        generation: true,
        digest: true,
        bytes: true,
      },
      orderBy: { id: "asc" },
    });
    const reviews = await db.acquisitionCandidate.findMany({
      where: { runId: scans.run.id },
      select: { id: true, review: true, countConfirmed: true, revision: true },
      orderBy: { id: "asc" },
    });
    const batchBefore = await db.acquisitionSession.findUniqueOrThrow({
      where: { id: scans.id },
    });
    const initial = await getBulkContext(db, f.owner, { batchId: scans.id });
    assert.equal(initial.plan!.totalCopies, 3);
    assert(initial.destinations!.some((box) => box.id === destination.id));
    assert.deepEqual(
      initial.plan!.items.map((row) => row.position),
      [3, 4, 5],
    );
    const request: Extract<BulkActionInput, { action: "MOVE_SCANS" }> = {
      action: "MOVE_SCANS",
      requestId: randomUUID(),
      policyStamp: initial.settings.stamp,
      batchId: scans.id,
      destinationId: destination.id,
      selected: picked(initial).slice(0, 2),
    };
    const committed = await performBulkAction(db, f.owner, request);
    assert.equal(committed.status, "APPLIED");
    assert.equal(committed.quantity, 2);
    assert(committed.acquisitionCommitId);
    const repeat = await performBulkAction(db, f.owner, request);
    assert(repeat.replay);
    assert.equal(repeat.acquisitionCommitId, committed.acquisitionCommitId);
    assert.equal(
      await db.acquisitionCommit.count({ where: { runId: scans.run.id } }),
      1,
    );
    const members = await db.acquisitionCommitMember.findMany({
      where: { runId: scans.run.id },
    });
    assert.equal(members.length, 2);
    const bulkItems = await db.inventoryItem.findMany({
      where: { locationId: destination.id },
    });
    assert.equal(
      bulkItems.reduce((n, row) => n + row.quantity, 0),
      2,
    );
    assert(
      bulkItems.every(
        (row) =>
          row.cardId === f.alternate.id &&
          row.currentOwnerId === f.owner &&
          row.sourceType === "ACQUISITION" &&
          row.foilStatus === "NONFOIL" &&
          row.language === "EN",
      ),
    );
    assert.equal(
      bulkItems
        .filter((row) => row.originalOpenerId === f.recipient)
        .reduce((n, row) => n + row.quantity, 0),
      1,
    );
    assert.deepEqual(
      await db.acquisitionPhoto.findMany({
        where: { runId: scans.run.id },
        select: {
          id: true,
          slotId: true,
          generation: true,
          digest: true,
          bytes: true,
        },
        orderBy: { id: "asc" },
      }),
      original,
    );
    assert.deepEqual(
      await db.acquisitionCandidate.findMany({
        where: { runId: scans.run.id },
        select: {
          id: true,
          review: true,
          countConfirmed: true,
          revision: true,
        },
        orderBy: { id: "asc" },
      }),
      reviews,
    );
    assert.equal(
      await db.acquisitionCandidate.count({
        where: { runId: scans.run.id, ignored: true },
      }),
      0,
    );
    const batchAfter = await db.acquisitionSession.findUniqueOrThrow({
      where: { id: scans.id },
    });
    assert.equal(batchAfter.locationId, batchBefore.locationId);
    assert.equal(batchAfter.section, batchBefore.section);
    assert.equal(batchAfter.revision, batchBefore.revision + 1);
    assert.equal(
      (await getBulkContext(db, f.owner, { batchId: scans.id })).plan!
        .totalCopies,
      1,
    );
    const stale = await performBulkAction(db, f.owner, {
      ...request,
      requestId: randomUUID(),
    });
    assert.equal(stale.status, "REJECTED");
    // The standard add-confirmed operation skips diverted scans through the
    // same independent physical candidate membership fence.
    const normal = await previewConfirmedAcquisitionCommit(
      db,
      { userId: f.owner, adminMode: false },
      scans.id,
      { locationId: f.box.id, section: "0", excludedPhotoIds: [] },
    );
    assert.equal(normal.count, 3);
    const normalReceipt = await commitAcquisitionCards(
      db,
      { userId: f.owner, adminMode: false },
      scans.id,
      {
        photoIds: normal.cards.map((row) => row.photoId),
        locationId: f.box.id,
        section: "0",
        requestKey: randomUUID(),
        previewToken: normal.token,
        overfillReason: null,
      },
    );
    assert.equal(normalReceipt.count, 3);
    assert.equal(
      await db.acquisitionCommitMember.count({
        where: { runId: scans.run.id },
      }),
      5,
    );
    assert.equal(
      (
        await db.inventoryItem.aggregate({
          where: {
            locationId: { in: [f.box.id, destination.id] },
            cardId: f.alternate.id,
          },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      5,
    );

    const f2 = await seedBulkCleanup(
      db,
      `capacity-${randomUUID().slice(0, 8)}`,
    );
    await saveBulkSettings(db, f2.owner, {
      action: "SETTINGS",
      enabled: true,
      maxCopies: 0,
      includeDecks: false,
      revision: 0,
    });
    const parent = await changeBulkLocation(db, f2.owner, {
      action: "CREATE",
      name: "Bulk parent",
      capacity: 1000,
    });
    const child = await db.inventoryLocation.create({
      data: {
        ownerPlayerId: f2.owner,
        parentLocationId: parent.id,
        name: "Section box",
        normalizedName: "section box",
        storageLayout: {
          capacity: 2,
          sections: [
            { name: "A", capacity: 1 },
            { name: "B", capacity: 1 },
          ],
        },
      },
    });
    const a = await seedBulkScans(db, f2, 1),
      b = await seedBulkScans(db, f2, 1);
    await db.acquisitionCandidate.update({
      where: { id: b.photos[0].candidate.id },
      data: {
        review: {
          cardId: f2.card.id,
          finish: "NONFOIL",
          language: "EN",
          condition: "NM",
          actorId: f2.owner,
        },
      },
    });
    const ca = await getBulkContext(db, f2.owner, { batchId: a.id }),
      cb = await getBulkContext(db, f2.owner, { batchId: b.id });
    const move = (
      context: BulkContext,
      batchId: string,
    ): Extract<BulkActionInput, { action: "MOVE_SCANS" }> => ({
      action: "MOVE_SCANS",
      requestId: randomUUID(),
      policyStamp: context.settings.stamp,
      batchId,
      destinationId: child.id,
      destinationSection: "A",
      selected: picked(context),
    });
    const outcomes = await Promise.all([
      performBulkAction(db, f2.owner, move(ca, a.id)),
      performBulkAction(db, f2.owner, move(cb, b.id)),
    ]);
    assert.equal(outcomes.filter((row) => row.status === "APPLIED").length, 1);
    assert.equal(
      (
        await db.inventoryItem.aggregate({
          where: { locationId: child.id, locationSection: "A" },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      1,
    );
    const remaining = outcomes[0].status === "REJECTED" ? a : b;
    const fresh = await getBulkContext(db, f2.owner, { batchId: remaining.id });
    const badSection = await performBulkAction(db, f2.owner, {
      ...move(fresh, remaining.id),
      destinationSection: "not-a-section",
    });
    assert.equal(badSection.status, "REJECTED");
    await assert.rejects(
      () =>
        performBulkAction(db, f2.owner, {
          ...move(fresh, remaining.id),
          destinationId: destination.id,
        }),
      /own bulk storage/,
    );
    const crossBatch = await performBulkAction(db, f2.owner, {
      ...move(fresh, remaining.id),
      batchId: remaining.id === a.id ? b.id : a.id,
    });
    assert.equal(crossBatch.status, "REJECTED");
    const ordinary = await performBulkAction(db, f2.owner, {
      ...move(fresh, remaining.id),
      destinationId: f2.box.id,
    });
    assert.equal(ordinary.status, "REJECTED");
    const changedReview = {
      cardId: f2.alternate.id,
      finish: "NONFOIL",
      language: "EN",
      condition: "LP",
      actorId: f2.owner,
    };
    await db.acquisitionCandidate.update({
      where: { id: remaining.photos[0].candidate.id },
      data: { review: changedReview, revision: { increment: 1 } },
    });
    assert.equal(
      (await performBulkAction(db, f2.owner, move(fresh, remaining.id))).status,
      "REJECTED",
    );
    const latest = await getBulkContext(db, f2.owner, {
      batchId: remaining.id,
    });
    const atomic = { ...move(latest, remaining.id), destinationSection: "B" };
    await db.$executeRawUnsafe(
      `CREATE FUNCTION marked_bulk_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId"='${atomic.requestId}' THEN RAISE EXCEPTION 'controlled receipt failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER marked_bulk_abort BEFORE INSERT ON "BulkCleanupAction" FOR EACH ROW EXECUTE FUNCTION marked_bulk_abort()',
    );
    try {
      await assert.rejects(() => performBulkAction(db, f2.owner, atomic));
      assert.equal(
        await db.acquisitionCommitMember.count({
          where: { runId: remaining.run.id },
        }),
        0,
      );
      assert.equal(
        await db.inventoryItem.count({
          where: { locationId: child.id, locationSection: "B" },
        }),
        0,
      );
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER marked_bulk_abort ON "BulkCleanupAction"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION marked_bulk_abort()");
    }
    assert.equal(
      (await performBulkAction(db, f2.owner, atomic)).status,
      "APPLIED",
    );
    assert.equal((await performBulkAction(db, f2.owner, atomic)).replay, true);

    // Global marked rows are returned even when absent from the visible page.
    const stock = await getBulkContext(db, f2.owner);
    const pin = stock.plan!.items[0];
    assert(pin);
    const scope = { held: [{ id: pin.id, quantity: 1, stamp: pin.stamp }] };
    const hidden = await getBulkContext(db, f2.owner, {
      scope,
      browse: {
        search: "no-card-has-this-name",
        sort: "name",
        desc: false,
        locationId: "",
        pageSize: 25,
      },
    });
    assert.equal(hidden.plan!.items.length, 0);
    assert.equal(hidden.marked!.length, 1);
    assert.equal(hidden.marked![0].pulledQuantity, 1);
    const partialScope = {
      held: [{ id: pin.id, quantity: 2, stamp: pin.stamp }],
    };
    const marked = await getBulkContext(db, f2.owner, { scope: partialScope });
    const lot = marked.marked!.find((row) => row.id === pin.id)!;
    const partial = await performBulkAction(db, f2.owner, {
      action: "MOVE",
      requestId: randomUUID(),
      policyStamp: marked.settings.stamp,
      scope: partialScope,
      destinationId: parent.id,
      selected: [
        {
          id: lot.id,
          quantity: 1,
          group: lot.group,
          groupStamp: lot.groupStamp,
          stamp: lot.stamp,
        },
      ],
    });
    assert.equal(partial.status, "APPLIED");
    const update = partial.stockUpdates!.find((row) => row.id === lot.id)!;
    const next = await getBulkContext(db, f2.owner, {
      scope: { held: [{ id: lot.id, quantity: 1, stamp: update.stamp }] },
    });
    assert.equal(next.marked![0].pulledQuantity, 1);
    console.log(
      "PASS marked pulls/scan bulk: global marked quantities; partial marks after moves; current-batch receipt import; ordinary confirmed import skips saved scans; opener/printing/finish/language/review/original/count conservation; replay/stale/foreign/section gates; concurrent capacity; all-or-nothing receipt failure/retry.",
    );
  } finally {
    await db.$disconnect();
  }
}
if (process.argv.includes("--run"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
