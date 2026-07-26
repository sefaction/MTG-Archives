"use client";

import { useState, useTransition } from "react";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import { addManualWishlistItem } from "@/app/wishlist/actions";
import {
  cn,
  filterButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";

export function WishlistSearchAdd() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<DeckCardSearchResponse | null>(null);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [message, setMessage] = useState(
    "Search owned/local printings or use Scryfall syntax such as command tower set:c20.",
  );
  const [pending, startTransition] = useTransition();

  function search(includeScryfall = false) {
    const clean = query.trim();
    if (clean.length < 2) {
      setMessage("Enter at least two characters.");
      return;
    }
    startTransition(async () => {
      setMessage(
        includeScryfall
          ? "Searching local cache and server Scryfall fallback…"
          : "Searching owned printings and local cache…",
      );
      const res = await fetch(
        `/api/decks/card-search?q=${encodeURIComponent(clean)}${includeScryfall ? "&scryfall=1" : ""}`,
      );
      const json = (await res.json()) as DeckCardSearchResponse;
      setResponse(json);
      setMessage(json.message);
      setSelected(json.results[0] ?? null);
    });
  }

  return (
    <section className="space-y-3 rounded border border-zinc-800 p-4">
      <h2 className="text-xl font-semibold">Add a manual wishlist card</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className={filterFieldClass}>
          Card search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={cn(filterInputClass, "mt-1 block min-w-72")}
            placeholder="Card name or Scryfall query, e.g. command tower set:c20"
          />
        </label>
        <button
          type="button"
          onClick={() => search(false)}
          disabled={pending}
          className={filterPrimaryButtonClass}
        >
          Search local
        </button>
        <button
          type="button"
          onClick={() => search(true)}
          disabled={pending}
          className={filterButtonClass}
        >
          Search Scryfall
        </button>
        <p className="text-sm text-zinc-400">
          {pending ? "Searching…" : message}
        </p>
      </div>
      {response?.results.length ? (
        <form
          action={addManualWishlistItem}
          className="grid gap-3 rounded border border-zinc-800 bg-zinc-950 p-3 lg:grid-cols-[1fr_96px_120px_1fr_auto]"
        >
          <label className={cn(filterFieldClass, "lg:col-span-2")}>
            Selected printing
            <select
              value={selected?.cardId || ""}
              onChange={(event) =>
                setSelected(
                  response.results.find(
                    (result) => result.cardId === event.target.value,
                  ) ?? null,
                )
              }
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {response.results.map((result) => (
                <option key={result.cardId} value={result.cardId}>
                  {result.name} — {result.setCode.toUpperCase()} #
                  {result.collectorNumber} · owned {result.ownedExactQuantity}{" "}
                  (+{result.ownedOtherPrintingQuantity} other) ·{" "}
                  {result.priceLabel}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="cardId" value={selected?.cardId || ""} />
          <input
            type="hidden"
            name="scryfallId"
            value={selected?.scryfallId || ""}
          />
          <input
            type="hidden"
            name="cardName"
            value={selected?.name || query}
          />
          <label className={filterFieldClass}>
            Quantity
            <input
              name="quantity"
              type="number"
              min="1"
              defaultValue="1"
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <label className={filterFieldClass}>
            Priority
            <input
              name="priority"
              placeholder="High"
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <label className={filterFieldClass}>
            Notes
            <input
              name="notes"
              placeholder="Promo, budget, etc."
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <div className="grid grid-cols-3 gap-2 lg:col-span-4">
            <input
              name="desiredFinish"
              placeholder="Finish"
              className={filterInputClass}
            />
            <input
              name="desiredCondition"
              placeholder="Condition"
              className={filterInputClass}
            />
            <input
              name="desiredLanguage"
              placeholder="Language"
              className={filterInputClass}
            />
          </div>
          <button
            disabled={!selected}
            className={cn(
              filterPrimaryButtonClass,
              "border-emerald-700 text-emerald-100 hover:bg-emerald-950/40",
            )}
          >
            Add wishlist
          </button>
          {selected ? (
            <div className="text-xs text-zinc-400 lg:col-span-5">
              {selected.setName} · {selected.rarity} · finishes:{" "}
              {selected.finishes.join(", ") || "unknown"} · locations:{" "}
              {selected.locationSummary || "not owned"}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
