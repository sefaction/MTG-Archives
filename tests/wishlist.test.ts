import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DeckSection, InventoryLocationKind } from "@prisma/client";
import { buildWishlistView } from "../lib/wishlist";

function card(overrides: any = {}) {
  return {
    id: overrides.id ?? "card-a",
    scryfallId: overrides.scryfallId ?? `${overrides.id ?? "card-a"}-sf`,
    oracleId: overrides.oracleId ?? "oracle-a",
    name: overrides.name ?? "Lightning Bolt",
    manaCost: overrides.manaCost ?? "{R}",
    manaValue: overrides.manaValue ?? 1,
    oracleText: overrides.oracleText ?? "Deal 3 damage to any target.",
    typeLine: overrides.typeLine ?? "Instant",
    colorIdentity: overrides.colorIdentity ?? ["R"],
    setCode: overrides.setCode ?? "clu",
    setName: overrides.setName ?? "Ravnica Clue Edition",
    collectorNumber: overrides.collectorNumber ?? "141",
    rarity: overrides.rarity ?? "uncommon",
    imageUri: overrides.imageUri ?? null,
    prices: overrides.prices ?? { usd: "1.50" },
  };
}

const boltA = card();
const boltB = card({
  id: "card-b",
  scryfallId: "card-b-sf",
  setCode: "2xm",
  collectorNumber: "129",
  oracleId: "oracle-a",
});

function inventory(overrides: any = {}) {
  const c = overrides.card ?? boltA;
  return {
    id: overrides.id ?? "inv-1",
    cardId: c.id,
    quantity: overrides.quantity ?? 1,
    card: { id: c.id, oracleId: c.oracleId, name: c.name },
    location: overrides.location ?? null,
  };
}

test("deck-derived wishlist treats only committed-to-this-deck copies as satisfied", () => {
  const view = buildWishlistView({
    manualItems: [],
    decks: [
      {
        id: "deck-1",
        name: "Burn",
        cards: [
          {
            id: "dc-1",
            cardId: boltA.id,
            scryfallId: boltA.scryfallId,
            oracleId: boltA.oracleId,
            cardName: boltA.name,
            section: DeckSection.MAINBOARD,
            quantity: 4,
            card: boltA,
          },
        ],
      },
    ],
    inventoryItems: [
      inventory({
        id: "available",
        quantity: 2,
        location: {
          id: "box",
          name: "Box",
          kind: InventoryLocationKind.NORMAL,
          deckId: null,
        },
      }),
      inventory({
        id: "committed",
        quantity: 1,
        location: {
          id: "deckloc",
          name: "Deck: Burn",
          kind: InventoryLocationKind.DECK,
          deckId: "deck-1",
        },
      }),
      inventory({
        id: "otherdeck",
        quantity: 1,
        location: {
          id: "deckloc2",
          name: "Deck: Other",
          kind: InventoryLocationKind.DECK,
          deckId: "deck-2",
        },
      }),
    ],
  });
  assert.equal(view.groups[0].deckQuantity, 3);
  assert.equal(view.groups[0].sources.decks[0].committedQuantity, 1);
  assert.equal(view.groups[0].sources.decks[0].missingQuantity, 3);
  assert.equal(view.groups[0].sources.decks[0].committedToOtherDecks, 1);
  assert.equal(view.groups[0].needQuantity, 3);
  assert.equal(view.groups[0].readyQuantity, 2);
  assert.equal(view.groups[0].getQuantity, 1);
  assert.equal(view.summary.readyQuantity, 2);
});

test("fully committed deck card does not appear as a derived need", () => {
  const view = buildWishlistView({
    manualItems: [],
    decks: [
      {
        id: "deck-1",
        name: "Burn",
        cards: [
          {
            id: "dc-1",
            cardId: boltA.id,
            scryfallId: boltA.scryfallId,
            oracleId: boltA.oracleId,
            cardName: boltA.name,
            section: DeckSection.MAINBOARD,
            quantity: 2,
            card: boltA,
          },
        ],
      },
    ],
    inventoryItems: [
      inventory({
        quantity: 2,
        location: {
          id: "deckloc",
          name: "Deck: Burn",
          kind: InventoryLocationKind.DECK,
          deckId: "deck-1",
        },
      }),
    ],
  });
  assert.equal(view.groups.length, 0);
  assert.equal(view.summary.deckRows, 0);
});

test("manual and deck-derived needs combine by oracle identity with source breakdown", () => {
  const view = buildWishlistView({
    manualItems: [
      {
        id: "wish-1",
        cardId: boltA.id,
        quantity: 1,
        priority: "High",
        notes: "gift",
        desiredFinish: null,
        desiredCondition: null,
        desiredLanguage: null,
        card: boltA,
      },
    ],
    decks: [
      {
        id: "deck-a",
        name: "Deck A",
        cards: [
          {
            id: "dc-a",
            cardId: boltA.id,
            scryfallId: boltA.scryfallId,
            oracleId: boltA.oracleId,
            cardName: boltA.name,
            section: DeckSection.MAINBOARD,
            quantity: 1,
            card: boltA,
          },
        ],
      },
      {
        id: "deck-b",
        name: "Deck B",
        cards: [
          {
            id: "dc-b",
            cardId: boltB.id,
            scryfallId: boltB.scryfallId,
            oracleId: boltB.oracleId,
            cardName: boltB.name,
            section: DeckSection.SIDEBOARD,
            quantity: 2,
            card: boltB,
          },
        ],
      },
    ],
    inventoryItems: [],
  });
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].sourceLabel, "Manual + Deck");
  assert.equal(view.groups[0].manualQuantity, 1);
  assert.equal(view.groups[0].deckQuantity, 3);
  assert.equal(view.groups[0].needQuantity, 4);
  assert.equal(view.groups[0].readyQuantity, 0);
  assert.equal(view.groups[0].getQuantity, 4);
  assert.equal(view.groups[0].sources.decks.length, 2);
});

test("normal wishlist is isolated from trade wishlist data", () => {
  const wishlist = readFileSync("lib/wishlist.ts", "utf8");
  assert.doesNotMatch(wishlist, /tradeWishlistItem/);
  assert.doesNotMatch(wishlist, /TradeWishlist/);
  assert.doesNotMatch(wishlist, /tradeQuantity/);
  assert.doesNotMatch(wishlist, /sources\.trade/);
});

test("inventory-aware counts separate available and committed deck copies", () => {
  const view = buildWishlistView({
    manualItems: [
      {
        id: "wish-1",
        cardId: boltA.id,
        quantity: 3,
        priority: null,
        notes: null,
        desiredFinish: null,
        desiredCondition: null,
        desiredLanguage: null,
        card: boltA,
      },
    ],
    decks: [],
    inventoryItems: [
      inventory({
        id: "box",
        quantity: 2,
        location: {
          id: "box",
          name: "Box",
          kind: InventoryLocationKind.NORMAL,
          deckId: null,
        },
      }),
      inventory({
        id: "other-deck",
        quantity: 1,
        location: {
          id: "deckloc2",
          name: "Deck: Other",
          kind: InventoryLocationKind.DECK,
          deckId: "deck-2",
        },
      }),
    ],
  });
  assert.equal(view.groups[0].inventory.ownedTotal, 3);
  assert.equal(view.groups[0].inventory.available, 2);
  assert.equal(view.groups[0].inventory.committedToDecks, 1);
  assert.equal(view.groups[0].needQuantity, 3);
  assert.equal(view.groups[0].readyQuantity, 0);
  assert.equal(view.groups[0].getQuantity, 3);
  assert.equal(view.summary.getQuantity, 3);
});

test("Need, Ready, and Get ignore copies assigned to other decks", () => {
  const view = buildWishlistView({
    manualItems: [],
    decks: [
      {
        id: "deck-1",
        name: "New Deck",
        cards: [
          {
            id: "dc-1",
            cardId: boltA.id,
            scryfallId: boltA.scryfallId,
            oracleId: boltA.oracleId,
            cardName: boltA.name,
            section: DeckSection.MAINBOARD,
            quantity: 4,
            card: boltA,
          },
        ],
      },
    ],
    inventoryItems: [
      inventory({
        id: "unassigned",
        quantity: 1,
        location: {
          id: "box",
          name: "Box",
          kind: InventoryLocationKind.NORMAL,
          deckId: null,
        },
      }),
      inventory({
        id: "assigned-elsewhere",
        quantity: 9,
        location: {
          id: "other-deck",
          name: "Deck: Existing",
          kind: InventoryLocationKind.DECK,
          deckId: "deck-2",
        },
      }),
    ],
  });

  assert.equal(view.groups[0].needQuantity, 4);
  assert.equal(view.groups[0].inventory.ownedTotal, 10);
  assert.equal(view.groups[0].inventory.available, 1);
  assert.equal(view.groups[0].inventory.committedToDecks, 9);
  assert.equal(view.groups[0].readyQuantity, 1);
  assert.equal(view.groups[0].getQuantity, 3);
  assert.equal(view.summary.readyQuantity, 1);
  assert.equal(view.summary.getQuantity, 3);
});

test("wishlist page is private and renders inventory-style table shell", () => {
  const page = readFileSync("app/wishlist/page.tsx", "utf8");
  const table = readFileSync("components/WishlistTable.tsx", "utf8");
  assert.match(page, /requireLogin\(\)/);
  assert.match(page, /<WishlistTable\s+groups=\{pageGroups\}/);
  assert.match(table, /<table className="w-full text-sm">/);
  assert.match(table, /Columns/);
});

test("wishlist table defaults and row action menu are compact", () => {
  const table = readFileSync("components/WishlistTable.tsx", "utf8");
  for (const label of [
    "Card Name",
    "Need",
    "Ready",
    "Get",
    "Source",
    "Decks",
    "Price",
    "Priority",
    "Actions",
  ]) {
    assert.match(table, new RegExp(label));
  }
  assert.match(table, /RowActionMenu/);
  assert.match(table, /View details/);
  const rowMenu = table.slice(
    table.indexOf("function RowActionMenu"),
    table.indexOf("function WishlistPrintingPicker"),
  );
  assert.match(rowMenu, /Quick add manual quantity/);
  assert.match(rowMenu, /View deck/);
  assert.match(rowMenu, /View in inventory/);
  assert.doesNotMatch(rowMenu, /Commit available copy/);
  assert.doesNotMatch(rowMenu, /Use owned printing/);
  assert.doesNotMatch(rowMenu, /Use cheapest printing/);
});

test("wishlist drawer contains granular editing and manipulation sections", () => {
  const table = readFileSync("components/WishlistTable.tsx", "utf8");
  const drawer = table.slice(
    table.indexOf("function WishlistDetailDrawer"),
    table.indexOf("function Metric"),
  );
  for (const label of [
    "Card summary",
    "Quantity summary",
    "Manual wishlist controls",
    "Needed for decks",
    "Inventory availability breakdown",
    "Printing tools",
    "Commit available copy",
    "Use owned printing for this deck card",
    "Use cheapest printing for this deck card",
    "Change deck card printing",
    "Change wishlist printing",
  ]) {
    assert.match(drawer, new RegExp(label));
  }
});

test("wishlist page includes inventory-style view, advanced filter, sort, and paging controls", () => {
  const page = readFileSync("app/wishlist/page.tsx", "utf8");
  const table = readFileSync("components/WishlistTable.tsx", "utf8");
  assert.match(table, /Table View/);
  assert.match(table, /Binder View/);
  assert.match(table, /Card Size:/);
  assert.match(table, /wishlistViewMode/);
  assert.match(table, /wishlistCardSize/);
  assert.match(table, /\["small", "medium", "large"\]/);
  assert.match(table, /size\[0\]\.toUpperCase\(\) \+ size\.slice\(1\)/);
  assert.match(table, /collectionCardGridClass\(cardSize\)/);
  assert.match(table, /width=\{265\}/);
  assert.match(table, /height=\{370\}/);
  assert.match(table, /aspect-\[63\/88\]/);
  assert.match(table, /loading="lazy"/);
  assert.match(table, /Previous/);
  assert.match(table, /Next/);
  assert.match(table, /Infinite scroll sentinel/);
  assert.match(page, /Advanced Filters/);
  assert.doesNotMatch(page, /Trade Wants/);
  assert.doesNotMatch(page, /Trade-wanted quantity/);
  assert.doesNotMatch(table, /updateTradeWishlistQuantity/);
  assert.doesNotMatch(table, /Wishlist quantity from/);
  assert.doesNotMatch(page, /Trade wants/);
  assert.doesNotMatch(table, /Trade Wanted Qty/);
  assert.doesNotMatch(table, /Negotiate trade with/);
  assert.match(page, /Clear Filters/);
  assert.match(page, /pageSize/);
  for (const filter of [
    "Color identity",
    "Mana min",
    "Price max",
    "Ready only",
  ]) {
    assert.match(page, new RegExp(filter));
  }
});

test("shared collection card grid sizing matches inventory binder density", () => {
  const grid = readFileSync("components/cardGrid.ts", "utf8");
  const inventory = readFileSync("components/InventoryBrowser.tsx", "utf8");
  const wishlist = readFileSync("components/WishlistTable.tsx", "utf8");
  assert.match(grid, /grid-cols-2 md:grid-cols-4 lg:grid-cols-8/);
  assert.match(grid, /grid-cols-2 md:grid-cols-4 lg:grid-cols-6/);
  assert.match(grid, /grid-cols-2 md:grid-cols-3 lg:grid-cols-5/);
  assert.match(inventory, /collectionCardGridClass\(cardSize\)/);
  assert.match(wishlist, /collectionCardGridClass\(cardSize\)/);
  assert.match(inventory, /inventoryCardSize/);
  assert.match(wishlist, /wishlistCardSize/);
});

test("deck-derived wishlist excludes basic lands but keeps nonbasic needs", () => {
  const forest = card({
    id: "forest-special",
    scryfallId: "forest-sf",
    oracleId: "oracle-forest",
    name: "Forest",
    manaCost: "",
    manaValue: 0,
    typeLine: "Basic Land — Forest",
    colorIdentity: ["G"],
  });
  const island = card({
    id: "island-special",
    scryfallId: "island-sf",
    oracleId: "oracle-island",
    name: "Island",
    manaCost: "",
    manaValue: 0,
    typeLine: "Basic Land — Island",
    colorIdentity: ["U"],
  });
  const solRing = card({
    id: "sol-ring",
    scryfallId: "sol-ring-sf",
    oracleId: "oracle-sol-ring",
    name: "Sol Ring",
    manaCost: "{1}",
    manaValue: 1,
    typeLine: "Artifact",
    colorIdentity: [],
  });

  const view = buildWishlistView({
    manualItems: [],
    decks: [
      {
        id: "deck-1",
        name: "Basics and Ring",
        cards: [
          {
            id: "dc-forest",
            cardId: forest.id,
            scryfallId: forest.scryfallId,
            oracleId: forest.oracleId,
            cardName: forest.name,
            section: DeckSection.MAINBOARD,
            quantity: 10,
            card: forest,
          },
          {
            id: "dc-island",
            cardId: island.id,
            scryfallId: island.scryfallId,
            oracleId: island.oracleId,
            cardName: island.name,
            section: DeckSection.MAINBOARD,
            quantity: 10,
            card: island,
          },
          {
            id: "dc-sol",
            cardId: solRing.id,
            scryfallId: solRing.scryfallId,
            oracleId: solRing.oracleId,
            cardName: solRing.name,
            section: DeckSection.MAINBOARD,
            quantity: 1,
            card: solRing,
          },
        ],
      },
    ],
    inventoryItems: [],
  });

  assert.equal(view.summary.needQuantity, 1);
  assert.equal(view.summary.readyQuantity, 0);
  assert.equal(view.summary.getQuantity, 1);
  assert.deepEqual(
    view.groups.map((group) => group.card.name),
    ["Sol Ring"],
  );
  assert.equal(view.groups[0].sources.decks[0].missingQuantity, 1);
});
