import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

export type BootstrapAdminOptions = {
  username: string;
  password: string;
  displayName: string;
};

/** Startup is provisioning, never password recovery or account administration. */
export async function bootstrapAdmin(
  db: Pick<PrismaClient, "$transaction">,
  options: BootstrapAdminOptions,
) {
  return db.$transaction(async (tx) => {
    // Serialize startup provisioning across simultaneous web replicas. Match the
    // case-insensitive login identity without resetting an existing account.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734021, 1)::text`;
    const existing = await tx.user.findFirst({
      where: { username: { equals: options.username, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return { created: false, userId: existing.id };

    const base =
      options.displayName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "admin";
    let name = base;
    let suffix = 1;
    while (await tx.player.findUnique({ where: { name } })) {
      name = `${base}-${suffix++}`;
    }
    let ownerDisplayName = options.displayName;
    suffix = 1;
    while (
      await tx.player.findUnique({ where: { displayName: ownerDisplayName } })
    ) {
      ownerDisplayName = `${options.displayName} (${suffix++})`;
    }
    const user = await tx.user.create({
      data: {
        username: options.username,
        passwordHash: await bcrypt.hash(options.password, 10),
        role: UserRole.ADMIN,
        displayName: options.displayName,
        isActive: true,
        forcePasswordChange: true,
        player: {
          create: {
            name,
            displayName: ownerDisplayName,
            active: true,
            isAdmin: true,
            color: "#0ea5e9",
          },
        },
      },
      select: { id: true },
    });
    return { created: true, userId: user.id };
  });
}
