import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FoilStatus, InventoryLocationKind } from "@prisma/client";
import {
  addInventoryCardToLocation,
  normalizeManualInventoryQuantity,
} from "../lib/inventory-manual";

function createManualTx(overrides: any = {}) {
  const cards = new Map([
    [
      "card-1",
      {
        id: "card-1",
        name: "Sol Ring",
        setCode: "ltc",
        collectorNumber: "314",
      },
    ],
    [
      "forest-special",
      {
        id: "forest-special",
        name: "Forest",
        setCode: "sld",
        collectorNumber: "999",
      },
    ],
  ]);
  const locations = new Map([
    [
      "box",
      {
        id: "box",
        ownerPlayerId: "player-1",
        name: "Box",
        kind: InventoryLocationKind.NORMAL,
        systemManaged: false,
        type: "Box",
        active: true,
      },
    ],
    [
      "deck-loc",
      {
        id: "deck-loc",
        ownerPlayerId: "player-1",
        name: "Deck: Test",
        kind: InventoryLocationKind.DECK,
        systemManaged: true,
        type: "Deck",
        active: true,
      },
    ],
  ]);
  const inventoryItems = new Map<string, any>(
    (overrides.inventoryItems ?? []).map((item: any) => [item.id, { ...item }]),
  );
  const auditLogs: any[] = [];
  let nextId = 1;
  const tx = {
    card: {
      findUnique: async ({ where }: any) => cards.get(where.id) ?? null,
    },
    inventoryLocation: {
      findFirst: async ({ where }: any) => {
        const location = locations.get(where.id);
        if (!location) return null;
        if (
          where.ownerPlayerId &&
          location.ownerPlayerId !== where.ownerPlayerId
        )
          return null;
        if (where.active !== undefined && location.active !== where.active)
          return null;
        return location;
      },
    },
    inventoryItem: {
      findFirst: async ({ where }: any) =>
        [...inventoryItems.values()].find(
          (item) =>
            item.currentOwnerId === where.currentOwnerId &&
            item.originalOpenerId === where.originalOpenerId &&
            item.cardId === where.cardId &&
            item.foil === where.foil &&
            item.foilStatus === where.foilStatus &&
            (where.condition?.in
              ? where.condition.in.includes(item.condition)
              : item.condition === where.condition) &&
            item.language === where.language &&
            item.locationId === where.locationId &&
            (item.locationSection ?? null) === where.locationSection &&
            item.quantity > 0,
        ) ?? null,
      update: async ({ where, data }: any) => {
        const item = inventoryItems.get(where.id);
        if (!item) throw new Error("missing inventory");
        if (data.quantity?.increment) item.quantity += data.quantity.increment;
        if (data.condition !== undefined) item.condition = data.condition;
        if (data.notes !== undefined) item.notes = data.notes;
        if (data.sourceType !== undefined) item.sourceType = data.sourceType;
        inventoryItems.set(item.id, item);
        return { ...item };
      },
      create: async ({ data }: any) => {
        const item = { id: `new-${nextId++}`, ...data };
        inventoryItems.set(item.id, item);
        return { ...item };
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return { id: `audit-${auditLogs.length}`, ...data };
      },
    },
  };
  return { tx, inventoryItems, auditLogs };
}

test("manual single-card add creates inventory and an audit log with a surviving item id", async () => {
  const { tx, inventoryItems, auditLogs } = createManualTx();
  const result = await addInventoryCardToLocation(tx as any, {
    ownerPlayerId: "player-1",
    cardId: "card-1",
    locationId: "box",
    quantity: 2,
    foilStatus: FoilStatus.FOIL,
    condition: "LP",
    language: "jp",
    actingUserId: "user-1",
  });

  assert.equal(result.created, true);
  assert.equal(result.inventory.quantity, 2);
  assert.equal(result.inventory.foilStatus, FoilStatus.FOIL);
  assert.equal(result.inventory.condition, "LP");
  assert.equal(result.inventory.language, "JP");
  assert.equal(inventoryItems.has(result.inventory.id), true);
  assert.equal(auditLogs[0].inventoryItemId, result.inventory.id);
  assert.equal(auditLogs[0].changeType, "inventory_added");
});

test("manual single-card add increments matching stack by owner, location, finish, condition, and language", async () => {
  const { tx, auditLogs } = createManualTx({
    inventoryItems: [
      {
        id: "existing",
        currentOwnerId: "player-1",
        originalOpenerId: "player-1",
        cardId: "card-1",
        quantity: 3,
        foil: false,
        foilStatus: FoilStatus.NONFOIL,
        condition: "NEAR_MINT",
        language: "EN",
        locationId: "box",
      },
    ],
  });
  const result = await addInventoryCardToLocation(tx as any, {
    ownerPlayerId: "player-1",
    cardId: "card-1",
    locationId: "box",
    quantity: 4,
    foilStatus: FoilStatus.NONFOIL,
    condition: "NM",
    language: "EN",
    actingUserId: "user-1",
  });

  assert.equal(result.created, false);
  assert.equal(result.inventory.id, "existing");
  assert.equal(result.inventory.quantity, 7);
  assert.equal(result.inventory.condition, "NM");
  assert.equal(auditLogs[0].inventoryItemId, "existing");
  assert.equal((auditLogs[0].afterJson as any).afterQuantity, 7);
});

test("manual single-card add keeps different on-demand sections separate", async () => {
  const { tx, inventoryItems } = createManualTx({
    inventoryItems: [
      {
        id: "section-one",
        currentOwnerId: "player-1",
        originalOpenerId: "player-1",
        cardId: "card-1",
        quantity: 3,
        foil: false,
        foilStatus: FoilStatus.NONFOIL,
        condition: "NM",
        language: "EN",
        locationId: "box",
        locationSection: "Section 1",
      },
    ],
  });

  const result = await addInventoryCardToLocation(tx as any, {
    ownerPlayerId: "player-1",
    cardId: "card-1",
    locationId: "box",
    locationSection: "Section 2",
    quantity: 2,
  });

  assert.equal(result.created, true);
  assert.equal(result.inventory.locationSection, "Section 2");
  assert.equal(inventoryItems.get("section-one")?.quantity, 3);
});

test("manual single-card add rejects deck locations by default but supports special basic-land printings", async () => {
  const { tx } = createManualTx();
  await assert.rejects(
    () =>
      addInventoryCardToLocation(tx as any, {
        ownerPlayerId: "player-1",
        cardId: "card-1",
        locationId: "deck-loc",
        quantity: 1,
      }),
    /normal inventory location/,
  );

  const result = await addInventoryCardToLocation(tx as any, {
    ownerPlayerId: "player-1",
    cardId: "forest-special",
    locationId: "box",
    quantity: 1,
  });
  assert.equal(result.card.name, "Forest");
});

test("manual inventory quantity must be a positive integer", () => {
  assert.equal(normalizeManualInventoryQuantity("3"), 3);
  assert.throws(() => normalizeManualInventoryQuantity("0"), /positive/);
  assert.throws(() => normalizeManualInventoryQuantity("1.5"), /positive/);
});

test("single-card and deck add-real-copy UIs use deliberate printing search and protected server actions", () => {
  const singleCard = readFileSync(
    "components/SingleCardInventoryAdd.tsx",
    "utf8",
  );
  assert.match(singleCard, /Add single card/);
  assert.match(singleCard, /Include Scryfall fallback for plain-name searches/);
  assert.match(singleCard, /onClick=\{search\}/);
  assert.match(singleCard, /action=\{addSingleCardToInventory\}/);

  const deckEditor = readFileSync("components/DeckListEditor.tsx", "utf8");
  const addRealCopyUi = deckEditor.slice(
    deckEditor.indexOf("function AddRealCopyToDeck"),
    deckEditor.indexOf("function ReturnCommittedCopies"),
  );
  assert.match(addRealCopyUi, /Add real copy/);
  assert.match(addRealCopyUi, /<DeckPrintingChooser/);
  assert.match(addRealCopyUi, /Add and commit real copy/);
  assert.match(addRealCopyUi, /action=\{addRealCopyToDeck\}/);
  assert.doesNotMatch(addRealCopyUi, /Added for deck row/);
  assert.doesNotMatch(addRealCopyUi, /Normal inventory location/);
  assert.doesNotMatch(addRealCopyUi, /Commit to this deck immediately/);

  const deckPicker = readFileSync("components/DeckCardPicker.tsx", "utf8");
  assert.match(deckPicker, /Also add a physical copy to inventory/);
  assert.match(deckPicker, /name="inventoryLocationId"/);
  assert.match(deckPicker, /name="commitNewInventoryCopy"/);

  const deckActions = readFileSync("app/decks/actions.ts", "utf8");
  const addRealCopyAction = deckActions.slice(
    deckActions.indexOf("export async function addRealCopyToDeck"),
    deckActions.indexOf("export async function commitDeckCardToDeck"),
  );
  assert.match(deckActions, /requireManagedDeck\(deckId\)/);
  assert.match(addRealCopyAction, /quantity > remainingNeeded/);
  assert.match(addRealCopyAction, /ensureDefaultLocation/);
  assert.match(addRealCopyAction, /ensureDeckLocation/);
  assert.match(addRealCopyAction, /selectedCardMatchesRow/);
  assert.match(addRealCopyAction, /moveInventoryQuantityWithinTransaction/);
  assert.doesNotMatch(addRealCopyAction, /formString\(fd, "locationId"\)/);
  assert.doesNotMatch(
    addRealCopyAction,
    /formString\(fd, "commitImmediately"\)/,
  );
  assert.match(deckActions, /if \(addInventoryCopy\)/);
  assert.match(deckActions, /Added physical copy while adding/);
});
