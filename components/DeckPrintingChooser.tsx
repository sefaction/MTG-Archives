"use client";

import { useMemo, useRef, useState } from "react";
import { ManaCost } from "@/components/mtg/ManaCost";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import {
  cn,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "@/components/filterStyles";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import {
  filterExactCardPrintings,
  getPrintingSetOptions,
} from "@/lib/deck-printing-options";

export function DeckPrintingChooser({
  cardName,
  selectedCardId,
  onSelect,
  showOwnership = false,
}: {
  cardName: string;
  selectedCardId?: string | null;
  onSelect: (result: DeckCardSearchResult | null) => void;
  showOwnership?: boolean;
}) {
  const [results, setResults] = useState<DeckCardSearchResult[]>([]);
  const [selectedSet, setSelectedSet] = useState("");
  const [status, setStatus] = useState(
    `Find available printings of ${cardName}.`,
  );
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const setOptions = useMemo(
    () => getPrintingSetOptions(results, cardName),
    [cardName, results],
  );
  const visibleResults = useMemo(
    () => filterExactCardPrintings(results, cardName, selectedSet),
    [cardName, results, selectedSet],
  );

  async function search() {
    const id = ++requestId.current;
    setLoading(true);
    setSelectedSet("");
    onSelect(null);
    setStatus(`Finding printings of ${cardName}…`);
    try {
      const params = new URLSearchParams({
        q: cardName,
        scryfall: "1",
        limit: "175",
      });
      const response = await fetch(
        `/api/decks/card-search?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Printing search failed.");
      const json = (await response.json()) as DeckCardSearchResponse;
      if (requestId.current !== id) return;
      const exactResults = filterExactCardPrintings(json.results, cardName);
      setResults(exactResults);
      setStatus(
        exactResults.length
          ? `${exactResults.length} ${exactResults.length === 1 ? "printing" : "printings"} found.`
          : `No printings of ${cardName} were found.`,
      );
    } catch (error) {
      if (requestId.current !== id) return;
      setResults([]);
      setStatus(
        error instanceof Error ? error.message : "Printing search failed.",
      );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }

  function changeSet(nextSet: string) {
    setSelectedSet(nextSet);
    if (
      selectedCardId &&
      !filterExactCardPrintings(results, cardName, nextSet).some(
        (result) => result.cardId === selectedCardId,
      )
    ) {
      onSelect(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-zinc-300">
          Printings for <strong className="text-zinc-100">{cardName}</strong>
        </p>
        <button
          type="button"
          onClick={search}
          disabled={loading}
          className={cn(filterPrimaryButtonClass, "shrink-0")}
        >
          {loading ? "Finding printings…" : "Find printings"}
        </button>
      </div>
      <p className="text-xs text-zinc-400" aria-live="polite">
        {status}
      </p>
      {results.length ? (
        <label className="block text-xs font-medium text-zinc-200">
          Filter by set
          <select
            value={selectedSet}
            onChange={(event) => changeSet(event.target.value)}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">All sets ({setOptions.length})</option>
            {setOptions.map((set) => (
              <option key={set.code} value={set.code}>
                {set.name} ({set.code.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="max-h-56 space-y-2 overflow-auto">
        {visibleResults.map((result) => (
          <button
            key={result.cardId}
            type="button"
            onClick={() => onSelect(result)}
            className={`w-full rounded border p-2 text-left text-sm ${
              selectedCardId === result.cardId
                ? "border-sky-500 bg-sky-950/30"
                : showOwnership && result.ownedExactQuantity > 0
                  ? "border-emerald-800 bg-emerald-950/20"
                  : "border-zinc-800"
            }`}
          >
            <span className="flex flex-wrap items-center gap-2">
              <strong>{result.name}</strong>
              <ManaCost value={result.manaCost} />
              <SetSymbol
                setCode={result.setCode}
                setName={result.setName}
                rarity={result.rarity}
              />
            </span>
            <span className="block text-xs text-zinc-400">
              {result.typeLine} · {result.setName} ·{" "}
              {result.setCode.toUpperCase()} #{result.collectorNumber} ·{" "}
              {result.rarity} · {result.priceLabel}
            </span>
            {showOwnership ? (
              <span className="block text-xs text-zinc-300">
                Owned exact {result.ownedExactQuantity} · Owned other printing{" "}
                {result.ownedOtherPrintingQuantity}
                {result.locationSummary ? ` · ${result.locationSummary}` : ""}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
