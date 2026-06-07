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
  assert.equal(exact.owned, 1);
  assert.equal(exact.missing, 1);
  assert.equal(exact.matchType, "Exact printing");
  assert.equal(exact.locationSummary, "Box-0003");

  const fallback = summarizeDeckCardOwnership(
    { oracleId: "oracle-a", cardName: "Lightning Bolt", quantity: 2 },
    inventory,
  );
  assert.equal(fallback.owned, 3);
  assert.equal(fallback.missing, 0);
  assert.equal(fallback.matchType, "Oracle/name fallback");
});
