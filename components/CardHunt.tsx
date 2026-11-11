"use client";

import Link from "next/link";
import { useState } from "react";
import type { HuntFinish, HuntMode, HuntPlan } from "@/lib/card-hunt";
import { filterInputClass, filterSelectClass, filterPrimaryButtonClass } from "./filterStyles";

type Result = HuntPlan & {title: string; warnings: string[]; generatedAt: string; ignoredBasicLandCopies: number};
const finishLabel = (value: string) => ({FOIL: "Foil", NONFOIL: "Nonfoil", ETCHED: "Etched"}[value] ?? value);

export type CardHuntContext = {
  id: string;
  scope: "card" | "printing";
  setCode: string;
  collectorNumber?: string;
  finish?: Exclude<HuntFinish, "ANY">;
};

export function CardHunt({decks = [], initialDeckId, card}: {
  decks?: Array<{id: string; name: string}>;
  initialDeckId?: string;
  card?: CardHuntContext;
}) {
  const [source, setSource] = useState<"deck" | "list">(initialDeckId || decks.length ? "deck" : "list");
  const [deckId, setDeckId] = useState(initialDeckId ?? decks[0]?.id ?? "");
  const [text, setText] = useState("");
  const [finish, setFinish] = useState<HuntFinish>("ANY");
  const [mode, setMode] = useState<HuntMode>("preferences");
  const [includeMaybeboard, setIncludeMaybeboard] = useState(false);
  const [ignoreBasicLands, setIgnoreBasicLands] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [boxPage, setBoxPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [showLines, setShowLines] = useState(false);
  const [linePage, setLinePage] = useState(0);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError(""); setResult(null);
    try {
      const input = card ? { card: { id: card.id, scope: card.scope, finish: card.finish } }
        : source === "deck" ? { deckId, ignoreBasicLands } : { text };
      const response = await fetch("/api/card-hunt", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({...input, mode, finish, includeMaybeboard})});
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The hunt could not be prepared.");
      setResult(value); setBoxPage(0); setLinePage(0); setFilter(""); setShowLines(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The hunt could not be prepared."); }
    finally { setPending(false); }
  }
  const boxes = result?.boxes.filter(box => {
    const term = filter.trim().toLowerCase();
    return !term || box.name.toLowerCase().includes(term) || box.picks.some(pick =>
      `${pick.name} ${pick.section ?? ""} ${pick.setCode} ${pick.collectorNumber}`.toLowerCase().includes(term));
  }) ?? [];
  return <div className="space-y-5">
    <form onSubmit={generate} className="app-panel p-4 sm:p-5">
      <fieldset disabled={pending} onChange={() => {setResult(null); setError("");}} className="min-w-0 space-y-4 disabled:opacity-70">
        {card ? (
          <p className="text-sm font-medium">
            {card.scope === "card" ? "All printings and finishes" :
              `Printing ${card.setCode.toUpperCase()} #${card.collectorNumber ?? "—"} · ${card.finish ? finishLabel(card.finish) : "All finishes"}`}
          </p>
        ) : <>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="hunt-source" checked={source === "deck"} onChange={() => setSource("deck")} /> From a deck</label>
          <label className="flex items-center gap-2"><input type="radio" name="hunt-source" checked={source === "list"} onChange={() => setSource("list")} /> Paste a list</label>
        </div>
        {source === "deck" ? <label className="block text-sm">Deck
          <select aria-label="Deck" className={`${filterSelectClass} mt-1 w-full`} value={deckId} onChange={event => setDeckId(event.target.value)} required>
            {!decks.length && <option value="">No personal decks yet — paste a list instead</option>}
            {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          </select>
        </label> : <label className="block text-sm">Cards to find
          <textarea aria-label="Cards to find" className={`${filterInputClass} mt-1 min-h-36 w-full`} value={text} onChange={event => setText(event.target.value)}
            maxLength={100_000} required placeholder={"1 Sol Ring\n3 Forest (M21) 274\n1 Arcane Signet *F*"} />
          <span className="mt-1 block text-xs text-[var(--app-muted)]">One card per line. Optional set, collector number and *F* foil preference. Up to 500 lines.</span>
        </label>}
        </>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!card && <label className="block text-sm">Finish preference
            <select aria-label="Finish preference" className={`${filterSelectClass} mt-1 w-full`} value={finish} onChange={event => setFinish(event.target.value as HuntFinish)}>
              <option value="ANY">Any finish</option><option value="FOIL">Prefer foil</option><option value="NONFOIL">Prefer nonfoil</option><option value="ETCHED">Prefer etched</option>
            </select>
          </label>}
          <label className="block text-sm">Pull priority
            <select aria-label="Pull priority" className={`${filterSelectClass} mt-1 w-full`} value={mode} onChange={event => setMode(event.target.value as HuntMode)}>
              <option value="preferences">My preferences first</option><option value="boxes">Optimize boxes</option>
            </select>
          </label>
        </div>
        {!card && <p className="text-sm text-[var(--app-muted)]">{mode === "preferences" ?
          "Prioritize your finish preference, then the deck or list's printing. Group those copies into boxes. Other available copies can fill gaps." :
          "Favor boxes that cover more of your list. Finish and printing preferences break ties; any substitutions are marked."}</p>}
        {!card && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeMaybeboard} onChange={event => setIncludeMaybeboard(event.target.checked)} /> Include maybeboard</label>}
        {!card && source === "deck" && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ignoreBasicLands} onChange={event => setIgnoreBasicLands(event.target.checked)} /> Ignore basic lands
        </label>}
        <button type="submit" className={filterPrimaryButtonClass}>{pending ? "Finding your cards…" : card ? "Find copies" : "Build hunt"}</button>
      </fieldset>
      <p className="mt-3 text-xs text-[var(--app-muted)]">Uses your available storage copies. Cards in decks and active trade reservations are excluded. A hunt is a plan; it does not reserve or move cards.</p>
    </form>
    {error && <p role="alert" className="app-panel border-red-700 p-4 text-red-300">{error}</p>}
    {pending && <p role="status">Checking storage and available copies…</p>}
    {result && <section aria-label="Hunt results" className="space-y-4">
      <div className="app-panel p-4">
        <h2 className="break-words text-xl font-semibold">{result.title}</h2>
        <p role="status" className="mt-2">{card && !result.planned ? "No copies are currently available in storage." :
          `${result.boxes.length} ${result.boxes.length === 1 ? "box" : "boxes"} · ${result.planned} to pull${card ? "" : ` · ${result.shortage} short`}${result.alreadyInDeck ? ` · ${result.alreadyInDeck} already in this deck` : ""}`}</p>
        {result.ignoredBasicLandCopies > 0 && <p className="mt-2 text-sm">
          {result.ignoredBasicLandCopies} basic land {result.ignoredBasicLandCopies === 1 ? "copy" : "copies"} skipped.
          {!result.lines.length && " No other cards to hunt."}
        </p>}
        <p className="mt-2 text-xs text-[var(--app-muted)]">Availability is a snapshot. Refresh the hunt before pulling if your inventory or trades change. Box optimization is a practical grouping suggestion, not a guaranteed minimum.</p>
        {!card && source === "deck" && deckId !== initialDeckId && <Link href={`/decks/${encodeURIComponent(deckId)}`} className="mt-2 inline-block text-sm underline">Back to deck</Link>}
        {result.warnings.length > 0 && <details className="mt-3 text-sm"><summary>List notes ({result.warnings.length})</summary><ul className="mt-2 list-inside list-disc">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      </div>
      {result.shortage > 0 && <div className="app-panel p-4">
        <h3 className="font-semibold">Still needed</h3>
        <ul className="mt-2 space-y-1 text-sm">{result.lines.filter(line => line.shortage > 0).map(line =>
          <li key={line.request.id} className="break-words">{line.shortage} × {line.request.name} — not enough available in storage</li>)}</ul>
      </div>}
      {result.lines.length > 0 && <div className="app-panel p-4">
        <button type="button" onClick={() => setShowLines(value => !value)} aria-expanded={showLines} className="text-sm underline">{showLines ? "Hide" : "Show"} requested cards and alternate printings</button>
        {showLines && <div className="mt-3 space-y-3">
          {result.lines.slice(linePage * 25, (linePage + 1) * 25).map(line => <div key={line.request.id} className="min-w-0 border-b border-[var(--app-border)] pb-3 text-sm">
            <p className="break-words font-medium">{line.request.quantity} × {line.request.name}{line.request.setCode ? ` · ${line.request.setCode.toUpperCase()} ${line.request.collectorNumber ?? ""}` : ""}</p>
            <p>{line.planned} planned · {line.shortage} short{line.request.alreadyInDeck ? ` · ${line.request.alreadyInDeck} already in deck` : ""}</p>
            {line.alternativeCount > 0 && <p className="mt-1 break-words text-[var(--app-muted)]">Other available printings: {line.alternatives.map(alt => `${alt.setCode.toUpperCase()} ${alt.collectorNumber} ${finishLabel(alt.finish)} (${alt.available})`).join("; ")}{line.alternativeCount > line.alternatives.length ? `; showing ${line.alternatives.length} of ${line.alternativeCount}` : ""}. Quantities are shared across the hunt.</p>}
          </div>)}
          {result.lines.length > 25 && <Pagination page={linePage} total={Math.ceil(result.lines.length / 25)} onChange={setLinePage} label="Requested cards" />}
        </div>}
      </div>}
      {result.boxes.length > 0 && <label className="block text-sm">Find a box, section or card
        <input className={`${filterInputClass} mt-1 w-full`} value={filter} onChange={event => {setFilter(event.target.value); setBoxPage(0);}} />
      </label>}
      {boxes.slice(boxPage * 10, (boxPage + 1) * 10).map(box => <HuntBox key={box.id} box={box} />)}
      {result.boxes.length > 0 && !boxes.length && <p>No matching boxes.</p>}
      {boxes.length > 10 && <Pagination page={boxPage} total={Math.ceil(boxes.length / 10)} onChange={setBoxPage} label="Boxes" />}
    </section>}
  </div>;
}

function Pagination({page, total, onChange, label}: {page: number; total: number; onChange: (page: number) => void; label: string}) {
  return <nav aria-label={label} className="flex flex-wrap items-center gap-3 text-sm">
    <button type="button" className="underline disabled:opacity-40" disabled={!page} onClick={() => onChange(page - 1)}>Previous</button>
    <span>Page {page + 1} of {total}</span>
    <button type="button" className="underline disabled:opacity-40" disabled={page + 1 >= total} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}

function HuntBox({box}: {box: HuntPlan["boxes"][number]}) {
  const [visible, setVisible] = useState(50);
  return <section className="app-panel min-w-0 p-4" aria-label={`Pull from ${box.name}`}>
    <h3 className="break-words text-lg font-semibold">{box.name}</h3>
    <p className="mt-1 text-sm text-[var(--app-muted)]">{box.picks.reduce((sum, pick) => sum + pick.quantity, 0)} copies to pull</p>
    <ul className="mt-3 divide-y divide-[var(--app-border)]">
      {box.picks.slice(0, visible).map(pick => <li key={`${pick.requestId}:${pick.inventoryItemId}`} className="flex min-w-0 items-start gap-3 py-3">
        <input type="checkbox" aria-label={`Pulled ${pick.quantity} ${pick.name}, ${pick.setCode} ${pick.collectorNumber}, ${finishLabel(pick.finish)}, ${pick.section ?? "unassigned section"}`} className="mt-1 shrink-0" />
        <div className="min-w-0 break-words text-sm">
          <p className="font-medium">{pick.quantity} × {pick.name}</p>
          <p>Section {pick.section || "unassigned"} · {pick.setCode.toUpperCase()} #{pick.collectorNumber} · {finishLabel(pick.finish)} · {pick.language} · {pick.condition}</p>
          {(pick.alternatePrinting || pick.finishCompromise) && <p className="mt-1 text-amber-300">{[pick.alternatePrinting && "Alternate printing", pick.finishCompromise && "Different finish from preference"].filter(Boolean).join(" · ")}</p>}
        </div>
      </li>)}
    </ul>
    {visible < box.picks.length && <button type="button" className="mt-2 text-sm underline" onClick={() => setVisible(value => value + 50)}>Show more cards ({box.picks.length - visible} remaining)</button>}
    <p className="mt-2 text-xs text-[var(--app-muted)]">Checks are temporary reminders on this page.</p>
  </section>;
}
