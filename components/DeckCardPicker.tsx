"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeckSection, FoilStatus } from "@prisma/client";
import { ManaCost } from "@/components/mtg/ManaCost";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { deckSectionLabel } from "@/lib/decks";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterSelectClass,
} from "@/components/filterStyles";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import { addDeckCard } from "@/app/decks/actions";

export function DeckCardPicker({
  deckId,
  defaultSection,
  sections,
  locations,
}: {
  deckId: string;
  defaultSection: DeckSection;
  sections: DeckSection[];
  locations: Array<{ id: string; name: string }>;
}) {
  const [query, setQuery] = useState("");
  const [includeScryfall, setIncludeScryfall] = useState(false);
  const [response, setResponse] = useState<DeckCardSearchResponse | null>(null);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [commitImmediately, setCommitImmediately] = useState(false);
  const [addInventoryCopy, setAddInventoryCopy] = useState(false);
  const [commitNewInventoryCopy, setCommitNewInventoryCopy] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const id = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (includeScryfall) params.set("scryfall", "1");
        const res = await fetch(`/api/decks/card-search?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed.");
        const json = (await res.json()) as DeckCardSearchResponse;
        if (requestId.current === id) setResponse(json);
      } catch (e) {
        if (requestId.current === id)
          setError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [query, includeScryfall]);

  const results = response?.results ?? [];
  const selectedAvailableLocations = selected?.availableLocations ?? [];

  const selectedLabel = useMemo(
    () =>
      selected
        ? `${selected.name} — ${selected.setCode.toUpperCase()} #${selected.collectorNumber}`
        : "No printing selected",
    [selected],
  );

  return (
    <section className="space-y-2 rounded border border-zinc-800 p-3">
      <h2 className="text-lg font-semibold">Add card</h2>
      <label className={cn(filterFieldClass, "block")}>
        Search for a card or printing
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setSelected(null);
            setCommitImmediately(false);
            setResponse(null);
            setError("");
            setLoading(next.trim().length >= 2);
          }}
          placeholder="Search any Magic card"
          className={cn(filterInputClass, "mt-1 w-full")}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={includeScryfall}
          onChange={(event) => {
            setIncludeScryfall(event.target.checked);
            setSelected(null);
            setCommitImmediately(false);
            setResponse(null);
            setError("");
            setLoading(query.trim().length >= 2);
          }}
        />
        Broaden with Scryfall results
      </label>
      <div className="text-sm text-zinc-400" aria-live="polite">
        {loading ? "Searching local cache and Scryfall…" : response?.message}
        {error ? <span className="text-red-300">{error}</span> : null}
      </div>
      {query.trim().length >= 2 && !loading && results.length === 0 ? (
        <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-400">
          No printings found.
        </p>
      ) : null}
      <div className="max-h-80 space-y-1.5 overflow-auto">
        {results.map((result) => (
          <button
            type="button"
            key={result.cardId}
            onClick={() => {
              setSelected(result);
              setCommitImmediately(false);
            }}
            className={`grid w-full gap-2 rounded border p-1.5 text-left md:grid-cols-[52px_1fr] ${selected?.cardId === result.cardId ? "border-sky-500 bg-sky-950/30" : result.ownedExactQuantity > 0 ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950"}`}
          >
            {result.imageUri ? (
              <img
                src={result.imageUri}
                alt=""
                className="h-16 w-11 rounded object-cover"
              />
            ) : (
              <div className="h-16 w-11 rounded bg-zinc-800" />
            )}
            <span className="space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="text-sky-100">{result.name}</strong>
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
                {result.setName} · #{result.collectorNumber} · {result.rarity} ·{" "}
                {result.priceLabel} ·{" "}
                {result.finishes.join(", ") || "finish unknown"}
              </span>
              <span className="flex flex-wrap gap-1 text-xs">
                {result.badges.map((badge) => (
                  <span key={badge} className="rounded bg-zinc-800 px-2 py-0.5">
                    {badge}
                  </span>
                ))}
                {result.ownedOtherPrintingQuantity ? (
                  <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-100">
                    Other printings owned: {result.ownedOtherPrintingQuantity}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>
      <form
        action={addDeckCard}
        className="grid gap-2 rounded border border-zinc-800 p-2 md:grid-cols-3"
      >
        <input type="hidden" name="deckId" value={deckId} />
        <input type="hidden" name="cardId" value={selected?.cardId ?? ""} />
        <p className="text-sm text-zinc-300 md:col-span-3">
          Selected: <span className="text-sky-100">{selectedLabel}</span>
        </p>
        <label className={filterFieldClass}>
          Section
          <select
            name="section"
            defaultValue={defaultSection}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            {sections.map((section) => (
              <option key={section} value={section}>
                {deckSectionLabel(section)}
              </option>
            ))}
          </select>
        </label>
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

        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-sm md:col-span-3">
          <label className="flex items-start gap-2 text-zinc-200">
            <input
              type="checkbox"
              name="commitImmediately"
              checked={commitImmediately}
              disabled={!selected || selectedAvailableLocations.length === 0}
              onChange={(event) => {
                setCommitImmediately(event.target.checked);
                if (event.target.checked) setAddInventoryCopy(false);
              }}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">
                Commit matched print immediately
              </span>
              <span className="block text-xs text-zinc-400">
                Move the selected owned copy into this deck as soon as it is
                added.
              </span>
            </span>
          </label>
          {selected && selectedAvailableLocations.length === 0 ? (
            <p className="text-xs text-amber-200">
              No matching uncommitted inventory copy is available for this exact
              printing.
            </p>
          ) : null}
          {selectedAvailableLocations.length > 0 ? (
            <label className={cn(filterFieldClass, "block")}>
              Pull from inventory location
              <select
                name="inventoryItemId"
                disabled={!commitImmediately}
                required={commitImmediately}
                className={cn(filterSelectClass, "mt-1 w-full")}
              >
                {selectedAvailableLocations.map((location) => (
                  <option
                    key={location.inventoryItemId}
                    value={location.inventoryItemId}
                  >
                    {location.locationName} · {location.quantity} available
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="space-y-2 rounded border border-sky-900 bg-sky-950/10 p-2 text-sm md:col-span-3">
          <label className="flex items-start gap-2 text-zinc-200">
            <input
              type="checkbox"
              name="addInventoryCopy"
              checked={addInventoryCopy}
              disabled={!selected || locations.length === 0}
              onChange={(event) => {
                setAddInventoryCopy(event.target.checked);
                if (event.target.checked) setCommitImmediately(false);
              }}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">
                Also add a physical copy to inventory
              </span>
              <span className="block text-xs text-zinc-400">
                Record newly acquired copies of the selected printing while
                adding it to the deck list.
              </span>
            </span>
          </label>
          {!locations.length ? (
            <p className="text-xs text-amber-200">
              Create a normal inventory location before adding physical copies.
            </p>
          ) : null}
          {addInventoryCopy ? (
            <div className="grid gap-2 md:grid-cols-4">
              <label className={filterFieldClass}>
                Physical quantity
                <input
                  name="inventoryQuantity"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className={cn(filterInputClass, "mt-1 w-full")}
                />
              </label>
              <label className={filterFieldClass}>
                Finish
                <select
                  name="inventoryFoilStatus"
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
                  name="inventoryCondition"
                  defaultValue="NM"
                  className={cn(filterInputClass, "mt-1 w-full")}
                />
              </label>
              <label className={filterFieldClass}>
                Language
                <input
                  name="inventoryLanguage"
                  defaultValue="EN"
                  className={cn(filterInputClass, "mt-1 w-full")}
                />
              </label>
              <label className={cn(filterFieldClass, "md:col-span-2")}>
                Normal inventory location
                <select
                  name="inventoryLocationId"
                  required
                  defaultValue={locations[0]?.id ?? ""}
                  className={cn(filterSelectClass, "mt-1 w-full")}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm text-zinc-300 md:col-span-2">
                <input
                  name="commitNewInventoryCopy"
                  type="checkbox"
                  checked={commitNewInventoryCopy}
                  onChange={(event) =>
                    setCommitNewInventoryCopy(event.target.checked)
                  }
                />
                Commit the new copy to this deck immediately
              </label>
            </div>
          ) : null}
        </div>
        <label className={filterFieldClass}>
          Notes
          <input name="notes" className={cn(filterInputClass, "mt-1 w-full")} />
        </label>
        <SubmitButton
          pendingLabel="Adding…"
          disabled={!selected}
          className="rounded border border-sky-700 px-3 py-2 text-sky-100 md:col-span-3"
        >
          Add selected printing
        </SubmitButton>
      </form>
    </section>
  );
}
