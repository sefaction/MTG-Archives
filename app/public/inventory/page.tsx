import Link from "next/link";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { InventoryAdvancedSearch } from "@/components/InventoryAdvancedSearch";
import { InventoryQuickCardNameSearch } from "@/components/InventoryQuickCardNameSearch";
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

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PublicOwner = {
  displayName: string;
  publicSlug?: string | null;
};

type PublicLocationPart = {
  locationId: string | null;
  name: string;
  quantity: number;
};

function publicOwnerFor(item: any): PublicOwner {
  const user = item.currentOwner?.users?.[0];
  return {
    displayName:
      user?.publicDisplayName || user?.displayName || "Public collection",
    publicSlug: user?.publicSlug || null,
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
      locationId: null,
      name: `${ownerName} — ${locationName}`,
      quantity: item.quantity,
    };
    const ownerPart = {
      ownerName,
      publicSlug: owner.publicSlug,
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
          color: item.currentOwner?.color || "#64748b",
        },
        quantity: item.quantity,
        ownerBreakdown: [ownerPart],
        locationBreakdown: [locationPart],
        locationSummary: locationSummary([locationPart]),
      });
      return;
    }
    existing.quantity += item.quantity;
    existing.ownerBreakdown.push(ownerPart);
    const previousLocation = existing.locationBreakdown.find(
      (part: PublicLocationPart) => part.name === locationPart.name,
    );
    if (previousLocation) previousLocation.quantity += locationPart.quantity;
    else existing.locationBreakdown.push(locationPart);
    existing.locationSummary = locationSummary(existing.locationBreakdown);
  });
  return Array.from(groups.values());
}

function toInventoryBrowserRows({
  displayItems,
  displayMode,
}: {
  displayItems: any[];
  displayMode: "exact" | "grouped";
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
    return {
      id: publicRowId,
      cardId: publicRowId,
      cardName: i.card.name,
      quantity: entry.quantity ?? i.quantity,
      displayMode,
      printingCount: entry.printingCount ?? 1,
      locationCount: entry.locationCount ?? i.locationBreakdown?.length ?? 1,
      locationSummary:
        displayMode === "grouped"
          ? `${entry.quantity} public cards · ${entry.printingCount} printings · ${collectionCount} collections`
          : (i.locationSummary ?? "Public collection"),
      locationBreakdown: i.locationBreakdown ?? [],
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
                  locationId: null,
                  name: location.name,
                  quantity: location.quantity,
                }),
              ),
            }))
          : [],
      locationId: "",
      locationName: "Public collection",
      currentOwnerId: "public",
      currentOwner:
        collectionCount === 1
          ? i.currentOwner.displayName
          : "Public collections",
      currentOwnerColor: i.currentOwner?.color || "#64748b",
      setCode: i.card.setCode.toUpperCase(),
      setName: i.card.setName ?? "",
      rarity: i.card.rarity,
      manaCost: i.card.manaCost ?? "",
      manaFaces: getManaFacesForDto(i.card.cardFaces),
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
        }),
      ),
      priceSourceLabel: "Scryfall",
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

export default async function PublicInventoryPage({ searchParams }: PageProps) {
  const p = await searchParams;
  const displayMode: "exact" | "grouped" =
    p.displayMode === "grouped" ? "grouped" : "exact";
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const initialPageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const initialBrowsingMode: "paginated" | "infinite" =
    p.browse === "infinite" ? "infinite" : "paginated";
  const sortField = p.sort || "cardName";
  const sortDirection: "asc" | "desc" = p.sortDir === "desc" ? "desc" : "asc";

  const result = await getGlobalPublicInventory({
    ...(p as any as PublicInventoryFilters),
    page:
      initialBrowsingMode === "infinite"
        ? "1"
        : Array.isArray(p.page)
          ? p.page[0]
          : p.page,
  });
  const setOptions: Array<{ setCode: string; setName: string | null }> = [];
  const cardNameRows: Array<{ name: string }> = [];
  const exactRows = getGlobalPublicExactPrintings(result.inventory);
  const groupedRows = getInventoryGroupedByCard(exactRows as any);
  const displayItems = displayMode === "grouped" ? groupedRows : exactRows;
  const rows = toInventoryBrowserRows({ displayItems, displayMode });
  const pageParams = Object.fromEntries(
    Object.entries(p).filter(([key, value]) => value && key !== "page"),
  ) as Record<string, string>;
  const pageHrefBase = new URLSearchParams(
    pageParams as Record<string, string>,
  ).toString();

  const selected = (key: string) => {
    const value = (p as Record<string, any>)[key];
    return Array.isArray(value)
      ? value.flatMap((entry) => String(entry).split(","))
      : value
        ? String(value).split(",")
        : [];
  };
  const clearFilterParams = new URLSearchParams();
  clearFilterParams.set("displayMode", displayMode);
  if (p.pageSize) clearFilterParams.set("pageSize", String(p.pageSize));
  if (p.browse) clearFilterParams.set("browse", String(p.browse));
  if (p.sort) clearFilterParams.set("sort", String(p.sort));
  if (p.sortDir) clearFilterParams.set("sortDir", String(p.sortDir));
  const clearFiltersHref = `/public/inventory?${clearFilterParams.toString()}`;

  return (
    <main className="p-8 space-y-6">
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4 text-sm">
        <div className="flex flex-wrap gap-4">
          <Link href="/" className="font-bold text-sky-200">
            MTG Inventory
          </Link>
          <Link href="/public">Public home</Link>
          <Link href="/public/inventory">Public inventory</Link>
          <Link href="/public/decks">Public decks</Link>
        </div>
        <Link className="rounded border border-sky-700 px-3 py-1" href="/login">
          Log in
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Public inventory</h1>
        <p className="text-zinc-400">
          Browse public cards from all collections that opted in. Showing{" "}
          {result.visibleCards} public cards on this page. Private users,
          locations, quantities, imports, and audit logs are excluded
          server-side.
        </p>
      </header>

      <InventoryQuickCardNameSearch actionPath="/public/inventory" params={p} />
      <InventoryAdvancedSearch
        actionPath="/public/inventory"
        params={p}
        displayMode={displayMode}
        isPublic
        players={result.publicProfiles.map((owner) => ({
          value: owner.publicSlug,
          label: owner.displayName,
        }))}
        ownerParamName="owner"
        ownerFilterLabel="Current owner"
        ownerAllLabel="All public owners"
        locations={result.publicLocations.map((location) => ({
          value: location.name,
          label: location.name,
        }))}
        locationParamName="locationName"
        includeUnassignedLocationOption={false}
        setOptions={setOptions.map((set) => ({
          value: set.setCode,
          label: `${set.setCode.toUpperCase()} — ${set.setName || set.setCode.toUpperCase()}`,
        }))}
        cardNameOptions={cardNameRows.map((card) => card.name)}
        clearHref={clearFiltersHref}
      />

      {rows.length ? (
        <InventoryBrowser
          rows={rows}
          players={[]}
          locations={result.publicLocations.map((location) => ({
            id: location.name,
            name: location.name,
          }))}
          cardLabels={{}}
          isAdmin={false}
          uiMode="public-readonly"
          displayMode={displayMode}
          totalMatchingCount={result.totalMatchingCount}
          totalMatchingCards={displayItems.reduce(
            (sum: number, entry: any) => sum + (entry.quantity ?? 0),
            0,
          )}
          currentPage={Math.min(result.page, result.totalPages)}
          totalPages={result.totalPages}
          hasPreviousPage={result.page > 1}
          hasNextPage={result.hasNextPage}
          pageHrefBase={pageHrefBase}
          infiniteApiPath="/api/public/inventory/list"
          initialPageSize={initialPageSize}
          initialBrowsingMode={initialBrowsingMode}
          initialSortField={String(sortField)}
          initialSortDirection={sortDirection}
          currentLocationId={selected("locationName")[0] || ""}
        />
      ) : (
        <div className="rounded border border-zinc-800 p-4 text-zinc-400">
          <p>No public inventory is available yet.</p>
          <Link className="mt-2 inline-block underline" href="/login">
            Log in to manage your own collection visibility.
          </Link>
        </div>
      )}
    </main>
  );
}
