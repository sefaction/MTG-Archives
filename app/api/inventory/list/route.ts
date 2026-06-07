import { NextResponse } from "next/server";
import { DefaultCollectionVisibility } from "@prisma/client";
import { getAccessScope, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveInventoryVisibility } from "@/lib/visibility";
import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
} from "@/lib/inventory-locations";

const pageSizeOptions = [10, 25, 50, 100, 250];

function paramsFromUrl(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function buildInventoryWhere(
  p: Record<string, string>,
  adminModeActive: boolean,
  playerId?: string | null,
) {
  const where: any = { quantity: { gt: 0 } };
  if (p.cardName) {
    const search = p.cardName.trim();
    where.OR = [
      { card: { name: { contains: search, mode: "insensitive" } } },
      { card: { setCode: { contains: search.toLowerCase() } } },
      { card: { setName: { contains: search, mode: "insensitive" } } },
      { card: { collectorNumber: { contains: search, mode: "insensitive" } } },
      { card: { typeLine: { contains: search, mode: "insensitive" } } },
      { location: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (p.oracleText)
    where.card = {
      ...(where.card || {}),
      oracleText: { contains: p.oracleText, mode: "insensitive" },
    };
  if (p.typeLine)
    where.card = {
      ...(where.card || {}),
      typeLine: { contains: p.typeLine, mode: "insensitive" },
    };
  if (!adminModeActive) {
    where.currentOwnerId = playerId || "__no_owner__";
  } else if (p.ownerId) {
    where.currentOwnerId = p.ownerId;
  }
  if (p.locationId) where.locationId = p.locationId;
  if (p.hasLocation === "unassigned")
    where.location = { normalizedName: "unassigned" };
  if (p.set)
    where.card = { ...(where.card || {}), setCode: p.set.toLowerCase() };
  if (p.rarity) where.card = { ...(where.card || {}), rarity: p.rarity };
  if (p.foil === "true") where.foil = true;
  if (p.foil === "false") where.foil = false;
  if (p.manaValueMin || p.manaValueMax)
    where.card = {
      ...(where.card || {}),
      manaValue: {
        gte: p.manaValueMin ? Number(p.manaValueMin) : undefined,
        lte: p.manaValueMax ? Number(p.manaValueMax) : undefined,
      },
    };
  return where;
}

function rowsFromDisplayItems({
  displayItems,
  displayMode,
  inventoryDefaultByPlayer,
  p,
}: {
  displayItems: any[];
  displayMode: "exact" | "grouped";
  inventoryDefaultByPlayer: Record<string, DefaultCollectionVisibility>;
  p: Record<string, string>;
}) {
  const colorIdentityNeedle = p.colorIdentity?.trim().toUpperCase();
  const keywordNeedle = p.keyword?.trim().toLowerCase();
  const priceMin = p.priceMin ? Number(p.priceMin) : undefined;
  const priceMax = p.priceMax ? Number(p.priceMax) : undefined;

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
            locationId: i.locationId ?? null,
            name: i.location?.name ?? "Unassigned",
            quantity: i.quantity,
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
        foil: i.foil,
        foilStatus: i.foilStatus,
        sourceType: i.sourceType,
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
    .filter((row) => {
      if (
        colorIdentityNeedle &&
        !row.colorIdentity.toUpperCase().includes(colorIdentityNeedle)
      )
        return false;
      if (keywordNeedle && !row.keywords.toLowerCase().includes(keywordNeedle))
        return false;
      const usdPrice = row.priceUsd ? Number(row.priceUsd) : undefined;
      if (
        priceMin !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice < priceMin)
      )
        return false;
      if (
        priceMax !== undefined &&
        (usdPrice === undefined ||
          Number.isNaN(usdPrice) ||
          usdPrice > priceMax)
      )
        return false;
      return true;
    });
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
  const where = buildInventoryWhere(p, adminModeActive, user.playerId);

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
  const [pageGroups, allGroups, ownerUsers] = await Promise.all([
    displayMode === "grouped"
      ? prisma.inventoryItem.groupBy({
          ...groupedGroupBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
      : prisma.inventoryItem.groupBy({
          ...exactGroupBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
    displayMode === "grouped"
      ? prisma.inventoryItem.groupBy(groupedGroupBy)
      : prisma.inventoryItem.groupBy(exactGroupBy),
    prisma.user.findMany({
      select: { playerId: true, inventoryDefaultVisibility: true },
    }),
  ]);
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
        include: { card: true, currentOwner: true, location: true },
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
  const visibilityFilteredItems = p.visibility
    ? items.filter((item) => {
        const effectiveVisibility = resolveInventoryVisibility(
          inventoryDefaultByPlayer[item.currentOwnerId] ??
            DefaultCollectionVisibility.PRIVATE,
          item.location?.visibility ?? "INHERIT",
        );
        if (p.visibility === "public") return effectiveVisibility === "PUBLIC";
        if (p.visibility === "private")
          return effectiveVisibility === "PRIVATE";
        if (p.visibility === "inherit")
          return (item.location?.visibility ?? "INHERIT") === "INHERIT";
        return true;
      })
    : items;
  const exactItems = getInventoryExactPrintings(visibilityFilteredItems as any);
  const groupedItems = getInventoryGroupedByCard(exactItems as any);
  const displayItems = displayMode === "grouped" ? groupedItems : exactItems;
  const totalMatchingCount = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalMatchingCount / pageSize));
  return NextResponse.json({
    rows: rowsFromDisplayItems({
      displayItems,
      displayMode,
      inventoryDefaultByPlayer,
      p,
    }),
    page,
    pageSize,
    totalMatchingCount,
    totalPages,
    hasNextPage: page < totalPages,
    nextPage: page < totalPages ? page + 1 : null,
  });
}
