import Link from "next/link";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import {
  getGlobalPublicInventory,
  PublicInventoryFilters,
} from "@/lib/public-collection";
import { getInventoryGroupedByCard } from "@/lib/inventory-locations";
import { getManaFacesForDto } from "@/lib/mtg/mana-display";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
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
        sourceItemIds: [`public-source-${index}`],
        ownerBreakdown: [ownerPart],
        locationBreakdown: [locationPart],
        locationSummary: locationSummary([locationPart]),
      });
      return;
    }
    existing.quantity += item.quantity;
    existing.sourceItemIds.push(`public-source-${index}`);
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
      sourceItemIds: [publicRowId],
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
      auditHistory: [],
    };
  });
}

export default async function PublicInventoryPage({ searchParams }: PageProps) {
  const p = await searchParams;
  const displayMode: "exact" | "grouped" =
    p.displayMode === "exact" ? "exact" : "grouped";
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const initialPageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const initialBrowsingMode: "paginated" | "infinite" =
    p.browse === "infinite" ? "infinite" : "paginated";
  const sortField = p.sort || "cardName";
  const sortDirection: "asc" | "desc" = p.sortDir === "desc" ? "desc" : "asc";

  const result = await getGlobalPublicInventory({
    ...(p as PublicInventoryFilters),
    page: initialBrowsingMode === "infinite" ? "1" : p.page,
  });
  const exactRows = getGlobalPublicExactPrintings(result.inventory);
  const groupedRows = getInventoryGroupedByCard(exactRows as any);
  const displayItems = displayMode === "grouped" ? groupedRows : exactRows;
  const rows = toInventoryBrowserRows({ displayItems, displayMode });
  const ownerFilter = p.owner || "";
  const pageParams = Object.fromEntries(
    Object.entries(p).filter(([key, value]) => value && key !== "page"),
  ) as Record<string, string>;
  const pageHrefBase = new URLSearchParams(pageParams).toString();

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

      <details open className="border border-zinc-800 rounded p-3">
        <summary className="cursor-pointer font-semibold">
          Public inventory filters
        </summary>
        <form className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <input
            name="q"
            defaultValue={p.q}
            placeholder="search public cards, sets, locations, collections"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="cardName"
            defaultValue={p.cardName}
            placeholder="card name contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="oracleText"
            defaultValue={p.oracleText}
            placeholder="oracle text contains"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="typeLine"
            defaultValue={p.typeLine}
            placeholder="type line contains"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="displayMode"
            defaultValue={displayMode}
            className="border p-2 bg-zinc-900"
          >
            <option value="grouped">Grouped by card name</option>
            <option value="exact">Exact printings</option>
          </select>
          <select
            name="owner"
            defaultValue={ownerFilter}
            className="border p-2 bg-zinc-900"
          >
            <option value="">all public collections</option>
            {result.publicProfiles.map((profile) => (
              <option key={profile.publicSlug} value={profile.publicSlug}>
                {profile.displayName}
              </option>
            ))}
          </select>
          <select
            name="locationName"
            defaultValue={p.locationName}
            className="border p-2 bg-zinc-900"
          >
            <option value="">all public location names</option>
            {result.publicLocations.map((location) => (
              <option key={location.name} value={location.name}>
                {location.name}
              </option>
            ))}
          </select>
          <input
            name="set"
            defaultValue={p.set}
            placeholder="set"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="rarity"
            defaultValue={p.rarity}
            placeholder="rarity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="colorIdentity"
            defaultValue={p.colorIdentity}
            placeholder="color identity"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMin"
            defaultValue={p.manaValueMin}
            placeholder="mana value min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="manaValueMax"
            defaultValue={p.manaValueMax}
            placeholder="mana value max"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="keyword"
            defaultValue={p.keyword}
            placeholder="keyword contains"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="foil"
            defaultValue={p.foil}
            className="border p-2 bg-zinc-900"
          >
            <option value="">foil/nonfoil</option>
            <option value="true">foil</option>
            <option value="false">nonfoil</option>
          </select>
          <input
            name="priceMin"
            defaultValue={p.priceMin}
            placeholder="price min"
            className="border p-2 bg-zinc-900"
          />
          <input
            name="priceMax"
            defaultValue={p.priceMax}
            placeholder="price max"
            className="border p-2 bg-zinc-900"
          />
          <select
            name="pageSize"
            defaultValue={String(result.pageSize)}
            className="border p-2 bg-zinc-900"
          >
            {[10, 25, 50, 100, 250].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <div className="col-span-2 flex gap-2">
            <button className="border px-3">Apply</button>
            <Link href="/public/inventory" className="border px-3 py-2">
              Clear Filters
            </Link>
          </div>
        </form>
      </details>

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
          initialSortField={sortField}
          initialSortDirection={sortDirection}
          currentLocationId={p.locationName || ""}
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
