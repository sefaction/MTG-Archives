import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import type { User, Player } from "@prisma/client";
import { UserRole } from "@prisma/client";

const COOKIE_NAME = "boxleague_session";
export type CurrentUser = User & { player: Player | null };

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

export async function hashPassword(password: string) {
  if (password.length < 8)
    throw new Error("Password must be at least 8 characters.");
  return bcrypt.hash(password, 12);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = (await cookies()).get(COOKIE_NAME)?.value;
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
  (await cookies()).set(COOKIE_NAME, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true as const, forcePasswordChange: user.forcePasswordChange };
}

export async function logout() {
  (await cookies()).delete({ name: COOKIE_NAME, path: "/" });
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

export function canImportForPlayer(user: CurrentUser, playerId: string) {
  return isAdminUser(user, user.player) || user.playerId === playerId;
}

export function canAccessImportBatch(
  user: CurrentUser,
  batch: { selectedPlayerId: string },
) {
  return (
    isAdminUser(user, user.player) || user.playerId === batch.selectedPlayerId
  );
}

export function canExportInventory(user: CurrentUser, ownerId?: string | null) {
  return (
    isAdminUser(user, user.player) ||
    Boolean(user.playerId && (!ownerId || ownerId === user.playerId))
  );
}

export function canEditInventory(user: CurrentUser) {
  return isAdminUser(user, user.player);
}
