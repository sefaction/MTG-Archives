import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { buildRestoreCredentialFence } from "../lib/backup";
import {
  createStoredSession,
  resolveStoredSession,
} from "../lib/auth-sessions";
import {
  createScannerPairing,
  claimScannerPairing,
  authenticateScanner,
} from "../lib/scanner-store";
import { scannerSecret } from "../lib/scanner-protocol";

// Invoked only after scanner fixture cleanup in the disposable acquisition DB.
// Valid credentials are used against metadata authentication; no helper/device,
// scanner poll, physical START, photo or Inventory mutation is invoked.
export async function verifyRestoreCredentials(db: PrismaClient) {
  assert.equal(await db.authSession.count(), 0);
  assert.equal(await db.scannerPairing.count(), 0);
  assert.equal(await db.scannerAgent.count(), 0);
  const tag = `restore-credentials-${randomUUID()}`;
  const schema = `legacy-'"\\$fence$-${randomUUID()}`;
  const quoted = `"${schema.replaceAll('"', '""')}"`;
  let schemaCreated = false;
  try {
    await db.player.create({ data: { id: tag, name: tag, displayName: tag } });
    const user = await db.user.create({
      data: {
        id: tag,
        username: tag,
        displayName: tag,
        playerId: tag,
        passwordHash: "fixture-not-login",
      },
    });
    const token = await createStoredSession(db, user);
    const pair = await createScannerPairing(db, tag);
    const agentId = randomUUID(),
      secret = scannerSecret();
    const claim = {
      version: 1,
      pairCode: pair.code,
      agentId,
      secret,
      name: "Restore fixture",
    };
    await claimScannerPairing(db, claim);
    const pendingPair = await createScannerPairing(db, tag);
    const authorization = `Bearer ${agentId}.${secret}`;
    const authenticate = () =>
      db.$transaction((tx) =>
        authenticateScanner(tx, authorization, new Date()),
      );
    assert.equal((await resolveStoredSession(db, token))?.id, tag);
    assert.equal((await authenticate()).agent.id, agentId);
    const before = await db.scannerAgent.findUniqueOrThrow({
      where: { id: agentId },
    });
    const fence = buildRestoreCredentialFence("public");
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(fence);
        throw Error("fixture rollback after credential fence");
      }),
      /fixture rollback/,
    );
    assert.deepEqual(
      await db.scannerAgent.findUniqueOrThrow({ where: { id: agentId } }),
      before,
    );
    assert.equal((await resolveStoredSession(db, token))?.id, tag);
    assert.equal((await authenticate()).agent.id, agentId);
    assert.equal(await db.scannerPairing.count({ where: { userId: tag } }), 2);

    await db.$transaction((tx) => tx.$executeRawUnsafe(fence));
    assert.equal(await resolveStoredSession(db, token), null);
    await assert.rejects(authenticate());
    await assert.rejects(
      claimScannerPairing(db, {
        ...claim,
        pairCode: pendingPair.code,
        agentId: randomUUID(),
      }),
    );
    assert.equal(await db.authSession.count(), 0);
    assert.equal(await db.scannerPairing.count(), 0);
    const after = await db.scannerAgent.findUniqueOrThrow({
      where: { id: agentId },
    });
    assert.ok(after.revokedAt);
    assert.deepEqual({ ...after, revokedAt: null }, before);
    assert.deepEqual(
      await db.user.findUniqueOrThrow({ where: { id: tag } }),
      user,
    );
    await db.$executeRawUnsafe(fence);
    assert.deepEqual(
      await db.scannerAgent.findUniqueOrThrow({ where: { id: agentId } }),
      after,
    );

    // New sign-in and explicit pairing work; old credentials remain refused.
    const freshToken = await createStoredSession(db, user);
    assert.equal((await resolveStoredSession(db, freshToken))?.id, tag);
    const freshPair = await createScannerPairing(db, tag);
    const freshAgent = randomUUID(),
      freshSecret = scannerSecret();
    await claimScannerPairing(db, {
      ...claim,
      pairCode: freshPair.code,
      agentId: freshAgent,
      secret: freshSecret,
    });
    assert.equal(
      (
        await db.$transaction((tx) =>
          authenticateScanner(
            tx,
            `Bearer ${freshAgent}.${freshSecret}`,
            new Date(),
          ),
        )
      ).agent.id,
      freshAgent,
    );
    await assert.rejects(authenticate());
    assert.equal(
      await db.scannerRun.count({ where: { agent: { userId: tag } } }),
      0,
    );
    assert.equal(
      await db.inventoryItem.count({ where: { currentOwnerId: tag } }),
      0,
    );

    // Actual PostgreSQL parsing of quoted schema names and missing legacy tables.
    await db.$executeRawUnsafe(`CREATE SCHEMA ${quoted}`);
    schemaCreated = true;
    await db.$executeRawUnsafe(buildRestoreCredentialFence(schema));
    await db.$executeRawUnsafe(
      `CREATE TABLE ${quoted}."AuthSession" (id integer)`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO ${quoted}."AuthSession" VALUES (1)`,
    );
    await db.$executeRawUnsafe(buildRestoreCredentialFence(schema));
    assert.deepEqual(
      await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM ${quoted}."AuthSession"`,
      ),
      [{ n: 0 }],
    );
    assert.equal(
      (await resolveStoredSession(db, freshToken))?.id,
      tag,
      "Legacy schema fence must not touch public",
    );
    console.log(
      "PASS: restore fence invalidates old sessions/pairing/agents, preserves rollback/history/users, accepts fresh credentials and quoted legacy schemas; zero physical runs/Inventory",
    );
  } finally {
    if (schemaCreated)
      await db.$executeRawUnsafe(`DROP SCHEMA ${quoted} CASCADE`);
    await db.authSession.deleteMany({ where: { userId: tag } });
    await db.scannerPairing.deleteMany({ where: { userId: tag } });
    await db.scannerAgent.deleteMany({ where: { userId: tag } });
    await db.user.deleteMany({ where: { id: tag } });
    await db.player.deleteMany({ where: { id: tag } });
  }
}
