import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  lockAndReadInventoryCapacity,
  lockInventoryDestinations,
} from "../lib/inventory-capacity";
import { addInventoryCardToLocation } from "../lib/inventory-manual";
import { commitImportBatch, importTransaction } from "../lib/import-commit";
import { moveInventoryStorageBatch } from "../lib/inventory-storage-move";
import { updateLocation } from "../lib/inventory-locations";
import { returnCommittedInventoryFromDeck } from "../lib/deck-inventory";
import { receivedTradeInventoryData } from "../lib/trade-inventory";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function client(label: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("application_name", label);
  return new PrismaClient({ datasourceUrl: url.href });
}
async function waitForLock(db: PrismaClient, label: string) {
  const until = Date.now() + 5000;
  do {
    const rows = await db.$queryRaw<
      { waiting: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${label} AND wait_event_type = 'Lock') AS waiting`;
    if (rows[0].waiting) return;
    await setTimeout(20);
  } while (Date.now() < until);
  throw new Error(`Expected a database lock wait for ${label}`);
}

export async function verifyInventoryCapacity(db: PrismaClient) {
  const tag = `capacity-${randomUUID()}`,
    owner = tag,
    user = tag,
    card = tag;
  const destination = tag + "-dest",
    source = tag + "-source",
    deckLocation = tag + "-deck";
  const ownedPlayers = [owner, ...[1, 2, 3].map((i) => tag + "-owner" + i)];
  try {
    await db.player.createMany({
      data: ownedPlayers.map((id) => ({ id, name: id, displayName: id })),
    });
    await db.user.create({
      data: {
        id: user,
        username: user,
        displayName: user,
        playerId: owner,
        passwordHash: "not-a-login",
      },
    });
    await db.card.create({
      data: {
        id: card,
        scryfallId: randomUUID(),
        name: tag,
        setCode: "tst",
        collectorNumber: "1",
        typeLine: "Land",
        rarity: "common",
      },
    });
    await db.deck.create({ data: { id: tag, ownerUserId: user, name: tag } });
    await db.inventoryLocation.createMany({
      data: [
        {
          id: destination,
          ownerPlayerId: owner,
          name: destination,
          normalizedName: destination,
          storageLayout: {
            capacity: 10,
            sections: [
              { name: "A", capacity: 8 },
              { name: "B", capacity: 4 },
            ],
          },
        },
        {
          id: source,
          ownerPlayerId: owner,
          name: source,
          normalizedName: source,
        },
        {
          id: deckLocation,
          ownerPlayerId: owner,
          name: "Deck: " + tag,
          normalizedName: "deck: " + tag,
          kind: "DECK",
          systemManaged: true,
          deckId: tag,
          type: "Deck",
        },
      ],
    });
    const data = {
      currentOwnerId: owner,
      originalOpenerId: null,
      cardId: card,
      quantity: 2,
      condition: "NM",
      sourceType: "ACQUISITION" as const,
      locationId: destination,
      locationSection: "A",
    };
    const a = await db.inventoryItem.create({ data });
    const b = await db.inventoryItem.create({
      data: { ...data, quantity: 3, locationSection: "B" },
    });
    const snapshot = () =>
      db.$transaction((tx) =>
        lockAndReadInventoryCapacity(tx, {
          locationId: destination,
          ownerPlayerId: owner,
          section: "A",
        }),
      );
    const original = await snapshot();
    assert.deepEqual(
      [original.totalQuantity, original.sectionQuantity, original.remaining],
      [5, 2, 5],
    );
    await assert.rejects(
      lockInventoryDestinations(db, [destination]),
      /transaction client/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        lockAndReadInventoryCapacity(tx, {
          locationId: destination,
          ownerPlayerId: ownedPlayers[1],
          section: null,
        }),
      ),
      /unavailable/,
    );
    await db.inventoryItem.update({
      where: { id: a.id },
      data: { notes: "metadata only" },
    });
    assert.equal((await snapshot()).revision, original.revision);
    await db.inventoryItem.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { quantity: { increment: 1 } },
    });
    assert.equal(
      (await snapshot()).revision,
      original.revision + 1,
      "one touch per statement and destination",
    );
    const beforeRollback = await snapshot();
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.inventoryItem.update({
          where: { id: a.id },
          data: { quantity: { increment: 1 } },
        });
        throw new Error("rollback capacity");
      }),
      /rollback capacity/,
    );
    assert.deepEqual(await snapshot(), beforeRollback);

    // Gate-first order: actual ordinary service calls cannot finish while the
    // acquisition capacity critical section holds its location lock.
    async function gateFirst(
      name: string,
      writer: (writerDb: PrismaClient) => Promise<unknown>,
    ) {
      const label = `${tag.slice(0, 40)}-${name}`,
        worker = client(label),
        held = deferred(),
        release = deferred();
      let before = 0;
      const holding = db.$transaction(
        async (tx) => {
          before = (
            await lockAndReadInventoryCapacity(tx, {
              locationId: destination,
              ownerPlayerId: owner,
              section: "A",
            })
          ).revision;
          held.resolve();
          await release.promise;
        },
        { timeout: 15000 },
      );
      await held.promise;
      const writing = writer(worker).then(
        () => null,
        (error) => error,
      );
      try {
        await waitForLock(db, label);
      } finally {
        release.resolve();
        await holding;
      }
      const error = await writing;
      await worker.$disconnect();
      if (error) throw error;
      assert.ok((await snapshot()).revision > before, name);
    }
    await gateFirst("manual", (p) =>
      p.$transaction((tx) =>
        addInventoryCardToLocation(tx, {
          ownerPlayerId: owner,
          cardId: card,
          locationId: destination,
          locationSection: "A",
          quantity: 1,
          actingUserId: user,
        }),
      ),
    );
    const batch = await db.importBatch.create({
      data: {
        filename: tag,
        importType: "inventory_csv:add",
        selectedPlayerId: owner,
        selectedOriginalOpenerId: owner,
        createdByUserId: user,
        status: "PREVIEW",
        items: {
          create: {
            rowNumber: 2,
            status: "matched",
            cardPrintingId: card,
            parsedCondition: "NM",
            parsedFoilStatus: "NONFOIL",
            rawRowJson: {},
            parsedRowJson: { quantity: 1, condition: "NM", language: "EN" },
          },
        },
      },
    });
    await gateFirst("import", (p) =>
      commitImportBatch(p, {
        batchId: batch.id,
        actingUserId: user,
        playerId: owner,
        isAdmin: false,
        destinationLocationId: destination,
        destinationLocationSection: "A",
      }),
    );
    const moving = await db.inventoryItem.create({
      data: { ...data, locationId: source, quantity: 2 },
    });
    await gateFirst("move", (p) =>
      moveInventoryStorageBatch(p, {
        actorUserId: user,
        destinationLocationId: destination,
        destinationLocationSection: "A",
        itemIds: [moving.id],
        allowedOwnerId: owner,
        quantityLimit: 1,
      }),
    );
    await gateFirst("trade", (p) =>
      p.$transaction((tx) =>
        tx.inventoryItem.create({
          data: receivedTradeInventoryData(a, 1, owner, destination),
        }),
      ),
    );
    await db.inventoryItem.create({
      data: { ...data, locationId: deckLocation, quantity: 1 },
    });
    await gateFirst("deck", (p) =>
      returnCommittedInventoryFromDeck(p, {
        actorUserId: user,
        ownerPlayerId: owner,
        deckId: tag,
        deckName: tag,
        destinationLocationId: destination,
        mode: "bulk_returned_from_deck",
      }),
    );
    await gateFirst("layout", (p) =>
      updateLocation(p, {
        id: destination,
        ownerPlayerId: owner,
        name: destination,
        storageLayout: {
          capacity: 20,
          sections: [{ name: "A", capacity: 15 }],
        },
      }),
    );
    await gateFirst("delete", (p) =>
      p.inventoryItem.delete({ where: { id: b.id } }),
    );
    assert.ok((await snapshot()).totalQuantity > 0);

    // Writer-first order: an old serializable snapshot must retry after the
    // writer commits, then observe the new revision and occupancy.
    const prior = await snapshot(),
      ready = deferred(),
      releaseWriter = deferred();
    const writer = db.$transaction(
      async (tx) => {
        await addInventoryCardToLocation(tx, {
          ownerPlayerId: owner,
          cardId: card,
          locationId: destination,
          locationSection: "A",
          quantity: 1,
          actingUserId: user,
        });
        ready.resolve();
        await releaseWriter.promise;
      },
      { timeout: 15000 },
    );
    await ready.promise;
    const label = `${tag.slice(0, 40)}-capture`,
      captureDb = client(label);
    let attempts = 0;
    const capturing = importTransaction(captureDb, async (tx) => {
      attempts++;
      await tx.inventoryLocation.findUnique({ where: { id: destination } });
      return lockAndReadInventoryCapacity(tx, {
        locationId: destination,
        ownerPlayerId: owner,
        section: "A",
      });
    });
    try {
      await waitForLock(db, label);
    } finally {
      releaseWriter.resolve();
      await writer;
    }
    const fresh = await capturing;
    await captureDb.$disconnect();
    assert.ok(
      attempts >= 2,
      "stale serializable snapshot retries the whole capacity read",
    );
    assert.ok(fresh.revision > prior.revision);
    assert.equal(fresh.totalQuantity, prior.totalQuantity + 1);

    // SQL updates, section/owner changes, null destinations and primary-key changes
    // share the same mechanism. API wrappers cannot silently bypass this gate.
    const rev = fresh.revision;
    await db.$executeRaw`UPDATE "InventoryItem" SET id = ${a.id + "-renamed"}, "locationSection" = 'B' WHERE id = ${a.id}`;
    assert.ok((await snapshot()).revision > rev);
    await db.inventoryItem.update({
      where: { id: a.id + "-renamed" },
      data: { locationId: null },
    });
    const sourceRevision = (
      await db.inventoryLocation.findUniqueOrThrow({ where: { id: source } })
    ).capacityRevision;
    await db.inventoryItem.update({
      where: { id: a.id + "-renamed" },
      data: { locationId: source },
    });
    assert.ok(
      (await db.inventoryLocation.findUniqueOrThrow({ where: { id: source } }))
        .capacityRevision > sourceRevision,
    );
    const unknown = await db.$transaction((tx) =>
      lockAndReadInventoryCapacity(tx, {
        locationId: source,
        ownerPlayerId: owner,
        section: null,
      }),
    );
    assert.equal(unknown.remaining, null);

    // Bounded scale evidence: 150,000 copies in 60,000 stacks, four uneven owners,
    // 400 locations and 4,000 named sections. No application snapshot is used.
    const sizes = [40000, 12000, 6000, 2000],
      locations: Prisma.InventoryLocationCreateManyInput[] = [],
      stock: Prisma.InventoryItemCreateManyInput[] = [];
    for (let o = 0; o < 4; o++) {
      for (let l = 0; l < 100; l++)
        locations.push({
          id: `${tag}-scale-${o}-${l}`,
          ownerPlayerId: ownedPlayers[o],
          name: `${o}/${l}`,
          normalizedName: `${o}/${l}`,
          storageLayout: {
            capacity: 2000,
            sections: Array.from({ length: 10 }, (_, i) => ({
              name: `${i}`,
              capacity: 200,
            })),
          },
        });
      for (let s = 0; s < sizes[o]; s++)
        stock.push({
          ...data,
          id: `${tag}-stack-${o}-${s}`,
          currentOwnerId: ownedPlayers[o],
          quantity: s % 2 === 0 ? 2 : 3,
          locationId: `${tag}-scale-${o}-${s % 100}`,
          locationSection: `${Math.floor(s / 100) % 10}`,
        });
    }
    await db.inventoryLocation.createMany({ data: locations });
    const started = performance.now();
    for (let i = 0; i < stock.length; i += 1000)
      await db.inventoryItem.createMany({ data: stock.slice(i, i + 1000) });
    const insertMs = performance.now() - started,
      updateStart = performance.now();
    await db.inventoryItem.updateMany({
      where: { id: { startsWith: tag + "-stack-" } },
      data: { quantity: { increment: 1 } },
    });
    const updateMs = performance.now() - updateStart;
    await db.inventoryItem.updateMany({
      where: { id: { startsWith: tag + "-stack-" } },
      data: { quantity: { decrement: 1 } },
    });
    const totals = await db.inventoryItem.aggregate({
      where: { id: { startsWith: tag + "-stack-" } },
      _sum: { quantity: true },
      _count: true,
    });
    assert.equal(totals._sum.quantity, 150000);
    assert.equal(totals._count, 60000);
    // Baseline comparison is confined to the named disposable verification DBs.
    // Disabling this one trigger is transactional and ALWAYS rolled back.
    const [{ name: databaseName }] = await db.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    assert.ok(
      ["acquisition_fixture", "import_integrity"].includes(databaseName),
    );
    const statementMs: { enabled: boolean; ms: number }[] = [];
    for (const enabled of [true, false, false, true]) {
      const rollback = new Error("benchmark rollback");
      await assert.rejects(
        db.$transaction(
          async (tx) => {
            if (!enabled)
              await tx.$executeRawUnsafe(
                'ALTER TABLE "InventoryItem" DISABLE TRIGGER mtg_inventory_capacity_update',
              );
            const start = performance.now();
            await tx.inventoryItem.updateMany({
              where: { id: { startsWith: tag + "-stack-" } },
              data: { quantity: { increment: 1 } },
            });
            statementMs.push({ enabled, ms: performance.now() - start });
            throw rollback;
          },
          { timeout: 60000 },
        ),
        (error) => error === rollback,
      );
    }
    const triggers = await db.$queryRaw<
      { name: string; enabled: string }[]
    >`SELECT tgname AS name, tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = '"InventoryItem"'::regclass AND tgname LIKE 'mtg_inventory_capacity_%'`;
    assert.equal(triggers.length, 4);
    assert.ok(triggers.every((t) => t.enabled === "O"));
    console.log(
      JSON.stringify({
        capacityScale: {
          owners: 4,
          locations: 400,
          sections: 4000,
          stacks: 60000,
          copies: 150000,
          insertMs,
          bulkUpdateMs: updateMs,
          rollbackStatementMs: statementMs,
        },
      }),
    );
    console.log(
      "PASS: database capacity coordination, actual service lock waits, stale snapshot retry, rollback, direct SQL, unknown capacity and bounded collection scale",
    );
  } finally {
    await db.importBatchItem.deleteMany({
      where: { importBatch: { selectedPlayerId: owner } },
    });
    await db.importBatch.deleteMany({ where: { selectedPlayerId: owner } });
    await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: user } });
    await db.inventoryItem.deleteMany({ where: { cardId: card } });
    await db.inventoryLocation.deleteMany({
      where: { ownerPlayerId: { in: ownedPlayers } },
    });
    await db.deck.deleteMany({ where: { id: tag } });
    await db.user.deleteMany({ where: { id: user } });
    await db.player.deleteMany({ where: { id: { in: ownedPlayers } } });
    await db.card.deleteMany({ where: { id: card } });
  }
}
