import {
  DefaultCollectionVisibility,
  Prisma,
  Visibility,
} from "@prisma/client";
import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
} from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";

export type PublicInventoryFilters = {
  q?: string;
};

export function publicInventoryVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryItemWhereInput[] {
  if (defaultVisibility === DefaultCollectionVisibility.PUBLIC) {
    return [
      { locationId: null },
      { location: { active: true, visibility: { not: Visibility.PRIVATE } } },
    ];
  }
  return [{ location: { active: true, visibility: Visibility.PUBLIC } }];
}

export async function getPublicProfileBySlug(publicSlug: string) {
  return prisma.user.findFirst({
    where: {
      publicSlug,
      publicProfileEnabled: true,
      playerId: { not: null },
      isActive: true,
    },
    select: {
      displayName: true,
      publicDisplayName: true,
      publicSlug: true,
      playerId: true,
      inventoryDefaultVisibility: true,
      deckDefaultVisibility: true,
    },
  });
}

export async function getPublicInventoryBySlug(
  publicSlug: string,
  filters: PublicInventoryFilters = {},
) {
  const profile = await getPublicProfileBySlug(publicSlug);
  if (!profile?.playerId) return null;

  const q = filters.q?.trim() || "";
  const cardWhere: Prisma.CardWhereInput | undefined = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { typeLine: { contains: q, mode: "insensitive" } },
          { oracleText: { contains: q, mode: "insensitive" } },
        ],
      }
    : undefined;

  const inventory = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: profile.playerId,
      quantity: { gt: 0 },
      OR: publicInventoryVisibilityWhere(profile.inventoryDefaultVisibility),
      ...(cardWhere ? { card: cardWhere } : {}),
    },
    include: {
      card: true,
      location: true,
    },
    orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
  });

  const exactRows = getInventoryExactPrintings(inventory as any);
  const groupedRows = getInventoryGroupedByCard(exactRows as any);

  return {
    profile,
    exactRows,
    groupedRows,
    visibleCards: exactRows.reduce((sum, row) => sum + row.quantity, 0),
  };
}
