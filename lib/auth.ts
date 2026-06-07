import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import type { User, Player } from "@prisma/client";
import { UserRole } from "@prisma/client";

const COOKIE_NAME = "mtg_inventory_session";
const LEGACY_COOKIE_NAME = "boxleague_session";
const ADMIN_MODE_COOKIE_NAME = "mtg_admin_mode";
export type CurrentUser = User & { player: Player | null };

export type AccessScope =
  | {
      mode: "user";
      userId: string;
      playerId: string | null;
      isAdminUser: boolean;
    }
  | {
      mode: "admin";
      userId: string;
      playerId: string | null;
      isAdminUser: true;
      canViewAllUsers: true;
    };

export function isAdminUser(
  user?: Pick<User, "role" | "username"> | null,
  player?: Pick<Player, "isAdmin"> | null,
) {
  return (
    user?.role === UserRole.ADMIN ||
    user?.username === (process.env.ADMIN_USERNAME || "admin") ||
    Boolean(player?.isAdmin)
  );
}

export async function isAdminModeEnabled(user?: CurrentUser | null) {
  if (!isAdminUser(user, user?.player)) return false;
  return (await cookies()).get(ADMIN_MODE_COOKIE_NAME)?.value === "1";
}

export function resolveAccessScope(
  user: CurrentUser,
  adminModeEnabled: boolean,
): AccessScope {
  const userIsAdmin = isAdminUser(user, user.player);
  if (userIsAdmin && adminModeEnabled) {
    return {
      mode: "admin",
      userId: user.id,
      playerId: user.playerId,
      isAdminUser: true,
      canViewAllUsers: true,
    };
  }
  return {
    mode: "user",
    userId: user.id,
    playerId: user.playerId,
    isAdminUser: userIsAdmin,
  };
}

export async function getAccessScope(user?: CurrentUser | null) {
  const currentUser = user ?? (await getCurrentUser());
  if (!currentUser) return null;
  return resolveAccessScope(currentUser, await isAdminModeEnabled(currentUser));
}

export async function setAdminMode(enabled: boolean) {
  const user = await requireLogin();
  if (!isAdminUser(user, user.player)) {
    throw new Error("You do not have permission to use admin mode.");
  }
  const cookieStore = await cookies();
  if (enabled) {
    cookieStore.set(ADMIN_MODE_COOKIE_NAME, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } else {
    cookieStore.delete({ name: ADMIN_MODE_COOKIE_NAME, path: "/" });
  }
}

export async function requireAdminMode() {
  const user = await requireLogin();
  if (!isAdminUser(user, user.player)) redirect("/dashboard?auth=denied");
  if (!(await isAdminModeEnabled(user))) redirect("/dashboard?auth=admin-mode");
  return user;
}

export async function hashPassword(password: string) {
  if (password.length < 8)
    throw new Error("Password must be at least 8 characters.");
  return bcrypt.hash(password, 12);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const session =
    cookieStore.get(COOKIE_NAME)?.value ??
    cookieStore.get(LEGACY_COOKIE_NAME)?.value;
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session },
    include: { player: true },
  });
  if (!user || !user.isActive) return null;
  return user;
}

export async function login(identifier: string, password: string) {
  const cleanIdentifier = identifier.trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: cleanIdentifier },
        { email: cleanIdentifier.toLowerCase() },
      ],
    },
  });
  if (!user || !user.isActive)
    return {
      ok: false as const,
      reason: "Invalid username/email or password.",
    };
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok)
    return {
      ok: false as const,
      reason: "Invalid username/email or password.",
    };
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const cookieSecure = process.env.COOKIE_SECURE === "true";
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  cookieStore.delete({ name: LEGACY_COOKIE_NAME, path: "/" });
  return { ok: true as const, forcePasswordChange: user.forcePasswordChange };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: "/" });
  cookieStore.delete({ name: LEGACY_COOKIE_NAME, path: "/" });
  cookieStore.delete({ name: ADMIN_MODE_COOKIE_NAME, path: "/" });
}

export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) redirect("/dashboard?auth=required");
  if (user.forcePasswordChange) redirect("/change-password");
  return user;
}

export async function requireAuth() {
  return requireLogin();
}

export async function requireAdmin() {
  const user = await requireLogin();
  if (!isAdminUser(user, user.player)) redirect("/dashboard?auth=denied");
  return user;
}

export async function requirePlayerOrAdmin() {
  const user = await requireLogin();
  if (!user.playerId && !isAdminUser(user, user.player))
    redirect("/dashboard?auth=denied");
  return user;
}

export function canImportForPlayer(
  user: CurrentUser,
  playerId: string,
  adminModeEnabled = false,
) {
  return (
    (isAdminUser(user, user.player) && adminModeEnabled) ||
    user.playerId === playerId
  );
}

export function canAccessImportBatch(
  user: CurrentUser,
  batch: { selectedPlayerId: string },
  adminModeEnabled = false,
) {
  return (
    (isAdminUser(user, user.player) && adminModeEnabled) ||
    user.playerId === batch.selectedPlayerId
  );
}

export function canExportInventory(
  user: CurrentUser,
  ownerId?: string | null,
  adminModeEnabled = false,
) {
  return (
    (isAdminUser(user, user.player) && adminModeEnabled) ||
    Boolean(user.playerId && (!ownerId || ownerId === user.playerId))
  );
}

export function canEditInventory(
  user: CurrentUser,
  ownerId?: string | null,
  adminModeEnabled = false,
) {
  return (
    (isAdminUser(user, user.player) && adminModeEnabled) ||
    Boolean(user.playerId && (!ownerId || ownerId === user.playerId))
  );
}
