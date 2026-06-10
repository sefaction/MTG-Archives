"use client";

import { useMemo, useRef, useState } from "react";
import { DeckSection } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { ManaCost } from "@/components/mtg/ManaCost";
import {
  bulkCommitDeckCardsToDeck,
  commitDeckCardToDeck,
  removeDeckCard,
  returnDeckCardToInventory,
  updateDeckCard,
} from "@/app/decks/actions";
import { deckSectionLabel } from "@/lib/decks";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import type { DeckOptimizationPreview } from "@/lib/deck-optimization";
import {
  buildDeckGroups,
  cardManaValue,
  cardPriceNumber,
  ownershipStatus,
  type DeckGroupMode,
  type DeckSortMode,
  type DeckViewMode,
} from "@/lib/deck-view";

export type DeckReturnLocation = { id: string; name: string };

export type DeckEditorRow = {
  id: string;
  cardName: string;
  section: DeckSection;
  quantity: number;
  notes: string | null;
  isCommander: boolean;
  exactOwned: number;
  otherOwned: number;
  available: number;
  availableExact: number;
  availableOther: number;
  committedToThisDeck: number;
  committedToOtherDecks: number;
  commitmentMissing: number;
  commitOptions: Array<{
    inventoryItemId: string;
    locationName: string;
    quantity: number;
    cardName: string;
    setCode: string;
    collectorNumber: string;
    matchType: "exact" | "other";
  }>;
  returnOptions: Array<{
    inventoryItemId: string;
    quantity: number;
    cardName: string;
    setCode: string;
    collectorNumber: string;
  }>;
  missing: number;
  enoughOwned: boolean;
  matchType: string;
  locationSummary: string;
  committedQuantity: number;
  createdAt: string;
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
    imageUri: string | null;
    imageUris: unknown;
    manaValue: number | null;
    colorIdentity: unknown;
    colors: unknown;
  } | null;
};

const viewModes: Array<{ value: DeckViewMode; label: string }> = [
  { value: "text", label: "Text" },
  { value: "grid", label: "Visual grid" },
  { value: "spoiler", label: "Visual spoiler" },
];

const groupModes: Array<{ value: DeckGroupMode; label: string }> = [
  { value: "type", label: "Type" },
  { value: "section", label: "Section" },
  { value: "mana", label: "Mana value" },
  { value: "color", label: "Color" },
  { value: "rarity", label: "Rarity" },
  { value: "set", label: "Set" },
  { value: "owned", label: "Owned status" },
];

const sortModes: Array<{ value: DeckSortMode; label: string }> = [
  { value: "name", label: "Name" },
  { value: "mana", label: "Mana value" },
  { value: "type", label: "Type" },
  { value: "color", label: "Color" },
  { value: "price", label: "Price" },
  { value: "owned", label: "Owned status" },
  { value: "set", label: "Set" },
  { value: "added", label: "Date added" },
];

function priceLabel(prices: unknown) {
  const price = cardPriceNumber(prices);
  return price == null ? "—" : `$${price.toFixed(2)}`;
}

function imageUri(row: DeckEditorRow) {
  const images = row.card?.imageUris as
    | { normal?: string; small?: string; art_crop?: string }
    | null
    | undefined;
  return images?.normal ?? images?.small ?? row.card?.imageUri ?? "";
}

function ownedBadge(row: DeckEditorRow, showLocations: boolean) {
  const status = ownershipStatus(row);
  const color =
    status === "Owned exact"
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
      : status === "Owned other printing"
        ? "border-sky-700 bg-sky-950/40 text-sky-100"
        : status === "Partial"
          ? "border-amber-700 bg-amber-950/40 text-amber-100"
          : "border-red-800 bg-red-950/30 text-red-100";
  return (
    <span
      className={`inline-flex flex-wrap gap-1 rounded border px-2 py-0.5 text-xs ${color}`}
    >
      <span>{status}</span>
      <span>
        Exact {row.exactOwned}/{row.quantity}
      </span>
      {row.otherOwned ? <span>· Other {row.otherOwned}</span> : null}
      {row.missing ? <span>· Missing {row.missing}</span> : null}
      {showLocations && row.locationSummary ? (
        <span>· {row.locationSummary}</span>
      ) : null}
    </span>
  );
}

export function DeckListEditor({
  deckId,
  rows,
  sections,
  canEdit,
  defaultGroupMode = "type",
  showPrivateInventory = false,
  returnLocations = [],
}: {
  deckId: string;
  rows: DeckEditorRow[];
  sections: DeckSection[];
  canEdit: boolean;
  defaultGroupMode?: DeckGroupMode;
  showPrivateInventory?: boolean;
  returnLocations?: DeckReturnLocation[];
}) {
  const [viewMode, setViewMode] = useState<DeckViewMode>("text");
  const [groupMode, setGroupMode] = useState<DeckGroupMode>(defaultGroupMode);
  const [sortMode, setSortMode] = useState<DeckSortMode>("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeckOptimizationPreview | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [moveSection, setMoveSection] = useState<DeckSection>(
    DeckSection.MAINBOARD,
  );
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [returnDestinationId, setReturnDestinationId] = useState("");

  const groups = useMemo(
    () => buildDeckGroups(rows, groupMode, sortMode),
    [rows, groupMode, sortMode],
  );
  const currentGroupRows = groups.flatMap((group) => group.rows);
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );
  const selectedQuantity = selectedRows.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const selectedCommittedQuantity = selectedRows.reduce(
    (total, row) => total + row.committedQuantity,
    0,
  );
  const missingIds = rows.filter((row) => row.missing > 0).map((row) => row.id);
  const unownedExactIds = rows
    .filter((row) => row.exactOwned < row.quantity)
    .map((row) => row.id);
  const otherOwnedIds = rows
    .filter((row) => row.exactOwned < row.quantity && row.otherOwned > 0)
    .map((row) => row.id);
  const bulkCommitMoves = rows
    .map((row) => {
      const option = [...row.commitOptions].sort((left, right) => {
        if (left.matchType !== right.matchType)
          return left.matchType === "exact" ? -1 : 1;
        return left.locationName.localeCompare(right.locationName);
      })[0];
      const quantity = Math.min(row.commitmentMissing, option?.quantity ?? 0);
      if (!option || quantity <= 0) return null;
      return {
        deckCardId: row.id,
        inventoryItemId: option.inventoryItemId,
        quantity,
        cardName: row.cardName,
        source: option.locationName,
        availableExact: row.availableExact,
        availableOther: row.availableOther,
        alreadyCommitted: row.committedToThisDeck,
        needed: row.quantity,
        remainingMissing: Math.max(0, row.commitmentMissing - quantity),
        warning:
          option.matchType === "exact"
            ? ""
            : "Uses another owned printing and updates this deck row.",
      };
    })
    .filter((move): move is NonNullable<typeof move> => Boolean(move));

  function selectIds(ids: string[]) {
    setSelected(new Set(ids));
    setPreview(null);
    setMessage("");
  }

  function toggleSelected(rowId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  async function loadPreview(mode: "owned" | "cheapest", rowIds: string[]) {
    if (!canEdit) return;
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
    if (!preview || !canEdit) return;
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
    if (!rowIds.length || !canEdit) return;
    setPending("Moving selected rows…");
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/bulk-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIds,
          section: moveSection,
          destinationLocationId: returnDestinationId,
          maybeboardCommittedMode:
            moveSection === DeckSection.MAYBEBOARD &&
            selectedCommittedQuantity > 0
              ? returnDestinationId
                ? "return"
                : ""
              : undefined,
        }),
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
    if (!rowIds.length || !canEdit) return;
    if (
      !window.confirm(
        `Remove ${rowIds.length} deck entries (${selectedQuantity} total cards) from this deck? Inventory will not be modified.`,
      )
    )
      return;
    setPending("Removing selected rows…");
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/bulk-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIds,
          destinationLocationId: returnDestinationId,
        }),
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

  async function returnSelectedCommitted() {
    const rowIds = [...selected];
    if (!rowIds.length || !canEdit) return;
    if (!returnDestinationId) {
      setMessage(
        "Choose a destination location for returned committed inventory.",
      );
      return;
    }
    setPending("Returning selected committed cards…");
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/return-committed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIds,
          destinationLocationId: returnDestinationId,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Return failed.");
      const result = (await res.json()) as {
        movedEntries: number;
        movedCards: number;
        skippedEntries: number;
        destinationLocationName: string;
      };
      setMessage(
        `Returned ${result.movedCards} committed cards to ${result.destinationLocationName}. ${result.skippedEntries} selected inventory entries had no committed copies.`,
      );
      setSelected(new Set());
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Return failed.");
    } finally {
      setPending("");
    }
  }
  return (
    <section className="space-y-4" id="deck-workspace">
      <div className="rounded border border-zinc-800 bg-zinc-950/80 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            View
            <select
              value={viewMode}
              onChange={(event) =>
                setViewMode(event.target.value as DeckViewMode)
              }
              className="ml-2 border bg-zinc-900 p-2"
            >
              {viewModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Group by
            <select
              value={groupMode}
              onChange={(event) =>
                setGroupMode(event.target.value as DeckGroupMode)
              }
              className="ml-2 border bg-zinc-900 p-2"
            >
              {groupModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Sort by
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as DeckSortMode)
              }
              className="ml-2 border bg-zinc-900 p-2"
            >
              {sortModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-zinc-400">
            {rows.reduce((total, row) => total + row.quantity, 0)} cards ·{" "}
            {rows.length} rows · data preserved while switching views
          </div>
        </div>
      </div>

      {canEdit ? (
        <div
          className="sticky top-0 z-10 space-y-3 rounded border border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur"
          id="bulk-edit"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Bulk tools</span>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(currentGroupRows.map((row) => row.id))}
            >
              Select all in current view
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(missingIds)}
            >
              Select all missing
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds(unownedExactIds)}
            >
              Select all unowned exact printings
            </button>
            <button
              type="button"
              className="rounded border border-zinc-700 px-2 py-1"
              onClick={() => selectIds([])}
            >
              Clear selection
            </button>
            <label className="flex items-center gap-1 text-xs text-zinc-300">
              Return destination
              <select
                value={returnDestinationId}
                onChange={(event) => setReturnDestinationId(event.target.value)}
                className="border bg-zinc-900 p-1"
              >
                <option value="">Choose…</option>
                {returnLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-emerald-700 px-2 py-1 text-emerald-100"
              disabled={Boolean(pending)}
              onClick={() => loadPreview("owned", otherOwnedIds)}
            >
              Preview missing → owned
            </button>
            <button
              type="button"
              className="rounded border border-sky-700 px-2 py-1 text-sky-100"
              disabled={Boolean(pending)}
              onClick={() => loadPreview("cheapest", missingIds)}
            >
              Preview missing → cheapest
            </button>
          </div>
          {selectedRows.length ? (
            <div className="flex flex-wrap items-center gap-2 rounded border border-sky-900 bg-sky-950/30 p-2 text-sm">
              <strong>{selectedRows.length} rows selected</strong>
              <span className="text-zinc-300">
                {selectedQuantity} deck-list cards · {selectedCommittedQuantity}{" "}
                physically committed
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
                className="rounded border border-amber-700 px-2 py-1 text-amber-100"
                disabled={Boolean(pending) || selectedCommittedQuantity === 0}
                onClick={returnSelectedCommitted}
              >
                Return selected committed cards
              </button>
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
            {pending ||
              message ||
              "Select cards to move, remove, or preview printing optimization without changing inventory."}
          </p>
        </div>
      ) : (
        <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-400">
          Read-only deck view. You can change view, grouping, sorting, and open
          card details; editing and inventory locations are hidden.
        </p>
      )}

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

      {viewMode === "text" ? (
        <TextDeckView
          deckId={deckId}
          groups={groups}
          sections={sections}
          canEdit={canEdit}
          selected={selected}
          expanded={expanded}
          setExpanded={setExpanded}
          toggleSelected={toggleSelected}
          previewOwned={(rowId) => loadPreview("owned", [rowId])}
          previewCheapest={(rowId) => loadPreview("cheapest", [rowId])}
          showPrivateInventory={showPrivateInventory}
          returnLocations={returnLocations}
        />
      ) : (
        <VisualDeckView
          deckId={deckId}
          groups={groups}
          sections={sections}
          canEdit={canEdit}
          selected={selected}
          expanded={expanded}
          setExpanded={setExpanded}
          toggleSelected={toggleSelected}
          previewOwned={(rowId) => loadPreview("owned", [rowId])}
          previewCheapest={(rowId) => loadPreview("cheapest", [rowId])}
          mode={viewMode}
          showPrivateInventory={showPrivateInventory}
          returnLocations={returnLocations}
        />
      )}

      {rows.length === 0 ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          No cards in this deck yet.
        </p>
      ) : null}
    </section>
  );
}

function TextDeckView(props: {
  deckId: string;
  groups: Array<{ label: string; rows: DeckEditorRow[]; quantity: number }>;
  sections: DeckSection[];
  canEdit: boolean;
  selected: Set<string>;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  toggleSelected: (rowId: string, checked: boolean) => void;
  previewOwned: (rowId: string) => void;
  previewCheapest: (rowId: string) => void;
  showPrivateInventory: boolean;
  returnLocations: DeckReturnLocation[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {props.groups.map((group) => (
        <section key={group.label} className="rounded border border-zinc-800">
          <GroupHeader
            label={group.label}
            rows={group.rows}
            quantity={group.quantity}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-zinc-300">
                <tr>
                  {props.canEdit ? <th className="p-3">Select</th> : null}
                  <th className="p-3">Qty</th>
                  <th className="p-3">Card</th>
                  <th className="p-3">Mana</th>
                  <th className="p-3">Printing</th>
                  <th className="p-3">Owned</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <TextDeckRow key={row.id} row={row} {...props} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TextDeckRow({
  row,
  ...props
}: { row: DeckEditorRow } & Parameters<typeof TextDeckView>[0]) {
  const expanded = props.expanded === row.id;
  return (
    <>
      <tr className="border-t border-zinc-800 align-top hover:bg-zinc-900/40">
        {props.canEdit ? (
          <td className="p-3">
            <input
              aria-label={`Select ${row.cardName}`}
              type="checkbox"
              checked={props.selected.has(row.id)}
              onChange={(event) =>
                props.toggleSelected(row.id, event.target.checked)
              }
            />
          </td>
        ) : null}
        <td className="p-3 font-semibold">{row.quantity}</td>
        <td className="p-3">
          <button
            type="button"
            className="text-left text-sky-100 hover:underline"
            onClick={() => props.setExpanded(expanded ? null : row.id)}
          >
            {row.cardName}
          </button>
          <div className="text-xs text-zinc-500">
            {row.card?.typeLine ?? row.matchType}
          </div>
          {row.notes ? (
            <div className="mt-1 text-xs text-zinc-400">Notes: {row.notes}</div>
          ) : null}
        </td>
        <td className="p-3">
          <ManaCost value={row.card?.manaCost ?? null} />
        </td>
        <td className="p-3">
          {row.card ? (
            <>
              <SetSymbol
                setCode={row.card.setCode}
                setName={row.card.setName}
                rarity={row.card.rarity}
              />{" "}
              <span className="text-xs text-zinc-400">
                #{row.card.collectorNumber} · {priceLabel(row.card.prices)}
              </span>
            </>
          ) : (
            <span className="text-zinc-500">Generic</span>
          )}
        </td>
        <td className="p-3">{ownedBadge(row, props.showPrivateInventory)}</td>
        <td className="p-3">
          <CardActions
            canEdit={props.canEdit}
            expanded={expanded}
            toggleExpanded={() => props.setExpanded(expanded ? null : row.id)}
            previewOwned={() => props.previewOwned(row.id)}
            previewCheapest={() => props.previewCheapest(row.id)}
          />
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-sky-900 bg-sky-950/10 align-top">
          <td colSpan={props.canEdit ? 7 : 6} className="p-4">
            <RowEditor
              deckId={props.deckId}
              row={row}
              sections={props.sections}
              canEdit={props.canEdit}
              showPrivateInventory={props.showPrivateInventory}
              returnLocations={props.returnLocations}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function VisualDeckView(
  props: Parameters<typeof TextDeckView>[0] & { mode: "grid" | "spoiler" },
) {
  const tileClass = props.mode === "spoiler" ? "w-56" : "w-40";
  return (
    <div className="space-y-4">
      {props.groups.map((group) => (
        <section
          key={group.label}
          className="rounded border border-zinc-800 p-3"
        >
          <GroupHeader
            label={group.label}
            rows={group.rows}
            quantity={group.quantity}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            {group.rows.map((row) => {
              const expanded = props.expanded === row.id;
              return (
                <article
                  key={row.id}
                  className={`${tileClass} rounded border border-zinc-800 bg-zinc-950 p-2`}
                >
                  {props.canEdit ? (
                    <input
                      aria-label={`Select ${row.cardName}`}
                      type="checkbox"
                      checked={props.selected.has(row.id)}
                      onChange={(event) =>
                        props.toggleSelected(row.id, event.target.checked)
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className="mt-1 block w-full text-left"
                    onClick={() => props.setExpanded(expanded ? null : row.id)}
                  >
                    {imageUri(row) ? (
                      <img
                        src={imageUri(row)}
                        alt=""
                        className="aspect-[488/680] w-full rounded object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[488/680] items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                        No image
                      </div>
                    )}
                    <div className="mt-2 font-semibold text-sky-100">
                      {row.quantity} {row.cardName}
                    </div>
                    <div className="text-xs text-zinc-400">
                      MV {cardManaValue(row)} ·{" "}
                      {row.card?.setCode.toUpperCase() ?? "—"} ·{" "}
                      {priceLabel(row.card?.prices)}
                    </div>
                  </button>
                  <div className="mt-2">
                    {ownedBadge(row, props.showPrivateInventory)}
                  </div>
                  <div className="mt-2">
                    <CardActions
                      canEdit={props.canEdit}
                      expanded={expanded}
                      toggleExpanded={() =>
                        props.setExpanded(expanded ? null : row.id)
                      }
                      previewOwned={() => props.previewOwned(row.id)}
                      previewCheapest={() => props.previewCheapest(row.id)}
                    />
                  </div>
                  {expanded ? (
                    <div className="mt-3">
                      <RowEditor
                        deckId={props.deckId}
                        row={row}
                        sections={props.sections}
                        canEdit={props.canEdit}
                        showPrivateInventory={props.showPrivateInventory}
                        returnLocations={props.returnLocations}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function GroupHeader({
  label,
  rows,
  quantity,
}: {
  label: string;
  rows: DeckEditorRow[];
  quantity: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
      <h2 className="text-xl font-semibold">
        {label}{" "}
        <span className="text-sm text-zinc-400">
          ({quantity} cards · {rows.length} rows)
        </span>
      </h2>
    </div>
  );
}

function CardActions({
  canEdit,
  expanded,
  toggleExpanded,
  previewOwned,
  previewCheapest,
}: {
  canEdit: boolean;
  expanded: boolean;
  toggleExpanded: () => void;
  previewOwned: () => void;
  previewCheapest: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        type="button"
        className="rounded border border-zinc-700 px-2 py-1"
        onClick={toggleExpanded}
      >
        {expanded ? "Close details" : canEdit ? "Edit/details" : "Details"}
      </button>
      {canEdit ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

function RowEditor({
  deckId,
  row,
  sections,
  canEdit,
  showPrivateInventory,
  returnLocations,
}: {
  deckId: string;
  row: DeckEditorRow;
  sections: DeckSection[];
  canEdit: boolean;
  showPrivateInventory: boolean;
  returnLocations: DeckReturnLocation[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div>
        {imageUri(row) ? (
          <img src={imageUri(row)} alt="" className="w-full max-w-56 rounded" />
        ) : (
          <div className="flex aspect-[488/680] max-w-56 items-center justify-center rounded bg-zinc-800 text-zinc-500">
            No image
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-sky-100">{row.cardName}</h3>
          <p className="text-sm text-zinc-300">
            {row.card?.typeLine ?? "No selected printing"}
          </p>
          <p className="text-sm text-zinc-400">
            {row.card
              ? `${row.card.setCode.toUpperCase()} #${row.card.collectorNumber} · ${row.card.rarity} · ${priceLabel(row.card.prices)}`
              : "Generic card row"}
          </p>
          <div className="mt-2">{ownedBadge(row, showPrivateInventory)}</div>
          <p className="mt-1 text-sm text-amber-100">
            Physically in deck: {row.committedQuantity}
          </p>
          {showPrivateInventory && row.locationSummary ? (
            <p className="mt-1 text-xs text-zinc-400">
              Location summary: {row.locationSummary}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <form
              action={updateDeckCard}
              className="grid gap-3 rounded border border-zinc-800 p-3 md:grid-cols-3"
            >
              <input type="hidden" name="deckId" value={deckId} />
              <input type="hidden" name="deckCardId" value={row.id} />
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
              {row.committedQuantity > 0 ? (
                <div className="md:col-span-3 rounded border border-amber-900 bg-amber-950/20 p-2 text-sm">
                  <p className="text-amber-100">
                    This card has {row.committedQuantity} committed physical
                    copies. If moving it to Maybeboard, choose how to handle
                    those copies.
                  </p>
                  <label className="mt-2 block">
                    Maybeboard committed-copy handling
                    <select
                      name="maybeboardCommittedMode"
                      defaultValue="return"
                      className="mt-1 w-full border bg-zinc-900 p-2"
                    >
                      <option value="return">
                        Move to Maybeboard and return committed copies
                      </option>
                      <option value="keep">
                        Move to Maybeboard but keep copies physically in deck
                      </option>
                    </select>
                  </label>
                  <label className="mt-2 block">
                    Destination location for returned copies
                    <select
                      name="destinationLocationId"
                      className="mt-1 w-full border bg-zinc-900 p-2"
                    >
                      <option value="">Choose a location…</option>
                      {returnLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              <SubmitButton
                pendingLabel="Saving…"
                className="rounded border border-sky-700 px-3 py-2 text-sky-100 md:col-span-2"
              >
                Save quantity, section, notes
              </SubmitButton>
            </form>
            <div className="space-y-3 rounded border border-zinc-800 p-3">
              <ReturnCommittedCopies
                deckId={deckId}
                row={row}
                returnLocations={returnLocations}
              />
              <PrintingPicker deckId={deckId} row={row} />
              <form action={removeDeckCard}>
                <input type="hidden" name="deckId" value={deckId} />
                <input type="hidden" name="deckCardId" value={row.id} />
                {row.committedQuantity > 0 ? (
                  <label className="mb-2 block text-sm">
                    Return committed copies to this location before removing
                    <select
                      name="destinationLocationId"
                      required
                      className="mt-1 w-full border bg-zinc-900 p-2"
                    >
                      <option value="">Choose a location…</option>
                      {returnLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <SubmitButton
                  pendingLabel="Removing…"
                  className="rounded border border-red-800 px-3 py-2 text-red-200"
                  confirmMessage={
                    row.committedQuantity > 0
                      ? `Return committed copies of ${row.cardName} to the selected location, then remove this deck-list row? Inventory will not be deleted.`
                      : `Remove ${row.cardName} from this deck list? Inventory will not be modified.`
                  }
                >
                  Remove
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReturnCommittedCopies({
  deckId,
  row,
  returnLocations,
}: {
  deckId: string;
  row: DeckEditorRow;
  returnLocations: DeckReturnLocation[];
}) {
  const [quantity, setQuantity] = useState(Math.max(1, row.committedQuantity));
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  if (!row.card?.id || row.committedQuantity <= 0) {
    return (
      <p className="rounded border border-zinc-800 p-2 text-sm text-zinc-400">
        No committed physical copies to return for this row.
      </p>
    );
  }
  async function returnCopies() {
    if (!destinationLocationId) {
      setMessage("Choose a destination location.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const res = await fetch(`/api/decks/${deckId}/return-committed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: row.card?.id,
          quantity,
          destinationLocationId,
        }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? "Return failed.");
      const result = (await res.json()) as {
        movedCards: number;
        destinationLocationName: string;
      };
      setMessage(
        `Returned ${result.movedCards} copies to ${result.destinationLocationName}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Return failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2 rounded border border-amber-900 bg-amber-950/10 p-2">
      <h4 className="font-semibold text-amber-100">Return committed copies</h4>
      <p className="text-xs text-zinc-300">
        {row.committedQuantity} physical copies are currently committed to this
        deck. Returning them keeps the deck-list row intact.
      </p>
      <label className="block text-sm">
        Quantity
        <input
          type="number"
          min={1}
          max={row.committedQuantity}
          value={quantity}
          onChange={(event) =>
            setQuantity(
              Math.max(
                1,
                Math.min(
                  row.committedQuantity,
                  Number(event.target.value) || 1,
                ),
              ),
            )
          }
          className="mt-1 w-full border bg-zinc-900 p-2"
        />
      </label>
      <label className="block text-sm">
        Destination location
        <select
          value={destinationLocationId}
          onChange={(event) => setDestinationLocationId(event.target.value)}
          className="mt-1 w-full border bg-zinc-900 p-2"
        >
          <option value="">Choose a location…</option>
          {returnLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={returnCopies}
        className="rounded border border-amber-700 px-3 py-2 text-amber-100 disabled:opacity-60"
      >
        {pending ? "Returning…" : "Return committed copies"}
      </button>
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
    </div>
  );
}

function PrintingPicker({
  deckId,
  row,
}: {
  deckId: string;
  row: DeckEditorRow;
}) {
  const [query, setQuery] = useState(row.cardName);
  const [results, setResults] = useState<DeckCardSearchResult[]>([]);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [status, setStatus] = useState(
    "Search uses the server deck-card search endpoint; the browser does not call Scryfall directly.",
  );
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  async function search() {
    const term = query.trim();
    if (term.length < 2) {
      setStatus("Enter at least 2 characters.");
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setStatus(
      "Searching owned printings, local cache, then server Scryfall fallback…",
    );
    try {
      const res = await fetch(
        `/api/decks/card-search?q=${encodeURIComponent(term)}&scryfall=1`,
      );
      if (!res.ok) throw new Error("Printing search failed.");
      const json = (await res.json()) as DeckCardSearchResponse;
      if (requestId.current === id) {
        setResults(json.results);
        setStatus(json.message);
      }
    } catch (error) {
      if (requestId.current === id)
        setStatus(
          error instanceof Error ? error.message : "Printing search failed.",
        );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }

  async function changePrinting() {
    if (!selected) return;
    setStatus("Changing printing…");
    const res = await fetch(
      `/api/decks/${deckId}/cards/${row.id}/change-printing`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: selected.cardId }),
      },
    );
    if (!res.ok) {
      setStatus((await res.json()).error ?? "Change printing failed.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="space-y-2">
      <h4 className="font-semibold">Change printing</h4>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full border bg-zinc-900 p-2 text-sm"
          placeholder="Search printings"
        />
        <button
          type="button"
          className="rounded border border-zinc-700 px-3 py-2 text-sm"
          onClick={search}
          disabled={loading}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="text-xs text-zinc-400" aria-live="polite">
        {status}
      </p>
      <div className="max-h-56 space-y-2 overflow-auto">
        {results.map((result) => (
          <button
            key={result.cardId}
            type="button"
            onClick={() => setSelected(result)}
            className={`w-full rounded border p-2 text-left text-sm ${selected?.cardId === result.cardId ? "border-sky-500 bg-sky-950/30" : result.ownedExactQuantity > 0 ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800"}`}
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
            <span className="block text-xs text-zinc-300">
              Owned exact {result.ownedExactQuantity} · Owned other printing{" "}
              {result.ownedOtherPrintingQuantity}
              {result.locationSummary ? ` · ${result.locationSummary}` : ""}
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
              <th className="p-2">Current price</th>
              <th className="p-2">Proposed price</th>
              <th className="p-2">Owned status</th>
              <th className="p-2">Reason/status</th>
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
                <td className="p-2">
                  {row.current?.priceUsd == null
                    ? "—"
                    : `$${row.current.priceUsd.toFixed(2)}`}
                </td>
                <td className="p-2">
                  {row.proposed?.priceUsd == null
                    ? "—"
                    : `$${row.proposed.priceUsd.toFixed(2)}`}
                </td>
                <td className="p-2">
                  Current owned {row.currentOwnedQuantity}/{row.quantity}
                  <br />
                  Proposed owned {row.proposedOwnedQuantity}/{row.quantity}
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
        Apply selected changes
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
        {printing.setCode.toUpperCase()} #{printing.collectorNumber}
      </div>
    </div>
  );
}

function CommitmentPanel({
  deckId,
  row,
  canEdit,
  normalLocations,
}: {
  deckId: string;
  row: DeckEditorRow;
  canEdit: boolean;
  normalLocations: DeckReturnLocation[];
}) {
  return (
    <section className="space-y-3 rounded border border-emerald-900/60 bg-emerald-950/10 p-3 text-sm">
      <div>
        <h4 className="font-semibold text-emerald-100">Physical commitment</h4>
        <p className="text-zinc-300">
          Needed {row.quantity} · Owned total {row.exactOwned + row.otherOwned}{" "}
          · Available inventory {row.available} · Committed to this deck{" "}
          {row.committedToThisDeck}/{row.quantity} · Committed to another deck{" "}
          {row.committedToOtherDecks} · Missing {row.missing}
        </p>
      </div>
      {row.committedToThisDeck >= row.quantity ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/40 p-2 text-emerald-100">
          Committed {row.committedToThisDeck}/{row.quantity}
        </p>
      ) : row.available > 0 ? (
        <p className="rounded border border-sky-800 bg-sky-950/30 p-2 text-sky-100">
          Available {row.available}; {row.commitmentMissing} still uncommitted.
        </p>
      ) : (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-amber-100">
          Missing available inventory for {row.commitmentMissing} deck cards.
        </p>
      )}
      {canEdit && row.commitOptions.length ? (
        <form
          action={commitDeckCardToDeck}
          className="grid gap-2 md:grid-cols-4"
        >
          <input type="hidden" name="deckId" value={deckId} />
          <input type="hidden" name="deckCardId" value={row.id} />
          <label className="text-xs md:col-span-2">
            Commit from available inventory
            <select
              name="inventoryItemId"
              className="mt-1 w-full border bg-zinc-900 p-2"
            >
              {row.commitOptions.map((option) => (
                <option
                  key={option.inventoryItemId}
                  value={option.inventoryItemId}
                >
                  {option.locationName}: {option.quantity} × {option.cardName} (
                  {option.setCode.toUpperCase()} #{option.collectorNumber})
                  {option.matchType === "exact"
                    ? " · exact"
                    : " · other printing"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Quantity
            <input
              name="quantity"
              type="number"
              min={1}
              max={Math.max(1, row.commitmentMissing)}
              defaultValue={Math.max(
                1,
                Math.min(row.commitmentMissing, row.available),
              )}
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <SubmitButton
            pendingLabel="Committing…"
            className="self-end rounded border border-emerald-700 px-3 py-2 text-emerald-100"
          >
            Commit to deck
          </SubmitButton>
        </form>
      ) : null}
      {canEdit && row.returnOptions.length && normalLocations.length ? (
        <form
          action={returnDeckCardToInventory}
          className="grid gap-2 md:grid-cols-5"
        >
          <input type="hidden" name="deckId" value={deckId} />
          <input type="hidden" name="deckCardId" value={row.id} />
          <label className="text-xs md:col-span-2">
            Return committed copy
            <select
              name="inventoryItemId"
              className="mt-1 w-full border bg-zinc-900 p-2"
            >
              {row.returnOptions.map((option) => (
                <option
                  key={option.inventoryItemId}
                  value={option.inventoryItemId}
                >
                  {option.quantity} × {option.cardName} (
                  {option.setCode.toUpperCase()} #{option.collectorNumber})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Destination
            <select
              name="destinationLocationId"
              className="mt-1 w-full border bg-zinc-900 p-2"
            >
              {normalLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Quantity
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={1}
              className="mt-1 w-full border bg-zinc-900 p-2"
            />
          </label>
          <SubmitButton
            pendingLabel="Returning…"
            className="self-end rounded border border-zinc-700 px-3 py-2"
          >
            Return to inventory
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

function BulkCommitPreview({
  deckId,
  moves,
  cancel,
}: {
  deckId: string;
  moves: Array<{
    deckCardId: string;
    inventoryItemId: string;
    quantity: number;
    cardName: string;
    source: string;
    availableExact: number;
    availableOther: number;
    alreadyCommitted: number;
    needed: number;
    remainingMissing: number;
    warning: string;
  }>;
  cancel: () => void;
}) {
  return (
    <section className="rounded border border-emerald-800 bg-emerald-950/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-emerald-100">
          Preview commit all available cards
        </h3>
        <button
          type="button"
          className="rounded border border-zinc-700 px-2 py-1"
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-zinc-400">
        Review proposed moves before applying. This preview only pulls from
        available inventory, never from other deck locations.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-zinc-300">
            <tr>
              <th className="p-2">Deck card</th>
              <th className="p-2">Needed</th>
              <th className="p-2">Already committed</th>
              <th className="p-2">Available exact</th>
              <th className="p-2">Available other</th>
              <th className="p-2">Proposed source</th>
              <th className="p-2">Proposed quantity</th>
              <th className="p-2">Remaining missing</th>
              <th className="p-2">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((move) => (
              <tr key={move.deckCardId} className="border-t border-zinc-800">
                <td className="p-2">{move.cardName}</td>
                <td className="p-2">{move.needed}</td>
                <td className="p-2">{move.alreadyCommitted}</td>
                <td className="p-2">{move.availableExact}</td>
                <td className="p-2">{move.availableOther}</td>
                <td className="p-2">{move.source}</td>
                <td className="p-2">{move.quantity}</td>
                <td className="p-2">{move.remainingMissing}</td>
                <td className="p-2 text-amber-200">{move.warning || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        action={bulkCommitDeckCardsToDeck}
        className="mt-3 flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="deckId" value={deckId} />
        <input
          type="hidden"
          name="movesJson"
          value={JSON.stringify(
            moves.map((move) => ({
              deckCardId: move.deckCardId,
              inventoryItemId: move.inventoryItemId,
              quantity: move.quantity,
            })),
          )}
        />
        <SubmitButton
          pendingLabel="Committing…"
          className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
        >
          Apply commit preview
        </SubmitButton>
        <span className="text-zinc-400">
          {moves.reduce((total, move) => total + move.quantity, 0)} cards will
          move into this deck.
        </span>
      </form>
    </section>
  );
}
