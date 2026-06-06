import Link from "next/link";
import { notFound } from "next/navigation";
import { DefaultCollectionVisibility, Visibility } from "@prisma/client";
import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
} from "@/lib/inventory-locations";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ publicSlug: string }>;
  searchParams: Promise<{ q?: string; view?: string }>;
};

function publicVisibilityWhere(defaultVisibility: DefaultCollectionVisibility) {
  if (defaultVisibility === DefaultCollectionVisibility.PUBLIC) {
    return [
      { locationId: null },
      { location: { visibility: { not: Visibility.PRIVATE }, active: true } },
    ];
  }
  return [{ location: { visibility: Visibility.PUBLIC, active: true } }];
}

function cardImage(row: {
  card: { imageUri?: string | null; imageUris?: unknown };
}) {
  const images = row.card.imageUris as
    | { small?: string; normal?: string }
    | null
    | undefined;
  return images?.small ?? images?.normal ?? row.card.imageUri ?? "";
}

export default async function PublicInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { publicSlug } = await params;
  const sp = await searchParams;
  const viewer = await prisma.user.findUnique({
    where: { publicSlug },
    include: { player: true },
  });
  if (!viewer?.publicProfileEnabled || !viewer.playerId) notFound();

  const q = sp.q?.trim() || "";
  const view = sp.view === "exact" ? "exact" : "grouped";
  const cardWhere = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { typeLine: { contains: q, mode: "insensitive" as const } },
          { oracleText: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const inventory = await prisma.inventoryItem.findMany({
    where: {
      currentOwnerId: viewer.playerId,
      quantity: { gt: 0 },
      OR: publicVisibilityWhere(viewer.inventoryDefaultVisibility),
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
  const visibleCards = exactRows.reduce((sum, row) => sum + row.quantity, 0);
  const displayName = viewer.publicDisplayName || viewer.displayName;

  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <Link
          className="text-sm text-sky-300 underline"
          href={`/u/${publicSlug}`}
        >
          {displayName}
        </Link>
        <h1 className="text-3xl font-bold">
          {displayName}&apos;s public inventory
        </h1>
        <p className="text-zinc-400">
          Showing {visibleCards} public cards across {exactRows.length} public
          exact printings.
        </p>
      </header>

      <form
        className="flex flex-wrap gap-2"
        action={`/u/${publicSlug}/inventory`}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search public cards"
          className="border bg-zinc-900 p-2"
        />
        <select
          name="view"
          defaultValue={view}
          className="border bg-zinc-900 p-2"
        >
          <option value="grouped">Grouped by card</option>
          <option value="exact">Exact printings</option>
        </select>
        <button className="border px-3 py-2">Search</button>
      </form>

      {view === "grouped" ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groupedRows.map((row: any) => {
            const representative = row.representative;
            const img = cardImage(representative);
            return (
              <article
                key={row.id}
                className="rounded border border-zinc-800 p-3"
              >
                <div className="flex gap-3">
                  {img ? (
                    <img src={img} alt="" className="h-28 rounded" />
                  ) : null}
                  <div>
                    <h2 className="font-semibold">{row.cardName}</h2>
                    <p className="text-sm text-zinc-400">
                      {row.quantity} public copies · {row.printingCount}{" "}
                      printings
                    </p>
                    <p className="text-sm text-zinc-400">
                      {representative.locationSummary}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th>Card</th>
                <th>Set</th>
                <th>Quantity</th>
                <th>Location</th>
                <th>Foil</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {exactRows.map((row: any) => (
                <tr key={row.id} className="border-b border-zinc-900">
                  <td>{row.card.name}</td>
                  <td>
                    {row.card.setCode.toUpperCase()} #{row.card.collectorNumber}
                  </td>
                  <td>{row.quantity}</td>
                  <td>{row.locationSummary}</td>
                  <td>{row.foilStatus}</td>
                  <td>{row.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!exactRows.length ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          No public inventory matches this search.
        </p>
      ) : null}
    </main>
  );
}
