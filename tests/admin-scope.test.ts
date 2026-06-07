import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessImportBatch,
  canExportInventory,
  canImportForPlayer,
  resolveAccessScope,
} from "../lib/auth";
import { UserRole } from "@prisma/client";

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
    player: overrides.player ?? {
      id: overrides.playerId ?? "owner-1",
      name: "owner-1",
      displayName: "Owner 1",
      color: "#64748b",
      isAdmin: false,
      active: true,
      userId: overrides.id ?? "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  } as any;
}

test("admin without admin mode resolves to normal user scope", () => {
  const admin = user({ role: UserRole.ADMIN, playerId: "admin-owner" });
  const scope = resolveAccessScope(admin, false);

  assert.equal(scope.mode, "user");
  assert.equal(scope.playerId, "admin-owner");
  assert.equal(scope.isAdminUser, true);
});

test("admin mode explicitly enables cross-user admin scope", () => {
  const admin = user({ role: UserRole.ADMIN, playerId: "admin-owner" });
  const scope = resolveAccessScope(admin, true);

  assert.equal(scope.mode, "admin");
  assert.equal(scope.canViewAllUsers, true);
});

test("non-admin cannot gain admin scope from a tampered admin-mode cookie", () => {
  const regular = user({ role: UserRole.PLAYER, playerId: "owner-1" });
  const scope = resolveAccessScope(regular, true);

  assert.equal(scope.mode, "user");
  assert.equal(scope.playerId, "owner-1");
});

test("owner-sensitive helpers require admin mode for cross-owner access", () => {
  const admin = user({ role: UserRole.ADMIN, playerId: "admin-owner" });

  assert.equal(canExportInventory(admin, "other-owner", false), false);
  assert.equal(canImportForPlayer(admin, "other-owner", false), false);
  assert.equal(
    canAccessImportBatch(admin, { selectedPlayerId: "other-owner" }, false),
    false,
  );

  assert.equal(canExportInventory(admin, "other-owner", true), true);
  assert.equal(canImportForPlayer(admin, "other-owner", true), true);
  assert.equal(
    canAccessImportBatch(admin, { selectedPlayerId: "other-owner" }, true),
    true,
  );
});
