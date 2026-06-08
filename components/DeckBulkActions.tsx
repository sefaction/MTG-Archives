"use client";

import { useMemo, useState } from "react";
import { DeckSection } from "@prisma/client";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { deckSectionLabel } from "@/lib/decks";
import type { DeckOptimizationPreview } from "@/lib/deck-optimization";

export type DeckBulkActionRow = {
  id: string;
  cardName: string;
  section: DeckSection;
  quantity: number;
  exactOwned: number;
  otherOwned: number;
  missing: number;
};

export function DeckBulkActions({
  deckId,
  rows,
}: {
  deckId: string;
  rows: DeckBulkActionRow[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DeckOptimizationPreview | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  function setSelectedIds(ids: string[]) {
    setSelected(new Set(ids));
    setPreview(null);
    setMessage("");
  }

  async function loadPreview(mode: "owned" | "cheapest", rowIds?: string[]) {
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
        `Applied printing changes: ${result.updatedRows} rows updated · ${result.mergedRows} rows merged. Refreshing…`,
      );
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Apply failed.");
    } finally {
      setPending("");
    }
  }

  const missingIds = rows.filter((row) => row.missing > 0).map((row) => row.id);
  const otherOwnedIds = rows
    .filter((row) => row.exactOwned < row.quantity && row.otherOwned > 0)
    .map((row) => row.id);

  return (
    <section className="space-y-3 rounded border border-zinc-800 p-4">
      <h2 className="text-xl font-semibold">Bulk printing tools</h2>
      <p className="text-sm text-zinc-400">
        Select deck rows, preview printing swaps, then apply only the changes
        you include. Inventory is never modified.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1"
          onClick={() => setSelectedIds(rows.map((row) => row.id))}
        >
          Select all deck rows
        </button>
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1"
          onClick={() => setSelectedIds(missingIds)}
        >
          Select all missing/unowned rows
        </button>
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1"
          onClick={() => setSelectedIds(otherOwnedIds)}
        >
          Select exact-not-owned but other-owned
        </button>
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1"
          onClick={() => setSelectedIds([])}
        >
          Clear selection
        </button>
      </div>
      <div className="max-h-40 overflow-auto rounded border border-zinc-800 p-2 text-sm">
        {rows.map((row) => (
          <label
            key={row.id}
            className="flex items-center gap-2 border-b border-zinc-900 py-1 last:border-0"
          >
            <input
              type="checkbox"
              checked={selected.has(row.id)}
              onChange={(event) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(row.id);
                  else next.delete(row.id);
                  return next;
                })
              }
            />
            <span className="flex-1">
              {row.cardName} · {deckSectionLabel(row.section)} · Qty{" "}
              {row.quantity}
            </span>
            <span className="text-xs text-zinc-400">
              Exact {row.exactOwned} · Other {row.otherOwned} · Missing{" "}
              {row.missing}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          disabled={!selectedRows.length || Boolean(pending)}
          className="rounded border border-emerald-700 px-3 py-2 text-emerald-100 disabled:opacity-60"
          onClick={() => loadPreview("owned", [...selected])}
        >
          Switch selected to owned printings
        </button>
        <button
          type="button"
          disabled={!selectedRows.length || Boolean(pending)}
          className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
          onClick={() => loadPreview("cheapest", [...selected])}
        >
          Switch selected to cheapest printings
        </button>
        <button
          type="button"
          disabled={Boolean(pending)}
          className="rounded border border-emerald-700 px-3 py-2 text-emerald-100 disabled:opacity-60"
          onClick={() => loadPreview("owned", otherOwnedIds)}
        >
          Switch missing to owned printings
        </button>
        <button
          type="button"
          disabled={Boolean(pending)}
          className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
          onClick={() => loadPreview("cheapest", missingIds)}
        >
          Switch missing to cheapest printings
        </button>
      </div>
      <p className="text-sm text-zinc-400" aria-live="polite">
        {pending || message}
      </p>
      {preview ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900 text-left text-zinc-300">
                <tr>
                  <th className="p-2">Apply</th>
                  <th className="p-2">Current</th>
                  <th className="p-2">Proposed</th>
                  <th className="p-2">Needed</th>
                  <th className="p-2">Owned</th>
                  <th className="p-2">Status</th>
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
                        <PrintingSummary printing={row.current} />
                      ) : (
                        "No printing"
                      )}
                    </td>
                    <td className="p-2">
                      {row.proposed ? (
                        <PrintingSummary printing={row.proposed} />
                      ) : (
                        <span className="text-zinc-500">
                          No proposed change
                        </span>
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
              !preview.rows.some(
                (row) => row.willChange && included.has(row.deckCardId),
              ) || Boolean(pending)
            }
            className="rounded border border-sky-700 px-3 py-2 text-sky-100 disabled:opacity-60"
            onClick={applyPreview}
          >
            Apply changes
          </button>
          <button
            type="button"
            className="ml-2 rounded border border-zinc-700 px-3 py-2"
            onClick={() => setPreview(null)}
          >
            Cancel preview
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PrintingSummary({
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
        #{printing.collectorNumber} ·{" "}
        {printing.priceUsd == null ? "—" : `$${printing.priceUsd.toFixed(2)}`}
      </div>
    </div>
  );
}
