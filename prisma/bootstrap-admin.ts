import { PrismaClient } from "@prisma/client";
import { bootstrapAdmin } from "../lib/admin-bootstrap";

const prisma = new PrismaClient();

async function main() {
  const result = await bootstrapAdmin(prisma, {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.SEED_ADMIN_PASSWORD || "admin123",
    displayName: process.env.ADMIN_DISPLAY_NAME || "Administrator",
  });
  console.log(
    result.created
      ? "[bootstrap-admin] created initial admin account"
      : "[bootstrap-admin] existing account preserved (no changes)",
  );
}

main()
  .catch(() => {
    // Do not include connection strings, password hashes or Prisma input data.
    console.error(
      "[bootstrap-admin] provisioning failed; verify database availability and configuration",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
