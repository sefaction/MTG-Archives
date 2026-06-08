"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeckSection } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { CardManaCost, SetSymbol } from "@/components/mtg/CardSymbols";
import { ManaCost } from "@/components/mtg/ManaCost";
import { deckSectionLabel } from "@/lib/decks";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import type { DeckOptimizationPreview } from "@/lib/deck-optimization";
import { removeDeckCard, updateDeckCard } from "@/app/decks/actions";

export type DeckEditorRow = {
  id: string;
  cardName: string;
  section: DeckSection;
  quantity: number;
  notes: string | null;
  isCommander: boolean;
  exactOwned: number;
  otherOwned: number;
  missing: number;
  enoughOwned: boolean;
  matchType: string;
  locationSummary: string;
  card: {
    id: string;
    name: string;
    manaCost: string | null;
    manaFaces: unknown;
    cardFaces: unknown;
    layout: string | null;
    typeLine: string;
    setCode: string;
    setName: string | null;
    collectorNumber: string;
    rarity: string;
    prices: unknown;
  } | null;
};

function priceLabel(prices: unknown) {
  const values = (prices ?? {}) as Record<string, string | null | undefined>;
  const value = values.usd ?? values.usd_foil ?? values.usd_etched;
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : "—";
}

export function DeckListEditor({
  deckId,
  rows,
  sections,
  canEdit,
}: {
  deckId: string;
  rows: DeckEditorRow[];
  sections: DeckSection[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeckOptimizationPreview | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [moveSection, setMoveSection] = useState<DeckSection>(
    DeckSection.MAINBOARD,
  );
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );
  const selectedQuantity = selectedRows.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const missingIds = rows.filter((row) => row.missing > 0).map((row) => row.id);
  const unownedExactIds = rows
    .filter((row) => row.exactOwned < row.quantity)
    .map((row) => row.id);
  const otherOwnedIds = rows
    .filter((row) => row.exactOwned < row.quantity && row.otherOwned > 0)
    .map((row) => row.id);

  function selectIds(ids: string[]) {
    setSelected(new Set(ids));
    setPreview(null);
    setMessage("");
  }

  async function loadPreview(mode: "owned" | "cheapest", rowIds: string[]) {
    if (!rowIds.length) {
      setMessage("Select at least one deck row first.");
      return;
    }
    setPending(`Previewing ${mode} printing changes…`);
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/optimize-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, rowIds }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Preview failed.");
      const json = (await res.json()) as DeckOptimizationPreview;
      setPreview(json);
      setIncluded(
        new Set(
          json.rows
            .filter((row) => row.willChange)
            .map((row) => row.deckCardId),
        ),
      );
      setMessage(
        `${json.summary.analyzedRows} rows analyzed · ${json.summary.changeRows} changes available · ${json.summary.noChangeRows} unchanged/no suitable change.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setPending("");
    }
  }

  async function applyPreview() {
    if (!preview) return;
    setPending("Applying printing changes…");
    setMessage("");
    try {
      const changes = preview.rows
        .filter(
          (row) =>
            row.willChange && row.proposed && included.has(row.deckCardId),
        )
        .map((row) => ({
          deckCardId: row.deckCardId,
          proposedCardId: row.proposed!.cardId,
          include: true,
        }));
      const res = await fetch(`/api/decks/${deckId}/optimize-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Apply failed.");
      const result = (await res.json()) as {
        updatedRows: number;
        mergedRows: number;
      };
      setMessage(
        `Applied printing changes: ${result.updatedRows} rows updated · ${result.mergedRows} rows merged.`,
      );
      setSelected(new Set());
      setPreview(null);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Apply failed.");
    } finally {
      setPending("");
    }
  }

  async function bulkMove() {
    const rowIds = [...selected];
    if (!rowIds.length) return;
    setPending("Moving selected rows…");
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/bulk-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIds, section: moveSection }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Bulk move failed.");
      const result = (await res.json()) as {
        movedRows: number;
        mergedRows: number;
      };
      setMessage(
        `${result.movedRows} rows moved · ${result.mergedRows} rows merged.`,
      );
      setSelected(new Set());
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk move failed.");
    } finally {
      setPending("");
    }
  }

  async function bulkRemove() {
    const rowIds = [...selected];
    if (!rowIds.length) return;
    if (
      !window.confirm(
        `Remove ${rowIds.length} deck rows (${selectedQuantity} total cards) from this deck? Inventory will not be modified.`,
      )
    )
      return;
    setPending("Removing selected rows…");
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/bulk-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIds }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Bulk remove failed.");
      const result = (await res.json()) as {
        deletedRows: number;
        deletedQuantity: number;
      };
      setMessage(
        `Removed ${result.deletedRows} rows (${result.deletedQuantity} total cards).`,
      );
      setSelected(new Set());
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Bulk remove failed.",
      );
    } finally {
      setPending("");
    }
  }

  return (
    <section className="space-y-4">
      {canEdit ? (
        <div className="sticky top-0 z-10 space-y-3 rounded border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Deck list tools</span>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(rows.map((row) => row.id))}
            >
              Select all rows
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(missingIds)}
            >
              Select missing
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(unownedExactIds)}
            >
              Select unowned exact printings
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds([])}
            >
              Clear selection
            </button>
            <button
              type="button"
              className="rounded border border-emerald-700 px-2 py-1 text-emerald-100"
              disabled={Boolean(pending)}
              onClick={() => loadPreview("owned", otherOwnedIds)}
            >
              Switch missing to owned printings
            </button>
            <button
              type="button"
              className="rounded border border-sky-700 px-2 py-1 text-sky-100"
              disabled={Boolean(pending)}
              onClick={() => loadPreview("cheapest", missingIds)}
            >
              Switch missing to cheapest printings
            </button>
          </div>
          {selectedRows.length ? (
            <div className="flex flex-wrap items-center gap-2 rounded border border-sky-900 bg-sky-950/30 p-2 text-sm">
              <strong>{selectedRows.length} rows selected</strong>
              <span className="text-zinc-300">
                {selectedQuantity} total cards
              </span>
              <button
                type="button"
                className="rounded border border-emerald-700 px-2 py-1 text-emerald-100"
                disabled={Boolean(pending)}
                onClick={() => loadPreview("owned", [...selected])}
              >
                Switch selected to owned printings
              </button>
              <button
                type="button"
                className="rounded border border-sky-700 px-2 py-1 text-sky-100"
                disabled={Boolean(pending)}
                onClick={() => loadPreview("cheapest", [...selected])}
              >
                Switch selected to cheapest printings
              </button>
              <select
                value={moveSection}
                onChange={(event) =>
                  setMoveSection(event.target.value as DeckSection)
                }
                className="border bg-zinc-900 p-1"
              >
                {sections.map((section) => (
                  <option key={section} value={section}>
                    {deckSectionLabel(section)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded border border-zinc-700 px-2 py-1"
                disabled={Boolean(pending)}
                onClick={bulkMove}
              >
                Move selected
              </button>
              <button
                type="button"
                className="rounded border border-red-800 px-2 py-1 text-red-200"
                disabled={Boolean(pending)}
                onClick={bulkRemove}
              >
                Remove selected
              </button>
            </div>
          ) : null}
          <p className="text-sm text-zinc-400" aria-live="polite">
            {pending || message}
          </p>
        </div>
      ) : null}

      {canEdit && preview ? (
        <OptimizationPreview
          preview={preview}
          included={included}
          setIncluded={setIncluded}
          applyPreview={applyPreview}
          cancel={() => setPreview(null)}
          pending={Boolean(pending)}
        />
      ) : null}

      {sections.map((section) => {
        const sectionRows = rows.filter((row) => row.section === section);
        return (
          <div key={section} className="rounded border border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 p-3">
              <h2 className="text-xl font-semibold">
                {deckSectionLabel(section)}
              </h2>
              {canEdit ? (
                <button
                  type="button"
                  className="rounded border border-zinc-700 px-2 py-1 text-sm"
                  onClick={() => selectIds(sectionRows.map((row) => row.id))}
                >
                  Select {deckSectionLabel(section)} rows
                </button>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-zinc-300">
                  <tr>
                    {canEdit ? <th className="p-3">Select</th> : null}
                    <th className="p-3">Qty</th>
                    <th className="p-3">Card</th>
                    <th className="p-3">Mana</th>
                    <th className="p-3">Set</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Owned</th>
                    {canEdit ? <th className="p-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map((row) => (
                    <DeckEditorTableRow
                      key={row.id}
                      deckId={deckId}
                      row={row}
                      sections={sections}
                      canEdit={canEdit}
                      selected={selected.has(row.id)}
                      expanded={expanded === row.id}
                      toggleSelected={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                      toggleExpanded={() =>
                        setExpanded(expanded === row.id ? null : row.id)
                      }
                      previewOwned={() => loadPreview("owned", [row.id])}
                      previewCheapest={() => loadPreview("cheapest", [row.id])}
                    />
                  ))}
                  {sectionRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={canEdit ? 8 : 6}
                        className="p-4 text-zinc-500"
                      >
                        No cards in this section.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DeckEditorTableRow({
  deckId,
  row,
  sections,
  canEdit,
  selected,
  expanded,
  toggleSelected,
  toggleExpanded,
  previewOwned,
  previewCheapest,
}: {
  deckId: string;
  row: DeckEditorRow;
  sections: DeckSection[];
  canEdit: boolean;
  selected: boolean;
  expanded: boolean;
  toggleSelected: (checked: boolean) => void;
  toggleExpanded: () => void;
  previewOwned: () => void;
  previewCheapest: () => void;
}) {
  return (
    <>
      <tr className="border-t border-zinc-800 align-top hover:bg-zinc-900/40">
        {canEdit ? (
          <td className="p-3">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => toggleSelected(event.target.checked)}
            />
          </td>
        ) : null}
        <td className="p-3 font-semibold">{row.quantity}</td>
        <td className="p-3">
          {canEdit ? (
            <button
              type="button"
              className="text-left text-sky-100 hover:underline"
              onClick={toggleExpanded}
            >
              {row.cardName}
            </button>
          ) : (
            <span className="text-sky-100">{row.cardName}</span>
          )}
          <div className="text-xs text-zinc-500">{row.matchType}</div>
          {row.notes ? (
            <div className="mt-1 text-xs text-zinc-400">Notes: {row.notes}</div>
          ) : null}
        </td>
        <td className="p-3">
          {row.card ? (
            <CardManaCost card={row.card as any} />
          ) : (
            <span className="text-zinc-500">-</span>
          )}
        </td>
        <td className="p-3">
          {row.card ? (
            <SetSymbol
              setCode={row.card.setCode}
              setName={row.card.setName}
              rarity={row.card.rarity}
            />
          ) : (
            <span className="text-zinc-500">Generic</span>
          )}
        </td>
        <td className="p-3">
          {row.card?.typeLine ?? (
            <span className="text-zinc-500">Unresolved</span>
          )}
        </td>
        <td className="p-3">
          <span
            className={row.enoughOwned ? "text-emerald-300" : "text-amber-200"}
          >
            Exact {row.exactOwned} / {row.quantity}
          </span>
          <div>Other printings: {row.otherOwned}</div>
          <div>
            {row.missing > 0 ? `Missing: ${row.missing}` : "Enough owned"}
          </div>
          {row.locationSummary ? (
            <div className="text-xs text-zinc-400">
              Owned in {row.locationSummary}
            </div>
          ) : null}
        </td>
        {canEdit ? (
          <td className="p-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-zinc-700 px-2 py-1"
                onClick={toggleExpanded}
              >
                {expanded ? "Close editor" : "Edit"}
              </button>
              <button
                type="button"
                className="rounded border border-emerald-700 px-2 py-1 text-emerald-100"
                onClick={previewOwned}
              >
                Use owned printing
              </button>
              <button
                type="button"
                className="rounded border border-sky-700 px-2 py-1 text-sky-100"
                onClick={previewCheapest}
              >
                Use cheapest printing
              </button>
            </div>
          </td>
        ) : null}
      </tr>
      {canEdit && expanded ? (
        <tr className="border-t border-sky-900 bg-sky-950/10 align-top">
          <td colSpan={8} className="p-4">
            <RowEditor deckId={deckId} row={row} sections={sections} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RowEditor({
  deckId,
  row,
  sections,
}: {
  deckId: string;
  row: DeckEditorRow;
  sections: DeckSection[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <form
        action={updateDeckCard}
        className="grid gap-3 rounded border border-zinc-800 p-3 md:grid-cols-3"
      >
        <input type="hidden" name="deckId" value={deckId} />
        <input type="hidden" name="deckCardId" value={row.id} />
        <div className="md:col-span-3 text-sm text-zinc-300">
          Current printing:{" "}
          {row.card
            ? `${row.card.setCode.toUpperCase()} #${row.card.collectorNumber} · ${priceLabel(row.card.prices)}`
            : "No selected printing"}
        </div>
        <label className="text-sm">
          Quantity
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={row.quantity}
            className="mt-1 w-full border bg-zinc-900 p-2"
          />
        </label>
        <label className="text-sm">
          Section
          <select
            name="section"
            defaultValue={row.section}
            className="mt-1 w-full border bg-zinc-900 p-2"
          >
            {sections.map((section) => (
              <option key={section} value={section}>
                {deckSectionLabel(section)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-3">
          Notes
          <textarea
            name="notes"
            defaultValue={row.notes ?? ""}
            className="mt-1 w-full border bg-zinc-900 p-2"
            rows={3}
          />
        </label>
        <SubmitButton
          pendingLabel="Saving…"
          className="rounded border border-sky-700 px-3 py-2 text-sky-100 md:col-span-2"
        >
          Save row edits
        </SubmitButton>
      </form>
      <div className="space-y-3 rounded border border-zinc-800 p-3">
        <h3 className="font-semibold">Change selected printing</h3>
        <p className="text-sm text-zinc-400">
          Search uses the deck printing picker ordering, with owned printings
          first. Quantity, section, and notes are preserved.
        </p>
        <PrintingSearch deckId={deckId} row={row} />
        <form action={removeDeckCard}>
          <input type="hidden" name="deckId" value={deckId} />
          <input type="hidden" name="deckCardId" value={row.id} />
          <SubmitButton
            pendingLabel="Removing…"
            className="rounded border border-red-800 px-3 py-2 text-red-200"
            confirmMessage={`Remove ${row.quantity} ${row.cardName} from this deck? Inventory will not be modified.`}
          >
            Remove row
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function PrintingSearch({
  deckId,
  row,
}: {
  deckId: string;
  row: DeckEditorRow;
}) {
  const [query, setQuery] = useState(row.cardName);
  const [includeScryfall, setIncludeScryfall] = useState(false);
  const [response, setResponse] = useState<DeckCardSearchResponse | null>(null);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
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
      } catch (error) {
        if (requestId.current === id)
          setMessage(error instanceof Error ? error.message : "Search failed.");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [query, includeScryfall]);

  async function changePrinting() {
    if (!selected) return;
    setMessage("Changing printing…");
    try {
      const res = await fetch(
        `/api/decks/${deckId}/cards/${row.id}/change-printing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: selected.cardId }),
        },
      );
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Change printing failed.");
      const result = (await res.json()) as {
        updatedRows: number;
        mergedRows: number;
      };
      setMessage(
        `Printing updated: ${result.updatedRows} row updated · ${result.mergedRows} row merged. Refreshing…`,
      );
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Change printing failed.",
      );
    }
  }

  const results = response?.results ?? [];
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        Search printings
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLoading(event.target.value.trim().length >= 2);
            setSelected(null);
            setMessage("");
          }}
          className="mt-1 w-full border bg-zinc-900 p-2"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={includeScryfall}
          onChange={(event) => {
            setIncludeScryfall(event.target.checked);
            setLoading(query.trim().length >= 2);
          }}
        />
        Broaden with Scryfall results
      </label>
      <p className="text-sm text-zinc-400" aria-live="polite">
        {loading ? "Searching…" : message || response?.message}
      </p>
      <div className="max-h-64 space-y-2 overflow-auto">
        {results.map((result) => (
          <button
            key={result.cardId}
            type="button"
            onClick={() => setSelected(result)}
            className={`w-full rounded border p-2 text-left ${selected?.cardId === result.cardId ? "border-sky-500 bg-sky-950/30" : result.ownedExactQuantity > 0 ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800"}`}
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
              {result.setName} · {result.setCode.toUpperCase()} #
              {result.collectorNumber} · {result.rarity} · {result.priceLabel}
            </span>
            <span className="block text-xs text-zinc-300">
              Exact owned {result.ownedExactQuantity} · Other printings owned{" "}
              {result.ownedOtherPrintingQuantity}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!selected}
        className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
        onClick={changePrinting}
      >
        Change to selected printing
      </button>
    </div>
  );
}

function OptimizationPreview({
  preview,
  included,
  setIncluded,
  applyPreview,
  cancel,
  pending,
}: {
  preview: DeckOptimizationPreview;
  included: Set<string>;
  setIncluded: React.Dispatch<React.SetStateAction<Set<string>>>;
  applyPreview: () => void;
  cancel: () => void;
  pending: boolean;
}) {
  return (
    <section className="space-y-3 rounded border border-sky-900 bg-sky-950/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          Inline printing-change preview
        </h2>
        <p className="text-sm text-zinc-300">
          {preview.summary.changeRows} changes available ·{" "}
          {preview.summary.noChangeRows} unchanged/no suitable change
        </p>
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-left text-zinc-300">
            <tr>
              <th className="p-2">Apply</th>
              <th className="p-2">Current printing</th>
              <th className="p-2">Proposed printing</th>
              <th className="p-2">Needed</th>
              <th className="p-2">Owned</th>
              <th className="p-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr
                key={row.deckCardId}
                className="border-t border-zinc-800 align-top"
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    disabled={!row.willChange}
                    checked={included.has(row.deckCardId)}
                    onChange={(event) =>
                      setIncluded((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.deckCardId);
                        else next.delete(row.deckCardId);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="p-2">
                  {row.current ? (
                    <PreviewPrinting printing={row.current} />
                  ) : (
                    "No printing"
                  )}
                </td>
                <td className="p-2">
                  {row.proposed ? (
                    <PreviewPrinting printing={row.proposed} />
                  ) : (
                    <span className="text-zinc-500">No proposed change</span>
                  )}
                </td>
                <td className="p-2">{row.quantity}</td>
                <td className="p-2">
                  Current {row.currentOwnedQuantity} · Proposed{" "}
                  {row.proposedOwnedQuantity}
                </td>
                <td className="p-2">
                  <span
                    className={
                      row.willChange ? "text-emerald-300" : "text-zinc-400"
                    }
                  >
                    {row.statusLabel}
                  </span>
                  {row.warnings.map((warning) => (
                    <div key={warning} className="text-xs text-amber-200">
                      {warning}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={
          pending ||
          !preview.rows.some(
            (row) => row.willChange && included.has(row.deckCardId),
          )
        }
        className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
        onClick={applyPreview}
      >
        Apply selected preview changes
      </button>
      <button
        type="button"
        className="ml-2 rounded border border-zinc-700 px-3 py-2"
        onClick={cancel}
      >
        Cancel preview
      </button>
    </section>
  );
}

function PreviewPrinting({
  printing,
}: {
  printing: {
    name: string;
    setCode: string;
    setName: string | null;
    collectorNumber: string;
    rarity: string;
    priceUsd: number | null;
  };
}) {
  return (
    <div>
      <div className="font-medium text-sky-100">{printing.name}</div>
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <SetSymbol
          setCode={printing.setCode}
          setName={printing.setName}
          rarity={printing.rarity}
        />
        {printing.setCode.toUpperCase()} #{printing.collectorNumber} ·{" "}
        {printing.priceUsd == null ? "—" : `$${printing.priceUsd.toFixed(2)}`}
      </div>
    </div>
  );
}
