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

function asNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function textIncludes(value: unknown, query: string) {
  return String(value || "")
    .toLowerCase()
    .includes(query);
}

function colorIdentityLabel(value: unknown) {
  if (Array.isArray(value)) return value.join("").toLowerCase();
  return String(value || "").toLowerCase();
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

function ownedStatusMatches(group: WishlistGroup, status: string) {
  if (!status) return true;
  if (status === "owned") return group.inventory.ownedTotal > 0;
  if (status === "not-owned") return group.inventory.ownedTotal === 0;
  if (status === "partially-available")
    return (
      group.inventory.available > 0 &&
      group.inventory.available < group.totalWanted
    );
  if (status === "fully-available")
    return group.inventory.available >= group.totalWanted;
  return true;
}

function sourceMatches(group: WishlistGroup, source: string) {
  if (!source) return true;
  return group.sourceLabel.toLowerCase() === source.toLowerCase();
}

function priorityMatches(group: WishlistGroup, priority: string) {
  if (!priority) return true;
  return group.sources.manual.some((item) =>
    textIncludes(item.priority, priority.toLowerCase()),
  );
}

function rangeMatches(
  value: number | null | undefined,
  min: string,
  max: string,
) {
  const numeric = value ?? null;
  if (numeric === null) return !min && !max;
  if (min && numeric < Number(min)) return false;
  if (max && numeric > Number(max)) return false;
  return true;
}

function sortGroups(groups: WishlistGroup[], sort: string) {
  return [...groups].sort((a, b) => {
    const missingA = Math.max(0, a.totalWanted - a.inventory.ownedTotal);
    const missingB = Math.max(0, b.totalWanted - b.inventory.ownedTotal);
    switch (sort) {
      case "name":
        return a.card.name.localeCompare(b.card.name);
      case "manual":
        return b.manualQuantity - a.manualQuantity;
      case "deck":
        return b.deckQuantity - a.deckQuantity;
      case "owned":
        return b.inventory.ownedTotal - a.inventory.ownedTotal;
      case "available":
        return b.inventory.available - a.inventory.available;
      case "missing":
        return missingB - missingA;
      case "price":
        return (b.estimatedMissingCost ?? -1) - (a.estimatedMissingCost ?? -1);
      case "priority":
        return (a.sources.manual[0]?.priority || "zzz").localeCompare(
          b.sources.manual[0]?.priority || "zzz",
        );
      case "source":
        return a.sourceLabel.localeCompare(b.sourceLabel);
      case "deckName":
        return (a.sources.decks[0]?.deckName || "").localeCompare(
          b.sources.decks[0]?.deckName || "",
        );
      case "rarity":
        return a.card.rarity.localeCompare(b.card.rarity);
      case "set":
        return a.card.setCode.localeCompare(b.card.setCode);
      case "mana":
        return (a.card.manaValue ?? 0) - (b.card.manaValue ?? 0);
      case "need":
      default:
        return (
          b.totalWanted - a.totalWanted ||
          a.card.name.localeCompare(b.card.name)
        );
    }
  });
}

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const tab = params.tab || "all";
  const q = (params.q || "").trim().toLowerCase();
  const source = params.source || "";
  const deck = (params.deck || "").trim().toLowerCase();
  const priority = (params.priority || "").trim().toLowerCase();
  const set = (params.set || "").trim().toLowerCase();
  const rarity = (params.rarity || "").trim().toLowerCase();
  const color = (params.color || "").trim().toLowerCase();
  const type = (params.type || "").trim().toLowerCase();
  const finish = (params.finish || "").trim().toLowerCase();
  const ownedStatus = params.ownedStatus || "";
  const sort = params.sort || "need";
  const viewMode = params.viewMode === "binder" ? "binder" : "table";
  const pageSize = Math.min(100, asNumber(params.pageSize, 25));
  const page = Math.max(1, asNumber(params.page, 1));
  const view = await getWishlistView(prisma, user.id, user.playerId);

  let groups = view.groups.filter((group) => matchesTab(group, tab));
  if (q) {
    groups = groups.filter(
      (group) =>
        textIncludes(group.card.name, q) ||
        textIncludes(group.card.typeLine, q) ||
        textIncludes(group.card.oracleText, q) ||
        textIncludes(group.card.setCode, q) ||
        textIncludes(group.card.setName, q) ||
        group.sources.decks.some((need) => textIncludes(need.deckName, q)) ||
        group.sources.manual.some((item) => textIncludes(item.notes, q)),
    );
  }
  groups = groups.filter(
    (group) =>
      sourceMatches(group, source) &&
      (!deck ||
        group.sources.decks.some((need) =>
          textIncludes(need.deckName, deck),
        )) &&
      (!params.missingOnly || group.totalWanted > group.inventory.ownedTotal) &&
      (!params.availableToCommit ||
        group.sources.decks.some(
          (need) => need.availableUncommittedCopyExists,
        )) &&
      ownedStatusMatches(group, ownedStatus) &&
      priorityMatches(group, priority) &&
      (!set ||
        textIncludes(group.card.setCode, set) ||
        textIncludes(group.card.setName, set)) &&
      (!rarity || textIncludes(group.card.rarity, rarity)) &&
      (!color ||
        colorIdentityLabel(group.card.colorIdentity).includes(color)) &&
      (!type || textIncludes(group.card.typeLine, type)) &&
      (!finish ||
        group.sources.manual.some((item) =>
          textIncludes(item.desiredFinish, finish),
        )) &&
      rangeMatches(
        group.card.manaValue ?? null,
        params.manaMin || "",
        params.manaMax || "",
      ) &&
      rangeMatches(
        group.estimatedPrice,
        params.priceMin || "",
        params.priceMax || "",
      ),
  );
  groups = sortGroups(groups, sort);
  const totalRows = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageGroups = groups.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  return (
    <main className="space-y-6 p-8">
      <Nav />
      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Wishlist</h1>
        <p className="text-zinc-400">
          Manual wants plus deck-derived needs in an inventory-style browser.
          Deck cards are satisfied only by copies committed to that deck’s
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

      <form className="space-y-3 rounded border border-zinc-800 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Search
            <input
              name="q"
              defaultValue={params.q || ""}
              className="mt-1 block border bg-zinc-900 p-2"
              placeholder="Card, text, set, deck, notes"
            />
          </label>
          <label className="text-sm">
            View
            <input type="hidden" name="viewMode" value={viewMode} />
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
            Sort
            <select
              name="sort"
              defaultValue={sort}
              className="mt-1 block border bg-zinc-900 p-2"
            >
              <option value="need">Wanted quantity</option>
              <option value="name">Card name</option>
              <option value="manual">Manual quantity</option>
              <option value="deck">Deck-needed quantity</option>
              <option value="owned">Owned total</option>
              <option value="available">Available quantity</option>
              <option value="missing">Missing quantity</option>
              <option value="price">Price</option>
              <option value="priority">Priority</option>
              <option value="source">Source</option>
              <option value="deckName">Deck name</option>
              <option value="rarity">Rarity</option>
              <option value="set">Set</option>
              <option value="mana">Mana value</option>
            </select>
          </label>
          <label className="text-sm">
            Page size
            <select
              name="pageSize"
              defaultValue={pageSize}
              className="mt-1 block border bg-zinc-900 p-2"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <input type="hidden" name="page" value="1" />
          <button className="rounded border border-sky-700 px-3 py-2 text-sky-100">
            Apply
          </button>
          <a
            href="/wishlist"
            className="rounded border border-zinc-700 px-3 py-2 text-sm"
          >
            Clear Filters
          </a>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-zinc-300">
            Advanced Filters
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="text-sm">
              Source
              <select
                name="source"
                defaultValue={source}
                className="mt-1 w-full border bg-zinc-900 p-2"
              >
                <option value="">Any</option>
                <option value="manual">Manual</option>
                <option value="deck">Deck</option>
                <option value="manual + deck">Manual + Deck</option>
              </select>
            </label>
            <label className="text-sm">
              Deck
              <input
                name="deck"
                defaultValue={params.deck || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Owned status
              <select
                name="ownedStatus"
                defaultValue={ownedStatus}
                className="mt-1 w-full border bg-zinc-900 p-2"
              >
                <option value="">Any</option>
                <option value="owned">Owned</option>
                <option value="not-owned">Not owned</option>
                <option value="partially-available">Partially available</option>
                <option value="fully-available">Fully available</option>
              </select>
            </label>
            <label className="text-sm">
              Priority
              <input
                name="priority"
                defaultValue={params.priority || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Set
              <input
                name="set"
                defaultValue={params.set || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Rarity
              <input
                name="rarity"
                defaultValue={params.rarity || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Color identity
              <input
                name="color"
                defaultValue={params.color || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Type line
              <input
                name="type"
                defaultValue={params.type || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Finish
              <input
                name="finish"
                defaultValue={params.finish || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Mana min
              <input
                name="manaMin"
                defaultValue={params.manaMin || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Mana max
              <input
                name="manaMax"
                defaultValue={params.manaMax || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Price min
              <input
                name="priceMin"
                defaultValue={params.priceMin || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="text-sm">
              Price max
              <input
                name="priceMax"
                defaultValue={params.priceMax || ""}
                className="mt-1 w-full border bg-zinc-900 p-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="missingOnly"
                value="1"
                defaultChecked={params.missingOnly === "1"}
              />{" "}
              Missing only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="availableToCommit"
                value="1"
                defaultChecked={params.availableToCommit === "1"}
              />{" "}
              Available to commit
            </label>
          </div>
        </details>
      </form>

      <WishlistTable
        groups={pageGroups}
        totalRows={totalRows}
        page={safePage}
        pageSize={pageSize}
        viewMode={viewMode}
        query={params}
      />
    </main>
  );
}
