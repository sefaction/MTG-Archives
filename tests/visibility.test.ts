import assert from "node:assert/strict";
import test from "node:test";
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
import {
  assertPublicSlug,
  normalizePublicSlug,
  resolveDeckVisibility,
  resolveInventoryVisibility,
} from "../lib/visibility";
import {
  globalPublicInventoryLocationWhere,
  publicInventoryVisibilityWhere,
} from "../lib/public-collection";

test("inventory visibility inherits private account default", () => {
  assert.equal(
    resolveInventoryVisibility(
      DefaultCollectionVisibility.PRIVATE,
      Visibility.INHERIT,
    ),
    DefaultCollectionVisibility.PRIVATE,
  );
});

test("inventory visibility inherits public account default", () => {
  assert.equal(
    resolveInventoryVisibility(
      DefaultCollectionVisibility.PUBLIC,
      Visibility.INHERIT,
    ),
    DefaultCollectionVisibility.PUBLIC,
  );
});

test("location private overrides public account default", () => {
  assert.equal(
    resolveInventoryVisibility(
      DefaultCollectionVisibility.PUBLIC,
      Visibility.PRIVATE,
    ),
    DefaultCollectionVisibility.PRIVATE,
  );
});

test("location public overrides private account default", () => {
  assert.equal(
    resolveInventoryVisibility(
      DefaultCollectionVisibility.PRIVATE,
      Visibility.PUBLIC,
    ),
    DefaultCollectionVisibility.PUBLIC,
  );
});

test("deck visibility uses the same override semantics", () => {
  assert.equal(
    resolveDeckVisibility(
      DefaultCollectionVisibility.PRIVATE,
      Visibility.PUBLIC,
    ),
    DefaultCollectionVisibility.PUBLIC,
  );
  assert.equal(
    resolveDeckVisibility(
      DefaultCollectionVisibility.PUBLIC,
      Visibility.PRIVATE,
    ),
    DefaultCollectionVisibility.PRIVATE,
  );
});

test("public slugs are normalized and validated without exposing emails", () => {
  assert.equal(normalizePublicSlug("Mana Vault Trades!"), "mana-vault-trades");
  assert.equal(assertPublicSlug("My Binder"), "my-binder");
  assert.throws(() => assertPublicSlug("x"), /at least 3 characters/);
});

test("public inventory where allows only explicitly public locations when account default is private", () => {
  assert.deepEqual(
    publicInventoryVisibilityWhere(DefaultCollectionVisibility.PRIVATE),
    [
      {
        location: {
          active: true,
          kind: "NORMAL",
          visibility: Visibility.PUBLIC,
        },
      },
      {
        location: { active: true, kind: "DECK", visibility: Visibility.PUBLIC },
      },
    ],
  );
});

test("public inventory where excludes private locations when account default is public", () => {
  assert.deepEqual(
    publicInventoryVisibilityWhere(DefaultCollectionVisibility.PUBLIC),
    [
      { locationId: null },
      {
        location: {
          active: true,
          kind: "NORMAL",
          visibility: { not: Visibility.PRIVATE },
        },
      },
      {
        location: {
          active: true,
          kind: "DECK",
          OR: [
            { visibility: Visibility.PUBLIC },
            {
              visibility: Visibility.INHERIT,
              deck: {
                ownerUser: {
                  deckDefaultVisibility: DefaultCollectionVisibility.PUBLIC,
                },
              },
            },
          ],
        },
      },
    ],
  );
});

test("global public location where applies visibility to inventory locations", () => {
  const where = globalPublicInventoryLocationWhere() as any;
  assert.equal(where.active, true);
  assert.equal(where.kind, "NORMAL");
  assert.deepEqual(where.OR[0], { visibility: Visibility.PUBLIC });
  assert.equal(where.OR[1].visibility, Visibility.INHERIT);
  assert.equal(
    where.OR[1].ownerPlayer.users.some.inventoryDefaultVisibility,
    DefaultCollectionVisibility.PUBLIC,
  );
  assert.equal(where.ownerPlayer.users.some.publicProfileEnabled, true);
  assert.equal(where.ownerPlayer.users.some.isActive, true);
  assert.equal(where.ownerPlayer.OR, undefined);
  assert.equal(where.ownerPlayer.visibility, undefined);
});
