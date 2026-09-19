/** Run only in the explicitly disposable local stack:
 * docker compose ... exec -e MTG_LOCAL_PILOT_TEST=1 web npx tsx scripts/verify-vault-pilot.ts
 * Creates a unique test owner, verifies real PostgreSQL transactions, and removes only its fixtures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { moveInventoryStorageBatch } from "../lib/inventory-storage-move";
import { getStorageLocations } from "../lib/storage-summary";

async function main() {
  if (process.env.MTG_LOCAL_PILOT_TEST !== "1")
    throw new Error(
      "Set MTG_LOCAL_PILOT_TEST=1 only for the disposable local snapshot.",
    );
  const prisma = new PrismaClient();
  const prefix = `vault-pilot-${randomUUID()}`;
  let ownerId: string | undefined;
  let tradeId: string | undefined;
  try {
    const actor = await prisma.user.findFirstOrThrow({
      where: { username: "admin" },
    });
    const card = await prisma.card.findFirstOrThrow();
    const owner = await prisma.player.create({
      data: { name: prefix, displayName: prefix },
    });
    ownerId = owner.id;
    const location = async (name: string, type = "Box") =>
      prisma.inventoryLocation.create({
        data: {
          ownerPlayerId: owner.id,
          name,
          normalizedName: name.toLowerCase(),
          type,
        },
      });
    const source = await location("Source");
    const vault = await location("Vault", "Vault");
    const other = await location("Other");
    const create = (
      quantity: number,
      locationId = source.id,
      locationSection: string | null = null,
    ) =>
      prisma.inventoryItem.create({
        data: {
          currentOwnerId: owner.id,
          originalOpenerId: owner.id,
          cardId: card.id,
          quantity,
          condition: "NM",
          sourceType: "MANUAL",
          notes: prefix,
          locationId,
          locationSection,
        },
      });
    const resident = await create(68, vault.id, "Sect 0");
    const stack = await create(100);
    const move = (
      input: Partial<Parameters<typeof moveInventoryStorageBatch>[1]> = {},
    ) =>
      moveInventoryStorageBatch(prisma, {
        actorUserId: actor.id,
        allowedOwnerId: owner.id,
        destinationLocationId: vault.id,
        destinationLocationSection: "Sect 0",
        itemIds: [stack.id],
        ...input,
      });
    const total = async () =>
      (
        await prisma.inventoryItem.aggregate({
          where: { currentOwnerId: owner.id },
          _sum: { quantity: true },
        })
      )._sum.quantity;
    assert.equal(
      (await getStorageLocations(prisma, [vault]))[0].sections.length,
      6,
    );
    const result = await move({
      itemIds: [resident.id, stack.id],
      quantityLimit: 17,
      expectedStacks: [resident, stack],
    });
    assert.equal(result.movedCards, 17);
    assert.equal(await total(), 168);
    assert.equal(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: stack.id },
        })
      ).quantity,
      83,
    );
    assert.equal(
      (await getStorageLocations(prisma, [vault]))[0].sections[0].quantity,
      85,
    );
    assert.equal(
      await prisma.inventoryAuditLog.count({
        where: { inventoryItem: { currentOwnerId: owner.id } },
      }),
      2,
    );
    await assert.rejects(move({ expectedStacks: [stack] }), /changed since/);
    await assert.rejects(
      move({ allowedOwnerId: "not-the-owner" }),
      /does not belong/,
    );
    await prisma.inventoryLocation.update({
      where: { id: other.id },
      data: { active: false },
    });
    await assert.rejects(move({ destinationLocationId: other.id }), /inactive/);
    await prisma.inventoryLocation.update({
      where: { id: other.id },
      data: { active: true, systemManaged: true },
    });
    await assert.rejects(
      move({ destinationLocationId: other.id }),
      /deck workflow/,
    );
    await prisma.inventoryLocation.update({
      where: { id: other.id },
      data: { systemManaged: false },
    });
    const trade = await prisma.trade.create({
      data: {
        proposerPlayerId: owner.id,
        receiverPlayerId: owner.id,
        status: "PROPOSED",
        lines: {
          create: {
            side: "PROPOSER",
            inventoryItemId: stack.id,
            quantity: 80,
            snapshotJson: {},
          },
        },
      },
    });
    tradeId = trade.id;
    await assert.rejects(move({ quantityLimit: 4 }), /reserved trade/);
    assert.equal(await total(), 168);
    await move({ quantityLimit: 3 });
    const full = await move();
    assert.equal(full.movedCards, 80);
    assert.equal(
      (await prisma.tradeLine.findFirstOrThrow({ where: { tradeId } }))
        .inventoryItemId,
      stack.id,
    );
    assert.equal(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: stack.id },
        })
      ).notes,
      prefix,
    );
    assert.equal(
      (await getStorageLocations(prisma, [vault]))[0].sections[0].quantity,
      168,
    );
    assert.equal((await move()).movedCards, 0);

    const concurrent = await create(100);
    const outcomes = await Promise.allSettled([
      move({
        itemIds: [concurrent.id],
        destinationLocationSection: "Sect 1",
        quantityLimit: 60,
      }),
      move({
        itemIds: [concurrent.id],
        destinationLocationSection: "Sect 2",
        quantityLimit: 60,
      }),
    ]);
    assert.ok(outcomes.some((r) => r.status === "fulfilled"));
    assert.equal(await total(), 268);
    assert.equal(
      await prisma.inventoryItem.count({
        where: { currentOwnerId: owner.id, quantity: { lt: 0 } },
      }),
      0,
    );

    // Physical scale differs from unique printing/row scale. 150k copies over
    // 3k inventory rows and 1,200 locations (200 parents + 1,000 children).
    const parents = Array.from({ length: 200 }, (_, i) => ({
      id: `${prefix}-p${i}`,
      ownerPlayerId: owner.id,
      name: `Parent ${i}`,
      normalizedName: `parent ${i}`,
      type: "Vault",
    }));
    await prisma.inventoryLocation.createMany({ data: parents });
    const children = Array.from({ length: 1000 }, (_, i) => ({
      id: `${prefix}-c${i}`,
      ownerPlayerId: owner.id,
      parentLocationId: parents[i % parents.length].id,
      name: `Child ${i}`,
      normalizedName: `child ${i}`,
      type: "Box",
    }));
    await prisma.inventoryLocation.createMany({ data: children });
    await prisma.inventoryItem.createMany({
      data: Array.from({ length: 3000 }, (_, i) => ({
        currentOwnerId: owner.id,
        originalOpenerId: owner.id,
        cardId: card.id,
        quantity: 50,
        condition: "NM",
        locationId: children[i % children.length].id,
        locationSection: `Sect ${i % 6}`,
        notes: prefix,
      })),
    });
    const start = performance.now();
    const summaries = await getStorageLocations(prisma, [
      ...parents,
      ...children,
    ]);
    assert.equal(summaries.length, 1200);
    assert.equal(
      summaries.reduce(
        (sum, l) => sum + l.sections.reduce((n, s) => n + s.quantity, 0),
        0,
      ),
      150000,
    );
    console.log(
      JSON.stringify({
        passed: true,
        cases: [
          "six empty sections",
          "17-copy fill",
          "copy conservation",
          "audit links",
          "stale selection",
          "owner scope",
          "inactive/deck destination",
          "partial reservations",
          "whole-stack trade links",
          "advisory overflow",
          "same-section no-op",
          "concurrency",
          "150k-copy/1200-location summary",
        ],
        summaryMs: Math.round(performance.now() - start),
        concurrentOutcomes: outcomes.map((r) => r.status),
      }),
    );
  } finally {
    if (tradeId) await prisma.trade.delete({ where: { id: tradeId } });
    if (ownerId) {
      await prisma.inventoryAuditLog.deleteMany({
        where: { inventoryItem: { currentOwnerId: ownerId } },
      });
      await prisma.inventoryItem.deleteMany({
        where: { currentOwnerId: ownerId },
      });
      await prisma.inventoryLocation.deleteMany({
        where: { ownerPlayerId: ownerId, parentLocationId: { not: null } },
      });
      await prisma.inventoryLocation.deleteMany({
        where: { ownerPlayerId: ownerId },
      });
      await prisma.player.delete({ where: { id: ownerId } });
    }
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
