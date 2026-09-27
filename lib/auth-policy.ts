import { UserRole, type User, type Player } from "@prisma/client";

// Shared role policy; Admin Mode is still required separately for elevated work.
export function isAdminUser(
  user?: Pick<User, "role" | "username"> | null,
  player?: Pick<Player, "isAdmin"> | null,
) {
  return (
    user?.role === UserRole.ADMIN ||
    user?.username.toLowerCase() ===
      (process.env.ADMIN_USERNAME || "admin").toLowerCase() ||
    Boolean(player?.isAdmin)
  );
}
