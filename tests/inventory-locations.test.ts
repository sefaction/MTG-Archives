import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocationPathMap,
  buildLocationTree,
  createLocation,
  deleteUnusedLocation,
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  groupInventoryPageGroupsByCardName,
  locationSummary,
  normalizeLocationName,
  normalizeLocationSection,
  orderInventoryItemsByPageGroups,
  updateLocation,
  withLocationPaths,
} from "../lib/inventory-locations";

function makeItem(overrides: any = {}) {
  return {
    id: overrides.id ?? "item-1",
    currentOwnerId: overrides.currentOwnerId ?? "owner-1",
    originalOpenerId: overrides.originalOpenerId ?? "owner-1",
    cardId: overrides.cardId ?? "card-sol-ring-cmm",
    foil: overrides.foil ?? false,
    foilStatus: overrides.foilStatus ?? "NONFOIL",
    condition: overrides.condition ?? "NM",
    language: overrides.language ?? "EN",
    sourceType: overrides.sourceType ?? "MANUAL",
    notes: overrides.notes ?? null,
    quantity: overrides.quantity ?? 1,
    locationId: overrides.locationId ?? null,
    locationSection: overrides.locationSection ?? null,
    location: overrides.location ?? null,
    card: {
      id: overrides.cardId ?? "card-sol-ring-cmm",
      name: overrides.cardName ?? "Sol Ring",
      oracleId: overrides.oracleId ?? "oracle-sol-ring",
      setCode: overrides.setCode ?? "cmm",
      setName: overrides.setName ?? "Commander Masters",
      collectorNumber: overrides.collectorNumber ?? "001",
      rarity: overrides.rarity ?? "uncommon",
      imageUri: null,
      imageUris: null,
      typeLine: "Artifact",
    },
  };
}

test("normalizes location names for per-owner uniqueness without changing display labels", () => {
  assert.equal(normalizeLocationName("  Box-0001  "), "box-0001");
  assert.equal(normalizeLocationName("Trade   Binder"), "trade binder");
});

test("normalizes optional on-demand location sections", () => {
  assert.equal(normalizeLocationSection("  Section   1  "), "Section 1");
  assert.equal(normalizeLocationSection(""), null);
  assert.throws(() => normalizeLocationSection("x".repeat(101)), /100/);
});

test("location paths and trees preserve arbitrary nesting and duplicate sibling names across branches", () => {
  const locations = [
    { id: "shelf-a", name: "Shelf A", parentLocationId: null },
    { id: "shelf-b", name: "Shelf B", parentLocationId: null },
    { id: "box-a", name: "Box 1", parentLocationId: "shelf-a" },
    { id: "box-b", name: "Box 1", parentLocationId: "shelf-b" },
    { id: "row-a", name: "Row 2", parentLocationId: "box-a" },
  ];

  const paths = buildLocationPathMap(locations);
  assert.equal(paths.get("row-a"), "Shelf A / Box 1 / Row 2");
  assert.equal(paths.get("box-b"), "Shelf B / Box 1");
  assert.deepEqual(
    withLocationPaths(locations).map((location) => location.path),
    [
      "Shelf A",
      "Shelf A / Box 1",
      "Shelf A / Box 1 / Row 2",
      "Shelf B",
      "Shelf B / Box 1",
    ],
  );
  const tree = buildLocationTree(locations);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].children[0].children[0].id, "row-a");
});

test("location creation rejects a parent owned outside the location owner", async () => {
  const prisma = {
    inventoryLocation: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async () => {
        throw new Error("create should not run");
      },
    },
  };

  await assert.rejects(
    createLocation(prisma as any, {
      ownerPlayerId: "owner-1",
      parentLocationId: "other-owner-location",
      name: "Row 1",
    }),
    /Parent location not found for this owner/,
  );
});

test("location updates reject hierarchy cycles", async () => {
  const prisma = {
    inventoryLocation: {
      findFirst: async () => ({
        id: "shelf",
        ownerPlayerId: "owner-1",
        normalizedName: "shelf",
        kind: "NORMAL",
        systemManaged: false,
      }),
      findMany: async () => [
        {
          id: "shelf",
          parentLocationId: null,
          normalizedName: "shelf",
          kind: "NORMAL",
          systemManaged: false,
          active: true,
        },
        {
          id: "box",
          parentLocationId: "shelf",
          normalizedName: "box",
          kind: "NORMAL",
          systemManaged: false,
          active: true,
        },
      ],
      update: async () => {
        throw new Error("update should not run");
      },
    },
  };

  await assert.rejects(
    updateLocation(prisma as any, {
      id: "shelf",
      ownerPlayerId: "owner-1",
      parentLocationId: "box",
      name: "Shelf",
    }),
    /beneath one of its descendants/,
  );
});

test("location deletion is blocked while sub-locations exist", async () => {
  const prisma = {
    inventoryLocation: {
      findUnique: async () => ({
        id: "shelf",
        kind: "NORMAL",
        systemManaged: false,
      }),
      count: async () => 1,
      delete: async () => {
        throw new Error("delete should not run");
      },
    },
    inventoryItem: { count: async () => 0 },
  };

  await assert.rejects(
    deleteUnusedLocation(prisma as any, "shelf"),
    /still contains sub-locations/,
  );
});

test("location deactivation is blocked while active sub-locations exist", async () => {
  const prisma = {
    inventoryLocation: {
      findFirst: async () => ({
        id: "shelf",
        ownerPlayerId: "owner-1",
        normalizedName: "shelf",
        kind: "NORMAL",
        systemManaged: false,
      }),
      count: async () => 1,
      update: async () => {
        throw new Error("update should not run");
      },
    },
  };

  await assert.rejects(
    updateLocation(prisma as any, {
      id: "shelf",
      ownerPlayerId: "owner-1",
      name: "Shelf",
      active: false,
    }),
    /active sub-locations first/,
  );
});

test("same exact printing in multiple locations shows one total and a location breakdown", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "box-row",
      quantity: 3,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
    makeItem({
      id: "shelf-row",
      quantity: 2,
      locationId: "loc-shelf",
      location: { id: "loc-shelf", name: "Shelf-0002", type: "Shelf" },
    }),
  ] as any[]);

  assert.equal(exactRows.length, 1);
  assert.equal(exactRows[0].quantity, 5);
  assert.deepEqual(
    exactRows[0].locationBreakdown.map(
      (entry: { name: string; quantity: number }) => [
        entry.name,
        entry.quantity,
      ],
    ),
    [
      ["Box-0001", 3],
      ["Shelf-0002", 2],
    ],
  );
  assert.equal(exactRows[0].sourceItemIds.length, 2);
});

test("exact printing groups condition aliases and notes but separates condition, finish, and language", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "legacy-near-mint",
      condition: "NEAR_MINT",
      notes: "Added for deck row Sol Ring",
      sourceType: "MANUAL",
    }),
    makeItem({
      id: "canonical-near-mint",
      condition: "NM",
      notes: null,
      sourceType: "CSV_PULL_IMPORT",
    }),
    makeItem({ id: "played", condition: "LP" }),
    makeItem({ id: "foil", foil: true, foilStatus: "FOIL" }),
    makeItem({ id: "japanese", language: "JA" }),
  ] as any[]);

  assert.equal(exactRows.length, 4);
  const nearMint = exactRows.find(
    (row) =>
      row.condition === "NM" &&
      row.foilStatus === "NONFOIL" &&
      row.language === "EN",
  );
  assert.equal(nearMint?.quantity, 2);
  assert.equal(nearMint?.sourceItemIds.length, 2);
});

test("different printings of the same oracle card group into one card-name total", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "cmm",
      cardId: "card-sol-ring-cmm",
      setCode: "cmm",
      collectorNumber: "001",
      quantity: 1,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
    makeItem({
      id: "ltc",
      cardId: "card-sol-ring-ltc",
      setCode: "ltc",
      collectorNumber: "310",
      quantity: 1,
      locationId: "loc-binder",
      location: { id: "loc-binder", name: "Binder-0003", type: "Binder" },
    }),
    makeItem({
      id: "who",
      cardId: "card-sol-ring-who",
      setCode: "who",
      collectorNumber: "250",
      quantity: 3,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
  ] as any[]);
  const grouped = getInventoryGroupedByCard(exactRows);

  assert.equal(exactRows.length, 3, "exact mode keeps printings separate");
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].cardName, "Sol Ring");
  assert.equal(grouped[0].quantity, 5);
  assert.equal(grouped[0].printingCount, 3);
  assert.equal(grouped[0].locationCount, 2);
});

test("grouping falls back to normalized card name when oracle id is missing", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "a",
      cardId: "card-a",
      oracleId: null,
      cardName: "Lightning Bolt",
      setCode: "lea",
    }),
    makeItem({
      id: "b",
      cardId: "card-b",
      oracleId: null,
      cardName: " Lightning   Bolt ",
      setCode: "clu",
    }),
  ] as any[]);
  const grouped = getInventoryGroupedByCard(exactRows);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].quantity, 2);
});

test("card-name page groups keep every printing together before pagination", () => {
  const cardById = new Map([
    ["sol-ring-cmm", { oracleId: "oracle-sol-ring", name: "Sol Ring" }],
    ["sol-ring-ltc", { oracleId: "oracle-sol-ring", name: "Sol Ring" }],
    [
      "arcane-signet",
      { oracleId: "oracle-arcane-signet", name: "Arcane Signet" },
    ],
  ]);
  const printingGroups = [
    { cardId: "arcane-signet", _sum: { quantity: 1 }, _count: { _all: 1 } },
    { cardId: "sol-ring-cmm", _sum: { quantity: 2 }, _count: { _all: 2 } },
    { cardId: "sol-ring-ltc", _sum: { quantity: 3 }, _count: { _all: 3 } },
  ];

  const cardNameGroups = groupInventoryPageGroupsByCardName(
    printingGroups,
    cardById,
  );
  const solRingPage = cardNameGroups.slice(1, 2);

  assert.equal(cardNameGroups.length, 2);
  assert.deepEqual(solRingPage[0].cardIds, ["sol-ring-cmm", "sol-ring-ltc"]);
  assert.equal(solRingPage[0]._sum.quantity, 5);
  assert.equal(solRingPage[0]._count._all, 5);
});

test("location summary remains compact for many locations", () => {
  assert.equal(
    locationSummary([
      { name: "Box-0001", quantity: 1 },
      { name: "Box-0002", quantity: 2 },
      { name: "Binder-0003", quantity: 3 },
    ]),
    "6 copies in 3 locations",
  );
});

function makeBulkPrisma(itemsInput: any[], locationsInput: any[]) {
  const items = itemsInput.map((item) => ({ ...item }));
  const locations = locationsInput.map((location) => ({ ...location }));
  const audits: any[] = [];
  const counters = {
    auditCreateCalls: 0,
    auditCreateManyCalls: 0,
    updateManyCalls: 0,
    deleteManyCalls: 0,
    transactionOptions: null as any,
  };
  const matchesWhere = (item: any, where: any) => {
    if (where.id?.in && !where.id.in.includes(item.id)) return false;
    if (where.id?.not && item.id === where.id.not) return false;
    if (where.locationId && item.locationId !== where.locationId) return false;
    if (
      where.locationSection !== undefined &&
      (item.locationSection ?? null) !== where.locationSection
    )
      return false;
    if (where.currentOwnerId && item.currentOwnerId !== where.currentOwnerId)
      return false;
    if (
      where.originalOpenerId &&
      item.originalOpenerId !== where.originalOpenerId
    )
      return false;
    if (where.cardId && item.cardId !== where.cardId) return false;
    if (where.foil !== undefined && item.foil !== where.foil) return false;
    if (where.foilStatus && item.foilStatus !== where.foilStatus) return false;
    if (where.condition?.in && !where.condition.in.includes(item.condition))
      return false;
    if (
      where.condition &&
      !where.condition.in &&
      item.condition !== where.condition
    )
      return false;
    if (where.language && item.language !== where.language) return false;
    if (where.sourceType && item.sourceType !== where.sourceType) return false;
    if (
      where.acquiredFromPullId !== undefined &&
      item.acquiredFromPullId !== where.acquiredFromPullId
    )
      return false;
    if (where.notes !== undefined && item.notes !== where.notes) return false;
    if (where.roundId !== undefined && item.roundId !== where.roundId)
      return false;
    if (
      where.quantity?.gt !== undefined &&
      !(item.quantity > where.quantity.gt)
    )
      return false;
    return true;
  };
  const delegate = {
    inventoryLocation: {
      findUnique: async ({ where }: any) =>
        locations.find((location) => location.id === where.id) ?? null,
    },
    inventoryItem: {
      aggregate: async ({ where }: any) => {
        const matching = items.filter((item) => matchesWhere(item, where));
        return {
          _count: { _all: matching.length },
          _sum: {
            quantity: matching.reduce((sum, item) => sum + item.quantity, 0),
          },
        };
      },
      findMany: async ({ where }: any) =>
        items
          .filter((item) => matchesWhere(item, where))
          .map((item) => ({ ...item })),
      findFirst: async ({ where }: any) =>
        items.find((item) => matchesWhere(item, where)) ?? null,
      findUnique: async ({ where, include }: any) => {
        const item = items.find((candidate) => candidate.id === where.id);
        if (!item) return null;
        return {
          ...item,
          ...(include?.card
            ? { card: item.card ?? { name: item.cardName ?? "Sol Ring" } }
            : {}),
          ...(include?.location
            ? {
                location:
                  locations.find(
                    (location) => location.id === item.locationId,
                  ) ?? null,
              }
            : {}),
        };
      },
      update: async ({ where, data }: any) => {
        const item = items.find((candidate) => candidate.id === where.id);
        if (!item) throw new Error("item not found");
        if (typeof data.quantity === "number") item.quantity = data.quantity;
        if (data.quantity?.increment) item.quantity += data.quantity.increment;
        if (data.quantity?.decrement) item.quantity -= data.quantity.decrement;
        if (data.locationId !== undefined) item.locationId = data.locationId;
        if (data.locationSection !== undefined)
          item.locationSection = data.locationSection;
        return { ...item };
      },
      updateMany: async ({ where, data }: any) => {
        counters.updateManyCalls += 1;
        let count = 0;
        for (const item of items) {
          if (!matchesWhere(item, where)) continue;
          if (typeof data.quantity === "number") item.quantity = data.quantity;
          if (data.quantity?.increment)
            item.quantity += data.quantity.increment;
          if (data.quantity?.decrement)
            item.quantity -= data.quantity.decrement;
          if (data.locationId !== undefined) item.locationId = data.locationId;
          if (data.locationSection !== undefined)
            item.locationSection = data.locationSection;
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        counters.deleteManyCalls += 1;
        const ids = new Set(where.id?.in ?? []);
        let count = 0;
        for (let index = items.length - 1; index >= 0; index -= 1) {
          if (ids.has(items[index].id)) {
            items.splice(index, 1);
            count += 1;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const index = items.findIndex((candidate) => candidate.id === where.id);
        if (index >= 0) items.splice(index, 1);
      },
      create: async ({ data }: any) => {
        const created = { id: `created-${items.length + 1}`, ...data };
        items.push(created);
        return { ...created };
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: any) => {
        counters.auditCreateCalls += 1;
        if (
          data.inventoryItemId &&
          !items.some((item) => item.id === data.inventoryItemId)
        ) {
          throw new Error("audit references deleted inventory item");
        }
        audits.push(data);
        return data;
      },
      createMany: async ({ data }: any) => {
        counters.auditCreateManyCalls += 1;
        for (const audit of data) {
          if (
            audit.inventoryItemId &&
            !items.some((item) => item.id === audit.inventoryItemId)
          ) {
            throw new Error("audit references deleted inventory item");
          }
        }
        audits.push(...data);
        return { count: data.length };
      },
    },
    trade: {
      findMany: async () => [],
    },
  };
  return {
    prisma: {
      ...delegate,
      $transaction: async (fn: any, options: any) => {
        counters.transactionOptions = options;
        return fn(delegate);
      },
    },
    items,
    locations,
    audits,
    counters,
  };
}

test("bulk move selected rows merges matching destination rows and preserves total quantity", async () => {
  const { bulkMoveInventoryToLocation } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits, counters } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-1",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        locationId: "loc-unassigned",
        quantity: 3,
      },
      {
        id: "dest-existing",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-1",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        locationId: "loc-box",
        quantity: 2,
      },
    ],
    [
      { id: "loc-unassigned", ownerPlayerId: "owner-1", name: "Unassigned" },
      { id: "loc-box", ownerPlayerId: "owner-1", name: "Box-0001" },
    ],
  );

  const result = await bulkMoveInventoryToLocation(prisma as any, {
    actorUserId: "user-1",
    destinationLocationId: "loc-box",
    itemIds: ["source"],
    allowedOwnerId: "owner-1",
  });

  assert.equal(result.movedEntries, 1);
  assert.equal(result.movedCards, 3);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "dest-existing");
  assert.equal(items[0].quantity, 5);
  assert.equal(audits.length, 2);
  assert.equal(counters.auditCreateCalls, 0);
  assert.equal(counters.auditCreateManyCalls, 1);
  assert.ok(counters.transactionOptions.timeout >= 30000);
});

test("bulk move 800 entries uses bulk audit insertion instead of per-row audit creates", async () => {
  const { bulkMoveInventoryToLocation } =
    await import("../lib/inventory-locations");
  const sourceItems = Array.from({ length: 800 }, (_, index) => ({
    id: `source-${index}`,
    currentOwnerId: "owner-1",
    originalOpenerId: "owner-1",
    cardId: `card-${index}`,
    foil: false,
    foilStatus: "NONFOIL",
    condition: "NM",
    language: "EN",
    roundId: null,
    sourceType: "IMPORT",
    acquiredFromPullId: null,
    notes: null,
    locationId: "loc-unassigned",
    quantity: index < 200 ? 2 : 1,
  }));
  const { prisma, items, audits, counters } = makeBulkPrisma(sourceItems, [
    { id: "loc-unassigned", ownerPlayerId: "owner-1", name: "Unassigned" },
    { id: "loc-box", ownerPlayerId: "owner-1", name: "Box-0001" },
  ]);

  const result = await bulkMoveInventoryToLocation(prisma as any, {
    actorUserId: "user-1",
    destinationLocationId: "loc-box",
    where: { locationId: "loc-unassigned" },
    sourceLocationId: "loc-unassigned",
    allowedOwnerId: "owner-1",
  });

  assert.equal(result.movedEntries, 800);
  assert.equal(result.movedCards, 1000);
  assert.equal(
    items.filter((item) => item.locationId === "loc-unassigned").length,
    0,
  );
  assert.equal(
    items.filter((item) => item.locationId === "loc-box").length,
    800,
  );
  assert.equal(audits.length, 800);
  assert.equal(counters.auditCreateCalls, 0);
  assert.equal(counters.auditCreateManyCalls, 2);
  assert.equal(counters.updateManyCalls, 1);
});

test("bulk delete selected rows removes inventory without deleting card metadata", async () => {
  const { bulkDeleteInventoryItems } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits, counters } = makeBulkPrisma(
    [
      {
        id: "delete-me",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-keep-catalog",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        notes: null,
        locationId: "loc-unassigned",
        quantity: 4,
      },
      {
        id: "keep-me",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-keep-catalog",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        notes: null,
        locationId: "loc-box",
        quantity: 2,
      },
    ],
    [
      { id: "loc-unassigned", ownerPlayerId: "owner-1", name: "Unassigned" },
      { id: "loc-box", ownerPlayerId: "owner-1", name: "Box-0001" },
    ],
  );

  const result = await bulkDeleteInventoryItems(prisma as any, {
    actorUserId: "user-1",
    itemIds: ["delete-me"],
    allowedOwnerId: "owner-1",
    reason: "Test delete",
    scope: "selected",
  });

  assert.equal(result.deletedEntries, 1);
  assert.equal(result.deletedCards, 4);
  assert.equal(
    items.some((item) => item.id === "delete-me"),
    false,
  );
  assert.equal(
    items.some((item) => item.cardId === "card-keep-catalog"),
    true,
  );
  assert.equal(items.find((item) => item.id === "keep-me")?.quantity, 2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].changeType, "bulk_inventory_delete_selected");
  assert.equal(counters.auditCreateCalls, 0);
  assert.equal(counters.auditCreateManyCalls, 1);
});

test("delete location contents only removes inventory from that location", async () => {
  const { bulkDeleteInventoryItems } =
    await import("../lib/inventory-locations");
  const { prisma, items, locations, audits } = makeBulkPrisma(
    [
      {
        id: "unassigned-copy",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        notes: null,
        locationId: "loc-unassigned",
        quantity: 3,
      },
      {
        id: "box-copy",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        notes: null,
        locationId: "loc-box",
        quantity: 2,
      },
    ],
    [
      { id: "loc-unassigned", ownerPlayerId: "owner-1", name: "Unassigned" },
      { id: "loc-box", ownerPlayerId: "owner-1", name: "Box-0001" },
    ],
  );

  const result = await bulkDeleteInventoryItems(prisma as any, {
    actorUserId: "user-1",
    where: { locationId: "loc-unassigned" },
    sourceLocationId: "loc-unassigned",
    allowedOwnerId: "owner-1",
    scope: "location",
  });

  assert.equal(result.deletedEntries, 1);
  assert.equal(result.deletedCards, 3);
  assert.equal(result.inventoryEntriesTouched, 1);
  assert.equal(result.locationQuantityRowsDeleted, 1);
  assert.equal(result.parentInventoryRowsDeleted, 1);
  assert.equal(result.physicalQuantityDeleted, 3);
  assert.equal(
    items.some((item) => item.locationId === "loc-unassigned"),
    false,
  );
  assert.equal(items.find((item) => item.id === "box-copy")?.quantity, 2);
  assert.equal(
    locations.some((location) => location.id === "loc-unassigned"),
    true,
  );
  assert.equal(audits[0].changeType, "location_contents_deleted");
  assert.doesNotThrow(() => structuredClone(result));
});

test("delete location contents reports an empty location without deleting the location", async () => {
  const { bulkDeleteInventoryItems } =
    await import("../lib/inventory-locations");
  const { prisma, locations } = makeBulkPrisma(
    [],
    [{ id: "loc-empty", ownerPlayerId: "owner-1", name: "Empty Box" }],
  );

  await assert.rejects(
    () =>
      bulkDeleteInventoryItems(prisma as any, {
        actorUserId: "user-1",
        where: { locationId: "loc-empty" },
        sourceLocationId: "loc-empty",
        allowedOwnerId: "owner-1",
        scope: "location",
      }),
    /This location has no inventory to delete/,
  );
  assert.equal(
    locations.some((location) => location.id === "loc-empty"),
    true,
  );
});

test("bulk move all from one location rejects same source and destination", async () => {
  const { bulkMoveInventoryToLocation } =
    await import("../lib/inventory-locations");
  const { prisma } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-1",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        locationId: "loc-box",
        quantity: 1,
      },
    ],
    [{ id: "loc-box", ownerPlayerId: "owner-1", name: "Box-0001" }],
  );

  await assert.rejects(
    () =>
      bulkMoveInventoryToLocation(prisma as any, {
        actorUserId: "user-1",
        destinationLocationId: "loc-box",
        sourceLocationId: "loc-box",
        where: { locationId: "loc-box" },
        allowedOwnerId: "owner-1",
      }),
    /Source and destination locations must be different/,
  );
});

test("bulk move can assign an on-demand section inside the same location", async () => {
  const { bulkMoveInventoryToLocation } =
    await import("../lib/inventory-locations");
  const { prisma, items } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-1",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        roundId: null,
        locationId: "loc-vault",
        locationSection: null,
        quantity: 6,
      },
    ],
    [{ id: "loc-vault", ownerPlayerId: "owner-1", name: "Vault" }],
  );

  const result = await bulkMoveInventoryToLocation(prisma as any, {
    actorUserId: "user-1",
    destinationLocationId: "loc-vault",
    destinationLocationSection: "  Section   1 ",
    itemIds: ["source"],
    allowedOwnerId: "owner-1",
  });

  assert.equal(result.movedCards, 6);
  assert.equal(items[0].locationId, "loc-vault");
  assert.equal(items[0].locationSection, "Section 1");
});

test("stack move partially moves into an existing matching destination stack", async () => {
  const { moveInventoryQuantityBetweenLocations } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        cardName: "Sol Ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 3,
      },
      {
        id: "destination",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-2",
        quantity: 1,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await moveInventoryQuantityBetweenLocations(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    destinationLocationId: "loc-box-2",
    quantity: 1,
    allowedOwnerId: "owner-1",
  });

  assert.equal(items.find((item) => item.id === "source")?.quantity, 2);
  assert.equal(items.find((item) => item.id === "destination")?.quantity, 2);
  assert.equal(result.auditInventoryItemId, "source");
  assert.equal(result.merged, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].inventoryItemId, "source");
  assert.equal(
    items.some((item) => item.quantity === 0),
    false,
  );
});

test("stack move fully moves into an existing matching destination stack without audit FK risk", async () => {
  const { moveInventoryQuantityBetweenLocations } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        cardName: "Sol Ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 3,
      },
      {
        id: "destination",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-2",
        quantity: 1,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await moveInventoryQuantityBetweenLocations(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    destinationLocationId: "loc-box-2",
    quantity: 3,
    allowedOwnerId: "owner-1",
  });

  assert.equal(
    items.some((item) => item.id === "source"),
    false,
  );
  assert.equal(items.find((item) => item.id === "destination")?.quantity, 4);
  assert.equal(result.auditInventoryItemId, "destination");
  assert.equal(result.sourceDeleted, true);
  assert.equal(audits[0].inventoryItemId, "destination");
  assert.equal(
    items.some((item) => item.quantity === 0),
    false,
  );
});

test("stack move partially moves into an empty destination by creating a stack", async () => {
  const { moveInventoryQuantityBetweenLocations } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        cardName: "Sol Ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 3,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await moveInventoryQuantityBetweenLocations(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    destinationLocationId: "loc-box-2",
    quantity: 1,
    allowedOwnerId: "owner-1",
  });

  assert.equal(items.find((item) => item.id === "source")?.quantity, 2);
  const created = items.find((item) => item.id !== "source");
  assert.equal(created?.quantity, 1);
  assert.equal(created?.locationId, "loc-box-2");
  assert.equal(result.auditInventoryItemId, created?.id);
  assert.equal(audits[0].inventoryItemId, created?.id);
});

test("stack move fully moves into an empty destination by relocating the source stack", async () => {
  const { moveInventoryQuantityBetweenLocations } =
    await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        cardName: "Sol Ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 3,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await moveInventoryQuantityBetweenLocations(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    destinationLocationId: "loc-box-2",
    quantity: 3,
    allowedOwnerId: "owner-1",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "source");
  assert.equal(items[0].locationId, "loc-box-2");
  assert.equal(items[0].quantity, 3);
  assert.equal(result.auditInventoryItemId, "source");
  assert.equal(audits[0].inventoryItemId, "source");
});

test("stack move rejects invalid quantities, same location, foreign owner, inactive destinations, and non-owner sources", async () => {
  const { moveInventoryQuantityBetweenLocations } =
    await import("../lib/inventory-locations");
  const { prisma } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        cardName: "Sol Ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 3,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-other-owner",
        ownerPlayerId: "owner-2",
        name: "Other Owner Box",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-inactive",
        ownerPlayerId: "owner-1",
        name: "Inactive Box",
        active: false,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );
  const base = {
    actorUserId: "user-1",
    inventoryItemId: "source",
    destinationLocationId: "loc-box-2",
    allowedOwnerId: "owner-1",
  };

  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        quantity: 0,
      }),
    /Quantity must be positive/,
  );
  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        quantity: 4,
      }),
    /Cannot move more copies/,
  );
  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        destinationLocationId: "loc-box-3",
        quantity: 1,
      }),
    /same location/,
  );
  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        destinationLocationId: "loc-other-owner",
        quantity: 1,
      }),
    /does not belong/,
  );
  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        destinationLocationId: "loc-inactive",
        quantity: 1,
      }),
    /inactive/,
  );
  await assert.rejects(
    () =>
      moveInventoryQuantityBetweenLocations(prisma as any, {
        ...base,
        quantity: 1,
        allowedOwnerId: "owner-2",
      }),
    /cannot manage/,
  );
});

test("stack edit merges condition aliases despite different notes and provenance", async () => {
  const { updateInventoryStack } = await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-2",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "LP",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 2,
      },
      {
        id: "destination",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "NEAR_MINT",
        language: "EN",
        sourceType: "CSV_PULL_IMPORT",
        acquiredFromPullId: "pull-1",
        roundId: "round-1",
        notes: "Imported copy",
        locationId: "loc-box-2",
        quantity: 3,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await updateInventoryStack(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    allowedOwnerId: "owner-1",
    target: {
      cardId: "card-sol-ring",
      locationId: "loc-box-2",
      quantity: 2,
      foilStatus: "NONFOIL",
      condition: "NM",
      language: "EN",
      sourceType: "MANUAL",
      notes: null,
    },
  });

  assert.equal(result.inventoryItemId, "destination");
  assert.equal(result.merged, true);
  assert.equal(
    items.some((item) => item.id === "source"),
    false,
  );
  assert.equal(items.find((item) => item.id === "destination")?.quantity, 5);
  assert.equal(audits[0].inventoryItemId, "destination");
  assert.equal(audits[0].changeType, "inventory_stack_merged");
});

test("stack split can merge the split quantity into an existing matching stack", async () => {
  const { splitInventoryStack } = await import("../lib/inventory-locations");
  const { prisma, items, audits } = makeBulkPrisma(
    [
      {
        id: "source",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: false,
        foilStatus: "NONFOIL",
        condition: "LP",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: null,
        locationId: "loc-box-3",
        quantity: 4,
      },
      {
        id: "destination",
        currentOwnerId: "owner-1",
        originalOpenerId: "owner-1",
        cardId: "card-sol-ring",
        foil: true,
        foilStatus: "FOIL",
        condition: "NM",
        language: "EN",
        sourceType: "MANUAL",
        acquiredFromPullId: null,
        roundId: null,
        notes: "trade binder copy",
        locationId: "loc-box-2",
        quantity: 1,
      },
    ],
    [
      {
        id: "loc-box-3",
        ownerPlayerId: "owner-1",
        name: "Box 3",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
      {
        id: "loc-box-2",
        ownerPlayerId: "owner-1",
        name: "Box 2",
        active: true,
        kind: "NORMAL",
        systemManaged: false,
      },
    ],
  );

  const result = await splitInventoryStack(prisma as any, {
    actorUserId: "user-1",
    inventoryItemId: "source",
    allowedOwnerId: "owner-1",
    target: {
      cardId: "card-sol-ring",
      locationId: "loc-box-2",
      quantity: 2,
      foilStatus: "FOIL",
      condition: "NM",
      language: "EN",
      sourceType: "MANUAL",
      notes: "trade binder copy",
    },
  });

  assert.equal(result.sourceInventoryItemId, "source");
  assert.equal(result.destinationInventoryItemId, "destination");
  assert.equal(result.merged, true);
  assert.equal(items.find((item) => item.id === "source")?.quantity, 2);
  assert.equal(items.find((item) => item.id === "destination")?.quantity, 3);
  assert.equal(audits.length, 2);
  assert.deepEqual(
    audits.map((audit) => audit.inventoryItemId),
    ["source", "destination"],
  );
});

test("page group ordering preserves descending card-name page order after hydration", () => {
  const pageGroups = [
    { cardId: "card-z" },
    { cardId: "card-y" },
    { cardId: "card-x" },
    { cardId: "card-w" },
  ];
  const hydratedItems = [
    makeItem({ id: "w", cardId: "card-w", cardName: "Warden" }),
    makeItem({ id: "x", cardId: "card-x", cardName: "Xorn" }),
    makeItem({ id: "y", cardId: "card-y", cardName: "Yavimaya" }),
    makeItem({ id: "z", cardId: "card-z", cardName: "Zetalpa" }),
  ];

  const ordered = orderInventoryItemsByPageGroups(
    hydratedItems,
    pageGroups,
    "grouped",
  );

  assert.deepEqual(
    ordered.map((item) => item.card.name),
    ["Zetalpa", "Yavimaya", "Xorn", "Warden"],
  );
});

test("exact page group ordering uses exact-printing keys without reversing the selected page", () => {
  const pageGroups = [
    {
      currentOwnerId: "owner-1",
      cardId: "card-z",
      foilStatus: "NONFOIL",
      condition: "NM",
      language: "EN",
    },
    {
      currentOwnerId: "owner-1",
      cardId: "card-y",
      foilStatus: "FOIL",
      condition: "LP",
      language: "EN",
    },
  ];
  const hydratedItems = [
    makeItem({
      id: "y",
      cardId: "card-y",
      cardName: "Yavimaya",
      foilStatus: "FOIL",
      condition: "LP",
    }),
    makeItem({ id: "z", cardId: "card-z", cardName: "Zetalpa" }),
  ];

  const ordered = orderInventoryItemsByPageGroups(
    hydratedItems,
    pageGroups,
    "exact",
  );

  assert.deepEqual(
    ordered.map((item) => item.card.name),
    ["Zetalpa", "Yavimaya"],
  );
});
