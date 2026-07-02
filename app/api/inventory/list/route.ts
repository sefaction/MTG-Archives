import { NextResponse } from "next/server";
import { DefaultCollectionVisibility } from "@prisma/client";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveInventoryVisibility } from "@/lib/visibility";
import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  orderInventoryItemsByPageGroups,
} from "@/lib/inventory-locations";
import { getManaFacesForDto } from "@/lib/mtg/mana-display";
import {
  finishForFoilStatus,
  formatSelectedPrice,
  selectPreferredCardPrice,
} from "@/lib/price-history";
import {
  buildInventoryWhereFromFilters,
  inventoryCardMatchesPostFilters,
  parseInventoryFilters,
} from "@/lib/inventory-filters";
import { compareInventoryGroups } from "@/lib/inventory-sort";
import {
  buildRelatedCardMetadataByScryfallId,
  enrichAllPartsWithLocalCardMetadata,
} from "@/lib/inventory-related-cards";

const pageSizeOptions = [10, 25, 50, 100, 250];

function paramsFromUrl(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function rowsFromDisplayItems({
  displayItems,
  displayMode,
  inventoryDefaultByPlayer,
  p,
  filters,
  relatedCardsByScryfallId,
  preferredPriceProvider,
}: {
  displayItems: any[];
  displayMode: "exact" | "grouped";
  inventoryDefaultByPlayer: Record<string, DefaultCollectionVisibility>;
  p: Record<string, string>;
  filters: ReturnType<typeof parseInventoryFilters>;
  relatedCardsByScryfallId: Map<string, any>;
  preferredPriceProvider?: string | null;
}) {
  return displayItems
    .map((entry: any) => {
      const i = displayMode === "grouped" ? entry.representative : entry;
      return {
        id: displayMode === "grouped" ? entry.id : i.id,
        cardId: i.cardId,
        cardName: i.card.name,
        quantity: entry.quantity ?? i.quantity,
        displayMode,
        sourceItemIds: i.sourceItemIds ?? [i.id],
        printingCount: entry.printingCount ?? 1,
        locationCount: entry.locationCount ?? i.locationBreakdown?.length ?? 1,
        locationSummary:
          displayMode === "grouped"
            ? `${entry.quantity} total · ${entry.printingCount} printings · ${entry.locationCount} locations`
            : (i.locationSummary ??
              (i.location?.name
                ? `${i.location.name}: ${i.quantity}`
                : "Unassigned")),
        locationBreakdown: i.locationBreakdown ?? [
          {
            inventoryItemId: i.id,
            locationId: i.locationId ?? null,
            name: i.location?.name ?? "Unassigned",
            quantity: i.quantity,
            foilStatus: i.foilStatus,
            condition: i.condition,
            language: i.language,
            sourceType: i.sourceType,
            locationKind: i.location?.kind ?? null,
            locationActive: i.location?.active ?? null,
            locationSystemManaged: i.location?.systemManaged ?? null,
          },
        ],
        printings:
          displayMode === "grouped"
            ? entry.printings.map((printing: any) => ({
                id: printing.id,
                cardName: printing.card.name,
                setCode: printing.card.setCode.toUpperCase(),
                collectorNumber: printing.card.collectorNumber,
                foilStatus: printing.foilStatus,
                condition: printing.condition,
                language: printing.language,
                quantity: printing.quantity,
                locationBreakdown: printing.locationBreakdown,
              }))
            : [],
        locationId: i.locationId ?? "",
        locationName: i.location?.name ?? "Unassigned",
        currentOwnerId: i.currentOwnerId,
        currentOwner: i.currentOwner.displayName,
        currentOwnerColor: i.currentOwner.color || "#64748b",
        setCode: i.card.setCode.toUpperCase(),
        setName: i.card.setName ?? "",
        rarity: i.card.rarity,
        manaCost: i.card.manaCost ?? "",
        manaFaces: getManaFacesForDto(i.card.cardFaces),
        cardFaces: Array.isArray(i.card.cardFaces) ? i.card.cardFaces : [],
        allParts: enrichAllPartsWithLocalCardMetadata(
          i.card.allParts,
          relatedCardsByScryfallId,
        ),
        layout: i.card.layout ?? "",
        manaValue: i.card.manaValue ?? undefined,
        typeLine: i.card.typeLine,
        colorIdentity: Array.isArray(i.card.colorIdentity)
          ? i.card.colorIdentity.join(",")
          : JSON.stringify(i.card.colorIdentity ?? ""),
        colors: Array.isArray(i.card.colors)
          ? i.card.colors.join(",")
          : JSON.stringify(i.card.colors ?? ""),
        priceUsd: (i.card.prices as any)?.usd ?? "",
        priceUsdFoil: (i.card.prices as any)?.usd_foil ?? "",
        priceUsdEtched: (i.card.prices as any)?.usd_etched ?? "",
        priceEur: (i.card.prices as any)?.eur ?? "",
        priceEurFoil: (i.card.prices as any)?.eur_foil ?? "",
        priceTix: (i.card.prices as any)?.tix ?? "",
        preferredPriceLabel: formatSelectedPrice(
          selectPreferredCardPrice(undefined, i.card.prices, {
            finish: finishForFoilStatus(i.foilStatus),
            preferredProvider: preferredPriceProvider || undefined,
          }),
        ),
        priceChange7Day: "",
        priceChange30Day: "",
        priceChange90Day: "",
        priceHistory: [],
        foil: i.foil,
        foilStatus: i.foilStatus,
        sourceType: i.sourceType,
        language: i.language,
        locationVisibility: i.location?.visibility ?? "INHERIT",
        effectiveVisibility: resolveInventoryVisibility(
          inventoryDefaultByPlayer[i.currentOwnerId] ??
            DefaultCollectionVisibility.PRIVATE,
          i.location?.visibility ?? "INHERIT",
        ),
        oracleText: i.card.oracleText ?? "",
        powerToughness: [i.card.power, i.card.toughness]
          .filter(Boolean)
          .join("/"),
        power: i.card.power ?? "",
        toughness: i.card.toughness ?? "",
        loyalty: i.card.loyalty ?? "",
        defense: i.card.defense ?? "",
        legalities: (i.card.legalities as any) ?? {},
        artist: i.card.artist ?? "",
        collectorNumber: i.card.collectorNumber,
        releasedAt: i.card.releasedAt?.toISOString().slice(0, 10) ?? "",
        keywords: Array.isArray(i.card.keywords)
          ? i.card.keywords.join(", ")
          : JSON.stringify(i.card.keywords ?? ""),
        notes: i.notes ?? "",
        condition: i.condition,
        imageUri:
          (i.card.imageUris as any)?.normal ??
          (i.card.imageUris as any)?.small ??
          i.card.imageUri ??
          "",
        imageSmall: (i.card.imageUris as any)?.small ?? "",
        scryfallUri: i.card.scryfallUri ?? "",
        auditHistory: [],
      };
    })
    .filter((row) =>
      inventoryCardMatchesPostFilters(
        {
          colorIdentity: row.colorIdentity,
          colors: row.colors,
          keywords: row.keywords,
          prices: {
            usd: row.priceUsd,
            usd_foil: row.priceUsdFoil,
            usd_etched: row.priceUsdEtched,
          },
        },
        filters,
      ),
    );
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessScope = await getAccessScope(user);
  const adminModeActive = accessScope?.mode === "admin";
  const p = paramsFromUrl(request);
  const displayMode: "exact" | "grouped" =
    p.displayMode === "grouped" ? "grouped" : "exact";
  const pageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const page = Math.max(1, Number(p.page || "1") || 1);
  const sortField = p.sort || "cardName";
  const sortDirection: "asc" | "desc" =
    p.sortDir === "desc" || (!p.sortDir && sortField === "releasedAt")
      ? "desc"
      : "asc";
  const filters = parseInventoryFilters(new URL(request.url).searchParams);
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive,
    playerId: user.playerId,
  });

  const exactGroupBy = {
    by: [
      "currentOwnerId",
      "cardId",
      "foilStatus",
      "condition",
      "language",
    ] as any,
    where,
    _sum: { quantity: true as const },
    _count: { _all: true as const },
    orderBy: [
      { cardId: "asc" },
      { currentOwnerId: "asc" },
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
  const [allGroups, ownerUsers] = await Promise.all([
    displayMode === "grouped"
      ? prisma.inventoryItem.groupBy(groupedGroupBy)
      : prisma.inventoryItem.groupBy(exactGroupBy),
    prisma.user.findMany({
      select: { playerId: true, inventoryDefaultVisibility: true },
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
      collectorNumber: true,
      releasedAt: true,
      typeLine: true,
      manaCost: true,
      colorIdentity: true,
      colors: true,
      keywords: true,
    },
  });
  const cardSortById = new Map(cardSortData.map((card) => [card.id, card]));
  const groupMatchesClientSafeFilters = (group: any) =>
    inventoryCardMatchesPostFilters(cardSortById.get(group.cardId), filters);
  const filteredGroups = (allGroups as any[]).filter(
    groupMatchesClientSafeFilters,
  );
  const sortedGroups = [...filteredGroups].sort((left, right) =>
    compareInventoryGroups(left, right, cardSortById, sortField, sortDirection),
  );
  const pageGroups = sortedGroups.slice((page - 1) * pageSize, page * pageSize);
  const pageGroupWhere =
    displayMode === "grouped"
      ? {
          ...where,
          cardId: { in: (pageGroups as any[]).map((group) => group.cardId) },
        }
      : {
          ...where,
          OR: (pageGroups as any[]).map((group) => ({
            currentOwnerId: group.currentOwnerId,
            cardId: group.cardId,
            foilStatus: group.foilStatus,
            condition: group.condition,
            language: group.language,
          })),
        };
  const items = pageGroups.length
    ? await prisma.inventoryItem.findMany({
        where: pageGroupWhere,
        include: {
          card: true,
          currentOwner: true,
          location: true,
        },
        orderBy: [{ card: { name: "asc" } }, { createdAt: "desc" }],
      })
    : [];
  const inventoryDefaultByPlayer = Object.fromEntries(
    ownerUsers
      .filter((ownerUser) => ownerUser.playerId)
      .map((ownerUser) => [
        ownerUser.playerId!,
        ownerUser.inventoryDefaultVisibility,
      ]),
  );
  const orderedItems = orderInventoryItemsByPageGroups(
    items,
    pageGroups,
    displayMode,
  );
  const visibilityFilteredItems = orderedItems;
  const exactItems = getInventoryExactPrintings(visibilityFilteredItems as any);
  const groupedItems = getInventoryGroupedByCard(exactItems as any);
  const displayItems = displayMode === "grouped" ? groupedItems : exactItems;
  const relatedCardsByScryfallId =
    await buildRelatedCardMetadataByScryfallId(displayItems);
  const totalMatchingCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalMatchingCount / pageSize));
  return NextResponse.json({
    rows: rowsFromDisplayItems({
      displayItems,
      displayMode,
      inventoryDefaultByPlayer,
      p,
      filters,
      relatedCardsByScryfallId,
      preferredPriceProvider: user?.preferredPriceProvider,
    }),
    page,
    pageSize,
    totalMatchingCount,
    totalPages,
    hasNextPage: page < totalPages,
    nextPage: page < totalPages ? page + 1 : null,
  });
}
