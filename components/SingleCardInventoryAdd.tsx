"use client";

import { useMemo, useState } from "react";
import { FoilStatus } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { ManaCost } from "@/components/mtg/ManaCost";
import { addSingleCardToInventory } from "@/app/imports/actions";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";

export type ManualAddLocation = { id: string; name: string };

export function SingleCardInventoryAdd({
  locations,
  defaultLocationId,
  added,
  embedded = false,
}: {
  locations: ManualAddLocation[];
  defaultLocationId?: string;
  added?: boolean;
  embedded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [includeScryfall, setIncludeScryfall] = useState(false);
  const [response, setResponse] = useState<DeckCardSearchResponse | null>(null);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [status, setStatus] = useState(
    "Search local cached and owned printings first. Use the checkbox to include Scryfall fallback.",
  );
  const [loading, setLoading] = useState(false);

  async function search() {
    const clean = query.trim();
    if (clean.length < 2) {
      setStatus("Enter at least 2 characters.");
      return;
    }
    setLoading(true);
    setStatus("Searching printings…");
    setSelected(null);
    try {
      const params = new URLSearchParams({ q: clean });
      if (includeScryfall) params.set("scryfall", "1");
      const res = await fetch(`/api/decks/card-search?${params.toString()}`);
      if (!res.ok) throw new Error("Card search failed.");
      const json = (await res.json()) as DeckCardSearchResponse;
      setResponse(json);
      setStatus(json.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Card search failed.");
    } finally {
      setLoading(false);
    }
  }

  const selectedLabel = useMemo(
    () =>
      selected
        ? `${selected.name} — ${selected.setCode.toUpperCase()} #${selected.collectorNumber}`
        : "No printing selected",
    [selected],
  );
  const results = response?.results ?? [];

  return (
    <section
      className={cn(
        "space-y-3",
        !embedded && "rounded border border-sky-900 bg-sky-950/10 p-4",
      )}
    >
      {!embedded || added ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!embedded ? (
            <h2 className="text-xl font-semibold">Add single card</h2>
          ) : null}
          {added ? (
            <span className="rounded border border-emerald-700 px-2 py-1 text-sm text-emerald-100">
              Card added to inventory.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label className={filterFieldClass}>
          Search by card name or printing
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Sol Ring"
          />
        </label>
        <button
          type="button"
          onClick={search}
          disabled={loading}
          className={cn(filterPrimaryButtonClass, "self-end")}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={includeScryfall}
          onChange={(event) => setIncludeScryfall(event.target.checked)}
        />
        Include Scryfall fallback for this search
      </label>
      <p className="text-sm text-zinc-400" aria-live="polite">
        {status}
      </p>
      <div className="max-h-80 space-y-2 overflow-auto">
        {results.map((result) => (
          <button
            key={result.cardId}
            type="button"
            onClick={() => setSelected(result)}
            className={`grid w-full gap-3 rounded border p-2 text-left md:grid-cols-[56px_1fr] ${selected?.cardId === result.cardId ? "border-sky-500 bg-sky-950/30" : "border-zinc-800 bg-zinc-950"}`}
          >
            {result.imageUri ? (
              <img
                src={result.imageUri}
                alt=""
                className="h-20 w-14 rounded object-cover"
              />
            ) : (
              <span className="h-20 w-14 rounded bg-zinc-800" />
            )}
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{result.name}</strong>
                <ManaCost value={result.manaCost} />
                <SetSymbol
                  setCode={result.setCode}
                  setName={result.setName}
                  rarity={result.rarity}
                />
              </span>
              <span className="block text-xs text-zinc-300">
                {result.typeLine}
              </span>
              <span className="block text-xs text-zinc-400">
                {result.setName} · {result.setCode.toUpperCase()} #
                {result.collectorNumber} · {result.rarity} · {result.priceLabel}{" "}
                · {result.finishes.join(", ") || "finish unknown"}
              </span>
            </span>
          </button>
        ))}
      </div>
      <form
        action={addSingleCardToInventory}
        className="grid gap-3 rounded border border-zinc-800 p-3 md:grid-cols-3"
      >
        <input type="hidden" name="cardId" value={selected?.cardId ?? ""} />
        <p className="text-sm text-zinc-300 md:col-span-3">
          Selected: <span className="text-sky-100">{selectedLabel}</span>
        </p>
        <label className={filterFieldClass}>
          Quantity
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={filterFieldClass}>
          Finish
          <select
            name="foilStatus"
            defaultValue={FoilStatus.NONFOIL}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value={FoilStatus.NONFOIL}>Nonfoil</option>
            <option value={FoilStatus.FOIL}>Foil</option>
            <option value={FoilStatus.ETCHED}>Etched</option>
          </select>
        </label>
        <label className={filterFieldClass}>
          Condition
          <input
            name="condition"
            defaultValue="NM"
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={filterFieldClass}>
          Language
          <input
            name="language"
            defaultValue="EN"
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={cn(filterFieldClass, "md:col-span-2")}>
          Destination location
          <select
            name="locationId"
            required
            defaultValue={defaultLocationId ?? ""}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">Choose a normal location…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className={cn(filterFieldClass, "md:col-span-3")}>
          Notes
          <textarea
            name="notes"
            rows={2}
            className={cn(filterTextareaClass, "mt-1 w-full")}
          />
        </label>
        <SubmitButton
          pendingLabel="Adding…"
          disabled={!selected || locations.length === 0}
          className={cn(filterPrimaryButtonClass, "md:col-span-3")}
        >
          Add selected printing to inventory
        </SubmitButton>
      </form>
    </section>
  );
}
