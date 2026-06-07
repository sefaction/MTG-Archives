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
        ],
      }
    : undefined;
  return { cardWhere, queryWhere };
}

export async function getPublicInventoryBySlug(
  publicSlug: string,
  filters: PublicInventoryFilters = {},
) {
  const profile = await getPublicProfileBySlug(publicSlug);
  if (!profile?.playerId) return null;

  const { cardWhere, queryWhere } = buildPublicCardWhere(filters);
  const visibilityOr = publicInventoryVisibilityWhere(
    profile.inventoryDefaultVisibility,
  );
  const where: Prisma.InventoryItemWhereInput = {
    currentOwnerId: profile.playerId,
    quantity: { gt: 0 },
    AND: [{ OR: visibilityOr }],
  };
  if (queryWhere) where.AND = [...(where.AND as any[]), queryWhere];
  if (Object.keys(cardWhere).length) where.card = cardWhere;
  if (filters.locationName?.trim()) {
    (where as any).location = { name: filters.locationName.trim() };
  } else if (filters.locationId) where.locationId = filters.locationId;
  if (filters.foil === "true") where.foil = true;
  if (filters.foil === "false") where.foil = false;

  const [inventory, publicLocations] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        card: true,
        location: true,
        currentOwner: true,
      },
      orderBy: [{ card: { name: "asc" } }, { card: { setCode: "asc" } }],
    }),
    prisma.inventoryLocation.findMany({
      where: {
        ownerPlayerId: profile.playerId,
        ...publicLocationVisibilityWhere(profile.inventoryDefaultVisibility),
      },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const colorIdentityNeedle = filters.colorIdentity?.trim().toUpperCase();
  const keywordNeedle = filters.keyword?.trim().toLowerCase();
  const priceMin = filters.priceMin ? Number(filters.priceMin) : undefined;
  const priceMax = filters.priceMax ? Number(filters.priceMax) : undefined;
  const filteredInventory = inventory.filter((item) => {
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
