import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import {
  writeInventoryReceipt,
  type InventoryReceiptLot,
} from "../lib/inventory-receipt";
import { addInventoryCardToLocation } from "../lib/inventory-manual";
import { receivedTradeInventoryData } from "../lib/trade-inventory";

export async function verifyInventoryReceipts(db: PrismaClient) {
  const id = `receipt-integrity-${randomUUID()}`;
  const owner = id + "-owner",
    opener = id + "-opener",
    user = id + "-user";
  try {
    await db.player.createMany({
      data: [owner, opener].map((id) => ({ id, name: id, displayName: id })),
    });
    await db.user.create({
      data: {
        id: user,
        username: user,
        displayName: user,
        passwordHash: "not-a-login",
        playerId: owner,
        role: "PLAYER",
      },
    });
    await db.card.create({
      data: {
        id,
        scryfallId: randomUUID(),
        name: id,
        setCode: "tst",
        collectorNumber: "1",
        rarity: "common",
        typeLine: "Land",
      },
    });
    await db.inventoryLocation.create({
      data: { id, name: id, normalizedName: id, ownerPlayerId: owner },
    });
    await db.league.create({ data: { id, name: id, slug: id } });
    await db.season.create({
      data: { id, name: id, leagueId: id, year: 2026, startDate: new Date() },
    });
    await db.round.create({
      data: {
        id,
        seasonId: id,
        name: id,
        monthNumber: 1,
        startDate: new Date(),
      },
    });
    await db.pull.create({
      data: {
        id,
        roundId: id,
        playerId: opener,
        cardId: id,
        quantity: 1,
        condition: "NM",
      },
    });
    const lot: InventoryReceiptLot = {
      currentOwnerId: owner,
      originalOpenerId: null,
      cardId: id,
      quantity: 1200,
      foilStatus: "ETCHED",
      sourceType: "ACQUISITION",
      condition: "LP",
      language: "EN",
      locationId: id,
      locationSection: "Scans",
      acquiredFromPullId: null,
      roundId: null,
      notes: "Distinct scan lot",
    };
    const audit = {
      action: "acquisition_committed",
      actingUserId: user,
      metadata: { fixture: id },
    };
    const receive = (data: InventoryReceiptLot) =>
      db.$transaction((tx) =>
        writeInventoryReceipt(tx, { lot: data, merge: null, audit }),
      );
    const first = await receive(lot);
    assert.equal(
      first.inventory.quantity,
      1200,
      "receipts must not use the manual 999-copy clamp",
    );
    assert.equal(first.inventory.originalOpenerId, null);
    assert.equal(first.inventory.foil, true);
    assert.equal(first.inventory.foilStatus, "ETCHED");
    const known = await receive({
      ...lot,
      originalOpenerId: opener,
      roundId: id,
      acquiredFromPullId: id,
      quantity: 3,
    });
    assert.equal(known.inventory.originalOpenerId, opener);
    assert.equal(known.inventory.roundId, id);
    assert.equal(known.inventory.acquiredFromPullId, id);
    assert.notEqual(first.inventory.id, known.inventory.id);
    const same = await receive(lot);
    assert.notEqual(
      same.inventory.id,
      first.inventory.id,
      "separate receipts cannot absorb a prior lot",
    );
    // Receipt idempotency belongs to the upcoming acquisition membership layer.
    assert.equal(
      (
        await db.inventoryItem.findUniqueOrThrow({
          where: { id: first.inventory.id },
          include: { originalOpener: true },
        })
      ).originalOpener,
      null,
    );
    const receivedTrade = await db.inventoryItem.create({
      data: receivedTradeInventoryData(first.inventory, 1, opener, id),
    });
    assert.equal(
      receivedTrade.originalOpenerId,
      null,
      "trade receiving does not invent an opener",
    );

    const stock = () =>
      db.inventoryItem.aggregate({
        where: { cardId: id },
        _sum: { quantity: true },
        _count: true,
      });
    const before = await stock();
    const auditsBefore = await db.inventoryAuditLog.count({
      where: { changedByUserId: user },
    });
    const fault = db.$extends({
      query: {
        inventoryAuditLog: {
          async create() {
            throw new Error("injected receipt audit failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    await assert.rejects(
      fault.$transaction((tx) =>
        writeInventoryReceipt(tx, { lot, merge: null, audit }),
      ),
      /injected/,
    );
    for (const quantity of [0, -1, 1.2, 2147483648]) {
      await assert.rejects(
        receive({ ...lot, quantity }),
        /positive database integer/,
      );
    }
    await assert.rejects(
      db.$transaction((tx) =>
        writeInventoryReceipt(tx, {
          lot,
          merge: { where: {}, update: {} },
          audit,
        }),
      ),
      /separate provenance lot/,
    );
    assert.deepEqual(await stock(), before);
    assert.equal(
      await db.inventoryAuditLog.count({ where: { changedByUserId: user } }),
      auditsBefore,
    );

    const manual = {
      ownerPlayerId: owner,
      cardId: id,
      locationId: id,
      quantity: 2,
      actingUserId: user,
      condition: "NM",
      language: "EN",
    };
    const variants: Partial<InventoryReceiptLot>[] = [
      { notes: "Keep this note" },
      { sourceType: "CSV_PULL_IMPORT" },
      { roundId: id },
      { acquiredFromPullId: id },
      { originalOpenerId: opener },
      { originalOpenerId: null },
      { sourceType: "ACQUISITION" },
    ];
    for (const [index, variant] of variants.entries()) {
      const section = `Manual ${index}`;
      const prior = await db.inventoryItem.create({
        data: {
          ...lot,
          originalOpenerId: owner,
          sourceType: "MANUAL",
          condition: "NM",
          foilStatus: "NONFOIL",
          foil: false,
          quantity: 4,
          notes: null,
          locationSection: section,
          ...variant,
        },
      });
      const added = await db.$transaction((tx) =>
        addInventoryCardToLocation(tx, { ...manual, locationSection: section }),
      );
      assert.notEqual(added.inventory.id, prior.id, JSON.stringify(variant));
      assert.deepEqual(
        await db.inventoryItem.findUniqueOrThrow({ where: { id: prior.id } }),
        prior,
      );
      const replayAdd = await db.$transaction((tx) =>
        addInventoryCardToLocation(tx, { ...manual, locationSection: section }),
      );
      assert.equal(
        replayAdd.inventory.id,
        added.inventory.id,
        "compatible manual additions still coalesce",
      );
      assert.equal(replayAdd.inventory.quantity, 4);
    }

    // Two manual transactions read the same stack before either gets the row lock.
    const seed = await db.$transaction((tx) =>
      addInventoryCardToLocation(tx, {
        ...manual,
        locationSection: "Race",
        quantity: 4,
      }),
    );
    let reads = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racing = db.$extends({
      query: {
        inventoryItem: {
          async findFirst({ args, query }) {
            const result = await query(args);
            if (++reads <= 2) {
              if (reads === 2) release();
              await barrier;
            }
            return result;
          },
        },
      },
    }) as unknown as PrismaClient;
    await Promise.all(
      [1, 2].map(() =>
        racing.$transaction((tx) =>
          addInventoryCardToLocation(tx, {
            ...manual,
            locationSection: "Race",
          }),
        ),
      ),
    );
    assert.equal(
      (
        await db.inventoryItem.findUniqueOrThrow({
          where: { id: seed.inventory.id },
        })
      ).quantity,
      8,
    );
    const logs = await db.inventoryAuditLog.findMany({
      where: { inventoryItemId: seed.inventory.id },
    });
    assert.deepEqual(
      logs
        .map((l) => (l.beforeJson as any).beforeQuantity)
        .sort((a, b) => a - b),
      [0, 4, 6],
    );
    const beforeFault = await stock();
    await assert.rejects(
      fault.$transaction((tx) =>
        addInventoryCardToLocation(tx, { ...manual, locationSection: "Race" }),
      ),
      /injected/,
    );
    assert.deepEqual(
      await stock(),
      beforeFault,
      "audit failure rolls back an increment as well as creation",
    );
    console.log(
      "PASS: receipt quantities >999, unknown/known opener, separate scan lots, pull/round/notes/source preservation, compatible manual merging, actual concurrent audit quantities and atomic rollback",
    );
  } finally {
    await db.inventoryAuditLog.deleteMany({ where: { changedByUserId: user } });
    await db.inventoryItem.deleteMany({ where: { cardId: id } });
    await db.pull.deleteMany({ where: { id } });
    await db.round.deleteMany({ where: { id } });
    await db.season.deleteMany({ where: { id } });
    await db.league.deleteMany({ where: { id } });
    await db.inventoryLocation.deleteMany({ where: { id } });
    await db.card.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: user } });
    await db.player.deleteMany({ where: { id: { in: [owner, opener] } } });
  }
}
