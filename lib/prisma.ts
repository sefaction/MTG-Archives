import { PrismaClient } from "@prisma/client";
import { withDatabaseConnectionLifetime } from "./prisma-connection-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: withDatabaseConnectionLifetime(process.env.DATABASE_URL),
});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
