"use client";

import { useState } from "react";
import type { TradeDeckReview, TradeDeckSearchItem } from "@/lib/trade-deck-view";

export function TradeDeckContents({ review }: { review: TradeDeckReview }) {
  return <div className="min-w-0 space-y-2 text-xs text-zinc-300">
    <p>{review.committedCopies} committed copies · {review.listedCopies} listed playable cards · {review.maybeboardCopies} list-only Maybeboard cards</p>
    <p>Only the committed copies transfer. Missing cards and assumed basic lands are not added.</p>
    <details open className="rounded border border-zinc-800 p-2"><summary className="cursor-pointer font-medium text-zinc-100">Complete deck list ({review.cards.length} entries)</summary>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {review.cards.map((card, index) => <li key={index} className="break-words">{card.quantity} × {card.name} <span className="text-zinc-500">{card.section.toLowerCase()}{card.isCommander ? " · commander" : ""}</span></li>)}
      </ul>
    </details>
    <details className="rounded border border-zinc-800 p-2"><summary className="cursor-pointer font-medium text-zinc-100">Committed physical copies ({review.committedCopies})</summary>
      {review.commitments.length ? <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {review.commitments.map((copy, index) => <li key={index} className="break-words">{copy.quantity} × {copy.name} · {copy.printingLabel} · {copy.foilStatus.toLowerCase()} · {copy.condition} · {copy.language}</li>)}
      </ul> : <p className="mt-2">This deck has no committed physical copies. Its complete list still transfers.</p>}
    </details>
  </div>;
}

export function TradeDeckPicker({ ownerId, side, counterTradeId, selected, onChange }: {
  ownerId: string; side: "offered" | "requested"; counterTradeId?: string;
  selected: TradeDeckReview[]; onChange: (value: TradeDeckReview[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [loadedQuery, setLoadedQuery] = useState("");
  const [items, setItems] = useState<TradeDeckSearchItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState<TradeDeckReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const base = () => new URLSearchParams({ ownerId, side, ...(counterTradeId ? { counterTradeId } : {}) });
  const search = async (more = false) => {
    setBusy(true); setError("");
    try {
      const params = base(); params.set("q", more ? loadedQuery : query);
      if (more && cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/trades/decks?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deck search is unavailable.");
      setItems(current => more ? [...current, ...data.items] : data.items);
      setCursor(data.nextCursor); if (!more) setLoadedQuery(query);
      if (!more && !data.items.length) setError("No matching decks. Your partner can offer a private deck directly.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Deck search is unavailable."); }
    finally { setBusy(false); }
  };
  const inspect = async (deckId: string) => {
    setBusy(true); setError(""); setConfirmed(false); setReview(null);
    try {
      const params = base(); params.set("deckId", deckId);
      const response = await fetch(`/api/trades/decks?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "This deck is unavailable to review.");
      setReview(data.review);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "This deck is unavailable to review."); }
    finally { setBusy(false); }
  };
  return <section className="min-w-0 space-y-2 rounded-lg border border-zinc-800 p-2" aria-label={side === "offered" ? "Whole decks to offer" : "Whole decks to request"}>
    <h4 className="text-sm font-medium text-zinc-100">Whole decks {side === "offered" ? "to offer" : "to request"}</h4>
    <p className="text-xs text-zinc-400">Each deck stays together with its committed copies. League-linked decks and physical Maybeboard commitments cannot be traded.</p>
    <div className="flex min-w-0 flex-wrap gap-2">
      <input className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm" aria-label={side === "offered" ? "Find your decks" : "Find partner decks"} placeholder="Deck name (optional)" value={query} onChange={event => setQuery(event.target.value)} disabled={busy}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!busy && ownerId) void search(); } }} />
      <button type="button" disabled={busy || !ownerId} onClick={() => search()} className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-50">Find decks</button>
    </div>
    {error ? <p role="status" className="text-xs text-amber-200">{error}</p> : null}
    {busy ? <p role="status" className="text-xs text-zinc-400">Loading decks…</p> : null}
    {items.length ? <ul className="max-h-56 space-y-1 overflow-y-auto">
      {items.map(item => <li key={item.deckId} className="flex min-w-0 items-center justify-between gap-2 rounded bg-zinc-900 p-2">
        <div className="min-w-0 text-xs"><p className="break-words font-medium">{item.name}</p><p className="text-zinc-400">{item.format.toLowerCase()} · {item.listEntries} list entries{item.blockedReason ? ` · ${item.blockedReason}` : ""}</p></div>
        <button type="button" disabled={busy || !!item.blockedReason} onClick={() => inspect(item.deckId)} className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-50" aria-label={`Review ${item.name}`}>Review</button>
      </li>)}
    </ul> : null}
    {cursor ? <button type="button" disabled={busy || query !== loadedQuery} onClick={() => search(true)} className="text-xs text-sky-300 underline">Load more decks</button> : null}
    {review ? <div className="space-y-2 rounded border border-sky-800 bg-sky-950/20 p-2">
      <h5 className="break-words text-sm font-medium">Review {review.name}</h5>
      <TradeDeckContents review={review} />
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the complete list and committed copies.</label>
      <button type="button" disabled={!confirmed} onClick={() => { onChange([...selected.filter(deck => deck.deckId !== review.deckId), review]); setReview(null); }} className="rounded bg-sky-800 px-3 py-1 text-xs disabled:opacity-50">{selected.some(deck => deck.deckId === review.deckId) ? "Replace reviewed deck" : "Add whole deck"}</button>
    </div> : null}
    {selected.map(deck => <div key={deck.deckId} className="space-y-1 rounded border border-emerald-900 bg-emerald-950/20 p-2 text-xs">
      <div className="flex items-start justify-between gap-2"><p className="break-words font-medium">{deck.name} · whole deck</p><button type="button" className="shrink-0 text-rose-300 underline" onClick={() => onChange(selected.filter(item => item.deckId !== deck.deckId))} aria-label={`Remove ${deck.name}`}>Remove</button></div>
      <p>{deck.committedCopies} committed copies · {deck.listedCopies} listed cards</p>
      <details><summary className="cursor-pointer text-sky-300">Reviewed contents</summary><TradeDeckContents review={deck} /></details>
      <button type="button" disabled={busy} className="text-sky-300 underline" onClick={() => inspect(deck.deckId)}>Refresh review</button>
    </div>)}
  </section>;
}
