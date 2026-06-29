import type { PrismaClient } from "@prisma/client";

type LocationTypeClient = Pick<PrismaClient, "locationType">;

const RESERVED_LOCATION_TYPE_KEYS = new Set(["deck"]);

export function normalizeLocationTypeName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cleanLocationTypeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isReservedLocationTypeName(value: string | null | undefined) {
  return RESERVED_LOCATION_TYPE_KEYS.has(
    normalizeLocationTypeName(value || ""),
  );
}

export async function getActiveLocationTypes(prisma: LocationTypeClient) {
  const types = await prisma.locationType.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  return types.filter((type) => !isReservedLocationTypeName(type.name));
}

export async function ensureLocationType(
  prisma: LocationTypeClient,
  rawName: string | null | undefined,
  options: { createdByUserId?: string | null } = {},
) {
  const name = cleanLocationTypeName(rawName || "");
  if (!name) return null;
  if (isReservedLocationTypeName(name)) {
    throw new Error(
      "Deck is a system-managed location type. Commit cards from a deck page instead.",
    );
  }
  const normalizedName = normalizeLocationTypeName(name);
  if (!normalizedName) return null;
  const existing = await prisma.locationType.findUnique({
    where: { normalizedName },
  });
  if (existing) {
    if (existing.active && existing.name === name) return existing;
    return prisma.locationType.update({
      where: { normalizedName },
      data: {
        name,
        active: true,
        createdByUserId: existing.createdByUserId ?? options.createdByUserId,
      },
    });
  }
  return prisma.locationType.create({
    data: { name, normalizedName, createdByUserId: options.createdByUserId },
  });
}

export async function locationTypeNameFromForm(
  prisma: LocationTypeClient,
  fd: FormData,
  options: { createdByUserId?: string | null } = {},
) {
  const createdType = cleanLocationTypeName(String(fd.get("newType") || ""));
  const selectedType = cleanLocationTypeName(String(fd.get("type") || ""));
  const type = await ensureLocationType(prisma, createdType || selectedType, {
    createdByUserId: createdType ? options.createdByUserId : undefined,
  });
  return type?.name ?? null;
}
