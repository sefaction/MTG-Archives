"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addCollectorWishes } from "@/app/collector/actions";
import { collectorFinishLabels, type CollectorDetail, type CollectorMode, type CollectorProgress } from "@/lib/collector";
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
function SetTile({set, mode}: {set: SetRow; mode: CollectorMode}) {
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
      <h2 className="min-w-0 break-words font-semibold"><Link className="underline" prefetch={false}
        href={{pathname: "/collector", query: {set: set.code, view: mode}}}>{set.name}</Link></h2>
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

type SetDetail = CollectorDetail & {checkedAt: string; wishlistedIds: string[]};
const wishlistButtonClass = "rounded border border-[var(--app-border)] px-3 py-2 text-sm disabled:opacity-50";

function CollectorSetDetail({code, name, initialMode}: {code: string; name?: string; initialMode: CollectorMode}) {
  const [mode, setMode] = useState(initialMode);
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [value, setValue] = useState<SetDetail>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [wishFeedback, setWishFeedback] = useState<{message: string; error?: boolean}>();

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({set: code, detail: mode, page: String(page), missing: missingOnly ? "1" : "0"});
    void fetch(`/api/collector?${params}`, {signal: controller.signal, cache: "no-store"}).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Set details unavailable.");
      if (!controller.signal.aborted) setValue(data);
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Set details unavailable.");
    });
    return () => controller.abort();
  }, [code, missingOnly, mode, page, retry]);

  function changePage(nextPage: number) {
    setValue(undefined);
    setError("");
    setWishFeedback(undefined);
    setPage(nextPage);
  }

  async function addToWishlist(targetId?: string) {
    setSaving(true);
    setWishFeedback(undefined);
    try {
      const result = await addCollectorWishes(targetId === undefined
        ? {set: code, mode, scope: "all"}
        : {set: code, mode, scope: "one", targetId});
      if (!result.ok) {
        setWishFeedback({message: result.error, error: true});
        return;
      }
      const message = [
        result.added > 0 ? `${result.added.toLocaleString()} added to Set Completion.` : "",
        result.alreadySaved > 0 ? `${result.alreadySaved.toLocaleString()} already on your wishlist.` : "",
      ].filter(Boolean).join(" ");
      setWishFeedback({message: message || "No missing targets to add."});
      setValue(undefined);
      setRetry(n => n + 1);
    } catch {
      setWishFeedback({message: "Could not add wishes. Try again.", error: true});
    } finally {
      setSaving(false);
    }
  }

  const wishlistedIds = new Set(value?.wishlistedIds);

  return <section aria-labelledby="collector-set-heading">
    <Link href="/collector" className="text-sm underline">Back to all sets</Link>
    <h2 id="collector-set-heading" className="mt-3 break-words text-xl font-semibold">{name ?? code.toUpperCase()}</h2>
    <p className="mt-2 text-sm text-[var(--app-muted)]">English paper cards and English owned copies, including copies in decks and reserved trades. Tokens are excluded.</p>
    <div className="my-4 flex flex-wrap items-end gap-4">
      <label className="text-sm">Completion view<select className="app-input mt-1 block max-w-full rounded border p-2" value={mode} disabled={saving}
        onChange={event => {setMode(event.target.value as CollectorMode); changePage(1);}}>
        <option value="grouped">Grouped cards</option><option value="variants">Printing / finish variants</option>
      </select></label>
      <label className="py-2 text-sm"><input type="checkbox" checked={missingOnly} disabled={saving}
        onChange={event => {setMissingOnly(event.target.checked); changePage(1);}} /> Missing only</label>
    </div>
    <div className="mb-4 space-y-2">
      <Link href="/wishlist?reason=sets" className="text-sm underline">Open Set Completion wishlist</Link>
      {wishFeedback && <p role={wishFeedback.error ? "alert" : "status"} className="text-sm">{wishFeedback.message}</p>}
      {saving && <p role="status" className="text-sm">Adding to Set Completion…</p>}
    </div>
    {error ? <div role="alert"><p>{error}</p>
      <button type="button" className="mt-2 underline" onClick={() => {setError(""); setRetry(n => n + 1);}}>Retry set details</button>
    </div> : !value ? <p role="status">Loading set details…</p> : <>
      <p className="font-medium">{value.progress.owned.toLocaleString()} / {value.progress.total.toLocaleString()} {mode === "grouped" ? "cards" : "variants"} owned</p>
      <p className="mt-1 text-sm text-[var(--app-muted)]">{(value.progress.total - value.progress.owned).toLocaleString()} missing · Complete catalog checked {new Date(value.checkedAt).toLocaleDateString()}</p>
      {value.progress.total > value.progress.owned && (
        <div className="mt-4 space-y-2">
          <button type="button" className={wishlistButtonClass} disabled={saving} onClick={() => void addToWishlist()}>
            Add all missing to Wishlist
          </button>
          <p className="text-sm text-[var(--app-muted)]">
            Adds one wish per missing target across the whole set in this view. Grouped cards prefer Nonfoil when available.
            Printing variants request the shown printing and finish. You can allow alternatives in Set Completion.
          </p>
        </div>
      )}
      {value.matches ? <ul className="mt-4 divide-y divide-[var(--app-border)] rounded-lg border border-[var(--app-border)]">
        {value.rows.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
          <div className="min-w-0 break-words">
            <p className="font-medium">{row.name}</p>
            {row.finish && <p className="text-sm text-[var(--app-muted)]">
              {row.collectorNumber ? `#${row.collectorNumber} · ` : ""}{collectorFinishLabels[row.finish]}
            </p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-sm">{row.quantity ? `${row.quantity.toLocaleString()} owned` : "Missing"}</span>
            {wishlistedIds.has(row.id) ? <span className="text-sm text-[var(--app-muted)]">On Wishlist</span>
              : row.quantity === 0 && (
                <button type="button" className={wishlistButtonClass} disabled={saving}
                  onClick={() => void addToWishlist(row.id)}>Add to Wishlist</button>
              )}
          </div>
        </li>)}
      </ul> : <p className="mt-4">{value.progress.total ? "No missing cards in this view." : "No eligible cards in this set."}</p>}
      {value.pages > 1 && <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" disabled={saving || value.page === 1} onClick={() => changePage(value.page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button>
        <span className="text-sm">Page {value.page} of {value.pages}</span>
        <button type="button" disabled={saving || value.page === value.pages} onClick={() => changePage(value.page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Next</button>
      </div>}
    </>}
  </section>;
}

export function CollectorView() {
  const params = useSearchParams();
  const code = params.get("set");
  const detailMode = params.get("view") === "variants" ? "variants" : "grouped";
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false);
  const [mode, setMode] = useState<CollectorMode>("grouped");
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
  if (code !== null) {
    if (!/^[a-z0-9]{2,8}$/.test(code)) return <p role="alert">Invalid set code. <Link href="/collector" className="underline">Back to all sets</Link></p>;
    return <CollectorSetDetail key={`${code}:${detailMode}`} code={code} initialMode={detailMode}
      name={sets.find(set => set.code === code)?.name} />;
  }
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
