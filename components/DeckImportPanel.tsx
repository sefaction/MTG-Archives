"use client";

import { useMemo, useState } from "react";
import { DeckSection } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { deckSectionLabel } from "@/lib/decks";
import type {
  DeckImportResolution,
  ResolvedDeckImportLine,
} from "@/lib/deck-import";
import { commitDeckImport } from "@/app/decks/actions";

const statusLabel: Record<string, string> = {
  OWNED_PRINTING_SELECTED: "Owned printing selected",
  CHEAPEST_PRINTING_SELECTED: "Cheapest printing selected",
  EXACT_PRINTING_SELECTED: "Exact printing selected",
  NEEDS_REVIEW: "Needs review",
  NOT_FOUND: "Not found",
  ERROR: "Error",
};

export function DeckImportPanel({ deckId }: { deckId: string }) {
  const [text, setText] = useState("");
  const [resolution, setResolution] = useState<DeckImportResolution | null>(
    null,
  );
  const [removedLines, setRemovedLines] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("merge");

  async function resolveDecklist() {
    setLoading(true);
    setError("");
    setResolution(null);
    setRemovedLines(new Set());
    try {
      const res = await fetch("/api/decks/import/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Decklist resolution failed.");
      setResolution((await res.json()) as DeckImportResolution);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decklist resolution failed.");
    } finally {
      setLoading(false);
    }
  }

  const committable = useMemo(() => {
    const lines = resolution?.lines ?? [];
    return lines.filter(
      (line) => line.cardId && !removedLines.has(line.lineNumber),
    );
  }, [resolution, removedLines]);

  const linesJson = useMemo(
    () =>
      JSON.stringify(
        committable.map((line) => ({
          cardId: line.cardId,
          quantity: line.quantity,
          section: line.section,
          notes: `Imported from line ${line.lineNumber}: ${line.rawLine}`,
        })),
      ),
    [committable],
  );

  return (
    <section className="space-y-3 rounded border border-zinc-800 p-4">
      <h2 className="text-xl font-semibold">Paste decklist</h2>
      <p className="text-sm text-zinc-400">
        Paste a decklist with quantities, optional sections, and optional
        set/collector details. Review selected printings before committing.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="w-full border bg-zinc-900 p-2 font-mono text-sm"
        placeholder={
          "Commander\n1 Atraxa, Praetors' Voice\n\nMainboard\n1 Sol Ring (CMM) 400\n4 Lightning Bolt"
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={resolveDecklist}
          disabled={loading || !text.trim()}
          className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
        >
          {loading ? "Parsing and resolving…" : "Parse and review"}
        </button>
        <span className="text-sm text-zinc-400" aria-live="polite">
          {loading
            ? "Parsing → resolving local matches → resolving Scryfall matches → review ready…"
            : error}
        </span>
      </div>
      {resolution ? (
        <div className="space-y-3">
          <div className="grid gap-2 text-xs text-zinc-300 md:grid-cols-7">
            <span>Lines parsed: {resolution.summary.parsed}</span>
            <span>Owned: {resolution.summary.ownedMatches}</span>
            <span>Scryfall/Cache: {resolution.summary.scryfallMatches}</span>
            <span>Cheapest: {resolution.summary.cheapestSelections}</span>
            <span>Needs review: {resolution.summary.needsReview}</span>
            <span>Not found: {resolution.summary.notFound}</span>
            <span>Deduped lookups: {resolution.summary.dedupedLookups}</span>
          </div>
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900 text-left text-zinc-300">
                <tr>
                  <th className="p-2">Use</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Parsed</th>
                  <th className="p-2">Section</th>
                  <th className="p-2">Matched printing</th>
                  <th className="p-2">Owned</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resolution.lines.map((line) => (
                  <ReviewLine
                    key={line.lineNumber}
                    line={line}
                    removed={removedLines.has(line.lineNumber)}
                    onToggle={() =>
                      setRemovedLines((current) => {
                        const next = new Set(current);
                        if (next.has(line.lineNumber))
                          next.delete(line.lineNumber);
                        else next.add(line.lineNumber);
                        return next;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <form
            action={commitDeckImport}
            className="flex flex-wrap items-center gap-3 rounded border border-zinc-800 p-3"
          >
            <input type="hidden" name="deckId" value={deckId} />
            <input type="hidden" name="linesJson" value={linesJson} />
            <label className="text-sm">
              Commit mode
              <select
                name="mode"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="ml-2 border bg-zinc-900 p-2"
              >
                <option value="merge">
                  Append / merge with existing cards
                </option>
                <option value="replace">Replace deck contents</option>
              </select>
            </label>
            <SubmitButton
              pendingLabel="Committing…"
              disabled={committable.length === 0}
              confirmMessage={
                mode === "replace"
                  ? "Replace current deck contents with the resolved decklist? Inventory will not be modified."
                  : undefined
              }
              className="rounded border border-sky-700 px-3 py-2 text-sky-100"
            >
              Commit {committable.length} resolved lines
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ReviewLine({
  line,
  removed,
  onToggle,
}: {
  line: ResolvedDeckImportLine;
  removed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className={`border-t border-zinc-800 ${removed ? "opacity-50" : ""}`}>
      <td className="p-2">
        <input
          type="checkbox"
          checked={!removed}
          onChange={onToggle}
          disabled={!line.cardId}
        />
      </td>
      <td className="p-2">{line.quantity}</td>
      <td className="p-2">
        <div>{line.cardName}</div>
        <div className="text-xs text-zinc-500">
          Line {line.lineNumber}: {line.rawLine}
        </div>
      </td>
      <td className="p-2">{deckSectionLabel(line.section as DeckSection)}</td>
      <td className="p-2">
        {line.cardId ? (
          <div>
            <div className="font-medium text-sky-100">{line.matchedName}</div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <SetSymbol
                setCode={line.matchedSetCode}
                setName={line.setName}
                rarity={line.rarity}
              />{" "}
              #{line.collector} ·{" "}
              {line.priceUsd == null ? "—" : `$${line.priceUsd.toFixed(2)}`}
            </div>
          </div>
        ) : (
          <span className="text-zinc-500">No printing selected</span>
        )}
      </td>
      <td className="p-2">
        {line.ownedQuantity ? (
          <span className="text-emerald-300">
            Owned: {line.ownedQuantity}
            {line.locationSummary ? ` in ${line.locationSummary}` : ""}
          </span>
        ) : (
          "Not owned"
        )}
      </td>
      <td className="p-2">
        <span className="block">{statusLabel[line.status]}</span>
        <span className="text-xs text-zinc-500">
          {line.error ?? line.resolutionMethod}
        </span>
      </td>
    </tr>
  );
}
