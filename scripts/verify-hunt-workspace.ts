import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedBulkCleanup } from "./verify-bulk-cleanup";
import { buildCardHunt } from "../lib/card-hunt-service";
import { performHuntAction } from "../lib/card-hunt-actions";
import { getBulkContext } from "../lib/bulk-cleanup-service";
import {
  performBulkAction,
  saveBulkSettings,
} from "../lib/bulk-cleanup-actions";
import { changeBulkLocation } from "../lib/bulk-locations";
import type { BulkActionInput, BulkContext } from "../lib/bulk-cleanup-policy";

export async function seedHuntWorkspace(db: PrismaClient, tag: string) {
  const f = await seedBulkCleanup(db, tag);
  await db.user.update({
    where: { id: f.owner },
    data: { bulkCleanupEnabled: true, bulkCleanupMaxCopies: 4 },
  });
  await db.inventoryLocation.update({
    where: { id: f.box.id },
    data: {
      name: "Blue-0004",
      normalizedName: "blue-0004",
      storageLayout: {
        capacity: 1000,
        sections: [
          { name: "0", capacity: 500 },
          { name: "1", capacity: 500 },
        ],
      },
    },
  });
  const image = (name: string) =>
    `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="252" height="352"><rect width="252" height="352" rx="12" fill="#173d4a"/><rect x="12" y="12" width="228" height="328" rx="8" fill="#244d53"/><text x="24" y="55" font-size="15" fill="white">${name}</text><path d="M24 240 L90 110 L145 185 L210 100 L228 240" fill="#50b7ac"/></svg>`).toString("base64")}`;
  for (const [id, setCode] of [
    [f.card.id, "cmm"],
    [f.alternate.id, "dmr"],
  ])
    await db.card.update({
      where: { id },
      data: {
        name: "Counterspell",
        setCode,
        imageUri: image("Counterspell"),
        typeLine: "Instant",
        manaCost: "{U}{U}",
        oracleText: "Counter target spell.",
        lang: "en",
        digital: false,
      },
    });
  const sol = await db.card.create({
    data: {
      scryfallId: randomUUID(),
      oracleId: randomUUID(),
      name: "Sol Ring",
      setCode: "c21",
      collectorNumber: "1",
      typeLine: "Artifact",
      rarity: "uncommon",
      imageUri: image("Sol Ring"),
      manaCost: "{1}",
      lang: "en",
    },
  });
  const island = await db.card.create({
    data: {
      scryfallId: randomUUID(),
      oracleId: randomUUID(),
      name: "Island",
      setCode: "dmu",
      collectorNumber: "2",
      typeLine: "Basic Land - Island",
      rarity: "common",
      imageUri: image("Island"),
      lang: "en",
    },
  });
  await db.inventoryItem.createMany({
    data: [
      { currentOwnerId: f.owner, cardId: sol.id, quantity: 6, condition: "NM" },
      {
        currentOwnerId: f.owner,
        cardId: island.id,
        quantity: 4,
        condition: "NM",
        locationId: f.box.id,
        locationSection: "0",
      },
    ],
  });
  const bulk = await changeBulkLocation(db, f.owner, {
    action: "CREATE",
    name: "Bulk-0001",
    capacity: 1000,
  });
  const child = await db.inventoryLocation.create({
    data: {
      ownerPlayerId: f.owner,
      name: "Bulk section",
      normalizedName: "bulk section",
      parentLocationId: bulk.id,
    },
  });
  await db.inventoryItem.createMany({
    data: [
      {
        currentOwnerId: f.owner,
        cardId: f.card.id,
        quantity: 20,
        condition: "NM",
        locationId: bulk.id,
      },
      {
        currentOwnerId: f.owner,
        cardId: island.id,
        quantity: 12,
        condition: "NM",
        locationId: bulk.id,
      },
      {
        currentOwnerId: f.owner,
        cardId: f.card.id,
        quantity: 5,
        condition: "NM",
        locationId: child.id,
      },
    ],
  });
  const destination = await changeBulkLocation(db, f.owner, {
    action: "CREATE",
    name: "Bulk-0002",
    capacity: 1000,
  });
  const deck = await db.deck.create({
    data: {
      ownerUserId: f.owner,
      name: "Masters of Evil - review",
      cards: {
        create: [
          {
            cardId: f.card.id,
            oracleId: f.card.oracleId,
            cardName: "Counterspell",
            quantity: 2,
          },
          {
            cardId: sol.id,
            oracleId: sol.oracleId,
            cardName: sol.name,
            quantity: 1,
          },
          {
            cardId: island.id,
            oracleId: island.oracleId,
            cardName: island.name,
            quantity: 4,
          },
        ],
      },
    },
  });
  return { ...f, sol, island, bulk, child, destination, reviewDeck: deck };
}
const chosen = (context: BulkContext, ids?: string[]) =>
  context
    .plan!.items.filter((row) => !ids || ids.includes(row.id))
    .map((row) => ({
      id: row.id,
      quantity: row.quantity,
      stamp: row.stamp,
      group: row.group,
      groupStamp: row.groupStamp,
    }));
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "hunt-workspace-db");
  assert.ok(
    ["/hunt_workspace_fixture", "/hunt_workspace_review"].includes(
      url.pathname,
    ),
  );
  if (!process.argv.includes("--seed-review"))
    assert.equal(process.env.MTG_HUNT_WORKSPACE_TEST, "1");
  const db = new PrismaClient();
  try {
    const f = await seedHuntWorkspace(db, `hunt-${randomUUID().slice(0, 8)}`);
    if (process.argv.includes("--seed-review")) {
      console.log(JSON.stringify(f));
      return;
    }
    const user = { id: f.owner, playerId: f.owner },
      input = { deckId: f.reviewDeck.id };
    const preserved = async () => {
      const data = {
        inventory: await db.inventoryItem.findMany({ orderBy: { id: "asc" } }),
        decks: await db.deckCard.findMany({ orderBy: { id: "asc" } }),
        locations: await db.inventoryLocation.findMany({
          orderBy: { id: "asc" },
        }),
      };
      return createHash("sha256").update(JSON.stringify(data)).digest("hex");
    };
    const before = await preserved(),
      initial = await buildCardHunt(db, user, input),
      counter = initial.boxes
        .flatMap((box) => box.picks)
        .find((row) => row.name === "Counterspell")!;
    assert.equal(initial.planned, 7);
    assert.equal(initial.shortage, 0);
    const adjusted = {
      ...input,
      adjustments: {
        excludedLocations: [f.box.id],
        held: [
          {
            id: counter.inventoryItemId,
            requestId: counter.requestId,
            quantity: 1,
            stamp: counter.stamp!,
          },
        ],
        printings: [
          {
            requestId: counter.requestId,
            cardId: f.alternate.id,
            finish: "NONFOIL" as const,
          },
        ],
      },
    };
    const replan = await buildCardHunt(db, user, adjusted),
      picks = replan.boxes.flatMap((box) => box.picks);
    assert.equal(replan.planned, 7);
    assert.equal(
      picks.find((row) => row.inventoryItemId === counter.inventoryItemId)!
        .pulledQuantity,
      1,
    );
    assert.equal(
      picks.find((row) => row.cardId === f.alternate.id)!.quantity,
      1,
    );
    assert.equal(picks.find((row) => row.name === "Island")!.isBulk, true);
    assert.equal(
      (
        await buildCardHunt(db, user, {
          ...adjusted,
          adjustments: { ...adjusted.adjustments, includeBulk: false },
        })
      ).shortage,
      4,
    );
    const options = (
      await buildCardHunt(db, user, {
        ...adjusted,
        printingRequestId: counter.requestId,
      })
    ).lines.find(
      (line) => line.request.id === counter.requestId,
    )!.printingOptions!;
    assert.ok(options.some((option) => option.cardId === f.alternate.id));
    await assert.rejects(
      () =>
        buildCardHunt(db, user, {
          ...adjusted,
          adjustments: {
            held: [{ ...adjusted.adjustments.held[0], stamp: "b".repeat(64) }],
          },
        }),
      /changed/,
    );
    assert.equal(await preserved(), before);
    const commit = picks.filter((row) => row.name === "Counterspell");
    const receipt = await performHuntAction(db, f.owner, {
      action: "COMMIT",
      requestId: randomUUID(),
      hunt: adjusted,
      selected: commit.map((row) => ({
        requestId: row.requestId,
        inventoryItemId: row.inventoryItemId,
        quantity: row.quantity,
        stamp: row.stamp!,
        targetStamp: row.targetStamp,
      })),
    });
    assert.equal(receipt.status, "APPLIED");
    const deckRows = await db.deckCard.findMany({
      where: { deckId: f.reviewDeck.id, cardName: "Counterspell" },
    });
    assert.deepEqual(deckRows.map((row) => row.quantity).sort(), [1, 1]);
    assert.equal(new Set(deckRows.map((row) => row.cardId)).size, 2);
    const bulk = await getBulkContext(db, f.owner),
      scope = { excludedItems: [f.damaged.id] },
      kept = await getBulkContext(db, f.owner, { scope });
    assert.equal(
      kept.plan!.items.some((row) => row.id === f.damaged.id),
      false,
    );
    assert.equal(kept.plan!.totalCopies, bulk.plan!.totalCopies);
    const excluded = await getBulkContext(db, f.owner, {
      scope: { excludedLocations: [f.box.id] },
    });
    assert.ok(excluded.plan!.protectedCopies > 0);
    assert.equal(
      excluded.plan!.items.some((row) => row.locationId === f.box.id),
      false,
    );
    const foreign = await db.inventoryLocation.create({
      data: {
        ownerPlayerId: f.other,
        name: "Private other box",
        normalizedName: "privateother",
      },
    });
    await assert.rejects(
      () =>
        changeBulkLocation(db, f.owner, {
          action: "TAG",
          locationId: foreign.id,
          isBulk: true,
          revision: 0,
        }),
      /own/,
    );
    const location = await db.inventoryLocation.findUniqueOrThrow({
      where: { id: f.box.id },
    });
    const inventoryBeforeTag = await db.inventoryItem.findMany({
      orderBy: { id: "asc" },
    });
    await changeBulkLocation(db, f.owner, {
      action: "TAG",
      locationId: f.box.id,
      isBulk: true,
      revision: location.capacityRevision,
    });
    assert.equal(
      (await getBulkContext(db, f.owner)).plan!.items.some(
        (row) => row.cardId === f.card.id,
      ),
      false,
    );
    assert.deepEqual(
      await db.inventoryItem.findMany({ orderBy: { id: "asc" } }),
      inventoryBeforeTag,
    );
    await assert.rejects(
      () =>
        changeBulkLocation(db, f.owner, {
          action: "TAG",
          locationId: f.box.id,
          isBulk: false,
          revision: location.capacityRevision,
        }),
      /changed/,
    );
    await changeBulkLocation(db, f.owner, {
      action: "TAG",
      locationId: f.box.id,
      isBulk: false,
      revision: location.capacityRevision + 1,
    });
    const current = await getBulkContext(db, f.owner, { scope }),
      normal = current.plan!.items.find((row) => row.id === f.normal.id)!;
    assert.ok(normal.quantity > 0);
    const physical = async () =>
        await db.inventoryItem.aggregate({
          where: { currentOwnerId: f.owner },
          _sum: { quantity: true },
        }),
      quantityBefore = await physical();
    const request: BulkActionInput = {
      action: "MOVE",
      requestId: randomUUID(),
      scope,
      policyStamp: current.settings.stamp,
      destinationId: f.destination.id,
      selected: chosen(current, [f.normal.id]),
    };
    const moved = await performBulkAction(db, f.owner, request);
    assert.equal(moved.status, "APPLIED");
    assert.equal((await performBulkAction(db, f.owner, request)).replay, true);
    assert.deepEqual(await physical(), quantityBefore);
    const target = await db.inventoryItem.findFirstOrThrow({
      where: { locationId: f.destination.id, cardId: f.card.id },
    });
    assert.equal(target.originalOpenerId, f.normal.originalOpenerId);
    assert.equal(target.notes, f.normal.notes);
    assert.equal(target.quantity, normal.quantity);
    // Independent sources contend for one capacity gate; at most one two-copy move fits.
    await db.inventoryItem.update({
      where: { id: f.normal.id },
      data: { quantity: { increment: 4 } },
    });
    const capacity = await changeBulkLocation(db, f.owner, {
      action: "CREATE",
      name: "Capacity test",
      capacity: 3,
    });
    const race = await getBulkContext(db, f.owner),
      sources = [
        race.plan!.items.find((row) => row.cardId === f.sol.id)!,
        race.plan!.items.find(
          (row) =>
            row.cardId === f.card.id &&
            row.finish === "NONFOIL" &&
            row.language === "EN",
        )!,
      ];
    const results = await Promise.all(
      sources.map((row) =>
        performBulkAction(db, f.owner, {
          action: "MOVE",
          requestId: randomUUID(),
          policyStamp: race.settings.stamp,
          destinationId: capacity.id,
          selected: [{ ...chosen(race, [row.id])[0], quantity: 2 }],
        }),
      ),
    );
    assert.equal(results.filter((row) => row.status === "APPLIED").length, 1);
    assert.equal(
      (
        await db.inventoryItem.aggregate({
          where: { locationId: capacity.id },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      2,
    );
    const now = await getBulkContext(db, f.owner),
      foreignResult = await performBulkAction(db, f.owner, {
        action: "MOVE",
        requestId: randomUUID(),
        policyStamp: now.settings.stamp,
        destinationId: foreign.id,
        selected: chosen(now).slice(0, 1),
      });
    assert.equal(foreignResult.status, "REJECTED");
    // Global search/order is applied before server pagination.
    for (let i = 0; i < 30; i++) {
      const card = await db.card.create({
        data: {
          scryfallId: randomUUID(),
          name: `Page ${String(i).padStart(2, "0")}`,
          setCode: "tst",
          collectorNumber: String(i),
          typeLine: "Artifact",
          rarity: "common",
        },
      });
      await db.inventoryItem.create({
        data: {
          cardId: card.id,
          currentOwnerId: f.owner,
          quantity: i + 5,
          condition: "NM",
        },
      });
    }
    const browse = {
      search: "Page",
      sort: "quantity" as const,
      desc: true,
      locationId: "",
      pageSize: 25,
    };
    const page1 = await getBulkContext(db, f.owner, { browse }),
      page2 = await getBulkContext(db, f.owner, { browse, page: 2 });
    assert.equal(page1.plan!.totalItems, 30);
    assert.equal(page1.plan!.items[0].quantity, 30);
    assert.equal(page2.plan!.items.length, 5);
    assert.equal(
      new Set([...page1.plan!.items, ...page2.plan!.items].map((row) => row.id))
        .size,
      30,
    );
    console.log(
      "PASS hunt workspace: read-only plans; held/excluded/alternate/fallback allocation; actual mixed-printing commitment; inherited bulk purpose; keep-stack/global counts; owner/stale gates; provenance/replay; concurrent capacity; global search/sort/paging.",
    );
  } finally {
    await db.$disconnect();
  }
}
if (process.argv.includes("--run") || process.argv.includes("--seed-review"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
