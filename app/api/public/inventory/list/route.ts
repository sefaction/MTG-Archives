import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getGlobalPublicInventory,
  PublicInventoryFilters,
} from "@/lib/public-collection";
import { getInventoryGroupedByCard } from "@/lib/inventory-locations";
import { getManaFacesForDto } from "@/lib/mtg/mana-display";
import {
  finishForFoilStatus,
  formatSelectedPrice,
  selectPreferredCardPrice,
} from "@/lib/price-history";
import {
  buildRelatedCardMetadataByScryfallId,
  enrichAllPartsWithLocalCardMetadata,
} from "@/lib/inventory-related-cards";

type PublicOwner = {
  displayName: string;
  publicSlug?: string | null;
  color: string;
};

type PublicLocationPart = {
  locationId: string | null;
  name: string;
  quantity: number;
  inventoryItemIds?: string[];
};

function publicOwnerFor(item: any): PublicOwner {
  const user = item.currentOwner?.users?.[0];
  return {
    displayName:
      user?.publicDisplayName || user?.displayName || "Public collection",
    publicSlug: user?.publicSlug || null,
    color: item.currentOwner?.color || "#64748b",
  };
}

function publicLocationName(item: any) {
  return item.location?.name || "Public collection";
}

function locationSummary(parts: PublicLocationPart[]) {
  if (!parts.length) return "Public collection";
  if (parts.length <= 2)
    return parts.map((part) => `${part.name}: ${part.quantity}`).join(" · ");
  const total = parts.reduce((sum, part) => sum + part.quantity, 0);
  const ownerCount = new Set(parts.map((part) => part.name.split(" — ")[0]))
    .size;
  return `${total} public cards across ${ownerCount} collections`;
}

function aggregatePublicLocationBreakdown(parts: PublicLocationPart[]) {
  const byLocation = new Map<string, PublicLocationPart>();
  for (const part of parts) {
    const key = part.locationId ?? part.name;
    const existing = byLocation.get(key);
    if (existing) {
      existing.quantity += part.quantity;
      existing.inventoryItemIds = [
        ...(existing.inventoryItemIds ?? []),
        ...(part.inventoryItemIds ?? []),
      ];
    } else byLocation.set(key, { ...part });
  }
  return Array.from(byLocation.values());
}

function getGlobalPublicExactPrintings(items: any[]) {
  const groups = new Map<string, any>();
  items.forEach((item, index) => {
    const owner = publicOwnerFor(item);
    const ownerName = owner.displayName;
    const locationName = publicLocationName(item);
    const key = [
      item.cardId,
      item.foilStatus,
      item.condition,
      item.language,
    ].join("|");
    const locationPart = {
      locationId: item.locationId ?? null,
      name: `${ownerName} — ${locationName}`,
      quantity: item.quantity,
      inventoryItemIds: [item.id],
    };
    const ownerPart = {
      ownerName,
      publicSlug: owner.publicSlug,
      ownerColor: owner.color,
      locationName,
      quantity: item.quantity,
    };
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...item,
        id: `public-exact-${key}`,
        cardId: item.cardId,
        currentOwnerId: "public",
        currentOwner: {
          displayName: ownerName,
          color: owner.color,
        },
        quantity: item.quantity,
        ownerBreakdown: [ownerPart],
        locationBreakdown: [locationPart],
        sourceItemIds: [item.id],
        locationSummary: locationSummary([locationPart]),
      });
      return;
    }
    existing.quantity += item.quantity;
    existing.sourceItemIds.push(item.id);
    existing.ownerBreakdown.push(ownerPart);
    const previousLocation = existing.locationBreakdown.find(
      (part: PublicLocationPart) => part.name === locationPart.name,
    );
    if (previousLocation) {
      previousLocation.quantity += locationPart.quantity;
      previousLocation.inventoryItemIds = [
        ...(previousLocation.inventoryItemIds ?? []),
        item.id,
      ];
    } else existing.locationBreakdown.push(locationPart);
    existing.locationSummary = locationSummary(existing.locationBreakdown);
  });
  return Array.from(groups.values());
}

function toInventoryBrowserRows({
  displayItems,
  displayMode,
  relatedCardsByScryfallId,
  preferredPriceProvider,
}: {
  displayItems: any[];
  displayMode: "exact" | "grouped";
  relatedCardsByScryfallId: Map<string, any>;
  preferredPriceProvider?: string | null;
}) {
  return displayItems.map((entry: any, rowIndex: number) => {
    const i = displayMode === "grouped" ? entry.representative : entry;
    const publicRowId = `public-global-${displayMode}-${entry.id ?? i.id ?? i.cardId ?? rowIndex}`;
    const collectionCount = new Set(
      (displayMode === "grouped"
        ? entry.printings.flatMap(
            (printing: any) => printing.ownerBreakdown || [],
          )
        : i.ownerBreakdown || []
      ).map((owner: any) => owner.publicSlug || owner.ownerName),
    ).size;
    const ownerBreakdown =
      displayMode === "grouped"
        ? entry.printings.flatMap(
            (printing: any) => printing.ownerBreakdown || [],
          )
        : i.ownerBreakdown || [];
    const rowLocationBreakdown =
      displayMode === "grouped"
        ? aggregatePublicLocationBreakdown(
            entry.printings.flatMap(
              (printing: any) => printing.locationBreakdown || [],
            ),
          )
        : (i.locationBreakdown ?? []);
    const sourceItemIds =
      displayMode === "grouped"
        ? entry.printings.flatMap(
            (printing: any) => printing.sourceItemIds || [],
          )
        : (i.sourceItemIds ?? []);
    const ownerColors = Array.from(
      new Set(
        ownerBreakdown.map((owner: any) => owner.ownerColor).filter(Boolean),
      ),
    );
    const currentOwnerColor =
      collectionCount === 1 && ownerColors.length === 1
        ? String(ownerColors[0])
        : "#64748b";
    return {
      id: publicRowId,
      cardId: publicRowId,
      sourceItemIds,
      cardName: i.card.name,
      quantity: entry.quantity ?? i.quantity,
      displayMode,
      printingCount: entry.printingCount ?? 1,
      locationCount: rowLocationBreakdown.length || 1,
      locationSummary:
        displayMode === "grouped"
          ? `${entry.quantity} public cards · ${entry.printingCount} printings · ${collectionCount} collections`
          : (i.locationSummary ?? "Public collection"),
      locationBreakdown: rowLocationBreakdown,
      printings:
        displayMode === "grouped"
          ? entry.printings.map((printing: any, printingIndex: number) => ({
              id: `${publicRowId}-printing-${printingIndex}`,
              cardName: printing.card.name,
              setCode: printing.card.setCode.toUpperCase(),
              collectorNumber: printing.card.collectorNumber,
              rarity: printing.card.rarity,
              foilStatus: printing.foilStatus,
              condition: printing.condition,
              language: printing.language,
              quantity: printing.quantity,
              locationBreakdown: printing.locationBreakdown.map(
                (location: any) => ({
                  locationId: location.locationId ?? null,
                  name: location.name,
                  quantity: location.quantity,
                  inventoryItemIds: location.inventoryItemIds ?? [],
                }),
              ),
              sourceItemIds: printing.sourceItemIds ?? [],
            }))
          : [],
      locationId: "",
      locationName: "Public collection",
      currentOwnerId: "public",
      currentOwner:
        collectionCount === 1
          ? i.currentOwner.displayName
          : "Public collections",
      currentOwnerColor,
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
      effectiveVisibility: "PUBLIC" as const,
      locationVisibility: "PUBLIC" as const,
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
      notes: "",
      condition: i.condition,
      imageUri:
        (i.card.imageUris as any)?.normal ??
        (i.card.imageUris as any)?.small ??
        i.card.imageUri ??
        "",
      imageSmall: (i.card.imageUris as any)?.small ?? "",
      scryfallUri: i.card.scryfallUri ?? "",
    };
  });
}

export async function GET(request: Request) {
  const viewer = await getCurrentUser();
  const searchParams = new URL(request.url).searchParams;
  const params = Array.from(new Set(searchParams.keys())).reduce(
    (acc, key) => ({ ...acc, [key]: searchParams.getAll(key).join(",") }),
    {} as Record<string, string>,
  );
  const displayMode: "exact" | "grouped" =
    params.displayMode === "grouped" ? "grouped" : "exact";
  const result = await getGlobalPublicInventory(
    params as PublicInventoryFilters,
  );
  const exactRows = getGlobalPublicExactPrintings(result.inventory);
  const groupedRows = getInventoryGroupedByCard(exactRows as any);
  const displayItems = displayMode === "grouped" ? groupedRows : exactRows;
  const relatedCardsByScryfallId =
    await buildRelatedCardMetadataByScryfallId(displayItems);
  return NextResponse.json({
    rows: toInventoryBrowserRows({
      displayItems,
      displayMode,
      relatedCardsByScryfallId,
      preferredPriceProvider: viewer?.preferredPriceProvider,
    }),
    page: result.page,
    pageSize: result.pageSize,
    totalMatchingCount: result.totalMatchingCount,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    nextPage: result.hasNextPage ? result.page + 1 : null,
  });
}
