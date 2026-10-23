import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import ts from "typescript";
import { PrismaClient, type Prisma, type InventoryItem, type TradeWishlistItem } from "@prisma/client";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { beginAcquisitionPhoto, createAcquisitionSession, executeAcquisitionCommand,
  finalizeAcquisitionPhoto, getAcquisitionCardReview, reserveAcquisitionCaptureSlot,
  saveAcquisitionReview } from "../lib/acquisition-store";
import { commitAcquisitionCards, previewAcquisitionCommit } from "../lib/acquisition-commit-service";
import { buildReservedInventoryQuantities } from "../lib/trade-lines";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; playerId: string; role: string; displayName: string };
type ActionContext = { client: PrismaClient; actor: Actor; admin: boolean; afterTransaction?: (tx: Tx) => Promise<void> };
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(r => { resolve = r; }), resolve: () => resolve() };
}
async function fingerprints(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM public.${quoted} t`) as unknown[];
    result[tablename] = row;
  }
  return result;
}

// The same real-action loader boundary as the existing trade CI: request
// identity and Next cache are adapted, not transfer/audit/notification SQL.
function loadTradeAction(db: PrismaClient, context: AsyncLocalStorage<ActionContext>) {
  const proxy = new Proxy(db, { get(_target, key) {
    const client = context.getStore()?.client ?? db;
    if (key === "$transaction") return (work: (tx: Tx) => Promise<unknown>, options: unknown) =>
      Reflect.apply(client.$transaction, client, [async (tx: Tx) => {
        const result = await work(tx);
        await context.getStore()?.afterTransaction?.(tx);
        return result;
      }, options]);
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  } });
  const filename = path.resolve("app/trades/actions.ts");
  const loaded: any = new (Module as any)(filename, module);
  loaded.filename = filename;
  loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (id: string) => {
    if (id === "@/lib/auth") return {
      requireLogin: async () => { assert(context.getStore()); return context.getStore()!.actor; },
      getAccessScope: async () => ({ mode: context.getStore()?.admin ? "admin" : "owner" }),
    };
    if (id === "@/lib/prisma") return { prisma: proxy };
    if (id === "next/cache") return { revalidatePath: () => {} };
    return originalRequire(id);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports.confirmPhysicalTrade as (form: FormData) => Promise<void>;
}

async function blockedBy(db: PrismaClient, waiting: string, holding: string) {
  const deadline = Date.now() + 5000;
  do {
    const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid))
      WHERE w.application_name=${waiting} AND h.application_name=${holding} AND w.wait_event_type='Lock') AS waiting`;
    if (row.waiting) return;
    await setTimeout(20);
  } while (Date.now() < deadline);
  throw new Error("Expected the named complete trade/acquisition blocking pair");
}

export async function verifyAcquisitionTradeCompositions(db: PrismaClient) {
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
  assert(new URL(process.env.DATABASE_URL!).pathname.startsWith("/acquisition_"));
  const context = new AsyncLocalStorage<ActionContext>();
  const confirm = loadTradeAction(db, context);
  for (const mode of ["trade-first", "acquisition-first", "trade-rollback"] as const) {
    const before = await fingerprints(db), tag = `trade-capture-${randomUUID()}`;
    const owners = [tag + "-a", tag + "-b", tag + "-admin"], users = owners.map(x => x + "-user");
    const cards = [tag + "-card-0", tag + "-card-1"], tradeId = tag + "-trade";
    const destinations = [tag + "-in-a", tag + "-in-b"], sources = [tag + "-out-a", tag + "-out-b"];
    const held = deferred(), release = deferred(), expectedErrors = new Set<unknown>(), failures: unknown[] = [];
    const holdingName = tag + "-holding", waitingName = tag + "-waiting";
    const makeClient = (name: string) => { const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("application_name", name); return new PrismaClient({ datasourceUrl: url.href }); };
    const holdingDb = makeClient(holdingName), waitingDb = makeClient(waitingName);
    type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
    const active: Promise<Outcome>[] = [];
    const observe = async (promise: Promise<unknown>): Promise<Outcome> => { try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; } };
    let sessionId: string | undefined, confirmationLedger: unknown, heldLedger: unknown, completedBodies = 0, faultReached = false;
    async function ledger(p: Tx = db, tradeOnly = false) {
      const notifications = await p.notification.findMany({ where: { recipientUserId: { in: users } }, orderBy: { id: "asc" } });
      const trade = await p.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { lines: { orderBy: { id: "asc" } } } });
      const reserved = buildReservedInventoryQuantities(["PROPOSED", "ACCEPTED_PENDING_EXCHANGE", "PARTIALLY_COMMITTED"].includes(trade.status) ? trade.lines : [], []);
      const common = {
        trade, reservations: Object.fromEntries([...reserved].sort(([a], [b]) => a.localeCompare(b))),
        stock: await p.inventoryItem.findMany({ where: { cardId: { in: cards }, ...(tradeOnly ? { sourceType: { not: "ACQUISITION" as const } } : {}) }, orderBy: { id: "asc" } }),
        audits: await p.inventoryAuditLog.findMany({ where: tradeOnly ? { tradeId } : { OR: [{ tradeId }, { inventoryItem: { cardId: { in: cards } } }] }, orderBy: { id: "asc" } }),
        events: await p.tradeEvent.findMany({ where: { tradeId }, orderBy: { id: "asc" } }), notifications,
        deliveries: await p.notificationDeliveryJob.findMany({ where: { OR: [{ sourceType: "trade.completed", sourceId: tradeId }, { notificationId: { in: notifications.map(n => n.id) } }] }, orderBy: { id: "asc" } }),
        wishlists: await p.tradeWishlistItem.findMany({ where: { ownerUserId: { in: users } }, orderBy: { id: "asc" } }),
      };
      if (tradeOnly) return common;
      assert(sessionId);
      return { ...common,
        locations: await p.inventoryLocation.findMany({ where: { ownerPlayerId: { in: owners } }, orderBy: { id: "asc" } }),
        session: await p.acquisitionSession.findUniqueOrThrow({ where: { id: sessionId } }),
        photos: await p.acquisitionPhoto.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
        candidates: await p.acquisitionCandidate.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
        jobs: await p.acquisitionProcessingJob.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
        receipts: await p.acquisitionCommit.findMany({ where: { run: { sessionId } }, orderBy: { id: "asc" } }),
        members: await p.acquisitionCommitMember.findMany({ where: { candidate: { run: { sessionId } } }, orderBy: { candidateId: "asc" } }),
      };
    }
    try {
      const people: Actor[] = [];
      for (let i = 0; i < 3; i++) {
        await db.player.create({ data: { id: owners[i], name: owners[i], displayName: owners[i] } });
        const user = await db.user.create({ data: { id: users[i], username: users[i], displayName: users[i], playerId: owners[i], role: i === 2 ? "ADMIN" : "PLAYER", passwordHash: "not-a-login-hash" } });
        people.push({ ...user, playerId: owners[i] });
      }
      await db.$transaction(tx => ensureCorrectionAccount(tx, owners[1]));
      await db.correctionLibraryAccount.update({ where: { ownerPlayerId: owners[1] }, data: { sampleBasisPoints: 0 } });
      for (let i = 0; i < 2; i++) {
        await db.card.create({ data: { id: cards[i], scryfallId: randomUUID(), name: cards[i], typeLine: "Artifact", setCode: "tst", collectorNumber: String(i), rarity: "common", lang: "en", finishes: ["nonfoil", "foil"] } });
        for (const id of [sources[i], destinations[i]]) await db.inventoryLocation.create({ data: { id, ownerPlayerId: owners[i], name: id, normalizedName: id, type: "Box", storageLayout: { capacity: 2, sections: [] } } });
      }
      const stock: InventoryItem[] = [];
      for (let i = 0; i < 2; i++) stock.push(await db.inventoryItem.create({ data: {
        cardId: cards[i], currentOwnerId: owners[i], originalOpenerId: owners[i], quantity: 2,
        foil: true, foilStatus: "FOIL", condition: "LP", language: "JA", sourceType: "MANUAL",
        notes: tag + "-provenance-" + i, locationId: sources[i], locationSection: "source",
      } }));
      const resident = await db.inventoryItem.create({ data: { cardId: cards[0], currentOwnerId: owners[1], quantity: 1, condition: "HP", notes: tag + "-resident", locationId: destinations[1] } });
      await db.trade.create({ data: { id: tradeId, proposerPlayerId: owners[0], receiverPlayerId: owners[1], status: "PARTIALLY_COMMITTED", proposerCommittedAt: new Date(), proposerDestinationLocationId: destinations[0], receiverDestinationLocationId: destinations[1],
        lines: { create: stock.map((row, i) => ({ side: i === 0 ? "PROPOSER" : "RECEIVER", inventoryItemId: row.id, quantity: 1, position: 0, snapshotJson: {} })) },
      } });
      const wishlists: TradeWishlistItem[] = [];
      for (let i = 0; i < 2; i++) wishlists.push(await db.tradeWishlistItem.create({ data: { ownerUserId: users[1 - i], targetOwnerPlayerId: owners[i], targetInventoryItemId: stock[i].id, cardId: cards[i], quantity: 1, status: "IN_TRADE" } }));
      const untouchedWishlist = await db.tradeWishlistItem.create({ data: { ownerUserId: users[2], targetOwnerPlayerId: owners[0], cardId: cards[0], quantity: 7 } });
      const created = await createAcquisitionSession(db, { userId: users[1], adminMode: false }, { requestKey: randomUUID(), ownerPlayerId: owners[1], locationId: destinations[1], section: "", policy: { kind: "MANUAL", quantity: 1 }, run: { providerId: "phone-photo-v1", runId: randomUUID(), enforcement: "LOGICAL_ALLOCATION", controls: ["STOP", "CANCEL"] } });
      sessionId = created.session.id;
      const actor = { userId: users[1], adminMode: false };
      await executeAcquisitionCommand(db, actor, sessionId, { requestKey: randomUUID(), revision: 0, command: "START" });
      const { slot } = await reserveAcquisitionCaptureSlot(db, actor, sessionId, randomUUID());
      const photo = await beginAcquisitionPhoto(db, actor, sessionId, { slotId: slot.id, uploadKey: randomUUID(), generation: 0, metadata: { digest: "a".repeat(64), bytes: 10, mediaType: "image/jpeg", width: 10, height: 10 } });
      await finalizeAcquisitionPhoto(db, actor, sessionId, photo.id);
      const review = await getAcquisitionCardReview(db, actor, sessionId, photo.id);
      await saveAcquisitionReview(db, actor, sessionId, { photoId: photo.id, revision: review.revision, action: "accept", decision: { cardId: cards[0], language: "en", finish: "NONFOIL", condition: "NM" } });
      const session = await db.acquisitionSession.findUniqueOrThrow({ where: { id: sessionId } });
      await executeAcquisitionCommand(db, actor, sessionId, { requestKey: randomUUID(), revision: session.revision, command: "STOP" });
      const selection = { photoIds: [photo.id], locationId: destinations[1], section: "" };
      const photoBefore = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } });
      const preview = await previewAcquisitionCommit(db, actor, sessionId, selection);
      assert.equal(preview.destination.remaining, 1);
      const request = { ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null as string | null };
      const initial = await ledger();
      assert.deepEqual(initial.reservations, Object.fromEntries(stock.map(row => [row.id, 1]).sort(([a], [b]) => String(a).localeCompare(String(b)))));
      const tradeContext: ActionContext = { client: mode === "acquisition-first" ? waitingDb : holdingDb, actor: people[1], admin: false,
        afterTransaction: async tx => {
          const row = await tx.trade.findUniqueOrThrow({ where: { id: tradeId } });
          if (row.status !== "COMPLETED") { confirmationLedger = await ledger(tx, true); return; }
          completedBodies++;
          if (mode !== "acquisition-first") {
            heldLedger = await ledger(tx); held.resolve(); await release.promise;
            if (mode === "trade-rollback") { faultReached = true; throw new Error("fixture post-completion trade rollback"); }
          }
        },
      };
      const callTrade = (ctx = tradeContext, force = false) => {
        const form = new FormData(); form.set("tradeId", tradeId); form.set("destinationLocationId", destinations[1]);
        if (force) { form.set("forceComplete", "1"); form.set("reason", "Explicit fixture admin recovery after transaction rollback"); }
        return context.run(ctx, () => confirm(form));
      };
      const heldCaptureDb = new Proxy(holdingDb, { get(target, key) {
        if (key === "$transaction") return (work: (tx: Tx) => Promise<unknown>, options: unknown) => Reflect.apply(target.$transaction, target, [async (tx: Tx) => { const result = await work(tx); heldLedger = await ledger(tx); held.resolve(); await release.promise; return result; }, options]);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const callCapture = (p: PrismaClient) => commitAcquisitionCards(p, actor, sessionId!, request);
      const first = observe(mode === "acquisition-first" ? callCapture(heldCaptureDb) : callTrade()); active.push(first);
      await Promise.race([held.promise, first.then(result => { throw result.ok ? new Error("First operation left its held boundary") : result.error; })]);
      const second = observe(mode === "acquisition-first" ? callTrade() : callCapture(waitingDb)); active.push(second);
      await blockedBy(db, waitingName, holdingName);
      release.resolve();
      const one = await first, two = await second;
      if (mode === "trade-rollback") {
        assert(!one.ok); expectedErrors.add(one.error); assert.match(String(one.error), /fixture post-completion trade rollback/); assert(faultReached);
        if (!two.ok) throw two.error;
        assert(confirmationLedger); assert.deepEqual(await ledger(db, true), confirmationLedger, "all transfer/audit/wishlist/event/notification effects roll back; prior physical confirmation remains");
        assert.equal(await db.acquisitionCommit.count({ where: { run: { sessionId } } }), 1);
        // Existing privileged recovery, not an invented ordinary retry policy.
        await callTrade({ client: waitingDb, actor: people[2], admin: true }, true);
      } else {
        if (!one.ok) throw one.error;
        if (mode === "trade-first") {
          assert(!two.ok); expectedErrors.add(two.error); assert.match(String(two.error), /preview changed/);
          assert.deepEqual(await ledger(), heldLedger, "stale acquisition cannot change the completed full trade or pending capture");
          const fresh = await previewAcquisitionCommit(db, actor, sessionId, selection);
          assert.equal(fresh.destination.remaining, 0); assert.equal(fresh.overfill, 1);
          const noConsent = await ledger();
          await assert.rejects(commitAcquisitionCards(db, actor, sessionId, { ...request, previewToken: fresh.token }), /overfill.*reason/i);
          assert.deepEqual(await ledger(), noConsent);
          request.previewToken = fresh.token; request.overfillReason = "Checked one extra physical space after complete trade";
          await callCapture(db);
        } else if (!two.ok) throw two.error;
      }
      assert.equal(completedBodies, 1, "one actual normal completion body reached the observation boundary");
      const final = await ledger();
      assert.equal(final.trade.status, "COMPLETED"); assert.deepEqual(final.reservations, {});
      assert.equal(final.events.filter(e => e.eventType === "completed").length, 1);
      assert.equal(final.events.filter(e => e.eventType === "receiver_confirmed_physical_exchange").length, 1);
      assert.equal(final.events.length, mode === "trade-rollback" ? 3 : 2);
      assert.equal(final.events.filter(e => e.eventType === "admin_force_complete").length, mode === "trade-rollback" ? 1 : 0);
      assert.equal(final.notifications.length, mode === "trade-rollback" ? 2 : 1);
      assert(final.notifications.every(n => n.type === "trade.completed" && n.readAt === null));
      assert.deepEqual(final.notifications.map(n => n.recipientUserId).sort(), mode === "trade-rollback" ? users.slice(0, 2).sort() : [users[0]]);
      assert.equal(final.deliveries.length, 0, "fixture users have no external delivery destinations");
      for (let i = 0; i < 2; i++) {
        const source = final.stock.find(row => row.id === stock[i].id)!;
        assert.equal(source.quantity, 1);
        assert.deepEqual(source, { ...stock[i], quantity: 1, updatedAt: source.updatedAt });
        const incoming = final.stock.filter(row => row.cardId === cards[i] && row.sourceType === "TRADE");
        assert.equal(incoming.length, 1); assert.equal(incoming[0].quantity, 1);
        assert.equal(incoming[0].currentOwnerId, owners[1 - i]); assert.equal(incoming[0].locationId, destinations[1 - i]); assert.equal(incoming[0].locationSection, null);
        for (const key of ["cardId", "originalOpenerId", "foil", "foilStatus", "condition", "language", "notes", "roundId", "acquiredFromPullId"] as const) assert.equal(incoming[0][key], stock[i][key]);
        const sourceAudit = final.audits.find(a => a.tradeId === tradeId && a.inventoryItemId === source.id)!;
        const receiptAudit = final.audits.find(a => a.tradeId === tradeId && a.inventoryItemId === incoming[0].id)!;
        assert.equal((sourceAudit.beforeJson as { quantity: number }).quantity, 2);
        assert.equal((sourceAudit.afterJson as { quantity: number }).quantity, 1);
        assert.equal((receiptAudit.afterJson as { quantity: number }).quantity, 1);
        assert.equal((receiptAudit.beforeJson as { quantityTransferred: number }).quantityTransferred, 1);
        const wishlist = final.wishlists.find(w => w.id === wishlists[i].id)!;
        assert.deepEqual(wishlist, { ...wishlists[i], status: "FULFILLED", updatedAt: wishlist.updatedAt });
        assert.equal(final.stock.filter(row => row.cardId === cards[i]).reduce((sum, row) => sum + row.quantity, 0), i === 0 ? 4 : 2);
      }
      assert.deepEqual(final.stock.find(row => row.id === resident.id), resident);
      assert.deepEqual(final.wishlists.find(w => w.id === untouchedWishlist.id), untouchedWishlist);
      assert.equal(final.audits.filter(a => a.tradeId === tradeId).length, 4);
      assert.equal(final.audits.filter(a => a.changeType === "acquisition_committed").length, 1);
      const receipts = await db.acquisitionCommit.findMany({ where: { run: { sessionId } } }); assert.equal(receipts.length, 1);
      const photoAfter = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: photo.id } });
      assert(photoAfter.purgeAfter); assert.equal(photoAfter.purgeAfter.getTime(), receipts[0].createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      assert.deepEqual(photoAfter, { ...photoBefore, purgeAfter: photoAfter.purgeAfter });
      const members = await db.acquisitionCommitMember.findMany({ where: { candidate: { run: { sessionId } } } }); assert.equal(members.length, 1);
      const captured = final.stock.filter(row => row.sourceType === "ACQUISITION"); assert.equal(captured.length, 1); assert.equal(captured[0].quantity, 1); assert.equal(members[0].inventoryItemId, captured[0].id);
      const captureAudit = final.audits.find(a => a.changeType === "acquisition_committed")!;
      assert.equal((captureAudit.afterJson as { overfill: number }).overfill, mode === "trade-first" ? 1 : 0);
      if (request.overfillReason) assert.equal(captureAudit.reason, request.overfillReason);
      assert.equal(final.stock.filter(row => row.locationId === destinations[1]).reduce((sum, row) => sum + row.quantity, 0), 3);
      const beforeReplay = await ledger();
      const replay = await callCapture(db); assert(replay.replay);
      await assert.rejects(callTrade(), /not awaiting physical confirmation/);
      assert.deepEqual(await ledger(), beforeReplay, "duplicate real action/request changes no receipt, stock, notification, wishlist or event");
      console.log(`PASS: full physical-trade/${mode} acquisition blocking pair, fresh consent/replay, reservations/provenance/stock/audit/wishlist/event/notification conservation`);
    } catch (error) { failures.push(error); }
    finally {
      release.resolve();
      for (const result of await Promise.all(active)) if (!result.ok && !expectedErrors.has(result.error) && !failures.includes(result.error)) failures.push(result.error);
      for (const result of await Promise.allSettled([holdingDb.$disconnect(), waitingDb.$disconnect()])) if (result.status === "rejected") failures.push(result.reason);
      try {
        const runs = await db.acquisitionRun.findMany({ where: { session: { ownerPlayerId: owners[1] } }, select: { id: true } });
        const where = { runId: { in: runs.map(r => r.id) } };
        await db.acquisitionCommitMember.deleteMany({ where }); await db.acquisitionCommit.deleteMany({ where }); await db.acquisitionProcessingJob.deleteMany({ where });
        await db.acquisitionCommand.deleteMany({ where }); await db.acquisitionPhoto.deleteMany({ where }); await db.acquisitionCaptureSlot.deleteMany({ where });
        await db.acquisitionCountCorrection.deleteMany({ where }); await db.acquisitionObservation.deleteMany({ where }); await db.acquisitionEvent.deleteMany({ where }); await db.acquisitionCandidate.deleteMany({ where }); await db.acquisitionArtifact.deleteMany({ where }); await db.acquisitionRun.deleteMany({ where: { id: { in: runs.map(r => r.id) } } }); await db.acquisitionSession.deleteMany({ where: { ownerPlayerId: owners[1] } });
        await db.notificationDeliveryJob.deleteMany({ where: { OR: [{ sourceType: "trade.completed", sourceId: tradeId }, { notification: { recipientUserId: { in: users } } }] } });
        await db.notification.deleteMany({ where: { recipientUserId: { in: users } } });
        await db.inventoryAuditLog.deleteMany({ where: { OR: [{ tradeId }, { inventoryItem: { cardId: { in: cards } } }] } }); await db.tradeEvent.deleteMany({ where: { tradeId } }); await db.tradeLine.deleteMany({ where: { tradeId } }); await db.trade.deleteMany({ where: { id: tradeId } });
        await db.tradeWishlistItem.deleteMany({ where: { ownerUserId: { in: users } } }); await db.inventoryItem.deleteMany({ where: { cardId: { in: cards } } }); await db.inventoryLocation.deleteMany({ where: { ownerPlayerId: { in: owners } } });
        const owner = { ownerPlayerId: owners[1] };
        await db.correctionRetentionPin.deleteMany({ where: owner }); await db.correctionCaptureOutbox.deleteMany({ where: { blob: owner } }); await db.correctionExample.deleteMany({ where: owner }); await db.correctionReviewEvent.deleteMany({ where: owner }); await db.correctionEvidence.deleteMany({ where: owner }); await db.correctionLibraryAccess.deleteMany({ where: owner }); await db.correctionBlob.deleteMany({ where: owner }); await db.correctionDeletionTombstone.deleteMany({ where: owner }); await db.correctionLibraryAccount.deleteMany({ where: owner });
        await db.user.deleteMany({ where: { id: { in: users } } }); await db.player.deleteMany({ where: { id: { in: owners } } }); await db.card.deleteMany({ where: { id: { in: cards } } });
        assert.deepEqual(await fingerprints(db), before, "restore every original public-table row without exclusions");
        console.log(`PASS: ${mode} restores all ${Object.keys(before).length} public-table full-row fingerprints`);
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, `Trade/acquisition ${mode} verification failed`, { cause: failures[0] });
  }
}
