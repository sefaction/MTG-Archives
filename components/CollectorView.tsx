"use client";
import { useEffect, useMemo, useState } from "react";
import type { CollectorProgress } from "@/lib/collector";
import type { CollectorSet } from "@/lib/collector-catalog";

let catalogLoads = 0;
const waiting: Array<() => void> = [];
async function loadTile(url: string, signal: AbortSignal) {
  if (catalogLoads >= 3) await new Promise<void>(resolve => waiting.push(resolve));
  catalogLoads++;
  try {
    signal.throwIfAborted();
    return await fetch(url, {signal, cache: "no-store"});
  } finally {
    catalogLoads--;
    waiting.shift()?.();
  }
}

type SetRow = CollectorSet & {hasOwned: boolean};
type Progress = CollectorProgress & {checkedAt: string};
function SetTile({set, mode}: {set: SetRow; mode: "grouped" | "variants"}) {
  const [value, setValue] = useState<Progress>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await loadTile(`/api/collector?set=${encodeURIComponent(set.code)}`, controller.signal);
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Catalog unavailable.");
        if (!controller.signal.aborted) setValue(data);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Catalog unavailable.");
      }
    })();
    return () => controller.abort();
  }, [set.code, retry]);
  const count = value?.[mode];
  return <article className="app-panel min-w-0 rounded-xl border border-[var(--app-border)] p-4">
    <div className="flex items-start justify-between gap-2">
      <h2 className="font-semibold">{set.name}</h2>
      <span className="shrink-0 text-xs uppercase text-[var(--app-muted)]">{set.code}</span>
    </div>
    {error ? <div role="status" className="mt-4 text-sm"><p>{error}</p>
      <button type="button" className="mt-2 underline" onClick={() => {setError(""); setValue(undefined); setRetry(n => n + 1);}}>Retry {set.code.toUpperCase()}</button></div> :
      count ? <div className="mt-4">
        <div className="flex justify-between gap-2 text-sm"><span>{count.owned.toLocaleString()} / {count.total.toLocaleString()} {mode === "grouped" ? "cards" : "variants"}</span><span>{count.total ? `${count.percent}%` : "No eligible cards"}</span></div>
        <progress className="mt-2 h-3 w-full accent-emerald-500" max={100} value={count.percent} aria-label={`${set.name} completion`} />
        <p className="mt-2 text-xs text-[var(--app-muted)]">Complete catalog checked {new Date(value!.checkedAt).toLocaleDateString()}</p>
      </div> : <p role="status" className="mt-4 text-sm text-[var(--app-muted)]">Checking complete set catalog...</p>}
  </article>;
}
export function CollectorView() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false);
  const [mode, setMode] = useState<"grouped" | "variants">("grouped");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/collector", {signal: controller.signal, cache: "no-store"}).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      if (!controller.signal.aborted) {setSets(data.sets); setDirectoryUnavailable(data.directoryUnavailable);}
    }).catch(caught => {if (!controller.signal.aborted) setError(caught.message);})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, []);
  const filtered = useMemo(() => sets.filter(set => (!hideEmpty || set.hasOwned) &&
    `${set.name} ${set.code}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "") || a.name.localeCompare(b.name)), [sets, hideEmpty, search]);
  // A three-request queue hydrates twelve tiles; only visible-page sets load.
  const visible = filtered.slice(page * 12, page * 12 + 12);
  return <section>
    <p className="text-sm text-[var(--app-muted)]">Your English paper collection, including copies in decks and reserved trades. Duplicate copies count once.</p>
    <details className="my-4 rounded-lg border border-[var(--app-border)] p-3 text-sm">
      <summary className="cursor-pointer font-medium">What counts toward completion?</summary>
      <p className="mt-2">English paper cards and English owned copies only. Promos, alternate art and special treatments count in their Scryfall-assigned set. Grouped cards combine the same Oracle identity within a set (exact name if no Oracle ID); variants count each Scryfall printing and supported nonfoil, foil or etched finish separately.</p>
      <p className="mt-2">Tokens, emblems, art cards, helper cards, oversized cards, and digital cards are excluded. Supplemental non-token card types and reversible cards are included. Condition and duplicate copies do not add targets. Serialized numbers are not separate targets.</p>
      <p className="mt-2">Totals use all pages of Scryfall’s catalog, checked within 24 hours, not just cached or owned cards. Unavailable or incomplete catalogs show no percentage. These are initial catalog choices, not a claim about your collecting preferences.</p>
    </details>
    <div className="my-5 flex flex-wrap items-end gap-4">
      <label className="text-sm">Completion view<select className="app-input mt-1 block max-w-full rounded border p-2" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
        <option value="grouped">Grouped cards</option><option value="variants">Printing / finish variants</option>
      </select></label>
      <label className="text-sm">Find a set<input className="app-input mt-1 block max-w-full rounded border p-2" value={search} onChange={event => {setSearch(event.target.value); setPage(0);}} placeholder="Set name or code" /></label>
      <label className="py-2 text-sm"><input type="checkbox" checked={hideEmpty} onChange={event => {setHideEmpty(event.target.checked); setPage(0);}} /> Only sets with English inventory</label>
    </div>
    {directoryUnavailable && <p role="status" className="mb-4 text-sm">Set directory unavailable. Showing locally known owned sets only; each total still requires a complete catalog check.</p>}
    {loading ? <p role="status">Loading set directory...</p> : error ? <p role="alert">{error} Reload to retry.</p> : <>
      <p className="mb-3 text-sm text-[var(--app-muted)]">{filtered.length} sets | Newest first{hideEmpty ? " | Sets with token-only or excluded inventory may show zero" : ""}</p>
      <div className="grid gap-4 md:grid-cols-3">{visible.map(set => <SetTile key={set.code} set={set} mode={mode} />)}</div>
      {!filtered.length && <p>No matching sets. Try another search or show all sets.</p>}
      <div className="mt-5 flex items-center gap-4">
        <button type="button" disabled={page === 0} onClick={() => setPage(n => n - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button>
        <span className="text-sm">Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 12))}</span>
        <button type="button" disabled={(page + 1) * 12 >= filtered.length} onClick={() => setPage(n => n + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Next</button>
      </div>
    </>}
  </section>;
}
