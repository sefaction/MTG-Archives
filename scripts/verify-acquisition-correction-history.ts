import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { changeCorrectionExample } from "../lib/acquisition-correction-access";
import { getCorrectionReviewHistory } from "../lib/acquisition-correction-history";

// Called by the guarded disposable PostgreSQL verifier; never a live snapshot.
export async function verifyCorrectionReviewHistory(db: PrismaClient) {
  const tag = `history-${randomUUID()}`, owners = [0, 1, 2].map(i => `${tag}-${i}`);
  const source = randomUUID(), otherSource = randomUUID(), candidate = `${tag}-candidate`;
  const original = await db.inventoryItem.aggregate({ _count: { _all: true }, _sum: { quantity: true } });
  const printing = { id: "fixture-printing", name: "Saved fixture printing", setCode: "tst", collectorNumber: "1", lang: "en", token: "PRIVATE_FIELD" };
  try {
    for (const [index, owner] of owners.entries()) {
      await db.player.create({ data: { id: owner, name: owner, displayName: owner } });
      await db.user.create({ data: { id: owner, username: owner, displayName: owner, playerId: owner,
        passwordHash: "fixture-only", role: index === 2 ? "ADMIN" : "PLAYER" } });
      await db.$transaction(tx => ensureCorrectionAccount(tx, owner));
    }
    const blob = await db.correctionBlob.create({ data: { ownerPlayerId: owners[0], digest: "c".repeat(64), bytes: 1, mediaType: "image/png" } });
    const createExample = (sourcePhotoId: string) => db.correctionExample.create({ data: {
      ownerPlayerId: owners[0], blobId: blob.id, sourcePhotoId, sourceCandidateId: candidate,
      sourceSessionId: `${tag}-session`, sourceGeneration: 0, physicalCopyGroup: sourcePhotoId,
    } });
    const example = await createExample(source), other = await createExample(otherSource);
    const events = Array.from({ length: 45 }, (_, index) => ({ id: randomUUID(), ownerPlayerId: owners[0],
      sourceCandidateId: candidate, candidateRevision: index + 1, sourcePhotoId: source, exampleId: example.id,
      actorId: owners[0], origin: "HUMAN", classification: "FIRST_CHOICE_AGREEMENT", bytes: 0, evidenceIds: [],
      // Deliberately opposing clocks prove revision-based sequence, not time order.
      createdAt: new Date(100000 - index * 1000), payload: { version: 1, before: null, after: { cardId: printing.id },
        displayKnown: true, firstDisplayedSuggestion: printing, printingProjections: [printing],
        missing: [], independentVerification: "UNVERIFIED", secret: "PRIVATE_FIELD", sourcePhotoId: source } as Prisma.InputJsonObject,
    }));
    await db.correctionReviewEvent.createMany({ data: events });
    const foreign = await db.correctionReviewEvent.create({ data: { ownerPlayerId: owners[0], sourceCandidateId: `${candidate}-other`,
      candidateRevision: 1, sourcePhotoId: otherSource, exampleId: other.id, actorId: owners[0], origin: "HUMAN",
      classification: "DISPLAY_IDENTITY_UNKNOWN", payload: { version: 1 }, bytes: 0 } });
    const actor = { userId: owners[0], adminMode: false };
    const accountBefore = await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owners[0] } });
    const first = await getCorrectionReviewHistory(db, actor, owners[0], example.id);
    assert.equal(first.entries.length, 20); assert.equal(first.entries[0].revision, 45); assert.equal(first.entries.at(-1)?.revision, 26);
    assert(first.nextCursor); assert.equal(first.entries[0].after.printing?.name, printing.name);
    assert.equal(first.entries[0].verification, "UNVERIFIED");
    assert.doesNotMatch(JSON.stringify(first), /PRIVATE_FIELD|actorId|sourcePhotoId|sourceCandidateId|password|token|signature/);
    const second = await getCorrectionReviewHistory(db, actor, owners[0], example.id, first.nextCursor);
    assert.equal(second.entries.length, 20); assert.equal(second.entries[0].revision, 25); assert.equal(second.entries.at(-1)?.revision, 6);
    const third = await getCorrectionReviewHistory(db, actor, owners[0], example.id, second.nextCursor!);
    assert.deepEqual(third.entries.map(event => event.revision), [5, 4, 3, 2, 1]); assert.equal(third.nextCursor, null);
    assert.equal(new Set([...first.entries, ...second.entries, ...third.entries].map(event => event.id)).size, 45);
    assert.deepEqual(await db.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owners[0] } }), accountBefore);
    await assert.rejects(() => getCorrectionReviewHistory(db, actor, owners[0], example.id, foreign.id), /unavailable/);
    await assert.rejects(() => getCorrectionReviewHistory(db, actor, owners[0], example.id, "invalid"));
    for (const adminMode of [false, true]) await assert.rejects(() => getCorrectionReviewHistory(db,
      { userId: owners[1], adminMode }, owners[0], example.id), /unavailable/);
    await assert.rejects(() => getCorrectionReviewHistory(db, { userId: owners[2], adminMode: false }, owners[0], example.id), /unavailable/);
    const admin = await getCorrectionReviewHistory(db, { userId: owners[2], adminMode: true }, owners[0], example.id);
    assert.deepEqual(admin.entries, first.entries);
    assert.equal(await db.correctionLibraryAccess.count({ where: { ownerPlayerId: owners[0], actorId: owners[2], action: "READ_REVIEW_HISTORY", exampleId: example.id } }), 1);
    await db.user.update({ where: { id: owners[2] }, data: { isActive: false } });
    await assert.rejects(() => getCorrectionReviewHistory(db, { userId: owners[2], adminMode: true }, owners[0], example.id), /unavailable/);
    await db.user.update({ where: { id: owners[0] }, data: { forcePasswordChange: true } });
    await assert.rejects(() => getCorrectionReviewHistory(db, actor, owners[0], example.id), /unavailable/);
    await db.user.update({ where: { id: owners[0] }, data: { forcePasswordChange: false } });
    await changeCorrectionExample(db, actor, owners[0], example.id, "WITHDRAW_LABEL");
    assert.deepEqual((await getCorrectionReviewHistory(db, actor, owners[0], example.id)).entries, first.entries);
    await changeCorrectionExample(db, actor, owners[0], example.id, "REMOVE");
    await assert.rejects(() => getCorrectionReviewHistory(db, actor, owners[0], example.id), /unavailable/);
    assert.equal(await db.correctionReviewEvent.count({ where: { ownerPlayerId: owners[0], sourcePhotoId: source } }), 0);
    assert.deepEqual(await db.inventoryItem.aggregate({ _count: { _all: true }, _sum: { quantity: true } }), original);
    console.log("PASS correction history: revision paging, bounded private projection, authorization/audit, withdrawal and removal");
  } finally {
    await db.correctionReviewEvent.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.correctionExample.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.correctionLibraryAccess.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.correctionBlob.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.correctionDeletionTombstone.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.correctionLibraryAccount.deleteMany({ where: { ownerPlayerId: { in: owners } } });
    await db.user.deleteMany({ where: { id: { in: owners } } });
    await db.player.deleteMany({ where: { id: { in: owners } } });
  }
}
