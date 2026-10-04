import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertSettledScannerTransfers } from "../lib/backup-drill-scanner-guard";

// Called only by the isolated acquisition database runner. These records are
// metadata fixtures; no agent credential, physical start or helper is used.
export async function verifyBackupScannerSettlement(db: PrismaClient) {
  const tag = `backup-scanner-settlement-${randomUUID()}`;
  assert.equal(
    await db.scannerRun.count(),
    0,
    "Requires isolated scanner fixture cleanup",
  );
  try {
    await db.player.create({ data: { id: tag, name: tag, displayName: tag } });
    await db.user.create({
      data: {
        id: tag,
        username: tag,
        displayName: tag,
        playerId: tag,
        passwordHash: "not-login",
      },
    });
    await db.scannerAgent.create({
      data: {
        id: tag,
        userId: tag,
        name: tag,
        tokenHash: createHash("sha256").update(tag).digest("hex"),
        credentialHash: "not-a-credential",
        expiresAt: new Date(0),
        revokedAt: new Date(0),
      },
    });
    const session = await db.acquisitionSession.create({
      data: {
        createdByUserId: tag,
        ownerPlayerId: tag,
        section: "",
        requestKey: tag,
        requestPayload: "{}",
        placement: {},
        policy: {},
        run: {
          create: {
            sourceRunId: tag,
            providerId: "windows-scanner-simplex-v1",
            enforcement: "FIXTURE",
            controls: [],
          },
        },
      },
      include: { run: true },
    });
    await db.scannerRun.create({
      data: {
        id: tag,
        agentId: tag,
        acquisitionRunId: session.run!.id,
        epoch: tag,
        requestPayload: "{}",
        deviceId: "no-physical-device",
        device: {},
        settings: {},
      },
    });
    const cases = [
      { status: "DRAINED", outcome: Prisma.DbNull, settled: true },
      {
        status: "CANCELLED_BEFORE_START",
        outcome: Prisma.DbNull,
        settled: true,
      },
      { status: "ERROR", outcome: Prisma.DbNull, settled: false },
      { status: "ERROR", outcome: Prisma.JsonNull, settled: false },
      {
        status: "ERROR",
        outcome: { outcome: "ERROR", imageCount: 0 },
        settled: true,
      },
      { status: "QUEUED", outcome: Prisma.DbNull, settled: false },
      { status: "STARTED", outcome: Prisma.DbNull, settled: false },
      {
        status: "RECONCILIATION",
        outcome: { outcome: "ERROR" },
        settled: false,
      },
    ];
    for (const entry of cases) {
      await db.scannerRun.update({
        where: { id: tag },
        data: {
          status: entry.status,
          outcome: entry.outcome,
          executionId: ["QUEUED", "CANCELLED_BEFORE_START"].includes(
            entry.status,
          )
            ? null
            : "metadata-only-execution",
        },
      });
      const before = await db.scannerRun.findUniqueOrThrow({
        where: { id: tag },
      });
      if (entry.settled) await assertSettledScannerTransfers(db);
      else
        await assert.rejects(
          assertSettledScannerTransfers(db),
          /Drain or cancel/,
        );
      assert.deepEqual(
        await db.scannerRun.findUniqueOrThrow({ where: { id: tag } }),
        before,
      );
    }
    // The legacy spelling is already prohibited by the current schema. Do not
    // weaken that constraint to manufacture a historical row for the guard.
    const beforeLegacy = await db.scannerRun.findUniqueOrThrow({
      where: { id: tag },
    });
    await assert.rejects(
      db.scannerRun.update({
        where: { id: tag },
        data: { status: "CANCELLED" },
      }),
      /check constraint/,
    );
    assert.deepEqual(
      await db.scannerRun.findUniqueOrThrow({ where: { id: tag } }),
      beforeLegacy,
    );
    assert.equal(
      await db.acquisitionPhoto.count({ where: { runId: session.run!.id } }),
      0,
    );
    assert.equal(
      await db.inventoryItem.count({ where: { currentOwnerId: tag } }),
      0,
    );
    console.log(
      "PASS: maintenance guard accepts durable transfers and rejects SQL/JSON null and uncertain states without mutation",
    );
  } finally {
    await db.scannerRun.deleteMany({ where: { id: tag } });
    await db.scannerAgent.deleteMany({ where: { id: tag } });
    await db.acquisitionRun.deleteMany({
      where: { session: { ownerPlayerId: tag } },
    });
    await db.acquisitionSession.deleteMany({ where: { ownerPlayerId: tag } });
    await db.user.deleteMany({ where: { id: tag } });
    await db.player.deleteMany({ where: { id: tag } });
  }
}
