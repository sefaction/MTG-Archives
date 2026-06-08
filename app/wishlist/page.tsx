export const dynamic = "force-dynamic";

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { WishlistSearchAdd } from "@/components/WishlistSearchAdd";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { CardManaCost } from "@/components/mtg/CardManaCost";
import { requireLogin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWishlistView, type WishlistGroup } from "@/lib/wishlist";
import { commitDeckCardToDeck } from "@/app/decks/actions";
import {
  removeManualWishlistItem,
  switchWishlistDeckCardToCheapestPrinting,
  switchWishlistDeckCardToOwnedPrinting,
  updateManualWishlistItem,
} from "./actions";

function money(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function matchesTab(group: WishlistGroup, tab: string) {
  if (tab === "manual") return group.manualQuantity > 0;
  if (tab === "decks") return group.deckQuantity > 0;
  if (tab === "available")
    return group.sources.decks.some((d) => d.availableUncommittedCopyExists);
  if (tab === "missing") return group.totalWanted > group.inventory.ownedTotal;
  return true;
}

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; sort?: string }>;
}) {
  const user = await requireLogin();
  const params = await searchParams;
  const tab = params.tab || "all";
  const q = (params.q || "").trim().toLowerCase();
  const sort = params.sort || "need";
  const view = await getWishlistView(prisma, user.id, user.playerId);
  let groups = view.groups.filter((group) => matchesTab(group, tab));
  if (q)
    groups = groups.filter(
      (group) =>
        group.card.name.toLowerCase().includes(q) ||
        group.card.typeLine.toLowerCase().includes(q),
    );
  if (sort === "name")
    groups = [...groups].sort((a, b) => a.card.name.localeCompare(b.card.name));
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
          Manual wants plus deck-derived needs. Deck cards are satisfied only by
          copies committed to that deck’s system-managed location.
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
            placeholder="Card name or type"
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
          </select>
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
            <option value="price">Estimated cost</option>
          </select>
        </label>
        <button className="rounded border border-sky-700 px-3 py-2 text-sky-100">
          Apply
        </button>
      </form>

      <section className="space-y-4">
        {groups.length === 0 ? (
          <p className="rounded border border-zinc-800 p-6 text-zinc-400">
            No wishlist needs match this view.
          </p>
        ) : null}
        {groups.map((group) => (
          <article
            key={group.key}
            className="rounded border border-zinc-800 bg-zinc-950 p-4"
          >
            <div className="grid gap-4 lg:grid-cols-[96px_1fr]">
              {group.card.imageUri ? (
                <img
                  src={group.card.imageUri}
                  alt=""
                  className="w-24 rounded"
                />
              ) : (
                <div className="h-32 w-24 rounded bg-zinc-900" />
              )}
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-sky-100">
                      {group.card.name}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-zinc-300">
                      <CardManaCost card={group.card} />
                      <span>{group.card.typeLine}</span>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {group.card.setCode.toUpperCase()} #
                      {group.card.collectorNumber} · {group.card.rarity}
                    </p>
                  </div>
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-sm">
                    {group.sourceLabel}
                  </span>
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-4 lg:grid-cols-7">
                  <Metric label="Wanted" value={group.totalWanted} />
                  <Metric label="Manual" value={group.manualQuantity} />
                  <Metric label="Decks" value={group.deckQuantity} />
                  <Metric
                    label="Owned total"
                    value={group.inventory.ownedTotal}
                  />
                  <Metric label="Available" value={group.inventory.available} />
                  <Metric
                    label="Committed"
                    value={group.inventory.committedToDecks}
                  />
                  <Metric label="Price" value={money(group.estimatedPrice)} />
                </div>
                {group.sources.manual.length ? (
                  <div className="space-y-2 rounded border border-zinc-800 p-3">
                    <h3 className="font-medium">Manual wishlist</h3>
                    {group.sources.manual.map((item) => (
                      <form
                        key={item.id}
                        action={updateManualWishlistItem}
                        className="grid gap-2 md:grid-cols-[80px_140px_1fr_1fr_auto]"
                      >
                        <input
                          type="hidden"
                          name="wishlistItemId"
                          value={item.id}
                        />
                        <input
                          name="quantity"
                          type="number"
                          min="1"
                          defaultValue={item.quantity}
                          className="border bg-zinc-900 p-2"
                        />
                        <input
                          name="priority"
                          placeholder="Priority"
                          defaultValue={item.priority || ""}
                          className="border bg-zinc-900 p-2"
                        />
                        <input
                          name="notes"
                          placeholder="Notes"
                          defaultValue={item.notes || ""}
                          className="border bg-zinc-900 p-2"
                        />
                        <input
                          name="desiredFinish"
                          placeholder="Finish"
                          defaultValue={item.desiredFinish || ""}
                          className="border bg-zinc-900 p-2"
                        />
                        <div className="flex gap-2">
                          <SubmitButton
                            pendingLabel="Saving…"
                            className="rounded border px-3 py-2"
                          >
                            Save
                          </SubmitButton>
                          <SubmitButton
                            formAction={removeManualWishlistItem}
                            pendingLabel="Removing…"
                            className="rounded border border-red-800 px-3 py-2 text-red-200"
                          >
                            Remove
                          </SubmitButton>
                        </div>
                      </form>
                    ))}
                  </div>
                ) : null}
                {group.sources.decks.length ? (
                  <div className="space-y-2 rounded border border-zinc-800 p-3">
                    <h3 className="font-medium">Needed for decks</h3>
                    {group.sources.decks.map((need) => (
                      <div
                        key={need.deckCardId}
                        className="grid gap-2 border-t border-zinc-800 pt-2 text-sm md:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <Link
                            href={`/decks/${need.deckId}`}
                            className="text-sky-200"
                          >
                            {need.deckName}
                          </Link>
                          <span className="text-zinc-400">
                            {" "}
                            · {need.section.toLowerCase()} · needed{" "}
                            {need.requiredQuantity}, committed{" "}
                            {need.committedQuantity}, missing{" "}
                            {need.missingQuantity}
                          </span>
                          <div className="text-zinc-500">
                            Selected:{" "}
                            {need.selectedPrinting?.setCode.toUpperCase()} #
                            {need.selectedPrinting?.collectorNumber} ·{" "}
                            {need.availableUncommittedCopyExists
                              ? `available to commit (${need.availableExact} exact, ${need.availableOther} other)`
                              : "missing from available inventory"}
                          </div>
                          {need.anotherOwnedPrintingAvailable ? (
                            <div className="text-amber-200">
                              Another owned printing is available.
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {need.commitOptions.slice(0, 2).map((option) => (
                            <form
                              key={option.inventoryItemId}
                              action={commitDeckCardToDeck}
                            >
                              <input
                                type="hidden"
                                name="deckId"
                                value={need.deckId}
                              />
                              <input
                                type="hidden"
                                name="deckCardId"
                                value={need.deckCardId}
                              />
                              <input
                                type="hidden"
                                name="inventoryItemId"
                                value={option.inventoryItemId}
                              />
                              <input
                                type="hidden"
                                name="quantity"
                                value={Math.min(
                                  option.quantity,
                                  need.missingQuantity,
                                )}
                              />
                              <SubmitButton
                                pendingLabel="Committing…"
                                className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
                              >
                                Commit{" "}
                                {Math.min(
                                  option.quantity,
                                  need.missingQuantity,
                                )}{" "}
                                from {option.locationName}
                              </SubmitButton>
                            </form>
                          ))}
                          <form action={switchWishlistDeckCardToOwnedPrinting}>
                            <input
                              type="hidden"
                              name="deckId"
                              value={need.deckId}
                            />
                            <input
                              type="hidden"
                              name="deckCardId"
                              value={need.deckCardId}
                            />
                            <SubmitButton
                              pendingLabel="Switching…"
                              className="rounded border border-sky-700 px-3 py-2 text-sky-100"
                            >
                              Use owned printing
                            </SubmitButton>
                          </form>
                          <form
                            action={switchWishlistDeckCardToCheapestPrinting}
                          >
                            <input
                              type="hidden"
                              name="deckId"
                              value={need.deckId}
                            />
                            <input
                              type="hidden"
                              name="deckCardId"
                              value={need.deckCardId}
                            />
                            <SubmitButton
                              pendingLabel="Switching…"
                              className="rounded border border-violet-700 px-3 py-2 text-violet-100"
                            >
                              Use cheapest printing
                            </SubmitButton>
                          </form>
                          <Link
                            href={`/decks/${need.deckId}`}
                            className="rounded border border-zinc-700 px-3 py-2"
                          >
                            View deck
                          </Link>
                          <Link
                            href={`/inventory?q=${encodeURIComponent(group.card.name)}`}
                            className="rounded border border-zinc-700 px-3 py-2"
                          >
                            View inventory
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-zinc-900 p-2">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-100">{value}</div>
    </div>
  );
}
