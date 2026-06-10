import assert from "node:assert/strict";
import test from "node:test";
import {
  deckLocationNormalizedName,
  isNormalInventoryLocation,
  isSystemDeckLocation,
} from "../lib/deck-inventory";

test("deck locations are recognized as system-managed and not normal destinations", () => {
  assert.equal(
    isSystemDeckLocation({ type: "Deck", normalizedName: "deck-abc" }),
    true,
  );
  assert.equal(
    isSystemDeckLocation({ type: "Box", normalizedName: "deck-abc" }),
    true,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Deck",
      normalizedName: "deck-abc",
      active: true,
    }),
    false,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Box",
      normalizedName: "box-0001",
      active: true,
    }),
    true,
  );
  assert.equal(
    isNormalInventoryLocation({
      type: "Binder",
      normalizedName: "binder-1",
      active: false,
    }),
    false,
  );
});

test("deck location normalized names are deterministic per deck", () => {
  assert.equal(deckLocationNormalizedName("deck-123"), "deck-deck-123");
  assert.notEqual(
    deckLocationNormalizedName("deck-123"),
    deckLocationNormalizedName("deck-456"),
  );
});

function makeDeckInventoryTx(itemsInput: any[], locationsInput: any[]) {
  const items = itemsInput.map((item) => ({ ...item }));
  const locations = locationsInput.map((location) => ({ ...location }));
  const audits: any[] = [];
  const matchesWhere = (item: any, where: any): boolean => {
    if (where.currentOwnerId && item.currentOwnerId !== where.currentOwnerId)
      return false;
    if (where.locationId && item.locationId !== where.locationId) return false;
    if (where.cardId?.in && !where.cardId.in.includes(item.cardId))
      return false;
    if (
      where.quantity?.gt !== undefined &&
      !(item.quantity > where.quantity.gt)
    )
      return false;
    return true;
  };
  const matchesLocationWhere = (location: any, where: any): boolean => {
    if (where.id && location.id !== where.id) return false;
    if (where.ownerPlayerId && location.ownerPlayerId !== where.ownerPlayerId)
      return false;
    if (where.OR) {
      return where.OR.some((part: any) => {
        if (part.deckId && location.deckId === part.deckId) return true;
        if (
          part.normalizedName &&
          location.normalizedName === part.normalizedName
        )
          return true;
        if (
          part.type &&
          location.type === part.type &&
          part.description?.contains &&
          location.description?.includes(part.description.contains)
        ) {
          return true;
        }
        return false;
      });
    }
    return true;
  };
  return {
    tx: {
      inventoryLocation: {
        findFirst: async ({ where }: any) =>
          locations.find((location) => matchesLocationWhere(location, where)) ??
          null,
        findUnique: async ({ where }: any) =>
          locations.find((location) => location.id === where.id) ?? null,
      },
      inventoryItem: {
        findMany: async ({ where }: any) =>
          items
            .filter((item) => matchesWhere(item, where))
            .map((item) => ({ ...item })),
        update: async ({ where, data }: any) => {
          const item = items.find((candidate) => candidate.id === where.id);
          if (!item) throw new Error("item not found");
          if (data.quantity?.increment)
            item.quantity += data.quantity.increment;
          if (data.quantity?.decrement)
            item.quantity -= data.quantity.decrement;
          if (data.locationId !== undefined) item.locationId = data.locationId;
          return { ...item };
        },
        delete: async ({ where }: any) => {
          const index = items.findIndex(
            (candidate) => candidate.id === where.id,
          );
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
          audits.push(data);
          return data;
        },
        createMany: async ({ data }: any) => {
          audits.push(...data);
          return { count: data.length };
        },
      },
    },
    items,
    locations,
    audits,
  };
}

function deckInventoryItem(overrides: any = {}) {
  return {
    id: overrides.id ?? "deck-item",
    currentOwnerId: overrides.currentOwnerId ?? "owner-1",
    originalOpenerId: overrides.originalOpenerId ?? "owner-1",
    cardId: overrides.cardId ?? "card-sol-ring",
    foil: false,
    foilStatus: "NONFOIL",
    condition: "NM",
    language: "EN",
    roundId: null,
    locationId: overrides.locationId ?? "deck-location",
    quantity: overrides.quantity ?? 1,
    sourceType: "MANUAL",
    acquiredFromPullId: null,
    notes: null,
    card: { name: overrides.cardName ?? "Sol Ring" },
  };
}

test("return committed inventory moves one deck item to a normal destination and writes audit", async () => {
  const { returnCommittedInventoryFromDeckTx } =
    await import("../lib/deck-inventory");
  const { tx, items, audits } = makeDeckInventoryTx(
    [
      deckInventoryItem({ id: "committed", quantity: 2 }),
      deckInventoryItem({ id: "destination", locationId: "box", quantity: 3 }),
    ],
    [
      {
        id: "deck-location",
        ownerPlayerId: "owner-1",
        name: "Deck: Test",
        normalizedName: "deck test",
        type: "Deck",
        kind: "DECK",
        deckId: "deck-1",
        systemManaged: true,
        active: true,
      },
      {
        id: "box",
        ownerPlayerId: "owner-1",
        name: "Box-0001",
        normalizedName: "box-0001",
        type: "Box",
        kind: "NORMAL",
        deckId: null,
        systemManaged: false,
        active: true,
      },
    ],
  );

  const result = await returnCommittedInventoryFromDeckTx(tx as any, {
    actorUserId: "user-1",
    ownerPlayerId: "owner-1",
    deckId: "deck-1",
    deckName: "Test",
    destinationLocationId: "box",
    mode: "returned_from_deck",
    cardIds: ["card-sol-ring"],
    maxQuantity: 1,
  });

  assert.equal(result.movedCards, 1);
  assert.equal(result.movedEntries, 1);
  assert.equal(items.find((item) => item.id === "committed")?.quantity, 1);
  assert.equal(items.find((item) => item.id === "destination")?.quantity, 4);
  assert.equal(audits.length, 2);
});

test("bulk returning selected card ids leaves unselected committed inventory in the deck", async () => {
  const { returnCommittedInventoryFromDeckTx } =
    await import("../lib/deck-inventory");
  const { tx, items } = makeDeckInventoryTx(
    [
      deckInventoryItem({ id: "selected", cardId: "card-a", quantity: 1 }),
      deckInventoryItem({ id: "unselected", cardId: "card-b", quantity: 1 }),
    ],
    [
      {
        id: "deck-location",
        ownerPlayerId: "owner-1",
        name: "Deck: Test",
        normalizedName: "deck test",
        type: "Deck",
        kind: "DECK",
        deckId: "deck-1",
        systemManaged: true,
        active: true,
      },
      {
        id: "box",
        ownerPlayerId: "owner-1",
        name: "Box-0001",
        normalizedName: "box-0001",
        type: "Box",
        kind: "NORMAL",
        deckId: null,
        systemManaged: false,
        active: true,
      },
    ],
  );

  const result = await returnCommittedInventoryFromDeckTx(tx as any, {
    actorUserId: "user-1",
    ownerPlayerId: "owner-1",
    deckId: "deck-1",
    deckName: "Test",
    destinationLocationId: "box",
    mode: "bulk_returned_from_deck",
    cardIds: ["card-a"],
  });

  assert.equal(result.movedCards, 1);
  assert.equal(items.find((item) => item.id === "selected")?.locationId, "box");
  assert.equal(
    items.find((item) => item.id === "unselected")?.locationId,
    "deck-location",
  );
});

test("return all committed inventory empties the deck location without deleting cards", async () => {
  const { returnCommittedInventoryFromDeckTx } =
    await import("../lib/deck-inventory");
  const { tx, items } = makeDeckInventoryTx(
    [
      deckInventoryItem({ id: "a", cardId: "card-a", quantity: 1 }),
      deckInventoryItem({ id: "b", cardId: "card-b", quantity: 2 }),
    ],
    [
      {
        id: "deck-location",
        ownerPlayerId: "owner-1",
        name: "Deck: Test",
        normalizedName: "deck test",
        type: "Deck",
        kind: "DECK",
        deckId: "deck-1",
        systemManaged: true,
        active: true,
      },
      {
        id: "box",
        ownerPlayerId: "owner-1",
        name: "Box-0001",
        normalizedName: "box-0001",
        type: "Box",
        kind: "NORMAL",
        deckId: null,
        systemManaged: false,
        active: true,
      },
    ],
  );

  const result = await returnCommittedInventoryFromDeckTx(tx as any, {
    actorUserId: "user-1",
    ownerPlayerId: "owner-1",
    deckId: "deck-1",
    deckName: "Test",
    destinationLocationId: "box",
    mode: "bulk_returned_from_deck",
  });

  assert.equal(result.movedCards, 3);
  assert.equal(
    items.filter((item) => item.locationId === "deck-location").length,
    0,
  );
  assert.equal(
    items
      .filter((item) => item.locationId === "box")
      .reduce((sum, item) => sum + item.quantity, 0),
    3,
  );
});
