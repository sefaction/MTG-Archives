import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ensureCorrectionAccount, saveCorrectionEvidence } from "../lib/acquisition-correction-library";
import { correctionCanonical, correctionHash, CORRECTION_EVIDENCE_LIMIT } from "../lib/acquisition-correction-policy";

export async function verifyCorrectionEvidencePrecision(db: PrismaClient) {
  const owners = [0, 1].map(() => `evidence-precision-${randomUUID()}`);
  const sourcePhotoId = randomUUID();
  const payload = {
    version: 1, role: "SOURCE_JOB", sourcePhotoId,
    job: { output: { printing: { candidates: [{ referenceBoundary: {
      quad: [[0.1, 0.022283614160397525], [0.2, 0.3],
        [0.029977852351801327, 0.4], [0.031683437246699864, 0.012623158408359954]],
    } }] } } },
    text: "O'Reilly Ω\\\"; DROP TABLE ignored; --", nullable: null,
    ordered: [3, 1, 2], tiny: 1e-30, negative: -0.019273814615612927,
  };
  const encoded = correctionCanonical(payload), bytes = Buffer.byteLength(encoded);
  const write = (owner: string, value: unknown = payload) => db.$transaction(async tx => {
    await ensureCorrectionAccount(tx, owner);
    return saveCorrectionEvidence(tx, owner, sourcePhotoId, value);
  });
  try {
    const id = await write(owners[0]);
    const record = await db.correctionEvidence.findUniqueOrThrow({ where: { id } });
    assert.equal(record.ownerPlayerId, owners[0]);
    assert.equal(record.sourcePhotoId, sourcePhotoId);
    const [text] = await db.$queryRaw<Array<{ payload: string }>>`
      SELECT "payload"::text AS payload FROM "CorrectionEvidence" WHERE "id" = ${id}`;
    assert.deepEqual(record.payload, payload);
    assert.deepEqual(JSON.parse(text.payload), payload);
    assert.equal(record.bundleHash, correctionHash(record.payload));
    assert.equal(record.bundleHash, correctionHash(JSON.parse(text.payload)));
    assert.equal(record.bytes, Buffer.byteLength(correctionCanonical(record.payload)));
    assert.equal(record.bytes, bytes);
    // Owner lock serializes deduplication; replay cannot charge a second time.
    const replay = await Promise.all([write(owners[0]), write(owners[0],
      Object.fromEntries(Object.entries(payload).reverse()))]);
    assert.deepEqual(replay, [id, id]);
    assert.equal(await db.correctionEvidence.count({ where: { ownerPlayerId: owners[0] } }), 1);
    assert.equal((await db.correctionLibraryAccount.findUniqueOrThrow({
      where: { ownerPlayerId: owners[0] },
    })).evidenceBytes, BigInt(bytes));
    const otherId = await write(owners[1]);
    assert.notEqual(otherId, id);
    assert.equal((await db.correctionLibraryAccount.findUniqueOrThrow({
      where: { ownerPlayerId: owners[1] },
    })).evidenceBytes, BigInt(bytes));
    const rollback = new Error("precision rollback");
    await assert.rejects(db.$transaction(async tx => {
      await ensureCorrectionAccount(tx, owners[0]);
      await saveCorrectionEvidence(tx, owners[0], sourcePhotoId, { ...payload, revision: 2 });
      throw rollback;
    }), error => error === rollback);
    assert.equal(await db.correctionEvidence.count({ where: { ownerPlayerId: owners[0] } }), 1);
    assert.equal((await db.correctionLibraryAccount.findUniqueOrThrow({
      where: { ownerPlayerId: owners[0] },
    })).evidenceBytes, BigInt(bytes));
    await assert.rejects(write(owners[0], { text: "x".repeat(CORRECTION_EVIDENCE_LIMIT) }), /exceeds bounds/);
    assert.equal(await db.correctionEvidence.count({ where: { ownerPlayerId: owners[0] } }), 1);
    assert.equal((await db.correctionLibraryAccount.findUniqueOrThrow({
      where: { ownerPlayerId: owners[0] },
    })).evidenceBytes, BigInt(bytes));
    console.log("PASS: canonical evidence geometry/text/hash/bytes, owner isolation, concurrent dedup, rollback and bounds");
  } finally {
    const where = { ownerPlayerId: { in: owners } };
    await db.correctionEvidence.deleteMany({ where });
    await db.correctionLibraryAccount.deleteMany({ where });
    assert.equal(await db.correctionEvidence.count({ where }), 0);
    assert.equal(await db.correctionLibraryAccount.count({ where }), 0);
  }
}
