import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { commitImportBatch } from "../lib/import-commit";
import { undoInventoryImport } from "../lib/import-undo";

// Explicitly opt in on a disposable database. All fixtures are owned by this run.
if (process.env.MTG_LOCAL_PILOT_TEST !== "1")
  throw new Error("Requires MTG_LOCAL_PILOT_TEST=1 and a disposable database.");
const db = new PrismaClient();
const tag = `import-integrity-${randomUUID()}`;
const ownerId = tag + "-owner",
  openerId = tag + "-opener",
  userId = tag + "-user",
  cardId = tag + "-card";
const locationId = tag + "-location";
const input = {
  actingUserId: userId,
  playerId: ownerId,
  isAdmin: false,
  destinationLocationId: locationId,
  destinationLocationSection: "Fallback",
};

async function batch(
  policy = "add",
  rows: { quantity: number; status?: string; section?: string }[] = [
    { quantity: 2 },
    { quantity: 3 },
  ],
) {
  return db.importBatch.create({
    data: {
      filename: tag + ".csv",
      importType: `inventory_csv:${policy}`,
      selectedPlayerId: ownerId,
      selectedOriginalOpenerId: openerId,
      createdByUserId: userId,
      status: "PREVIEW",
      totalRows: rows.length,
      items: {
        create: rows.map((row, index) => ({
          rowNumber: index + 2,
          status: row.status || "matched",
          cardPrintingId: cardId,
          parsedCondition: "NM",
          parsedFoilStatus: "ETCHED",
          rawRowJson: {},
          parsedRowJson: {
            quantity: row.quantity,
            name: tag,
            foilStatus: "ETCHED",
            condition: "NM",
            language: "EN",
            notes: "CSV note",
            ...(row.section
              ? {
                  locationName: "Integrity shelf",
                  locationSection: row.section,
                }
              : {}),
          },
        })),
      },
    },
  });
}
const total = async () =>
  (
    await db.inventoryItem.aggregate({
      where: { currentOwnerId: ownerId },
      _sum: { quantity: true },
    })
  )._sum.quantity ?? 0;
const audits = () =>
  db.inventoryAuditLog.count({ where: { changedByUserId: userId } });
const rows = (id: string) =>
  db.importBatchItem.findMany({
    where: { importBatchId: id },
    orderBy: { rowNumber: "asc" },
  });

// Force two initial reads to share the pre-commit snapshot; retries pass through.
function concurrentClient() {
  let reads = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return db.$extends({
    query: {
      importBatch: {
        async findUnique({ args, query }) {
          const result = await query(args);
          if (++reads <= 2) {
            if (reads === 2) release();
            await gate;
          }
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
}

async function run() {
  await db.player.createMany({
    data: [
      { id: ownerId, name: ownerId, displayName: ownerId },
      { id: openerId, name: openerId, displayName: openerId },
    ],
  });
  await db.user.create({
    data: {
      id: userId,
      username: userId,
      displayName: userId,
      passwordHash: "not-a-login-hash",
      playerId: ownerId,
      role: "ADMIN",
    },
  });
  await db.card.create({
    data: {
      id: cardId,
      scryfallId: randomUUID(),
      name: tag,
      typeLine: "Basic Land",
      setCode: "tst",
      collectorNumber: "1",
      rarity: "common",
    },
  });
  await db.inventoryLocation.create({
    data: {
      id: locationId,
      name: "Integrity shelf",
      normalizedName: "integrity shelf",
      ownerPlayerId: ownerId,
    },
  });
  const original = await db.inventoryItem.create({
    data: {
      currentOwnerId: ownerId,
      originalOpenerId: openerId,
      cardId,
      quantity: 4,
      foil: true,
      foilStatus: "ETCHED",
      condition: "NM",
      language: "EN",
      locationId,
      locationSection: "Fallback",
      notes: "Original note",
      sourceType: "MANUAL",
    },
  });

  const first = await batch();
  const concurrent = concurrentClient();
  const results = await Promise.all([
    commitImportBatch(concurrent, { ...input, batchId: first.id }),
    commitImportBatch(concurrent, { ...input, batchId: first.id }),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.committedRows, 0),
    2,
  );
  assert.equal(await total(), 9);
  assert.equal(await audits(), 2);
  assert.equal(
    (await commitImportBatch(db, { ...input, batchId: first.id }))
      .committedRows,
    0,
  );
  const committed = await rows(first.id);
  assert.deepEqual(
    committed.map((row) => [row.beforeQuantity, row.afterQuantity]),
    [
      [4, 6],
      [6, 9],
    ],
  );
  assert.ok(
    committed.every(
      (row) => row.inventoryItemId === original.id && row.status === "imported",
    ),
  );
  const audit = await db.inventoryAuditLog.findFirstOrThrow({
    where: { inventoryItemId: original.id },
  });
  assert.equal((audit.afterJson as Prisma.JsonObject).importBatchId, first.id);
  console.log(
    "PASS: simultaneous confirmations and retries apply every row exactly once, with audit lineage",
  );

  const beforeUndoAudits = await audits();
  let undoWrites = 0;
  const failUndo = db.$extends({
    query: {
      inventoryAuditLog: {
        async create({ args, query }) {
          if (args.data.changeType === "import_undo" && ++undoWrites === 2)
            throw new Error("Injected undo failure");
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  await assert.rejects(
    undoInventoryImport(failUndo, first.id, userId),
    /Injected undo failure/,
  );
  assert.equal(await total(), 9);
  assert.equal(await audits(), beforeUndoAudits);
  assert.ok((await rows(first.id)).every((row) => row.status === "imported"));
  assert.equal((await undoInventoryImport(db, first.id, userId)).blocked, 0);
  assert.equal(await total(), 4);
  assert.equal(
    (await db.inventoryItem.findUniqueOrThrow({ where: { id: original.id } }))
      .notes,
    "Original note",
  );
  await undoInventoryImport(db, first.id, userId);
  assert.equal(await total(), 4);
  console.log(
    "PASS: undo reverses shared-stack rows in reverse order, rolls back failures, retains history, and is retry-safe",
  );

  const failed = await batch();
  const auditCount = await audits();
  let writes = 0;
  const failCommit = db.$extends({
    query: {
      importBatchItem: {
        async update({ args, query }) {
          if (args.data.status === "imported" && ++writes === 2)
            throw new Error("Injected receipt failure");
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  await assert.rejects(
    commitImportBatch(failCommit, { ...input, batchId: failed.id }),
    /Injected receipt failure/,
  );
  assert.equal(await total(), 4);
  assert.equal(await audits(), auditCount);
  assert.ok(
    (await rows(failed.id)).every(
      (row) => row.status === "matched" && !row.inventoryItemId,
    ),
  );
  assert.equal(
    (await db.importBatch.findUniqueOrThrow({ where: { id: failed.id } }))
      .status,
    "PREVIEW",
  );
  await commitImportBatch(db, { ...input, batchId: failed.id });
  assert.equal(await total(), 9);
  console.log(
    "PASS: failure after inventory and audit writes rolls back the entire ready set; retry succeeds once",
  );

  const separate = await batch("separate", [
    { quantity: 1, section: "Pocket 1" },
    { quantity: 2, section: "Pocket 1" },
    { quantity: 8, status: "ambiguous" },
  ]);
  await commitImportBatch(db, { ...input, batchId: separate.id });
  const separateRows = await rows(separate.id);
  assert.notEqual(
    separateRows[0].inventoryItemId,
    separateRows[1].inventoryItemId,
  );
  const inventory = await db.inventoryItem.findUniqueOrThrow({
    where: { id: separateRows[0].inventoryItemId! },
  });
  assert.deepEqual(
    [
      inventory.originalOpenerId,
      inventory.foilStatus,
      inventory.foil,
      inventory.condition,
      inventory.language,
      inventory.locationId,
      inventory.locationSection,
      inventory.notes,
      inventory.sourceType,
    ],
    [
      openerId,
      "ETCHED",
      true,
      "NM",
      "EN",
      locationId,
      "Pocket 1",
      "CSV note",
      "CSV_PULL_IMPORT",
    ],
  );
  assert.equal(separateRows[2].status, "ambiguous");
  assert.equal(await total(), 12);
  assert.equal(
    (await db.importBatch.findUniqueOrThrow({ where: { id: separate.id } }))
      .status,
    "IMPORTED_WITH_REVIEW",
  );
  assert.equal((await undoInventoryImport(db, separate.id, userId)).blocked, 0);
  assert.equal(await total(), 9);
  assert.equal(
    (await db.inventoryItem.findUniqueOrThrow({ where: { id: inventory.id } }))
      .quantity,
    0,
  );
  console.log(
    "PASS: separate policy, row/fallback locations, opener/finish/condition/language/notes/source and partial review are preserved",
  );

  const preview = await batch("preview");
  await assert.rejects(
    commitImportBatch(db, { ...input, batchId: preview.id }),
    /preview only/,
  );
  const unauthorized = await batch();
  await assert.rejects(
    commitImportBatch(db, {
      ...input,
      batchId: unauthorized.id,
      playerId: openerId,
    }),
    /Not authorized/,
  );
  await assert.rejects(
    commitImportBatch(db, {
      ...input,
      batchId: unauthorized.id,
      destinationLocationId: "missing",
    }),
    /destination/,
  );
  assert.equal(await total(), 9);
  console.log(
    "PASS: preview, owner boundary and invalid destinations have no inventory effects",
  );

  const raceA = await batch("add", [{ quantity: 2, section: "Race" }]);
  const raceB = await batch("add", [{ quantity: 3, section: "Race" }]);
  const racing = concurrentClient();
  await Promise.all([
    commitImportBatch(racing, { ...input, batchId: raceA.id }),
    commitImportBatch(racing, { ...input, batchId: raceB.id }),
  ]);
  const raceInventory = await db.inventoryItem.findMany({
    where: { currentOwnerId: ownerId, locationSection: "Race" },
  });
  assert.equal(raceInventory.length, 1);
  assert.equal(raceInventory[0].quantity, 5);
  console.log(
    "PASS: concurrent different batches serialize creation of the same inventory stack",
  );

  const staged = await batch("add", [
    { quantity: 2, status: "ambiguous", section: "Staged" },
    { quantity: 3, section: "Staged" },
  ]);
  await commitImportBatch(db, { ...input, batchId: staged.id });
  const pending = (await rows(staged.id))[0];
  await db.importBatchItem.update({
    where: { id: pending.id },
    data: { status: "resolved" },
  });
  await commitImportBatch(db, { ...input, batchId: staged.id });
  assert.equal(await total(), 19);
  assert.equal((await undoInventoryImport(db, staged.id, userId)).blocked, 0);
  assert.equal(await total(), 14);
  console.log(
    "PASS: undo respects commit chronology when earlier CSV rows resolve in later passes",
  );

  // A later audited edit restoring the same quantity must still block undo.
  await db.inventoryAuditLog.create({
    data: {
      inventoryItemId: original.id,
      changedByUserId: userId,
      changeType: "inventory_edited",
      beforeJson: { quantity: 9 },
      afterJson: { quantity: 9 },
    },
  });
  assert.equal((await undoInventoryImport(db, failed.id, userId)).blocked, 2);
  assert.equal(await total(), 14);
  assert.equal(
    (await db.importBatch.findUniqueOrThrow({ where: { id: failed.id } }))
      .status,
    "PARTIALLY_UNDONE",
  );
  console.log(
    "PASS: undo refuses inventory changed after import, even at the same quantity",
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.importBatchItem.deleteMany({
      where: { importBatch: { selectedPlayerId: ownerId } },
    });
    await db.importBatch.deleteMany({ where: { selectedPlayerId: ownerId } });
    await db.inventoryAuditLog.deleteMany({
      where: { changedByUserId: userId },
    });
    await db.inventoryItem.deleteMany({ where: { currentOwnerId: ownerId } });
    await db.inventoryLocation.deleteMany({
      where: { ownerPlayerId: ownerId },
    });
    await db.user.deleteMany({ where: { id: userId } });
    await db.player.deleteMany({ where: { id: { in: [ownerId, openerId] } } });
    await db.card.deleteMany({ where: { id: cardId } });
    await db.$disconnect();
  });
