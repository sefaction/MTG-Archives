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
  cardName?: string;
  oracleText?: string;
  typeLine?: string;
  set?: string;
  rarity?: string;
  foil?: string;
  colorIdentity?: string;
  manaValueMin?: string;
  manaValueMax?: string;
  keyword?: string;
  priceMin?: string;
  priceMax?: string;
  locationId?: string;
  locationName?: string;
  owner?: string;
  page?: string;
  pageSize?: string;
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

export function publicLocationVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryLocationWhereInput {
  if (defaultVisibility === DefaultCollectionVisibility.PUBLIC) {
    return { active: true, visibility: { not: Visibility.PRIVATE } };
  }
  return { active: true, visibility: Visibility.PUBLIC };
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

function buildPublicCardWhere(filters: PublicInventoryFilters) {
  const cardWhere: Prisma.CardWhereInput = {};
  const q = filters.q?.trim();
  if (filters.cardName?.trim()) {
    cardWhere.name = { contains: filters.cardName.trim(), mode: "insensitive" };
  }
  if (filters.oracleText?.trim()) {
    cardWhere.oracleText = {
      contains: filters.oracleText.trim(),
      mode: "insensitive",
    };
  }
  if (filters.typeLine?.trim()) {
    cardWhere.typeLine = {
      contains: filters.typeLine.trim(),
      mode: "insensitive",
    };
  }
  if (filters.set?.trim()) cardWhere.setCode = filters.set.trim().toLowerCase();
  if (filters.rarity?.trim()) cardWhere.rarity = filters.rarity.trim();
  if (filters.manaValueMin || filters.manaValueMax) {
    cardWhere.manaValue = {
      gte: filters.manaValueMin ? Number(filters.manaValueMin) : undefined,
      lte: filters.manaValueMax ? Number(filters.manaValueMax) : undefined,
    };
  }
  const queryWhere: Prisma.InventoryItemWhereInput | undefined = q
    ? {
        OR: [
          { card: { name: { contains: q, mode: "insensitive" } } },
          { card: { typeLine: { contains: q, mode: "insensitive" } } },
          { card: { oracleText: { contains: q, mode: "insensitive" } } },
          { card: { setCode: { contains: q.toLowerCase() } } },
          { card: { setName: { contains: q, mode: "insensitive" } } },
          { card: { collectorNumber: { contains: q, mode: "insensitive" } } },
          { location: { name: { contains: q, mode: "insensitive" } } },
          {
            currentOwner: {
              users: {
                some: {
                  publicProfileEnabled: true,
                  publicDisplayName: { contains: q, mode: "insensitive" },
                },
              },
            },
          },
        ],
      }
    : undefined;
  return { cardWhere, queryWhere };
}

function publicUserWhere(defaultVisibility: DefaultCollectionVisibility) {
  return {
    isActive: true,
    publicProfileEnabled: true,
    playerId: { not: null },
    inventoryDefaultVisibility: defaultVisibility,
  } satisfies Prisma.UserWhereInput;
}

function publicOwnerVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryItemWhereInput {
  return {
    currentOwner: { users: { some: publicUserWhere(defaultVisibility) } },
    OR: publicInventoryVisibilityWhere(defaultVisibility),
  };
}

function buildPublicInventoryWhere(
  filters: PublicInventoryFilters,
  publicSlug?: string,
) {
  const { cardWhere, queryWhere } = buildPublicCardWhere(filters);
  const and: Prisma.InventoryItemWhereInput[] = [
    {
      OR: [
        publicOwnerVisibilityWhere(DefaultCollectionVisibility.PUBLIC),
        publicOwnerVisibilityWhere(DefaultCollectionVisibility.PRIVATE),
      ],
    },
  ];
  if (queryWhere) and.push(queryWhere);
  if (publicSlug) {
    and.push({
      currentOwner: {
        users: {
          some: {
            publicSlug,
            isActive: true,
            publicProfileEnabled: true,
            playerId: { not: null },
          },
        },
      },
    });
  }
  if (filters.owner?.trim()) {
    and.push({
      currentOwner: {
        users: {
          some: {
            publicSlug: filters.owner.trim(),
            isActive: true,
            publicProfileEnabled: true,
            playerId: { not: null },
          },
        },
      },
    });
  }

  const where: Prisma.InventoryItemWhereInput = {
    quantity: { gt: 0 },
    AND: and,
  };
  if (Object.keys(cardWhere).length) where.card = cardWhere;
  if (filters.locationName?.trim()) {
    (where as any).location = { name: filters.locationName.trim() };
  } else if (filters.locationId) where.locationId = filters.locationId;
  if (filters.foil === "true") where.foil = true;
  if (filters.foil === "false") where.foil = false;
  return where;
}

function filterPublicInventoryByClientSafeFilters(
  inventory: Array<{ card: any; quantity: number }>,
  filters: PublicInventoryFilters,
) {
  const colorIdentityNeedle = filters.colorIdentity?.trim().toUpperCase();
  const keywordNeedle = filters.keyword?.trim().toLowerCase();
  const priceMin = filters.priceMin ? Number(filters.priceMin) : undefined;
  const priceMax = filters.priceMax ? Number(filters.priceMax) : undefined;
  return inventory.filter((item) => {
    if (colorIdentityNeedle) {
      const colorIdentity = Array.isArray(item.card.colorIdentity)
        ? item.card.colorIdentity.join(",")
        : JSON.stringify(item.card.colorIdentity ?? "");
      if (!colorIdentity.toUpperCase().includes(colorIdentityNeedle))
        return false;
    }
    if (keywordNeedle) {
      const keywords = Array.isArray(item.card.keywords)
        ? item.card.keywords.join(", ")
        : JSON.stringify(item.card.keywords ?? "");
      if (!keywords.toLowerCase().includes(keywordNeedle)) return false;
    }
    const usdPrice = (item.card.prices as any)?.usd
      ? Number((item.card.prices as any).usd)
      : undefined;
    if (
      priceMin !== undefined &&
      (usdPrice === undefined || Number.isNaN(usdPrice) || usdPrice < priceMin)
    )
      return false;
    if (
      priceMax !== undefined &&
      (usdPrice === undefined || Number.isNaN(usdPrice) || usdPrice > priceMax)
    )
      return false;
    return true;
  });
}

const publicInventoryInclude = {
  card: true,
  location: true,
  currentOwner: {
    select: {
      displayName: true,
      color: true,
      users: {
        where: { isActive: true, publicProfileEnabled: true },
        select: {
          displayName: true,
          publicDisplayName: true,
          publicSlug: true,
          inventoryDefaultVisibility: true,
        },
        orderBy: { createdAt: "asc" as const },
      },
    },
  },
} satisfies Prisma.InventoryItemInclude;

export async function getPublicInventoryBySlug(
  publicSlug: string,
  filters: PublicInventoryFilters = {},
) {
  const profile = await getPublicProfileBySlug(publicSlug);
  if (!profile?.playerId) return null;

  const inventory = await prisma.inventoryItem.findMany({
    where: buildPublicInventoryWhere(filters, publicSlug),
    include: publicInventoryInclude,
    orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
  });

  const publicLocations = await prisma.inventoryLocation.findMany({
    where: {
      ownerPlayerId: profile.playerId,
      ...publicLocationVisibilityWhere(profile.inventoryDefaultVisibility),
    },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  const filteredInventory = filterPublicInventoryByClientSafeFilters(
    inventory as any,
    filters,
  );
  const exactRows = getInventoryExactPrintings(filteredInventory as any);
  const groupedRows = getInventoryGroupedByCard(exactRows as any);

  return {
    profile,
    publicLocations,
    exactRows,
    groupedRows,
    visibleCards: exactRows.reduce((sum, row) => sum + row.quantity, 0),
  };
}

export async function getGlobalPublicInventory(
  filters: PublicInventoryFilters = {},
) {
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const pageSize = pageSizeOptions.includes(Number(filters.pageSize))
    ? Number(filters.pageSize)
    : 50;
  const page = Math.max(1, Number(filters.page || "1") || 1);
  const rawPageSize = pageSize * 5;
  const startedAt = Date.now();
  const inventory = await prisma.inventoryItem.findMany({
    where: buildPublicInventoryWhere(filters),
    include: publicInventoryInclude,
    orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
    skip: (page - 1) * rawPageSize,
    take: rawPageSize + 1,
  });

  const publicProfiles = await prisma.user.findMany({
    where: {
      isActive: true,
      publicProfileEnabled: true,
      publicSlug: { not: null },
      playerId: { not: null },
    },
    select: {
      publicSlug: true,
      publicDisplayName: true,
      displayName: true,
    },
    orderBy: { publicDisplayName: "asc" },
  });

  const publicLocations = await prisma.inventoryLocation.findMany({
    where: {
      ownerPlayer: {
        users: {
          some: {
            isActive: true,
            publicProfileEnabled: true,
            playerId: { not: null },
          },
        },
      },
      OR: [
        { visibility: Visibility.PUBLIC },
        {
          visibility: Visibility.INHERIT,
          ownerPlayer: {
            users: {
              some: publicUserWhere(DefaultCollectionVisibility.PUBLIC),
            },
          },
        },
      ],
    },
    select: { name: true },
    distinct: ["name"],
    orderBy: { name: "asc" },
  });

  const hasNextPage = inventory.length > rawPageSize;
  const pageInventory = hasNextPage
    ? inventory.slice(0, rawPageSize)
    : inventory;
  const filteredInventory = filterPublicInventoryByClientSafeFilters(
    pageInventory as any,
    filters,
  );
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 1000 || inventory.length > rawPageSize) {
    console.warn("[public-inventory-list] paged query diagnostics", {
      elapsedMs,
      page,
      pageSize,
      rawPageSize,
      rawRowsLoaded: inventory.length,
      filteredRows: filteredInventory.length,
      hasNextPage,
    });
  }

  return {
    inventory: filteredInventory,
    publicProfiles: publicProfiles.map((profile) => ({
      publicSlug: profile.publicSlug!,
      displayName: profile.publicDisplayName || profile.displayName,
    })),
    publicLocations,
    page,
    pageSize,
    hasNextPage,
    rawRowsLoaded: pageInventory.length,
    visibleCards: filteredInventory.reduce((sum, row) => sum + row.quantity, 0),
  };
}
