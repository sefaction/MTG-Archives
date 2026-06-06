import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "admin"
  );
}

async function ensureOwner(
  displayName: string,
  existingPlayerId?: string | null,
) {
  if (existingPlayerId) return existingPlayerId;
  const base = slugify(displayName);
  let name = base;
  let suffix = 1;
  while (await prisma.player.findUnique({ where: { name } }))
    name = `${base}-${suffix++}`;
  const player = await prisma.player.create({
    data: { name, displayName, active: true, isAdmin: true, color: "#0ea5e9" },
  });
  return player.id;
}

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Administrator";
  const hash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { username } });
  const playerId = await ensureOwner(displayName, existing?.playerId);

  await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash: hash,
      role: UserRole.ADMIN,
      displayName,
      playerId,
      isActive: true,
      forcePasswordChange: true,
    },
    create: {
      username,
      passwordHash: hash,
      role: UserRole.ADMIN,
      displayName,
      playerId,
      isActive: true,
      forcePasswordChange: true,
    },
  });

  await prisma.player.update({
    where: { id: playerId },
    data: { displayName, isAdmin: true, active: true },
  });
  console.log(`[bootstrap-admin] ensured admin user: ${username}`);
}

main().finally(async () => prisma.$disconnect());
