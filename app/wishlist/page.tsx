export const dynamic = "force-dynamic";

import { Nav } from "@/components/Nav";
import { WishlistSearchAdd } from "@/components/WishlistSearchAdd";
import { WishlistTable } from "@/components/WishlistTable";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWishlistView, type WishlistGroup } from "@/lib/wishlist";

function money(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function matchesTab(group: WishlistGroup, tab: string) {
  if (tab === "manual") return group.manualQuantity > 0;
  if (tab === "decks") return group.deckQuantity > 0;
  if (tab === "available")
    return group.sources.decks.some((d) => d.availableUncommittedCopyExists);
  if (tab === "missing") return group.totalWanted > group.inventory.ownedTotal;
  if (tab === "stock") return group.inventory.ownedTotal > 0;
  if (tab === "out") return group.inventory.ownedTotal === 0;
  return true;
}

function priorityMatches(group: WishlistGroup, priority: string) {
  if (!priority) return true;
  return group.sources.manual.some(
    (item) => (item.priority || "").toLowerCase() === priority.toLowerCase(),
  );
}

function rarityMatches(group: WishlistGroup, rarity: string) {
  if (!rarity) return true;
  return group.card.rarity.toLowerCase() === rarity.toLowerCase();
}

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    sort?: string;
    priority?: string;
    rarity?: string;
  }>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const tab = params.tab || "all";
  const q = (params.q || "").trim().toLowerCase();
  const sort = params.sort || "need";
  const priority = params.priority || "";
  const rarity = params.rarity || "";
  const view = await getWishlistView(prisma, user.id, user.playerId);
  let groups = view.groups.filter((group) => matchesTab(group, tab));
  if (q) {
    groups = groups.filter(
      (group) =>
        group.card.name.toLowerCase().includes(q) ||
        group.card.typeLine.toLowerCase().includes(q) ||
        group.sources.decks.some((deck) =>
          deck.deckName.toLowerCase().includes(q),
        ),
    );
  }
  groups = groups.filter(
    (group) => priorityMatches(group, priority) && rarityMatches(group, rarity),
  );
  if (sort === "name")
    groups = [...groups].sort((a, b) => a.card.name.localeCompare(b.card.name));
  if (sort === "missing")
    groups = [...groups].sort(
      (a, b) =>
        Math.max(0, b.totalWanted - b.inventory.ownedTotal) -
        Math.max(0, a.totalWanted - a.inventory.ownedTotal),
    );
  if (sort === "available")
    groups = [...groups].sort(
      (a, b) => b.inventory.available - a.inventory.available,
    );
  if (sort === "price")
    groups = [...groups].sort(
      (a, b) => (b.estimatedMissingCost ?? -1) - (a.estimatedMissingCost ?? -1),
    );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Wishlist</h1>
        <p className="text-zinc-400">
          Manual wants plus deck-derived needs in an inventory-style table. Deck
          cards are satisfied only by copies committed to that deck’s
          system-managed location.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {[
          ["Manual rows", view.summary.manualRows],
          ["Deck-needed rows", view.summary.deckRows],
          ["Total wanted", view.summary.totalWantedQuantity],
          ["Missing from inventory", view.summary.missingFromInventoryQuantity],
          ["Available to commit", view.summary.availableToCommitQuantity],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded border border-zinc-800 bg-zinc-950 p-4"
          >
            <div className="text-xs uppercase text-zinc-500">{label}</div>
            <div className="text-2xl font-semibold text-sky-100">{value}</div>
          </div>
        ))}
        <div className="rounded border border-zinc-800 bg-zinc-950 p-4 md:col-span-5">
          <div className="text-xs uppercase text-zinc-500">
            Estimated cost for missing inventory
          </div>
          <div className="text-2xl font-semibold text-emerald-100">
            {money(view.summary.estimatedMissingCost)}
          </div>
        </div>
      </section>

      <WishlistSearchAdd />

      <form className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 p-4">
        <label className="text-sm">
          Search/filter
          <input
            name="q"
            defaultValue={params.q || ""}
            className="mt-1 block border bg-zinc-900 p-2"
            placeholder="Card, type, or deck"
          />
        </label>
        <label className="text-sm">
          View
          <select
            name="tab"
            defaultValue={tab}
            className="mt-1 block border bg-zinc-900 p-2"
          >
            <option value="all">All</option>
            <option value="manual">Manual</option>
            <option value="decks">Needed for Decks</option>
            <option value="available">Available to Commit</option>
            <option value="missing">Missing from Inventory</option>
            <option value="stock">In Stock</option>
            <option value="out">Not in Stock</option>
          </select>
        </label>
        <label className="text-sm">
          Priority
          <input
            name="priority"
            defaultValue={priority}
            className="mt-1 block border bg-zinc-900 p-2"
            placeholder="High"
          />
        </label>
        <label className="text-sm">
          Rarity
          <input
            name="rarity"
            defaultValue={rarity}
            className="mt-1 block border bg-zinc-900 p-2"
            placeholder="rare"
          />
        </label>
        <label className="text-sm">
          Sort
          <select
            name="sort"
            defaultValue={sort}
            className="mt-1 block border bg-zinc-900 p-2"
          >
            <option value="need">Highest need</option>
            <option value="name">Name</option>
            <option value="missing">Missing quantity</option>
            <option value="available">Available quantity</option>
            <option value="price">Estimated cost</option>
          </select>
        </label>
        <button className="rounded border border-sky-700 px-3 py-2 text-sky-100">
          Apply
        </button>
      </form>

      <WishlistTable groups={groups} />
    </main>
  );
}
