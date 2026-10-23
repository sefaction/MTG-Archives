import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PrismaClient, type Prisma } from "@prisma/client";
import { addInventoryCardToLocation } from "../lib/inventory-manual";
import { moveInventoryStorageBatch } from "../lib/inventory-storage-move";
import { returnCommittedInventoryFromDeck } from "../lib/deck-inventory";
import { updateLocation } from "../lib/inventory-locations";
import { commitAcquisitionCards, previewAcquisitionCommit } from "../lib/acquisition-commit-service";
import type { AcquisitionActor } from "../lib/acquisition-store";

function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(r => { resolve = r; }), resolve: () => resolve() };
}

// Only the observation point is adapted: the complete real transaction body
// writes normally, then waits before committing. Results and SQL are unchanged.
function holdTransaction(client: PrismaClient, beforeHold: (tx: Prisma.TransactionClient) => Promise<void>) {
  const held = deferred(), release = deferred();
  let reached = false;
  const proxy = new Proxy(client, { get(target, property) {
    if (property === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
      Reflect.apply(target.$transaction, target, [async (tx: Prisma.TransactionClient) => {
        const result = await work(tx);
        await beforeHold(tx);
        reached = true; held.resolve(); await release.promise;
        return result;
      }, options]);
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { proxy, held: held.promise, release: release.resolve, reached: () => reached };
}

async function waitForWriter(db: PrismaClient, waitingName: string, holdingName: string) {
  const deadline = Date.now() + 5000;
  do {
    const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity waiting
        JOIN pg_stat_activity holding ON holding.pid=ANY(pg_blocking_pids(waiting.pid))
        WHERE waiting.application_name=${waitingName} AND waiting.wait_event_type='Lock'
          AND holding.application_name=${holdingName}
      ) AS waiting`;
    if (row.waiting) return;
    await setTimeout(20);
  } while (Date.now() < deadline);
  throw new Error(`Expected the actual ${waitingName} transaction to wait for ${holdingName}`);
}

export async function verifyAcquisitionWriterCompositions(
  db: PrismaClient,
  actor: AcquisitionActor,
  ownerPlayerId: string,
  fixture: {
    cardId: string;
    location: (capacity: number) => Promise<string>;
    capture: (locationId: string) => Promise<{ sessionId: string; photoId: string }>;
  },
) {
  for (const kind of ["manual", "move", "deck", "layout"] as const) {
    for (const first of ["ordinary", "acquisition"] as const) {
      const tag = `writer-${randomUUID()}`;
      const destination = await fixture.location(2);
      const source = await fixture.location(2);
      const section = kind === "deck" ? null : "A";
      const ownedLocations = [destination, source];
      const inventoryIds = new Set<string>();
      const deckId = kind === "deck" ? tag : undefined;
      const holdingName = `${tag}-holding`, waitingName = `${tag}-waiting`;
      const client = (name: string) => {
        const url = new URL(process.env.DATABASE_URL!);
        url.searchParams.set("application_name", name);
        return new PrismaClient({ datasourceUrl: url.href });
      };
      const holdingDb = client(holdingName), waitingDb = client(waitingName);
      let activeFirst: Promise<unknown> | undefined, activeSecond: Promise<unknown> | undefined;
      let sessionId: string | undefined;
      async function ledger(p: Prisma.TransactionClient = db) {
        assert(sessionId, "ledger requires the exact owned capture");
        const rows = await p.inventoryItem.findMany({ where: { locationId: { in: ownedLocations } }, orderBy: { id: "asc" } });
        for (const row of rows) inventoryIds.add(row.id);
        return {
          stock: rows,
          audits: await p.inventoryAuditLog.findMany({ where: { inventoryItemId: { in: [...inventoryIds] } }, orderBy: { id: "asc" } }),
          receipts: await p.acquisitionCommit.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
          members: await p.acquisitionCommitMember.findMany({ where: { candidate: { run: { sessionId } } }, orderBy: { candidateId: "asc" } }),
          candidates: await p.acquisitionCandidate.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
          photos: await p.acquisitionPhoto.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
          jobs: await p.acquisitionProcessingJob.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
          locations: await p.inventoryLocation.findMany({ where: { id: { in: ownedLocations } }, orderBy: { id: "asc" } }),
          session: await p.acquisitionSession.findUniqueOrThrow({ where: { id: sessionId } }),
        };
      }
      let heldFirstLedger: Awaited<ReturnType<typeof ledger>> | undefined;
      const hold = holdTransaction(holdingDb, async tx => {
        heldFirstLedger = await ledger(tx);
      });
      const failures: unknown[] = [];
      try {
        const stock = { currentOwnerId: ownerPlayerId, originalOpenerId: null,
          cardId: fixture.cardId, foil: false, foilStatus: "NONFOIL" as const,
          condition: "LP", language: "EN", quantity: 1, sourceType: "MANUAL" as const,
          notes: `${tag}-resident`, locationId: destination, locationSection: section };
        const resident = await db.inventoryItem.create({ data: stock });
        inventoryIds.add(resident.id);
        let moving: Awaited<ReturnType<typeof db.inventoryItem.create>> | undefined;
        if (deckId) {
          await db.deck.create({ data: { id: deckId, ownerUserId: actor.userId, name: tag } });
          const deckLocation = await db.inventoryLocation.create({ data: {
            ownerPlayerId, name: `Deck: ${tag}`, normalizedName: `deck-${tag}`,
            kind: "DECK", systemManaged: true, deckId, type: "Deck",
          } });
          ownedLocations.push(deckLocation.id);
          moving = await db.inventoryItem.create({ data: { ...stock, condition: "NM",
            notes: `${tag}-source`, locationId: deckLocation.id, locationSection: null } });
        } else if (kind === "move") {
          moving = await db.inventoryItem.create({ data: { ...stock, condition: "NM",
            notes: `${tag}-source`, locationId: source } });
        }
        if (moving) inventoryIds.add(moving.id);
        const capture = await fixture.capture(destination);
        sessionId = capture.sessionId;
        const selection = { photoIds: [capture.photoId], locationId: destination, section: section ?? "" };
        const preview = await previewAcquisitionCommit(db, actor, sessionId, selection);
        assert.equal(preview.destination.remaining, 1);
        assert.equal(preview.overfill, 0);
        const initialPhoto = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: capture.photoId } });
        const request = { ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null };
        const ordinary = async (p: PrismaClient) => {
          if (kind === "manual") return p.$transaction(tx => addInventoryCardToLocation(tx, {
            ownerPlayerId, cardId: fixture.cardId, locationId: destination, locationSection: section,
            quantity: 1, actingUserId: actor.userId, condition: "NM", notes: `${tag}-manual`,
          }));
          if (kind === "move") return moveInventoryStorageBatch(p, {
            actorUserId: actor.userId, destinationLocationId: destination,
            destinationLocationSection: section, itemIds: [moving!.id], allowedOwnerId: ownerPlayerId,
          });
          if (kind === "deck") return returnCommittedInventoryFromDeck(p, {
            actorUserId: actor.userId, ownerPlayerId, deckId: deckId!, deckName: tag,
            destinationLocationId: destination, mode: "bulk_returned_from_deck",
          });
          // updateLocation's production write is one autocommit statement.
          // Enclose it solely to hold that real statement's lock for observation.
          return p.$transaction(tx => updateLocation(tx as PrismaClient, {
            id: destination, ownerPlayerId, name: tag,
            storageLayout: { capacity: 1, sections: [{ name: "A", capacity: 1 }] },
          }));
        };
        const captureWith = (p: PrismaClient) => commitAcquisitionCards(p, actor, capture.sessionId, request);
        const outcome = async (work: Promise<unknown>) => {
          try { return { ok: true as const, value: await work }; }
          catch (error) { return { ok: false as const, error }; }
        };
        // Attach rejection handling immediately; the finally below releases and
        // awaits both actual operations even when observation/assertions fail.
        const firstResult = outcome(first === "ordinary" ? ordinary(hold.proxy) : captureWith(hold.proxy));
        activeFirst = firstResult;
        await Promise.race([hold.held, firstResult.then(result => {
          throw result.ok ? new Error("First writer finished before its observation boundary") : result.error;
        })]);
        assert(hold.reached());
        const secondResult = outcome(first === "ordinary" ? captureWith(waitingDb) : ordinary(waitingDb));
        activeSecond = secondResult;
        await waitForWriter(db, waitingName, holdingName);
        hold.release();
        const firstDone = await firstResult, secondDone = await secondResult;
        if (!firstDone.ok) throw firstDone.error;
        if (first === "ordinary") {
          assert(!secondDone.ok, "a stale preview cannot silently admit a physical copy");
          assert.match(String(secondDone.error), /preview changed/);
        } else if (kind === "move") {
          assert(!secondDone.ok, "the older serializable move requires an explicit fresh attempt");
          assert.match(String(secondDone.error), /Inventory changed during this move/);
          assert(heldFirstLedger);
          assert.deepEqual(await ledger(), heldFirstLedger, "refused move preserves all completed acquisition and source fields");
          await ordinary(db);
        } else if (!secondDone.ok) throw secondDone.error;

        if (first === "ordinary") {
          const refused = await ledger();
          assert(heldFirstLedger);
          assert.deepEqual(refused, heldFirstLedger, "the complete stale attempt rolls back every scoped field");
          assert.equal(refused.receipts.length, 0); assert.equal(refused.members.length, 0);
          assert.equal(refused.audits.filter(a => a.changeType === "acquisition_committed").length, 0);
          const fresh = await previewAcquisitionCommit(db, actor, sessionId, selection);
          assert.equal(fresh.destination.remaining, 0); assert.equal(fresh.overfill, 1);
          assert.notEqual(fresh.token, preview.token);
          await assert.rejects(commitAcquisitionCards(db, actor, sessionId, {
            ...request, previewToken: fresh.token,
          }), /overfill|reason/i);
          assert.deepEqual(await ledger(), refused, "missing overfill confirmation has no partial effects");
          request.previewToken = fresh.token;
          const reason = `Checked extra physical space after ${kind}`;
          const receipt = await commitAcquisitionCards(db, actor, sessionId, { ...request, overfillReason: reason });
          assert.equal(receipt.count, 1);
          const audit = await db.inventoryAuditLog.findFirstOrThrow({ where: {
            inventoryItemId: receipt.inventoryItemIds[0], changeType: "acquisition_committed",
          } });
          assert.equal(audit.reason, reason); assert.equal((audit.afterJson as { overfill: number }).overfill, 1);
          // Frozen request replay must use the exact successful payload.
          const successful = { ...request, overfillReason: reason };
          const beforeReplay = await ledger();
          assert.deepEqual(await commitAcquisitionCards(db, actor, sessionId, successful), { ...receipt, replay: true });
          assert.deepEqual(await ledger(), beforeReplay);
        } else {
          const beforeReplay = await ledger();
          assert.deepEqual(await commitAcquisitionCards(db, actor, sessionId, request), { ...(firstDone.value as object), replay: true });
          assert.deepEqual(await ledger(), beforeReplay, "later ordinary mutation cannot repeat the receipt");
        }
        const final = await ledger();
        assert.equal(final.receipts.length, 1); assert.equal(final.members.length, 1);
        assert.equal(final.audits.filter(a => a.changeType === "acquisition_committed").length, 1);
        assert.equal(final.audits.filter(a => a.changeType !== "acquisition_committed").length, kind === "layout" ? 0 : 1);
        const captured = final.stock.filter(row => row.sourceType === "ACQUISITION");
        assert.equal(captured.length, 1); assert.equal(captured[0].quantity, 1);
        assert.equal(final.members[0].inventoryItemId, captured[0].id);
        assert.equal(final.stock.reduce((sum, row) => sum + row.quantity, 0), kind === "layout" ? 2 : 3);
        assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: resident.id } }), resident);
        const savedPhoto = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: capture.photoId } });
        assert(savedPhoto.purgeAfter, "successful commit retains its original for seven days");
        assert.equal(savedPhoto.purgeAfter.getTime(), final.receipts[0].createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        assert.deepEqual(savedPhoto, { ...initialPhoto, purgeAfter: savedPhoto.purgeAfter });
        if (moving) {
          const moved = await db.inventoryItem.findUniqueOrThrow({ where: { id: moving.id } });
          assert.equal(moved.locationId, destination); assert.equal(moved.locationSection, section);
          const { locationId: oldLocation, locationSection: oldSection, updatedAt: oldUpdated, ...originalLot } = moving;
          const { locationId: newLocation, locationSection: newSection, updatedAt: newUpdated, ...movedLot } = moved;
          void oldLocation; void oldSection; void oldUpdated; void newLocation; void newSection; void newUpdated;
          assert.deepEqual(movedLot, originalLot, "movement preserves complete original lot/provenance/quantity");
        }
        console.log(`PASS: complete ${kind}/${first}-first acquisition composition, actual blocking pair, fresh admission, once-only receipt/audit/stock and immutable peer/photo`);
      } catch (error) { failures.push(error); }
      finally {
        hold.release();
        await Promise.allSettled([activeFirst, activeSecond].filter((p): p is Promise<unknown> => !!p));
        for (const p of [holdingDb, waitingDb]) {
          try { await p.$disconnect(); } catch (error) { failures.push(error); }
        }
        try {
          const remaining = await db.inventoryItem.findMany({ where: { locationId: { in: ownedLocations } }, select: { id: true } });
          for (const row of remaining) inventoryIds.add(row.id);
          if (sessionId) {
            await db.acquisitionCommitMember.deleteMany({ where: { candidate: { run: { sessionId } } } });
            await db.acquisitionCommit.deleteMany({ where: { run: { sessionId } } });
          }
          await db.inventoryAuditLog.deleteMany({ where: { inventoryItemId: { in: [...inventoryIds] } } });
          await db.inventoryItem.deleteMany({ where: { id: { in: [...inventoryIds] } } });
          if (deckId) {
            await db.inventoryLocation.deleteMany({ where: { deckId } });
            await db.deck.deleteMany({ where: { id: deckId } });
          }
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, `${kind}/${first}-first qualification failed`, { cause: failures[0] });
    }
  }
}
