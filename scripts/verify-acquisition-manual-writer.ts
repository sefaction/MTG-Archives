import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { addInventoryCardToLocation } from "../lib/inventory-manual";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import {
  beginAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  finalizeAcquisitionPhoto, getAcquisitionCardReview, getAcquisitionProgress,
  reserveAcquisitionCaptureSlot, saveAcquisitionReview,
  type AcquisitionActor, type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import { commitAcquisitionCards, previewAcquisitionCommit } from "../lib/acquisition-commit-service";

// Full row content, including future columns; no volatile-table exclusions.
async function fingerprints(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const result: Record<string, { count: number; hash: string }> = {};
  for (const { tablename } of tables) {
    const table = Prisma.raw(`public."${tablename.replaceAll('"', '""')}"`);
    const [row] = await db.$queryRaw<{ count: number; hash: string }[]>(Prisma.sql`
      SELECT count(*)::int AS count,
        md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS hash
      FROM ${table} t`);
    result[tablename] = row;
  }
  return result;
}

/** One writer-first schedule using the actual manual domain writer and complete
 * acquisition service. Authentication/browser and other writer orders are separate. */
export async function verifyAcquisitionManualWriter(
  db: PrismaClient, parentInput: CreateAcquisitionInput,
) {
  const before = await fingerprints(db);
  const id = randomUUID();
  const cardId = `manual-capture-card-${id}`, locationId = `manual-capture-location-${id}`;
  const ownerPlayerId = `manual-capture-owner-${id}`, userId = `manual-capture-user-${id}`;
  const actor: AcquisitionActor = { userId, adminMode: false };
  const base = { ...parentInput, ownerPlayerId };
  let sessionId: string | undefined, runId: string | undefined;
  const failures: unknown[] = [];
  try {
    await db.player.create({ data: { id: ownerPlayerId, name: ownerPlayerId, displayName: ownerPlayerId } });
    await db.user.create({ data: {
      id: userId, username: userId, displayName: userId, playerId: ownerPlayerId,
      role: "PLAYER", passwordHash: "not-a-login-hash",
    } });
    await db.$transaction(tx => ensureCorrectionAccount(tx, ownerPlayerId));
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: { sampleBasisPoints: 0 } });
    await db.card.create({ data: {
      id: cardId, scryfallId: randomUUID(), name: `Manual capture ${id}`,
      setCode: "mfx", collectorNumber: "1", typeLine: "Creature", rarity: "common",
      lang: "en", digital: false, finishes: ["nonfoil"],
    } });
    await db.inventoryLocation.create({ data: {
      id: locationId, ownerPlayerId: base.ownerPlayerId, name: id, normalizedName: id,
      type: "Box", storageLayout: { capacity: 1, sections: [{ name: "A", capacity: 1 }] },
    } });
    const created = await createAcquisitionSession(db, actor, {
      ...base, requestKey: randomUUID(), locationId, section: "A",
      policy: { kind: "MANUAL", quantity: 1 }, run: { ...base.run, providerId: "phone-photo-v1" },
    });
    sessionId = created.session.id;
    runId = (await db.acquisitionRun.findUniqueOrThrow({ where: { sessionId } })).id;
    await executeAcquisitionCommand(db, actor, sessionId, {
      requestKey: randomUUID(), revision: 0, command: "START",
    });
    const { slot } = await reserveAcquisitionCaptureSlot(db, actor, sessionId, randomUUID());
    // Same metadata-only saved-photo fixture as the existing commit verifier.
    // This does not claim upload, original-byte or recognition acceptance.
    const photo = await beginAcquisitionPhoto(db, actor, sessionId, {
      slotId: slot.id, uploadKey: randomUUID(), generation: 0,
      metadata: { digest: "a".repeat(64), bytes: 10, mediaType: "image/jpeg", width: 10, height: 10 },
    });
    await finalizeAcquisitionPhoto(db, actor, sessionId, photo.id);
    const review = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
    await saveAcquisitionReview(db, actor, sessionId, {
      photoId: photo.id, revision: review.revision, action: "accept",
      decision: { cardId, language: "en", finish: "NONFOIL", condition: "NM" },
    });
    const progress = await getAcquisitionProgress(db, actor, sessionId);
    await executeAcquisitionCommand(db, actor, sessionId, {
      requestKey: randomUUID(), revision: progress.revision, command: "STOP",
    });
    const selection = { locationId, section: "A", photoIds: [photo.id] };
    const preview = await previewAcquisitionCommit(db, actor, sessionId, selection);
    assert.equal(preview.destination.remaining, 1);
    assert.equal(preview.overfill, 0);
    const protectedRows = await fingerprints(db);

    let signalHeld!: () => void, releaseWriter!: () => void;
    const held = new Promise<void>(resolve => { signalHeld = resolve; });
    const release = new Promise<void>(resolve => { releaseWriter = resolve; });
    const writerLabel = `manual-${id}`, captureLabel = `capture-${id}`;
    const connection = (label: string) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set("application_name", label);
      return new PrismaClient({ datasourceUrl: url.href });
    };
    const writerDb = connection(writerLabel), captureDb = connection(captureLabel);
    // Same default transaction and writer as addSingleCardToInventory. Only the
    // post-write/pre-commit observation boundary is held; no SQL/result is replaced.
    const writing = writerDb.$transaction(async tx => {
      const result = await addInventoryCardToLocation(tx, {
        ownerPlayerId: base.ownerPlayerId, cardId, locationId, locationSection: "A",
        quantity: 1, foilStatus: "NONFOIL", condition: "NM", language: "EN",
        notes: "Manual writer conservation", actingUserId: actor.userId,
        reason: "Manual single-card inventory add.",
      });
      signalHeld();
      await release;
      return result;
    });
    // Attach a rejection observer immediately; failures still propagate below.
    void writing.catch(() => {});
    let capturing: Promise<unknown> | undefined;
    try {
      await Promise.race([
        held,
        writing.then(() => { throw new Error("Manual writer left the held boundary early"); }),
        setTimeout(5000, undefined, { ref: false }).then(() => { throw new Error("Manual writer boundary was not reached"); }),
      ]);
      // Prove these two exact backends block each other, rather than accepting
      // an unrelated Lock wait on a similarly timed connection.
      const [{ pid: writerPid }] = await db.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity WHERE application_name = ${writerLabel} AND state = 'idle in transaction'`;
      assert.ok(writerPid);
      capturing = commitAcquisitionCards(captureDb, actor, sessionId, {
        ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null,
      }).then(() => null, error => error);
      const deadline = Date.now() + 5000;
      let waiting = false;
      do {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE application_name = ${captureLabel} AND wait_event_type = 'Lock'
              AND ${writerPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
        waiting = row.waiting;
        if (!waiting) await setTimeout(20);
      } while (!waiting && Date.now() < deadline);
      assert.ok(waiting, "complete acquisition commit must be blocked by this manual writer PID");
      releaseWriter();
      const manual = await writing;
      assert.match(String(await capturing), /preview changed/);
      const afterStale = await fingerprints(db);
      for (const table of Object.keys(protectedRows)) {
        if (!["InventoryItem", "InventoryAuditLog", "InventoryLocation"].includes(table))
          assert.deepEqual(afterStale[table], protectedRows[table], `stale commit changed ${table}`);
      }
      const manualRow = await db.inventoryItem.findUniqueOrThrow({ where: { id: manual.inventory.id } });
      const manualAudit = await db.inventoryAuditLog.findMany({ where: { inventoryItemId: manualRow.id } });
      assert.equal(manualAudit.length, 1);
      assert.equal(manualAudit[0].changeType, "inventory_added");
      assert.equal(manualAudit[0].changedByUserId, actor.userId);
      assert.equal(manualRow.quantity, 1);
      assert.equal(manualRow.sourceType, "MANUAL");
      assert.equal(manualRow.originalOpenerId, base.ownerPlayerId);
      assert.equal(manualRow.notes, "Manual writer conservation");
      assert.equal(await db.inventoryItem.count({ where: { locationId } }), 1);
      assert.equal(await db.inventoryAuditLog.count({ where: { inventoryItem: { locationId } } }), 1);

      const fresh = await previewAcquisitionCommit(db, actor, sessionId, selection);
      assert.notEqual(fresh.token, preview.token);
      assert.equal(fresh.destination.remaining, 0);
      assert.equal(fresh.overfill, 1);
      const beforeRefusal = await fingerprints(db);
      await assert.rejects(commitAcquisitionCards(db, actor, sessionId, {
        ...selection, requestKey: randomUUID(), previewToken: fresh.token, overfillReason: null,
      }), /confirm overfill with a reason/);
      assert.deepEqual(await fingerprints(db), beforeRefusal);
      const request = { ...selection, requestKey: randomUUID(), previewToken: fresh.token,
        overfillReason: "Checked one extra physical space after the manual addition" };
      const receipt = await commitAcquisitionCards(db, actor, sessionId, request);
      assert.equal(receipt.count, 1);
      assert.equal(receipt.replay, false);
      assert.equal(receipt.inventoryItemIds.length, 1);
      const added = await db.inventoryItem.findUniqueOrThrow({ where: { id: receipt.inventoryItemIds[0] } });
      assert.notEqual(added.id, manualRow.id);
      assert.equal(added.quantity, 1);
      assert.equal(added.sourceType, "ACQUISITION");
      assert.equal(added.originalOpenerId, null);
      for (const row of [manualRow, added]) {
        assert.equal(row.currentOwnerId, base.ownerPlayerId);
        assert.equal(row.cardId, cardId);
        assert.equal(row.locationId, locationId);
        assert.equal(row.locationSection, "A");
        assert.equal(row.foilStatus, "NONFOIL");
        assert.equal(row.condition, "NM");
        assert.equal(row.language.toLowerCase(), "en");
      }
      const audit = await db.inventoryAuditLog.findMany({ where: { inventoryItemId: added.id } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].changeType, "acquisition_committed");
      assert.equal(audit[0].reason, request.overfillReason);
      assert.equal((audit[0].afterJson as { overfill: number }).overfill, 1);
      assert.equal(await db.acquisitionCommit.count({ where: { runId } }), 1);
      const members = await db.acquisitionCommitMember.findMany({ where: { runId } });
      assert.equal(members.length, 1);
      assert.equal(members[0].commitId, receipt.id);
      assert.equal(members[0].inventoryItemId, added.id);
      assert.equal(await db.inventoryItem.count({ where: { locationId } }), 2);
      assert.equal((await db.inventoryItem.aggregate({ where: { locationId }, _sum: { quantity: true } }))._sum.quantity, 2);
      assert.deepEqual(await db.inventoryItem.findUnique({ where: { id: manualRow.id } }), manualRow);
      assert.deepEqual(await db.inventoryAuditLog.findMany({ where: { inventoryItemId: manualRow.id } }), manualAudit);
      const beforeReplay = await fingerprints(db);
      const replay = await commitAcquisitionCards(db, actor, sessionId, request);
      assert.equal(replay.id, receipt.id);
      assert.equal(replay.replay, true);
      assert.deepEqual(await fingerprints(db), beforeReplay);
      console.log("PASS: exact manual-writer PID blocks complete acquisition; stale/unreasoned commits conserve rows, explicit overfill keeps both lots and audited replay is effect-free");
    } catch (error) { failures.push(error); } finally {
      releaseWriter();
      const settled = await Promise.allSettled(capturing ? [writing, capturing] : [writing]);
      for (const result of settled)
        if (result.status === "rejected" && !failures.includes(result.reason)) failures.push(result.reason);
      const disconnected = await Promise.allSettled([writerDb.$disconnect(), captureDb.$disconnect()]);
      for (const result of disconnected)
        if (result.status === "rejected") failures.push(result.reason);
    }
  } catch (error) { failures.push(error); }
  // Children and transactions are terminal before any exact-owned row cleanup.
  try {
    // Resolve by our exact session if setup was interrupted between its two reads.
    if (sessionId && !runId)
      runId = (await db.acquisitionRun.findUnique({ where: { sessionId } }))?.id;
    if (runId) {
      const where = { runId };
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
      await db.acquisitionRun.delete({ where: { id: runId } });
    }
    if (sessionId) await db.acquisitionSession.delete({ where: { id: sessionId } });
    await db.inventoryAuditLog.deleteMany({ where: { inventoryItem: { cardId } } });
    await db.inventoryItem.deleteMany({ where: { cardId } });
    await db.inventoryLocation.deleteMany({ where: { id: locationId } });
    await db.card.deleteMany({ where: { id: cardId } });
    const correctionOwner = { ownerPlayerId };
    await db.correctionRetentionPin.deleteMany({ where: correctionOwner });
    await db.correctionCaptureOutbox.deleteMany({ where: { blob: correctionOwner } });
    await db.correctionExample.deleteMany({ where: correctionOwner });
    await db.correctionReviewEvent.deleteMany({ where: correctionOwner });
    await db.correctionEvidence.deleteMany({ where: correctionOwner });
    await db.correctionLibraryAccess.deleteMany({ where: correctionOwner });
    await db.correctionBlob.deleteMany({ where: correctionOwner });
    await db.correctionDeletionTombstone.deleteMany({ where: correctionOwner });
    await db.correctionLibraryAccount.deleteMany({ where: correctionOwner });
    await db.user.deleteMany({ where: { id: userId } });
    await db.player.deleteMany({ where: { id: ownerPlayerId } });
    assert.deepEqual(await fingerprints(db), before, "manual-writer fixture must restore every public table's complete rows");
    console.log(`PASS: manual-writer fixture restores all ${Object.keys(before).length} public-table full-row fingerprints`);
  } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Manual-writer verification and cleanup failed", { cause: failures[0] });
}
