import assert from "node:assert/strict";
import test from "node:test";
import {
  DeckSection,
  DefaultCollectionVisibility,
  UserRole,
  Visibility,
} from "@prisma/client";
import {
  canManageDeck,
  canViewDeck,
  deckCardCount,
  normalizePositiveQuantity,
  publicDeckWhere,
  summarizeDeckCardOwnership,
} from "../lib/decks";
import { resolveAccessScope } from "../lib/auth";
import { resolveDeckVisibility } from "../lib/visibility";

function user(overrides: any = {}) {
  return {
    id: overrides.id ?? "user-1",
    username: overrides.username ?? "user",
    email: null,
    passwordHash: "hash",
    role: overrides.role ?? UserRole.PLAYER,
    isActive: true,
    forcePasswordChange: false,
    displayName: overrides.displayName ?? "User",
    playerId: overrides.playerId ?? "owner-1",
    lastLoginAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    player: null,
  } as any;
}

function deck(overrides: any = {}) {
  return {
    ownerUserId: overrides.ownerUserId ?? "user-1",
    visibility: overrides.visibility ?? Visibility.INHERIT,
    ownerUser: {
      deckDefaultVisibility:
        overrides.deckDefaultVisibility ?? DefaultCollectionVisibility.PRIVATE,
      publicProfileEnabled: overrides.publicProfileEnabled ?? true,
      isActive: overrides.isActive ?? true,
    },
  };
}

test("deck CRUD policy allows owners and requires admin mode for cross-user edits", () => {
  const owner = user({ id: "user-1" });
  const admin = user({ id: "admin-1", role: UserRole.ADMIN });
  const otherDeck = deck({ ownerUserId: "user-2" });

  assert.equal(canManageDeck(owner, deck(), false), true);
  assert.equal(canManageDeck(owner, otherDeck, false), false);
  assert.equal(canManageDeck(admin, otherDeck, false), false);
  assert.equal(canManageDeck(admin, otherDeck, true), true);

  const adminNormalScope = resolveAccessScope(admin, false);
  const adminModeScope = resolveAccessScope(admin, true);
  assert.equal(adminNormalScope.mode, "user");
  assert.equal(adminModeScope.mode, "admin");
});

test("public/private deck visibility protects private decks", () => {
  assert.equal(
    canViewDeck(null, deck({ visibility: Visibility.PRIVATE })),
    false,
  );
  assert.equal(
    canViewDeck(null, deck({ visibility: Visibility.PUBLIC })),
    true,
  );
  assert.equal(
    canViewDeck(
      null,
      deck({
        visibility: Visibility.INHERIT,
        deckDefaultVisibility: DefaultCollectionVisibility.PUBLIC,
      }),
    ),
    true,
  );
  assert.equal(
    canViewDeck(
      null,
      deck({ visibility: Visibility.PUBLIC, publicProfileEnabled: false }),
    ),
    false,
  );
  assert.equal(
    resolveDeckVisibility(
      DefaultCollectionVisibility.PRIVATE,
      Visibility.INHERIT,
    ),
    DefaultCollectionVisibility.PRIVATE,
  );
});

test("public deck where includes public and inherited-public decks only", () => {
  assert.deepEqual(publicDeckWhere(), {
    ownerUser: { isActive: true, publicProfileEnabled: true },
    OR: [
      { visibility: Visibility.PUBLIC },
      {
        visibility: Visibility.INHERIT,
        ownerUser: {
          deckDefaultVisibility: DefaultCollectionVisibility.PUBLIC,
        },
      },
    ],
  });
});

test("deck card counts exclude maybeboard quantities", () => {
  assert.equal(
    deckCardCount([
      { quantity: 60, section: DeckSection.MAINBOARD },
      { quantity: 15, section: DeckSection.SIDEBOARD },
      { quantity: 4, section: DeckSection.MAYBEBOARD },
    ]),
    75,
  );
});

test("deck card quantity normalization prevents zero and negative quantities", () => {
  assert.equal(normalizePositiveQuantity("3" as any), 3);
  assert.equal(normalizePositiveQuantity("0" as any), 1);
  assert.equal(normalizePositiveQuantity("-2" as any), 1);
  assert.equal(normalizePositiveQuantity("10000" as any), 999);
});

test("inventory awareness supports exact printing and oracle/name fallback", () => {
  const inventory = [
    {
      quantity: 1,
      location: { name: "Box-0003" },
      card: { id: "card-a", oracleId: "oracle-a", name: "Lightning Bolt" },
    },
    {
      quantity: 2,
      location: { name: "Binder" },
      card: { id: "card-b", oracleId: "oracle-a", name: "Lightning Bolt" },
    },
  ];

  const exact = summarizeDeckCardOwnership(
    {
      cardId: "card-a",
      oracleId: "oracle-a",
      cardName: "Lightning Bolt",
      quantity: 2,
    },
    inventory,
  );
  assert.equal(exact.exactOwned, 1);
  assert.equal(exact.otherOwned, 2);
  assert.equal(exact.owned, 3);
  assert.equal(exact.missing, 0);
  assert.equal(exact.matchType, "Exact printing + other printings");
  assert.equal(exact.locationSummary, "Box-0003, Binder");

  const fallback = summarizeDeckCardOwnership(
    { oracleId: "oracle-a", cardName: "Lightning Bolt", quantity: 2 },
    inventory,
  );
  assert.equal(fallback.owned, 3);
  assert.equal(fallback.missing, 0);
  assert.equal(fallback.matchType, "Oracle/name fallback");
});

import {
  parseDecklistText,
  mergeImportLines,
  buildDeckImportResolution,
} from "../lib/deck-import";
import {
  orderDeckSearchResults,
  compareCheapestPlayableCards,
} from "../lib/deck-search";

test("decklist parser handles quantities, sections, set codes, collector numbers, blanks, and malformed lines", () => {
  const parsed = parseDecklistText(`
Commander
1 Atraxa, Praetors' Voice

Mainboard
4 Lightning Bolt [SLD] 123
1 Sol Ring (CMM) 400
// comment
Sideboard
Negate
`);

  assert.equal(parsed.lines.length, 4);
  assert.equal(parsed.skippedLines.length, 3);
  assert.equal(parsed.lines[0].section, DeckSection.COMMANDER);
  assert.equal(parsed.lines[0].quantity, 1);
  assert.equal(parsed.lines[0].parsedName, "Atraxa, Praetors' Voice");
  assert.equal(parsed.lines[1].section, DeckSection.MAINBOARD);
  assert.equal(parsed.lines[1].quantity, 4);
  assert.equal(parsed.lines[1].parsedSetCode, "sld");
  assert.equal(parsed.lines[1].parsedCollectorNumber, "123");
  assert.equal(parsed.lines[2].parsedSetCode, "cmm");
  assert.equal(parsed.lines[2].parsedCollectorNumber, "400");
  assert.equal(parsed.lines[3].section, DeckSection.SIDEBOARD);
  assert.equal(parsed.lines[3].parsedName, "Negate");
  assert.deepEqual(parsed.lines[3].warnings, ["Missing quantity; assumed 1."]);
  assert.equal(parsed.lines[3].rawLine, "Negate");
  assert.equal(parsed.lines[3].lineNumber, 10);
  assert.equal(parsed.skippedLines[0].resolutionStatus, "SKIPPED");
});

test("deck import review summary includes failures, warnings, skipped, excluded, and ready rows", () => {
  const parsed = parseDecklistText(`
Commander
1 Sol Ring
Bad malformed card line
1 Missing Card (BAD) 999
`);
  const ready = {
    ...parsed.lines[0],
    selectedCardId: "card-1",
    selectedCardSummary: {
      cardId: "card-1",
      scryfallId: "sf-1",
      name: "Sol Ring",
      setCode: "cmm",
      setName: "Commander Masters",
      collectorNumber: "400",
      rarity: "uncommon",
      priceUsd: 1.23,
    },
    resolutionStatus: "MANUALLY_SELECTED" as const,
  };
  const notFound = {
    ...parsed.lines[2],
    resolutionStatus: "NOT_FOUND" as const,
    resolutionMessage: "No card found.",
    errors: ["No card found."],
  };
  const excludedWarning = { ...parsed.lines[1], included: false };
  const review = buildDeckImportResolution(
    [ready, excludedWarning, notFound],
    parsed.skippedLines,
  );

  assert.equal(review.lines.length, 3);
  assert.equal(review.skippedLines.length, 1);
  assert.equal(review.summary.totalPastedLines, 4);
  assert.equal(review.summary.readyToCommit, 1);
  assert.equal(review.summary.manualSelections, 1);
  assert.equal(review.summary.notFound, 1);
  assert.equal(review.summary.excluded, 1);
  assert.equal(review.summary.skipped, 1);
  assert.equal(review.lines[2].rawLine, "1 Missing Card (BAD) 999");
});

test("search results order owned printings before local and Scryfall printings", () => {
  const ordered = orderDeckSearchResults([
    {
      cardId: "s",
      scryfallId: "s",
      oracleId: null,
      name: "Bolt",
      manaCost: null,
      typeLine: "Instant",
      setCode: "sld",
      setName: "SLD",
      collectorNumber: "1",
      rarity: "rare",
      imageUri: null,
      priceUsd: 0.1,
      priceLabel: "$0.10",
      ownedQuantity: 0,
      ownedExactQuantity: 0,
      ownedOtherPrintingQuantity: 0,
      locationSummary: "",
      finishes: [],
      source: "scryfall",
      badges: [],
    },
    {
      cardId: "l",
      scryfallId: "l",
      oracleId: null,
      name: "Bolt",
      manaCost: null,
      typeLine: "Instant",
      setCode: "lea",
      setName: "LEA",
      collectorNumber: "1",
      rarity: "common",
      imageUri: null,
      priceUsd: 0.2,
      priceLabel: "$0.20",
      ownedQuantity: 0,
      ownedExactQuantity: 0,
      ownedOtherPrintingQuantity: 0,
      locationSummary: "",
      finishes: [],
      source: "local",
      badges: [],
    },
    {
      cardId: "o",
      scryfallId: "o",
      oracleId: null,
      name: "Bolt",
      manaCost: null,
      typeLine: "Instant",
      setCode: "clu",
      setName: "CLU",
      collectorNumber: "1",
      rarity: "common",
      imageUri: null,
      priceUsd: 1.2,
      priceLabel: "$1.20",
      ownedQuantity: 3,
      ownedExactQuantity: 3,
      ownedOtherPrintingQuantity: 0,
      locationSummary: "Box",
      finishes: [],
      source: "owned",
      badges: [],
    },
  ]);

  assert.deepEqual(
    ordered.map((result) => result.cardId),
    ["o", "l", "s"],
  );
});

test("cheapest playable comparison prefers paper english priced cards", () => {
  const base = {
    id: "a",
    scryfallId: "a",
    oracleId: "oracle",
    multiverseIds: [],
    mtgoId: null,
    arenaId: null,
    name: "Test Card",
    printedName: null,
    lang: "en",
    releasedAt: new Date("2024-01-01"),
    layout: "normal",
    highresImage: null,
    imageStatus: null,
    manaCost: null,
    manaValue: 1,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    colors: [],
    colorIdentity: [],
    colorIndicator: [],
    typeLine: "Creature",
    printedTypeLine: null,
    oracleText: null,
    printedText: null,
    setCode: "aaa",
    setId: null,
    setType: "expansion",
    keywords: [],
    legalities: {},
    games: ["paper"],
    reserved: null,
    foil: null,
    nonfoil: true,
    finishes: ["nonfoil"],
    oversized: false,
    promo: null,
    reprint: null,
    variation: null,
    digital: false,
    fullArt: null,
    textless: null,
    booster: null,
    storySpotlight: null,
    setName: "A",
    collectorNumber: "1",
    rarity: "common",
    artist: null,
    artistIds: [],
    illustrationId: null,
    borderColor: null,
    frame: null,
    frameEffects: [],
    securityStamp: null,
    preview: {},
    imageUri: null,
    imageUris: {},
    cardFaces: [],
    prices: { usd: "0.50" },
    relatedUris: {},
    purchaseUris: {},
    scryfallUri: null,
    apiUri: null,
    rawScryfallJson: {},
    scryfallFingerprint: null,
    firstCachedAt: new Date(),
    lastSyncedAt: null,
    lastFetchedAt: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    priceLastFetchedAt: null,
  } as any;
  const digitalCheap = {
    ...base,
    id: "d",
    digital: true,
    games: ["arena"],
    prices: { usd: "0.01" },
  };
  assert(compareCheapestPlayableCards(base, digitalCheap) < 0);
});

test("decklist commit merge helper combines duplicate card and section lines", () => {
  assert.deepEqual(
    mergeImportLines([
      { cardId: "card-1", quantity: 1, section: DeckSection.MAINBOARD },
      { cardId: "card-1", quantity: 3, section: DeckSection.MAINBOARD },
      { cardId: "card-1", quantity: 1, section: DeckSection.SIDEBOARD },
      { quantity: 99, section: DeckSection.MAINBOARD },
    ]),
    [
      { cardId: "card-1", quantity: 4, section: DeckSection.MAINBOARD },
      { cardId: "card-1", quantity: 1, section: DeckSection.SIDEBOARD },
    ],
  );
});
