import { notFound } from "next/navigation";
import { PublicCollectionNav } from "@/components/PublicCollectionNav";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { getPublicInventoryBySlug } from "@/lib/public-collection";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ publicSlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

function toInventoryBrowserRows({
  displayItems,
  displayMode,
}: {
  displayItems: any[];
  displayMode: "exact" | "grouped";
}) {
  return displayItems.map((entry: any, rowIndex: number) => {
    const i = displayMode === "grouped" ? entry.representative : entry;
    const publicRowId = `public-${displayMode}-${rowIndex}`;
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
          ? `${entry.quantity} public cards · ${entry.printingCount} printings · ${entry.locationCount} locations`
          : (i.locationSummary ??
            (i.location?.name
              ? `${i.location.name}: ${i.quantity}`
              : "Public")),
      locationBreakdown: i.locationBreakdown ?? [
        {
          locationId: null,
          name: i.location?.name ?? "Public",
          quantity: i.quantity,
        },
      ],
      printings:
        displayMode === "grouped"
          ? entry.printings.map((printing: any, printingIndex: number) => ({
              id: `${publicRowId}-printing-${printingIndex}`,
              cardName: printing.card.name,
              setCode: printing.card.setCode.toUpperCase(),
              collectorNumber: printing.card.collectorNumber,
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
      locationName: i.location?.name ?? "Public",
      currentOwnerId: "public",
      currentOwner: i.currentOwner?.displayName ?? "Public collection",
      currentOwnerColor: i.currentOwner?.color || "#64748b",
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
      effectiveVisibility: "PUBLIC" as const,
      locationVisibility: i.location?.visibility ?? "PUBLIC",
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

export default async function PublicInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { publicSlug } = await params;
  const p = await searchParams;
  const displayMode: "exact" | "grouped" =
    p.displayMode === "exact" ? "exact" : "grouped";
  const pageSizeOptions = [10, 25, 50, 100, 250];
  const initialPageSize = pageSizeOptions.includes(Number(p.pageSize))
    ? Number(p.pageSize)
    : 50;
  const initialBrowsingMode: "paginated" | "infinite" =
    p.browse === "infinite" ? "infinite" : "paginated";

  const result = await getPublicInventoryBySlug(publicSlug, p);
  if (!result) notFound();

  const { profile, exactRows, groupedRows, publicLocations, visibleCards } =
    result;
  const displayName = profile.publicDisplayName || profile.displayName;
  const displayItems = displayMode === "grouped" ? groupedRows : exactRows;
  const rows = toInventoryBrowserRows({ displayItems, displayMode });

  return (
    <main className="p-8 space-y-6">
      <PublicCollectionNav publicSlug={publicSlug} displayName={displayName} />
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">
          {displayName}&apos;s public inventory
        </h1>
        <p className="text-zinc-400">
          Showing {visibleCards} public cards across {exactRows.length} public
          exact printings. Private locations, private quantities, audit history,
          imports, and edit controls are not exposed.
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
            placeholder="search public cards"
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
            name="locationName"
            defaultValue={p.locationName}
            className="border p-2 bg-zinc-900"
          >
            <option value="">all public locations</option>
            {publicLocations.map((location) => (
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
          <div className="col-span-2 flex gap-2">
            <button className="border px-3">Apply</button>
            <a href={`/u/${publicSlug}/inventory`} className="border px-3 py-2">
              Clear Filters
            </a>
          </div>
        </form>
      </details>

      {rows.length ? (
        <InventoryBrowser
          rows={rows}
          players={[]}
          locations={publicLocations.map((location) => ({
            id: location.name,
            name: location.name,
          }))}
          cardLabels={{}}
          isAdmin={false}
          uiMode="public-readonly"
          displayMode={displayMode}
          totalMatchingCount={displayItems.length}
          totalMatchingCards={displayItems.reduce(
            (sum: number, entry: any) => sum + (entry.quantity ?? 0),
            0,
          )}
          initialPageSize={initialPageSize}
          initialBrowsingMode={initialBrowsingMode}
          currentLocationId={p.locationName || ""}
        />
      ) : (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          No public inventory is available.
        </p>
      )}
    </main>
  );
}
