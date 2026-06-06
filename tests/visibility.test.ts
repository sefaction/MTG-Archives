import assert from "node:assert/strict";
import test from "node:test";
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
import {
  assertPublicSlug,
  normalizePublicSlug,
  resolveDeckVisibility,
  resolveInventoryVisibility,
} from "../lib/visibility";

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
