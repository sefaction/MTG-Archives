import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { getBulkContext, bulkReservations } from "../lib/bulk-cleanup-service";
import { saveBulkSettings, performBulkAction } from "../lib/bulk-cleanup-actions";
import type { BulkContext, BulkActionInput } from "../lib/bulk-cleanup-policy";
import { createAcquisitionSession, saveAcquisitionReview } from "../lib/acquisition-store";
import { ensureDeckLocation } from "../lib/deck-commitments";
import { previewAcquisitionCommit, commitAcquisitionCards } from "../lib/acquisition-commit-service";

export async function seedBulkCleanup(db: PrismaClient, tag: string) {
  const password = randomUUID(), passwordHash = await bcrypt.hash(password, 4);
  for (const role of ["owner", "other", "recipient"]) {
    const id = `${tag}-${role}`;
    await db.player.create({ data: { id, name: id, displayName: `${role === "owner" ? "Bulk collection" : role === "recipient" ? "Archive recipient" : "Other private owner"} ${tag}` } });
    await db.user.create({ data: { id, username: id, displayName: id, passwordHash, playerId: id } });
  }
  const owner = `${tag}-owner`, other = `${tag}-other`, recipient = `${tag}-recipient`;
  const box = await db.inventoryLocation.create({ data: { ownerPlayerId: owner, name: "Blue Box", normalizedName: "blue box" } });
  const card = await db.card.create({ data: { scryfallId: randomUUID(), oracleId: randomUUID(), name: "Excess Archive Card", setCode: "tst", collectorNumber: "1", typeLine: "Artifact", rarity: "common" } });
  const alternate = await db.card.create({ data: { scryfallId: randomUUID(), oracleId: card.oracleId, name: card.name, setCode: "old", collectorNumber: "2", typeLine: "Artifact", rarity: "common" } });
  const normal = await db.inventoryItem.create({ data: { currentOwnerId: owner, originalOpenerId: recipient, cardId: card.id, quantity: 7, condition: "NM", locationId: box.id, locationSection: "0", sourceType: "ACQUISITION", notes: "Retain lot provenance" } });
  const damaged = await db.inventoryItem.create({ data: { currentOwnerId: owner, cardId: card.id, quantity: 3, condition: "DMG", locationId: box.id, locationSection: "1" } });
  const deck = await db.deck.create({ data: { ownerUserId: owner, name: "Protected deck" } });
  const deckLocation = await db.$transaction(tx => ensureDeckLocation(tx, { ...deck, ownerUser: { playerId: owner } }));
  const committed = await db.inventoryItem.create({ data: { currentOwnerId: owner, cardId: card.id, quantity: 2, condition: "NM", locationId: deckLocation.id } });
  await db.deckCard.create({ data: { deckId: deck.id, cardId: card.id, cardName: card.name, quantity: 2 } });
  await db.inventoryItem.createMany({ data: [
    { currentOwnerId: owner, cardId: alternate.id, quantity: 2, condition: "NM" },
    { currentOwnerId: owner, cardId: card.id, quantity: 2, condition: "NM", foilStatus: "FOIL" },
    { currentOwnerId: owner, cardId: card.id, quantity: 2, condition: "NM", language: "JA" },
    { currentOwnerId: other, cardId: card.id, quantity: 100, condition: "NM" },
  ] });
  return { owner, other, recipient, password, box, card, alternate, normal, damaged, deck, committed };
}
export async function seedBulkScans(db: PrismaClient, f: Awaited<ReturnType<typeof seedBulkCleanup>>, quantity = 4) {
  const actor = { userId: f.owner, adminMode: false };
  const capture = await createAcquisitionSession(db, actor, { requestKey: randomUUID(), ownerPlayerId: f.owner, locationId: f.box.id, section: "0", policy: { kind: "UNTARGETED" },
    defaults: { condition: "NM", finish: "NONFOIL", language: "en" }, run: { providerId: "phone-photo-v1", runId: randomUUID(), enforcement: "NONE", controls: ["STOP", "CANCEL"] } });
  const run = await db.acquisitionRun.findUniqueOrThrow({ where: { sessionId: capture.session.id } });
  const photos = [];
  for (let position = 0; position < quantity; position++) {
    const slot = await db.acquisitionCaptureSlot.create({ data: { runId: run.id, position, generation: 1, requestKey: randomUUID() } });
    const photo = await db.acquisitionPhoto.create({ data: { runId: run.id, slotId: slot.id, uploadKey: randomUUID(), generation: 1, digest: "a".repeat(64), bytes: 10, mediaType: "image/png", width: 250, height: 350, ready: true, readyAt: new Date() } });
    const candidate = await db.acquisitionCandidate.create({ data: { runId: run.id, physicalId: slot.id, identityKind: "NATIVE", acquisitionOrder: position, spatialOrder: 0, expectedSides: ["FRONT"], provisional: false, uncertainty: [], revision: 1, countConfirmed: true,
      review: { cardId: f.alternate.id, language: "EN", finish: "NONFOIL", condition: "NM", actorId: f.owner } } });
    photos.push({ photo, candidate, slot });
  }
  await db.acquisitionSession.update({ where: { id: capture.session.id }, data: { phase: "COMPLETE" } });
  return { id: capture.session.id, run, photos };
}
function request(context: BulkContext, action: "REMOVE" = "REMOVE"): Extract<BulkActionInput, { action: "REMOVE" }> {
  return { requestId: randomUUID(), action, policyStamp: context.settings.stamp, selected: context.plan!.items.map(row => ({ id: row.id, group: row.group, groupStamp: row.groupStamp, stamp: row.stamp, quantity: row.quantity })) };
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.MTG_BULK_CLEANUP_TEST !== "1" || url.hostname !== "mtg-bulk-cleanup-db" || url.pathname !== "/bulk_cleanup_fixture") throw Error("Use the dedicated disposable bulk cleanup fixture.");
  const db = new PrismaClient();
  try {
    const tag = `bulk-${randomUUID().slice(0, 8)}`, f = await seedBulkCleanup(db, tag);
    const before = await getBulkContext(db, f.owner);
    assert.equal(before.enabled, false); assert.equal(before.plan, undefined);
    await saveBulkSettings(db, f.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    let context = await getBulkContext(db, f.owner);
    assert.equal(context.plan!.totalCopies, 6); assert.equal(context.plan!.items.find(row => row.id === f.damaged.id)?.quantity, 3);
    assert.equal(context.plan!.items.find(row => row.id === f.normal.id)?.quantity, 3);
    assert.ok(context.plan!.items.every(row => row.id !== f.committed.id));
    assert.equal((await getBulkContext(db, f.other)).plan, undefined);
    await assert.rejects(saveBulkSettings(db, f.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: true, revision: 0 }));
    await saveBulkSettings(db, f.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: true, revision: 1 });
    context = await getBulkContext(db, f.owner); assert.equal(context.plan!.totalCopies, 8);
    const trade = await db.trade.create({ data: { proposerPlayerId: f.owner, receiverPlayerId: f.recipient, createdByUserId: f.owner, status: "PROPOSED", offeredInventoryItemId: f.normal.id } });
    await db.tradeLine.create({ data: { tradeId: trade.id, side: "PROPOSER", inventoryItemId: f.normal.id, quantity: 4, snapshotJson: {} } });
    const legacy = await db.trade.create({ data: { proposerPlayerId: f.owner, receiverPlayerId: f.recipient, createdByUserId: f.owner,
      status: "PROPOSED", offeredInventoryItemId: f.normal.id, requestedInventoryItemId: f.damaged.id } });
    const chunked = await db.$transaction(tx => bulkReservations(tx, [f.normal.id, ...Array.from({ length: 2000 }, (_, index) => `absent-${index}`), f.damaged.id]));
    assert.equal(chunked.get(f.normal.id), 5); assert.equal(chunked.get(f.damaged.id), 1);
    await db.trade.update({ where: { id: legacy.id }, data: { status: "CANCELLED" } });
    context = await getBulkContext(db, f.owner); assert.equal(context.plan!.totalCopies, 6); assert.equal(context.plan!.protectedCopies, 2);
    assert.equal(context.plan!.items.find(row => row.id === f.normal.id)?.quantity, 3);
    // A stale, now-reserved plan is rejected and its request permanently closed.
    const stale = request(context);
    await db.tradeLine.updateMany({ where: { tradeId: trade.id }, data: { quantity: 5 } });
    assert.equal((await performBulkAction(db, f.owner, stale)).status, "REJECTED");
    await db.trade.update({ where: { id: trade.id }, data: { status: "CANCELLED" } });
    assert.equal((await performBulkAction(db, f.owner, stale)).status, "REJECTED");
    context = await getBulkContext(db, f.owner);
    const removal = request(context), snapshot = await db.inventoryItem.findUniqueOrThrow({ where: { id: f.committed.id } });
    const concurrent = await Promise.all([performBulkAction(db, f.owner, removal), performBulkAction(db, f.owner, removal)]);
    assert.ok(concurrent.every(row => row.status === "APPLIED")); assert.equal(concurrent.filter(row => row.replay).length, 1);
    assert.equal((await db.inventoryItem.aggregate({ where: { currentOwnerId: f.owner, cardId: f.card.id, foilStatus: "NONFOIL", language: "EN" }, _sum: { quantity: true } }))._sum.quantity, 4);
    assert.deepEqual(await db.inventoryItem.findUnique({ where: { id: f.committed.id } }), snapshot);
    assert.equal(await db.bulkCleanupAction.count({ where: { actorUserId: f.owner, requestId: removal.requestId } }), 1);
    // Same-request recovery is still possible after the feature is disabled.
    await saveBulkSettings(db, f.owner, { action: "SETTINGS", enabled: false, maxCopies: 4, includeDecks: true, revision: 2 });
    assert.equal((await performBulkAction(db, f.owner, removal)).replay, true);
    assert.equal((await db.cardHandoff.count({ where: { fromPlayerId: f.owner } })), 0);

    const m = await seedBulkCleanup(db, tag + "-move");
    await saveBulkSettings(db, m.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    const movePlan = await getBulkContext(db, m.owner), move = { ...request(movePlan), action: "MOVE" as const, boxName: "Bulk / Outgoing" };
    // Destination failure rolls back all source changes and is durably closed.
    const tiny = await db.inventoryLocation.create({ data: { ownerPlayerId: m.owner, name: "Full bulk box", normalizedName: "full bulk box", type: "Bulk cleanup", storageLayout: { capacity: 1, sections: [] } } });
    const protectedBefore = await db.inventoryItem.findMany({ where: { currentOwnerId: m.owner }, orderBy: { id: "asc" } });
    assert.equal((await performBulkAction(db, m.owner, { ...move, requestId: randomUUID(), boxName: tiny.name })).status, "REJECTED");
    assert.deepEqual(await db.inventoryItem.findMany({ where: { currentOwnerId: m.owner }, orderBy: { id: "asc" } }), protectedBefore);
    const moved = await performBulkAction(db, m.owner, move); assert.equal(moved.quantity, 6); assert.equal(moved.status, "APPLIED");
    assert.equal((await getBulkContext(db, m.owner)).plan!.totalCopies, 0);
    const movedLot = await db.inventoryItem.findFirstOrThrow({ where: { currentOwnerId: m.owner, location: { type: "Bulk cleanup" }, originalOpenerId: m.recipient } });
    assert.equal(movedLot.notes, m.normal.notes); assert.equal(movedLot.sourceType, m.normal.sourceType); assert.equal(movedLot.quantity, 3);
    await db.inventoryItem.update({ where: { id: movedLot.id }, data: { locationId: m.box.id } });
    assert.equal((await getBulkContext(db, m.owner)).plan!.totalCopies, 3);
    const givePlan = await getBulkContext(db, m.owner), gift = { ...request(givePlan), action: "GIVE" as const, kind: "GIFT" as const, recipient: { type: "ARCHIVE" as const, playerId: m.recipient } };
    assert.equal((await performBulkAction(db, m.owner, gift)).status, "APPLIED");
    assert.equal((await performBulkAction(db, m.owner, gift)).replay, true);
    assert.equal((await db.inventoryItem.aggregate({ where: { currentOwnerId: m.recipient, location: { normalizedName: "unassigned" } }, _sum: { quantity: true } }))._sum.quantity, 3);
    assert.equal(await db.cardHandoff.count({ where: { fromPlayerId: m.owner, toPlayerId: m.recipient } }), givePlan.plan!.items.length);
    const external = await seedBulkCleanup(db, tag + "-external");
    await saveBulkSettings(db, external.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    const externalPlan = await getBulkContext(db, external.owner);
    assert.equal((await performBulkAction(db, external.owner, { ...request(externalPlan), action: "GIVE", kind: "TRADE", recipient: { type: "EXTERNAL", name: "Local store" } })).status, "APPLIED");
    assert.equal((await db.cardHandoff.aggregate({ where: { fromPlayerId: external.owner, recipientName: "Local store", kind: "TRADE" }, _sum: { quantity: true } }))._sum.quantity, 6);
    const rollback = await seedBulkCleanup(db, tag + "-rollback");
    await saveBulkSettings(db, rollback.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    await db.inventoryItem.update({ where: { id: rollback.normal.id }, data: { notes: "bulk-cleanup-rollback-fixture" } });
    const rollbackInput = { ...request(await getBulkContext(db, rollback.owner)), action: "MOVE" as const, boxName: "Rollback bulk" };
    const rollbackBefore = await db.inventoryItem.findMany({ where: { currentOwnerId: rollback.owner }, orderBy: { id: "asc" } });
    const auditBefore = await db.inventoryAuditLog.count();
    await db.$executeRawUnsafe(`CREATE FUNCTION bulk_cleanup_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notes = 'bulk-cleanup-rollback-fixture' THEN RAISE EXCEPTION 'injected destination write failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER bulk_cleanup_fixture_failure BEFORE INSERT ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION bulk_cleanup_fixture_fail()`);
    try { await assert.rejects(performBulkAction(db, rollback.owner, rollbackInput)); }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER bulk_cleanup_fixture_failure ON "InventoryItem"`); await db.$executeRawUnsafe(`DROP FUNCTION bulk_cleanup_fixture_fail()`); }
    assert.deepEqual(await db.inventoryItem.findMany({ where: { currentOwnerId: rollback.owner }, orderBy: { id: "asc" } }), rollbackBefore);
    assert.equal(await db.inventoryAuditLog.count(), auditBefore);
    assert.equal(await db.bulkCleanupAction.count({ where: { actorUserId: rollback.owner } }), 0);
    assert.equal((await performBulkAction(db, rollback.owner, rollbackInput)).status, "APPLIED");
    const guarded = await seedBulkCleanup(db, tag + "-guarded");
    await saveBulkSettings(db, guarded.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    await db.inventoryLocation.update({ where: { id: guarded.box.id }, data: { active: false } });
    assert.equal((await getBulkContext(db, guarded.owner)).plan!.totalCopies, 0);
    assert.equal((await getBulkContext(db, guarded.owner)).plan!.protectedCopies, 6);
    await db.inventoryLocation.update({ where: { id: guarded.box.id }, data: { active: true } });
    const league = await db.league.create({ data: { name: "Protected fixture League", slug: tag, seasons: { create: { name: "Fixture season", year: 2026, startDate: new Date(), rounds: { create: { name: "Fixture round", monthNumber: 1, startDate: new Date() } } } } }, include: { seasons: { include: { rounds: true } } } });
    const roundId = league.seasons[0].rounds[0].id;
    const pull = await db.pull.create({ data: { roundId, playerId: guarded.owner, cardId: guarded.card.id, quantity: 7, condition: "NM" } });
    await db.inventoryItem.update({ where: { id: guarded.normal.id }, data: { roundId, acquiredFromPullId: pull.id } });
    const leaguePlan = await getBulkContext(db, guarded.owner);
    assert.equal(leaguePlan.plan!.totalCopies, 3); assert.equal(leaguePlan.plan!.protectedCopies, 3);
    assert.ok(leaguePlan.plan!.items.every(row => row.id !== guarded.normal.id));
    await db.inventoryItem.update({ where: { id: guarded.normal.id }, data: { roundId: null, acquiredFromPullId: null } });
    const foreignAttempt = request(await getBulkContext(db, guarded.owner));
    assert.equal((await performBulkAction(db, guarded.other, foreignAttempt)).status, "REJECTED");
    assert.equal((await getBulkContext(db, guarded.owner)).plan!.totalCopies, 6);

    const s = await seedBulkCleanup(db, tag + "-scans");
    await saveBulkSettings(db, s.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    const older = await seedBulkScans(db, s, 3), current = await seedBulkScans(db, s, 4);
    // Alternate printing has two saved copies. Keep two older scans, then pull
    // older #3 and all four current scans. The saved copies count only once.
    const oldPlan = await getBulkContext(db, s.owner, { batchId: older.id }); assert.deepEqual(oldPlan.plan!.items.map(row => row.position), [3]);
    let scanPlan = await getBulkContext(db, s.owner, { batchId: current.id }); assert.equal(scanPlan.plan!.totalCopies, 4);
    // Real acquisition receipt moves a previously counted pending scan into
    // stock. It must leave the excess decision unchanged, not count twice.
    const selection = { photoIds: [older.photos[0].photo.id], locationId: s.box.id, section: "0" };
    const preview = await previewAcquisitionCommit(db, { userId: s.owner, adminMode: false }, older.id, selection);
    await commitAcquisitionCards(db, { userId: s.owner, adminMode: false }, older.id, { ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null });
    scanPlan = await getBulkContext(db, s.owner, { batchId: current.id });
    assert.equal(scanPlan.plan!.totalCopies, 4);
    assert.equal((await getBulkContext(db, s.other, { batchId: current.id })).enabled, false);
    const ignore = { ...request(scanPlan), action: "IGNORE_SCANS" as const, batchId: current.id };
    const original = await db.acquisitionCandidate.findMany({ where: { runId: current.run.id }, orderBy: { id: "asc" } });
    assert.equal((await performBulkAction(db, s.owner, ignore)).quantity, 4); assert.equal((await performBulkAction(db, s.owner, ignore)).replay, true);
    const after = await db.acquisitionCandidate.findMany({ where: { runId: current.run.id }, orderBy: { id: "asc" } });
    after.forEach((row, index) => { assert.equal(row.ignored, true); assert.equal(row.countConfirmed, original[index].countConfirmed); assert.deepEqual(row.review, original[index].review); assert.equal(row.physicalId, original[index].physicalId); });
    assert.equal(await db.acquisitionCandidate.count({ where: { runId: older.run.id, ignored: true } }), 0);
    const first = current.photos[0];
    await saveAcquisitionReview(db, { userId: s.owner, adminMode: false }, current.id, { action: "restore", photoId: first.photo.id, revision: first.candidate.revision + 1, requestKey: randomUUID() });
    scanPlan = await getBulkContext(db, s.owner, { batchId: current.id }); assert.equal(scanPlan.plan!.totalCopies, 1);
    // A changed source cannot use an old pull authorization.
    const staleScan = { ...request(scanPlan), action: "IGNORE_SCANS" as const, batchId: current.id };
    await db.acquisitionPhoto.update({ where: { id: first.photo.id }, data: { ready: false, readyAt: null } });
    assert.equal((await performBulkAction(db, s.owner, staleScan)).status, "REJECTED");
    assert.equal(await db.acquisitionCandidate.count({ where: { runId: current.run.id, ignored: false } }), 1);
    const scale = await seedBulkCleanup(db, tag + "-scale");
    await db.inventoryLocation.update({ where: { id: scale.box.id }, data: { storageLayout: { capacity: null, sections: Array.from({ length: 100 }, (_, index) => ({ name: `Section ${index}`, capacity: null })) } } });
    await saveBulkSettings(db, scale.owner, { action: "SETTINGS", enabled: true, maxCopies: 4, includeDecks: false, revision: 0 });
    for (let offset = 0; offset < 30000; offset += 1000) await db.inventoryItem.createMany({ data: Array.from({ length: 1000 }, () => ({ currentOwnerId: scale.owner, cardId: scale.card.id, quantity: 5, condition: "NM", locationId: scale.box.id })) });
    const started = performance.now(), scaled = await getBulkContext(db, scale.owner);
    assert.equal(scaled.plan!.totalCopies, 150006); assert.equal(scaled.plan!.items.length, 100); assert.ok(scaled.plan!.pages > 299);
    console.log(JSON.stringify({ scale: { lots: 30000, physicalCopies: 150000, planMs: Math.round(performance.now() - started), pagedItems: scaled.plan!.items.length } }));
    console.log("PASS bulk cleanup: opt-in/settings conflict; exact printing/finish/language; deck toggle/protection; modern reservations; stale rejection tombstones; concurrent replay; disabled recovery; provenance-preserving bulk move and recount; immediate Archives handoff; multi-batch original order; scan source/review/count conservation; restore; foreign privacy.");
  } finally { await db.$disconnect(); }
}
if (process.argv.includes("--run")) main().catch(error => { console.error(error); process.exitCode = 1; });
