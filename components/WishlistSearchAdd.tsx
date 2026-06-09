"use client";

import { useState, useTransition } from "react";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import { addManualWishlistItem } from "@/app/wishlist/actions";

export function WishlistSearchAdd() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<DeckCardSearchResponse | null>(null);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [message, setMessage] = useState(
    "Search owned printings and local cache first; include Scryfall when needed.",
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
        <label className="text-sm">
          Card search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 block min-w-72 border bg-zinc-900 p-2"
            placeholder="Lightning Bolt"
          />
        </label>
        <button
          type="button"
          onClick={() => search(false)}
          disabled={pending}
          className="rounded border border-sky-700 px-3 py-2 text-sky-100"
        >
          Search local
        </button>
        <button
          type="button"
          onClick={() => search(true)}
          disabled={pending}
          className="rounded border border-zinc-700 px-3 py-2"
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
          <label className="text-sm lg:col-span-2">
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
              className="mt-1 w-full border bg-zinc-900 p-2"
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
          <label className="text-sm">
            Quantity
            <input
              name="quantity"
              type="number"
              min="1"
              defaultValue="1"
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <label className="text-sm">
            Priority
            <input
              name="priority"
              placeholder="High"
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <label className="text-sm">
            Notes
            <input
              name="notes"
              placeholder="Promo, budget, etc."
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <div className="grid grid-cols-3 gap-2 lg:col-span-4">
            <input
              name="desiredFinish"
              placeholder="Finish"
              className="border bg-zinc-900 p-2 text-sm"
            />
            <input
              name="desiredCondition"
              placeholder="Condition"
              className="border bg-zinc-900 p-2 text-sm"
            />
            <input
              name="desiredLanguage"
              placeholder="Language"
              className="border bg-zinc-900 p-2 text-sm"
            />
          </div>
          <button
            disabled={!selected}
            className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
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
