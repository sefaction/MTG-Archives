"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeckSection } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { deckSectionLabel, deckSections } from "@/lib/decks";
import type {
  DeckImportResolution,
  DeckImportReviewLine,
  DeckImportStatus,
} from "@/lib/deck-import";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import { commitDeckImport } from "@/app/decks/actions";

const statusLabel: Record<DeckImportStatus, string> = {
  RESOLVED_EXACT_PRINTING: "Exact printing selected",
  RESOLVED_OWNED_PRINTING: "Owned printing selected",
  RESOLVED_CHEAPEST_PRINTING: "Cheapest printing selected",
  MANUALLY_SELECTED: "Manually selected",
  NEEDS_REVIEW: "Needs review",
  AMBIGUOUS: "Ambiguous",
  NOT_FOUND: "Not found",
  PARSE_WARNING: "Parse warning",
  PARSE_ERROR: "Could not parse",
  SKIPPED: "Skipped",
  ERROR: "Error",
};

const resolvedStatuses: DeckImportStatus[] = [
  "RESOLVED_EXACT_PRINTING",
  "RESOLVED_OWNED_PRINTING",
  "RESOLVED_CHEAPEST_PRINTING",
  "MANUALLY_SELECTED",
];

function lineQuantity(line: Pick<DeckImportReviewLine, "quantity">) {
  return line.quantity ?? 0;
}

function summarize(
  lines: DeckImportReviewLine[],
  skipped: DeckImportReviewLine[],
) {
  const resolved = lines.filter((line) =>
    resolvedStatuses.includes(line.resolutionStatus),
  );
  const unresolved = lines.filter((line) => !line.selectedCardId);
  const excluded = lines.filter((line) => !line.included);
  const ready = lines.filter((line) => line.included && line.selectedCardId);
  return {
    totalPastedLines: lines.length + skipped.length,
    parsedCardLines: lines.length,
    totalCardQuantityParsed: lines.reduce(
      (total, line) => total + lineQuantity(line),
      0,
    ),
    resolved: resolved.length,
    resolvedTotalQuantity: resolved.reduce(
      (total, line) => total + lineQuantity(line),
      0,
    ),
    unresolvedRows: unresolved.length,
    unresolvedTotalQuantity: unresolved.reduce(
      (total, line) => total + lineQuantity(line),
      0,
    ),
    ownedMatches: lines.filter(
      (line) => line.resolutionStatus === "RESOLVED_OWNED_PRINTING",
    ).length,
    cheapestSelections: lines.filter(
      (line) => line.resolutionStatus === "RESOLVED_CHEAPEST_PRINTING",
    ).length,
    manualSelections: lines.filter(
      (line) => line.resolutionStatus === "MANUALLY_SELECTED",
    ).length,
    needsReview: lines.filter(
      (line) =>
        line.resolutionStatus === "NEEDS_REVIEW" ||
        line.resolutionStatus === "AMBIGUOUS",
    ).length,
    notFound: lines.filter((line) => line.resolutionStatus === "NOT_FOUND")
      .length,
    parseErrors: lines.filter((line) => line.resolutionStatus === "PARSE_ERROR")
      .length,
    excluded: excluded.length,
    excludedTotalQuantity: excluded.reduce(
      (total, line) => total + lineQuantity(line),
      0,
    ),
    readyToCommit: ready.length,
    readyToCommitTotalQuantity: ready.reduce(
      (total, line) => total + lineQuantity(line),
      0,
    ),
    unresolvedIncluded: lines.filter(
      (line) => line.included && !line.selectedCardId,
    ).length,
    warnings: lines.filter((line) => line.warnings.length > 0).length,
    skipped: skipped.length,
  };
}

export function DeckImportPanel({ deckId }: { deckId: string }) {
  const [text, setText] = useState("");
  const [lines, setLines] = useState<DeckImportReviewLine[]>([]);
  const [skippedLines, setSkippedLines] = useState<DeckImportReviewLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("merge");
  const [commitError, setCommitError] = useState("");

  async function resolveDecklist() {
    setLoading(true);
    setError("");
    setCommitError("");
    setLines([]);
    setSkippedLines([]);
    try {
      const res = await fetch("/api/decks/import/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Decklist resolution failed.");
      const resolution = (await res.json()) as DeckImportResolution;
      setLines(resolution.lines);
      setSkippedLines(resolution.skippedLines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decklist resolution failed.");
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(
    () => summarize(lines, skippedLines),
    [lines, skippedLines],
  );
  const linesJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          rawLine: line.rawLine,
          cardId: line.selectedCardId,
          quantity: line.quantity,
          section: line.section,
          included: line.included,
          notes: `Imported from line ${line.lineNumber}: ${line.rawLine}`,
        })),
      ),
    [lines],
  );

  function updateLine(
    id: string,
    updater: (line: DeckImportReviewLine) => DeckImportReviewLine,
  ) {
    setLines((current) =>
      current.map((line) => (line.id === id ? updater(line) : line)),
    );
  }

  function preSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (summary.unresolvedIncluded > 0) {
      event.preventDefault();
      setCommitError(
        `Resolve or exclude ${summary.unresolvedIncluded} unresolved lines before committing.`,
      );
    }
  }

  return (
    <section className="space-y-3 rounded border border-zinc-800 p-4">
      <h2 className="text-xl font-semibold">Paste decklist</h2>
      <p className="text-sm text-zinc-400">
        Every non-comment pasted line is kept visible in review. Resolve or
        exclude problem rows before committing.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="w-full border bg-zinc-900 p-2 font-mono text-sm"
        placeholder={
          "Commander\n1 Atraxa, Praetors' Voice\n\nCreatures\n1 Sol Ring (CMM) 400\n4 Lightning Bolt\nSol Rign"
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
            : error || (lines.length ? "Review ready." : "")}
        </span>
      </div>

      {lines.length || skippedLines.length ? (
        <div className="space-y-3">
          <div className="grid gap-2 text-xs text-zinc-300 md:grid-cols-6">
            <span>Total lines: {summary.totalPastedLines}</span>
            <span>Card rows: {summary.parsedCardLines}</span>
            <span>Total cards parsed: {summary.totalCardQuantityParsed}</span>
            <span>Resolved rows: {summary.resolved}</span>
            <span>Resolved cards: {summary.resolvedTotalQuantity}</span>
            <span>Owned: {summary.ownedMatches}</span>
            <span>Cheapest: {summary.cheapestSelections}</span>
            <span>Manual: {summary.manualSelections}</span>
            <span>Needs review: {summary.needsReview}</span>
            <span>Unresolved cards: {summary.unresolvedTotalQuantity}</span>
            <span>Not found: {summary.notFound}</span>
            <span>Parse errors: {summary.parseErrors}</span>
            <span>Warnings: {summary.warnings}</span>
            <span>Excluded rows: {summary.excluded}</span>
            <span>Excluded cards: {summary.excludedTotalQuantity}</span>
            <span>Ready rows: {summary.readyToCommit}</span>
            <span>Ready cards: {summary.readyToCommitTotalQuantity}</span>
          </div>
          {summary.unresolvedIncluded > 0 ? (
            <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-sm text-amber-100">
              Resolve or exclude {summary.unresolvedIncluded} unresolved lines
              before committing.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900 text-left text-zinc-300">
                <tr>
                  <th className="p-2">Include</th>
                  <th className="p-2">Line</th>
                  <th className="p-2">Parsed</th>
                  <th className="p-2">Section</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Selected printing</th>
                  <th className="p-2">Owned</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <ReviewLine
                    key={line.id}
                    line={line}
                    updateLine={(updater) => updateLine(line.id, updater)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {skippedLines.length ? (
            <details
              className="rounded border border-zinc-800 p-3 text-sm"
              open
            >
              <summary className="cursor-pointer font-semibold">
                Skipped section/header lines ({skippedLines.length})
              </summary>
              <ul className="mt-2 space-y-1 text-zinc-400">
                {skippedLines.map((line) => (
                  <li key={line.id}>
                    Line {line.lineNumber}: <code>{line.rawLine}</code> —{" "}
                    {line.resolutionMessage}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <form
            action={commitDeckImport}
            onSubmit={preSubmit}
            className="flex flex-wrap items-center gap-3 rounded border border-zinc-800 p-3"
          >
            <input type="hidden" name="deckId" value={deckId} />
            <input type="hidden" name="linesJson" value={linesJson} />
            <input
              type="hidden"
              name="unresolvedIncludedCount"
              value={summary.unresolvedIncluded}
            />
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
              disabled={
                summary.readyToCommit === 0 || summary.unresolvedIncluded > 0
              }
              confirmMessage={
                mode === "replace"
                  ? "Replace current deck contents with the resolved decklist? Inventory will not be modified."
                  : undefined
              }
              className="rounded border border-sky-700 px-3 py-2 text-sky-100"
            >
              Commit {summary.readyToCommit} resolved rows
            </SubmitButton>
            {commitError ? (
              <span className="text-sm text-red-300">{commitError}</span>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ReviewLine({
  line,
  updateLine,
}: {
  line: DeckImportReviewLine;
  updateLine: (
    updater: (line: DeckImportReviewLine) => DeckImportReviewLine,
  ) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const message = [line.resolutionMessage, ...line.warnings, ...line.errors]
    .filter(Boolean)
    .join(" ");
  return (
    <tr
      className={`border-t border-zinc-800 align-top ${!line.included ? "opacity-50" : ""}`}
    >
      <td className="p-2">
        <input
          type="checkbox"
          checked={line.included}
          onChange={(event) =>
            updateLine((current) => ({
              ...current,
              included: event.target.checked,
            }))
          }
        />
      </td>
      <td className="p-2">
        <div>#{line.lineNumber}</div>
        <code className="text-xs text-zinc-400">{line.rawLine}</code>
      </td>
      <td className="p-2">
        <label className="block text-xs">
          Qty
          <input
            className="mt-1 w-16 border bg-zinc-900 p-1"
            type="number"
            min={1}
            value={line.quantity ?? ""}
            onChange={(event) =>
              updateLine((current) => ({
                ...current,
                quantity: Number(event.target.value) || null,
              }))
            }
          />
        </label>
        <label className="mt-1 block text-xs">
          Name
          <input
            className="mt-1 w-48 border bg-zinc-900 p-1"
            value={line.parsedName ?? ""}
            onChange={(event) =>
              updateLine((current) => ({
                ...current,
                parsedName: event.target.value || null,
                selectedCardId: null,
                selectedCardSummary: null,
                resolutionStatus: "NEEDS_REVIEW",
                resolutionMessage: "Parsed name changed; choose a printing.",
              }))
            }
          />
        </label>
        <div className="mt-1 text-xs text-zinc-500">
          {line.parsedSetCode
            ? `${line.parsedSetCode.toUpperCase()} ${line.parsedCollectorNumber ?? ""}`
            : "No set/collector"}
        </div>
      </td>
      <td className="p-2">
        <select
          value={line.section ?? DeckSection.MAINBOARD}
          onChange={(event) =>
            updateLine((current) => ({
              ...current,
              section: event.target.value as DeckSection,
            }))
          }
          className="border bg-zinc-900 p-1"
        >
          {deckSections.map((section) => (
            <option key={section} value={section}>
              {deckSectionLabel(section)}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2">
        <span
          className={
            resolvedStatuses.includes(line.resolutionStatus)
              ? "text-emerald-300"
              : "text-amber-200"
          }
        >
          {statusLabel[line.resolutionStatus]}
        </span>
        <div className="max-w-xs text-xs text-zinc-500">{message}</div>
      </td>
      <td className="p-2">
        {line.selectedCardSummary ? (
          <div>
            <div className="font-medium text-sky-100">
              {line.selectedCardSummary.name}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <SetSymbol
                setCode={line.selectedCardSummary.setCode}
                setName={line.selectedCardSummary.setName}
                rarity={line.selectedCardSummary.rarity}
              />
              #{line.selectedCardSummary.collectorNumber} ·{" "}
              {line.selectedCardSummary.priceUsd == null
                ? "—"
                : `$${line.selectedCardSummary.priceUsd.toFixed(2)}`}
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
        <div className="space-y-2">
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-1"
            onClick={() => setManualOpen((open) => !open)}
          >
            {line.selectedCardId ? "Change printing" : "Resolve"}
          </button>
          <button
            type="button"
            className="block rounded border border-zinc-700 px-2 py-1"
            onClick={() =>
              updateLine((current) => ({
                ...current,
                included: !current.included,
              }))
            }
          >
            {line.included ? "Exclude" : "Re-include"}
          </button>
          {manualOpen ? (
            <ManualResolve line={line} updateLine={updateLine} />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function ManualResolve({
  line,
  updateLine,
}: {
  line: DeckImportReviewLine;
  updateLine: (
    updater: (line: DeckImportReviewLine) => DeckImportReviewLine,
  ) => void;
}) {
  const [query, setQuery] = useState(line.parsedName ?? "");
  const [results, setResults] = useState<DeckCardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const id = ++requestId.current;
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/decks/card-search?${new URLSearchParams({ q: trimmed, scryfall: "1" }).toString()}`,
        );
        if (!res.ok) throw new Error("Search failed.");
        const json = (await res.json()) as DeckCardSearchResponse;
        if (requestId.current === id) setResults(json.results);
      } catch (e) {
        if (requestId.current === id)
          setError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [query]);

  return (
    <div className="w-80 space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2">
      <input
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setResults([]);
          setError("");
          setLoading(next.trim().length >= 2);
        }}
        className="w-full border bg-zinc-900 p-1"
        placeholder="Search printing"
      />
      <div className="text-xs text-zinc-400">
        {loading
          ? "Searching…"
          : error ||
            (!results.length && query.trim().length >= 2
              ? "No results yet."
              : "")}
      </div>
      <div className="max-h-72 space-y-1 overflow-auto">
        {results.map((result) => (
          <button
            key={result.cardId}
            type="button"
            className={`block w-full rounded border p-2 text-left text-xs ${result.ownedExactQuantity ? "border-emerald-800 bg-emerald-950/30" : "border-zinc-800"}`}
            onClick={() =>
              updateLine((current) => ({
                ...current,
                selectedCardId: result.cardId,
                selectedCardSummary: {
                  cardId: result.cardId,
                  scryfallId: result.scryfallId,
                  name: result.name,
                  setCode: result.setCode,
                  setName: result.setName,
                  collectorNumber: result.collectorNumber,
                  rarity: result.rarity,
                  priceUsd: result.priceUsd,
                },
                ownedQuantity: result.ownedExactQuantity,
                locationSummary: result.locationSummary || null,
                resolutionStatus: "MANUALLY_SELECTED",
                resolutionMessage: "Printing manually selected during review.",
                errors: [],
                included: true,
              }))
            }
          >
            <strong>{result.name}</strong> · {result.setCode.toUpperCase()} #
            {result.collectorNumber} · {result.priceLabel}
            <span className="block text-zinc-400">
              {result.ownedExactQuantity
                ? `Owned: ${result.ownedExactQuantity}`
                : "Not owned"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
