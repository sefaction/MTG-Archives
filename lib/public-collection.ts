import {
  DefaultCollectionVisibility,
  Prisma,
  Visibility,
} from "@prisma/client";
import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  orderInventoryItemsByPageGroups,
} from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";
import {
  inventoryCardMatchesPostFilters,
  parseInventoryFilters,
} from "@/lib/inventory-filters";

export type PublicInventoryFilters = {
  q?: string;
  cardName?: string;
  oracleText?: string;
  typeLine?: string;
  set?: string;
  rarity?: string;
  foil?: string;
  finish?: string;
  type?: string;
  colors?: string;
  colorMode?: string;
  colorIdentity?: string;
  colorIdentityMode?: string;
  mvOp?: string;
  mv?: string;
  mvMin?: string;
  mvMax?: string;
  manaValueMin?: string;
  manaValueMax?: string;
  keyword?: string;
  priceMin?: string;
  priceMax?: string;
  locationId?: string | string[];
  locationName?: string | string[];
  owner?: string;
  displayMode?: string;
  sort?: string;
  sortDir?: string;
  page?: string;
  pageSize?: string;
};

export function publicInventoryVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryItemWhereInput[] {
  if (defaultVisibility === DefaultCollectionVisibility.PUBLIC) {
    return [
      { locationId: null },
      {
        location: {
          active: true,
          kind: "NORMAL",
          visibility: { not: Visibility.PRIVATE },
        },
      },
      {
        location: {
          active: true,
          kind: "DECK",
          OR: [
            { visibility: Visibility.PUBLIC },
            {
              visibility: Visibility.INHERIT,
              deck: {
                ownerUser: {
                  deckDefaultVisibility: DefaultCollectionVisibility.PUBLIC,
                },
              },
            },
          ],
        },
      },
    ];
  }
  return [
    {
      location: { active: true, kind: "NORMAL", visibility: Visibility.PUBLIC },
    },
    { location: { active: true, kind: "DECK", visibility: Visibility.PUBLIC } },
  ];
}

export function publicLocationVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryLocationWhereInput {
  if (defaultVisibility === DefaultCollectionVisibility.PUBLIC) {
    return {
      active: true,
      kind: "NORMAL",
      visibility: { not: Visibility.PRIVATE },
    };
  }
  return { active: true, kind: "NORMAL", visibility: Visibility.PUBLIC };
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
      id: true,
      displayName: true,
      publicDisplayName: true,
      publicSlug: true,
      playerId: true,
      inventoryDefaultVisibility: true,
      deckDefaultVisibility: true,
    },
  });
}

function publicFilterValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => entry.split(","));
  return value ? value.split(",") : [];
}

function buildPublicCardWhere(filters: PublicInventoryFilters) {
  const cardWhere: Prisma.CardWhereInput = {};
  const q = filters.q?.trim();
  const structured = parseInventoryFilters(filters as any);
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
  if (structured.rarities.length)
    cardWhere.rarity = { in: structured.rarities };
  else if (filters.rarity?.trim()) cardWhere.rarity = filters.rarity.trim();
  const mvCondition =
    structured.mvOp === "between"
      ? { gte: structured.mvMin, lte: structured.mvMax }
      : structured.mvOp === "eq" && structured.mv !== undefined
        ? structured.mv
        : structured.mvOp === "lt" && structured.mv !== undefined
          ? { lt: structured.mv }
          : structured.mvOp === "lte" && structured.mv !== undefined
            ? { lte: structured.mv }
            : structured.mvOp === "gt" && structured.mv !== undefined
              ? { gt: structured.mv }
              : structured.mvOp === "gte" && structured.mv !== undefined
                ? { gte: structured.mv }
                : undefined;
  if (mvCondition !== undefined) cardWhere.manaValue = mvCondition;
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

function publicOwnerDisplayName(user: {
  publicDisplayName?: string | null;
  displayName?: string | null;
  player?: { displayName?: string | null; name?: string | null } | null;
}) {
  return (
    user.publicDisplayName?.trim() ||
    user.player?.displayName?.trim() ||
    user.displayName?.trim() ||
    user.player?.name?.trim() ||
    "Owner"
  );
}

function publicUserWhere(defaultVisibility: DefaultCollectionVisibility) {
  return {
    isActive: true,
    publicProfileEnabled: true,
    playerId: { not: null },
    inventoryDefaultVisibility: defaultVisibility,
  } satisfies Prisma.UserWhereInput;
}

export function globalPublicInventoryLocationWhere(
  ownerPublicSlug?: string,
): Prisma.InventoryLocationWhereInput {
  return {
    active: true,
    kind: "NORMAL",
    ownerPlayer: {
      users: {
        some: {
          isActive: true,
          publicProfileEnabled: true,
          playerId: { not: null },
          ...(ownerPublicSlug ? { publicSlug: ownerPublicSlug } : {}),
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
  };
}

function publicOwnerVisibilityWhere(
  defaultVisibility: DefaultCollectionVisibility,
): Prisma.InventoryItemWhereInput {
  return {
    currentOwner: { users: { some: publicUserWhere(defaultVisibility) } },
    OR: publicInventoryVisibilityWhere(defaultVisibility),
  };
}

export function buildPublicInventoryWhere(
  filters: PublicInventoryFilters,
  publicSlug?: string,
) {
  const { cardWhere, queryWhere } = buildPublicCardWhere(filters);
  const structured = parseInventoryFilters(filters as any);
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

  if (structured.typeTokens.length) {
    and.push({
      AND: structured.typeTokens.map((type) => ({
        card: { typeLine: { contains: type, mode: "insensitive" } },
      })),
    });
  }
  if (structured.types.length) {
    and.push({
      OR: structured.types.map((type) => ({
        card: { typeLine: { contains: type, mode: "insensitive" } },
      })),
    });
  }
  if (structured.sets.length) {
    and.push({
      OR: structured.sets.flatMap((set) => [
        { card: { setCode: { equals: set, mode: "insensitive" } } },
        { card: { setName: { contains: set, mode: "insensitive" } } },
      ]),
    });
  }

  const where: Prisma.InventoryItemWhereInput = {
    quantity: { gt: 0 },
    AND: and,
  };
  if (Object.keys(cardWhere).length) where.card = cardWhere;
  const publicLocationNames = publicFilterValues(filters.locationName).filter(
    Boolean,
  );
  const publicLocationIds = publicFilterValues(filters.locationId).filter(
    Boolean,
  );
  if (publicLocationNames.length) {
    where.location = { name: { in: publicLocationNames } };
  } else if (publicLocationIds.length) {
    where.locationId = { in: publicLocationIds };
  }
  if (structured.finishes.length)
    where.foilStatus = { in: structured.finishes };
  else if (filters.foil === "true") where.foil = true;
  else if (filters.foil === "false") where.foil = false;
  return where;
}

function filterPublicInventoryByClientSafeFilters(
  inventory: Array<{ card: any; quantity: number }>,
  filters: PublicInventoryFilters,
) {
  const structured = parseInventoryFilters(filters as any);
  return inventory.filter((item) =>
    inventoryCardMatchesPostFilters(item.card, structured),
  );
}

const publicInventoryInclude = {
  card: true,
  location: true,
  currentOwner: {
    select: {
      id: true,
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
  const displayMode =
    (filters as any).displayMode === "exact" ? "exact" : "grouped";
  const sortField = filters.sort || "cardName";
  const sortDirection: "asc" | "desc" =
    filters.sortDir === "desc" ? "desc" : "asc";
  const where = buildPublicInventoryWhere(filters);
  const startedAt = Date.now();
  const exactGroupBy = {
    by: ["cardId", "foilStatus", "condition", "language"] as any,
    where,
    _sum: { quantity: true as const },
    _count: { _all: true as const },
    orderBy: [
      { cardId: "asc" },
      { foilStatus: "asc" },
      { condition: "asc" },
      { language: "asc" },
    ] as any,
  };
  const groupedGroupBy = {
    by: ["cardId"] as any,
    where,
    _sum: { quantity: true as const },
    _count: { _all: true as const },
    orderBy: [{ cardId: "asc" }] as any,
  };
  const ownerPublicSlug = filters.owner?.trim() || undefined;
  const publicOwnerInventoryWhere = buildPublicInventoryWhere({});
  const publicLocationInventoryWhere = buildPublicInventoryWhere(
    ownerPublicSlug ? { owner: ownerPublicSlug } : {},
  );
  const [allGroups, publicProfiles, publicLocations] = await Promise.all([
    displayMode === "grouped"
      ? prisma.inventoryItem.groupBy(groupedGroupBy)
      : prisma.inventoryItem.groupBy(exactGroupBy),
    prisma.user.findMany({
      where: {
        isActive: true,
        publicProfileEnabled: true,
        publicSlug: { not: null },
        playerId: { not: null },
        player: { inventoryOwned: { some: publicOwnerInventoryWhere } },
      },
      select: {
        publicSlug: true,
        publicDisplayName: true,
        displayName: true,
        player: { select: { displayName: true, name: true } },
      },
      orderBy: [{ publicDisplayName: "asc" }, { displayName: "asc" }],
    }),
    prisma.inventoryLocation.findMany({
      where: {
        ...globalPublicInventoryLocationWhere(ownerPublicSlug),
        inventoryItems: { some: publicLocationInventoryWhere },
      },
      select: { name: true },
      distinct: ["name"],
      orderBy: { name: "asc" },
    }),
  ]);
  const cardSortData = await prisma.card.findMany({
    where: {
      id: {
        in: Array.from(
          new Set((allGroups as any[]).map((group) => group.cardId)),
        ),
      },
    },
    select: {
      id: true,
      name: true,
      setCode: true,
      rarity: true,
      manaValue: true,
      prices: true,
      colorIdentity: true,
      colors: true,
      keywords: true,
    },
  });
  const cardSortById = new Map(cardSortData.map((card) => [card.id, card]));
  const compareValues = (left: any, right: any) => {
    if (typeof left === "number" || typeof right === "number") {
      return (Number(left) || 0) - (Number(right) || 0);
    }
    return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  };
  const structuredFilters = parseInventoryFilters(filters as any);
  const groupMatchesClientSafeFilters = (group: any) =>
    inventoryCardMatchesPostFilters(
      cardSortById.get(group.cardId),
      structuredFilters,
    );
  const sortValue = (group: any) => {
    const card = cardSortById.get(group.cardId) as any;
    if (sortField === "quantity") return group._sum?.quantity ?? 0;
    if (sortField === "setCode") return card?.setCode ?? "";
    if (sortField === "rarity") return card?.rarity ?? "";
    if (sortField === "manaValue") return card?.manaValue ?? 0;
    if (sortField === "priceUsd") return Number(card?.prices?.usd ?? 0);
    return card?.name ?? "";
  };
  const filteredGroups = (allGroups as any[]).filter(
    groupMatchesClientSafeFilters,
  );
  const sortedGroups = [...filteredGroups].sort((left, right) => {
    const direction = sortDirection === "desc" ? -1 : 1;
    const primary =
      compareValues(sortValue(left), sortValue(right)) * direction;
    if (primary) return primary;
    return compareValues(left.cardId, right.cardId);
  });
  const pageGroups = sortedGroups.slice((page - 1) * pageSize, page * pageSize);

  const pageWhere =
    displayMode === "grouped"
      ? {
          ...where,
          cardId: { in: (pageGroups as any[]).map((group) => group.cardId) },
        }
      : {
          ...where,
          OR: (pageGroups as any[]).map((group) => ({
            cardId: group.cardId,
            foilStatus: group.foilStatus,
            condition: group.condition,
            language: group.language,
          })),
        };
  const inventory = pageGroups.length
    ? await prisma.inventoryItem.findMany({
        where: pageWhere,
        include: publicInventoryInclude,
        orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
      })
    : [];

  const orderedInventory = orderInventoryItemsByPageGroups(
    inventory,
    pageGroups,
    displayMode,
  );
  const filteredInventory = filterPublicInventoryByClientSafeFilters(
    orderedInventory,
    filters,
  );
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 1000 || inventory.length > pageSize * 10) {
    console.warn("[public-inventory-list] server-side page query diagnostics", {
      elapsedMs,
      page,
      pageSize,
      sortField,
      sortDirection,
      firstReturnedCardName:
        cardSortById.get(pageGroups[0]?.cardId)?.name ?? null,
      rowsReturned: pageGroups.length,
      rawRowsHydratedForVisibleGroups: inventory.length,
      totalMatchingCount: filteredGroups.length,
    });
  }
  if (pageGroups.length > pageSize) {
    console.warn(
      "[public-inventory-list] query returned more rows than requested page size",
      {
        rowsReturned: pageGroups.length,
        pageSize,
      },
    );
  }

  return {
    inventory: filteredInventory,
    publicProfiles: publicProfiles.map((profile) => ({
      publicSlug: profile.publicSlug!,
      displayName: publicOwnerDisplayName(profile),
    })),
    publicLocations,
    page,
    pageSize,
    totalMatchingCount: filteredGroups.length,
    totalPages: Math.max(1, Math.ceil(filteredGroups.length / pageSize)),
    hasNextPage: page * pageSize < filteredGroups.length,
    visibleCards: filteredInventory.reduce((sum, row) => sum + row.quantity, 0),
  };
}
