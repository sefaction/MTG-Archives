"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";
import { DeckSection, FoilStatus } from "@prisma/client";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { SetSymbol } from "@/components/mtg/CardSymbols";
import { ManaCost } from "@/components/mtg/ManaCost";
import {
  bulkCommitDeckCardsToDeck,
  addRealCopyToDeck,
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
import {
  cn,
  filterButtonClass,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "@/components/filterStyles";

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
    locationName: string;
    quantity: number;
    cardName: string;
    setCode: string;
    collectorNumber: string;
  }>;
  missing: number;
  isBasicLand?: boolean;
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
  { value: "compact", label: "Compact text" },
  { value: "text", label: "Detailed table" },
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
    { normal?: string; small?: string; art_crop?: string } | null | undefined;
  return images?.normal ?? images?.small ?? row.card?.imageUri ?? "";
}

function ownedBadge(row: DeckEditorRow, showLocations: boolean) {
  const status = ownershipStatus(row);
  const color =
    status === "Owned exact"
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
      : status === "Basic land"
        ? "border-zinc-700 bg-zinc-900/70 text-zinc-100"
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
      {row.isBasicLand ? (
        <span>· not wishlisted</span>
      ) : (
        <span>
          Exact {row.exactOwned}/{row.quantity}
        </span>
      )}
      {row.isBasicLand && row.committedToThisDeck ? (
        <span>· {row.committedToThisDeck} committed</span>
      ) : null}
      {!row.isBasicLand && row.otherOwned ? (
        <span>· Other {row.otherOwned}</span>
      ) : null}
      {!row.isBasicLand && row.missing ? (
        <span>· Missing {row.missing}</span>
      ) : null}
      {showLocations && row.locationSummary ? (
        <span>· {row.locationSummary}</span>
      ) : null}
    </span>
  );
}

function commitmentBadge(row: DeckEditorRow) {
  const committed = row.committedToThisDeck;
  const status =
    row.isBasicLand && committed === 0
      ? "Basic land"
      : row.commitmentMissing <= 0 || committed >= row.quantity
        ? "Committed"
        : committed > 0
          ? "Partially committed"
          : row.available > 0
            ? "Ready to commit"
            : "Missing";
  const color =
    status === "Committed"
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
      : status === "Partially committed"
        ? "border-amber-700 bg-amber-950/40 text-amber-100"
        : status === "Ready to commit"
          ? "border-sky-700 bg-sky-950/40 text-sky-100"
          : status === "Basic land"
            ? "border-zinc-700 bg-zinc-900/70 text-zinc-100"
            : "border-red-800 bg-red-950/30 text-red-100";

  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        color,
      )}
    >
      {status}
    </span>
  );
}

function isFullyCommitted(row: DeckEditorRow) {
  return row.commitmentMissing <= 0 || row.committedToThisDeck >= row.quantity;
}

function ownedStatusBadge(row: DeckEditorRow) {
  const status = ownershipStatus(row);
  const color =
    status === "Owned exact"
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
      : status === "Basic land"
        ? "border-[#4a584d] bg-[#151c18] text-stone-100"
        : status === "Owned other printing"
          ? "border-cyan-700 bg-cyan-950/40 text-cyan-100"
          : status === "Partial"
            ? "border-amber-700 bg-amber-950/40 text-amber-100"
            : "border-red-800 bg-red-950/30 text-red-100";

  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        color,
      )}
    >
      {status}
    </span>
  );
}

function listOwnershipBadge(row: DeckEditorRow) {
  return isFullyCommitted(row) ? commitmentBadge(row) : ownedStatusBadge(row);
}

function listCommitmentBadge(row: DeckEditorRow) {
  return isFullyCommitted(row) ? (
    <span className="text-xs text-stone-600">—</span>
  ) : (
    commitmentBadge(row)
  );
}

function listStatusBadges(row: DeckEditorRow) {
  return isFullyCommitted(row) ? (
    commitmentBadge(row)
  ) : (
    <>
      {ownedStatusBadge(row)}
      {commitmentBadge(row)}
    </>
  );
}

function InventoryBreakdown({
  row,
  showPrivateInventory,
}: {
  row: DeckEditorRow;
  showPrivateInventory: boolean;
}) {
  return (
    <section className="space-y-3 rounded border border-zinc-800 p-3">
      <div>
        <h3 className="font-semibold text-zinc-100">Inventory status</h3>
        <p className="text-sm text-zinc-400">
          Detailed ownership and location information for this deck row.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ownedBadge(row, false)}
        {commitmentBadge(row)}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Exact owned
          </dt>
          <dd className="text-zinc-100">{row.exactOwned}</dd>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Other printings
          </dt>
          <dd className="text-zinc-100">{row.otherOwned}</dd>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Available to commit
          </dt>
          <dd className="text-zinc-100">{row.available}</dd>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Physically in deck
          </dt>
          <dd className="text-zinc-100">{row.committedToThisDeck}</dd>
        </div>
        {row.committedToOtherDecks > 0 ? (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              In other decks
            </dt>
            <dd className="text-zinc-100">{row.committedToOtherDecks}</dd>
          </div>
        ) : null}
        {row.missing > 0 ? (
          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              Missing
            </dt>
            <dd className="text-zinc-100">{row.missing}</dd>
          </div>
        ) : null}
      </dl>
      {showPrivateInventory && row.locationSummary ? (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <h4 className="text-xs uppercase tracking-wide text-zinc-500">
            Location summary
          </h4>
          <p className="mt-1 text-sm text-zinc-300">{row.locationSummary}</p>
        </div>
      ) : null}
    </section>
  );
}

export function DeckListEditor({
  deckId,
  rows,
  sections,
  canEdit,
  actionControls,
  defaultGroupMode = "type",
  showPrivateInventory = false,
  returnLocations = [],
}: {
  deckId: string;
  rows: DeckEditorRow[];
  sections: DeckSection[];
  canEdit: boolean;
  actionControls?: ReactNode;
  defaultGroupMode?: DeckGroupMode;
  showPrivateInventory?: boolean;
  returnLocations?: DeckReturnLocation[];
}) {
  const [viewMode, setViewMode] = useState<DeckViewMode>("compact");
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
  const [previewRowId, setPreviewRowId] = useState(
    () =>
      rows.find((row) => row.isCommander)?.id ??
      rows.find((row) => imageUri(row))?.id ??
      rows[0]?.id ??
      "",
  );

  const groups = useMemo(
    () => buildDeckGroups(rows, groupMode, sortMode),
    [rows, groupMode, sortMode],
  );
  const currentGroupRows = groups.flatMap((group) => group.rows);
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );
  const selectedDrawerRow = useMemo(
    () => rows.find((row) => row.id === expanded) ?? null,
    [rows, expanded],
  );
  const previewRow = useMemo(
    () =>
      rows.find((row) => row.id === previewRowId) ??
      rows.find((row) => row.isCommander) ??
      rows[0] ??
      null,
    [previewRowId, rows],
  );
  const selectedQuantity = selectedRows.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const selectedCommittedQuantity = selectedRows.reduce(
    (total, row) => total + row.committedQuantity,
    0,
  );
  const totalQuantity = rows.reduce((total, row) => total + row.quantity, 0);
  const exactOwnedQuantity = rows.reduce(
    (total, row) => total + Math.min(row.quantity, row.exactOwned),
    0,
  );
  const missingQuantity = rows.reduce((total, row) => total + row.missing, 0);
  const committedQuantity = rows.reduce(
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
        skippedRows: number;
        destinationLocationName: string;
      };
      setMessage(
        `Returned ${result.movedCards} committed cards from ${result.movedEntries} inventory entries. Skipped ${result.skippedRows} selected rows with no committed copies.`,
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
      <div className="app-panel p-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="pb-2 text-xs font-semibold uppercase tracking-wide text-amber-200">
            Builder
          </div>
          {actionControls}
          {canEdit ? (
            <details className="relative" id="bulk-edit">
              <summary
                className={cn(
                  filterButtonClass,
                  "list-none cursor-pointer px-3 py-1.5 text-sm marker:hidden",
                )}
              >
                Selection
                {selectedRows.length ? ` (${selectedRows.length})` : ""}
              </summary>
              <div className="absolute left-0 top-full z-30 mt-2 w-[min(38rem,calc(100vw-2rem))] rounded-lg border border-[#364139] bg-[#101614] p-3 shadow-xl shadow-black/40">
                <div className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={cn(filterButtonClass, "px-2 py-1")}
                      onClick={() =>
                        selectIds(currentGroupRows.map((row) => row.id))
                      }
                    >
                      Select all in current view
                    </button>
                    <button
                      type="button"
                      className={cn(filterButtonClass, "px-2 py-1")}
                      onClick={() => selectIds(missingIds)}
                    >
                      Select all missing
                    </button>
                    <button
                      type="button"
                      className={cn(filterButtonClass, "px-2 py-1")}
                      onClick={() => selectIds(unownedExactIds)}
                    >
                      Select all unowned exact printings
                    </button>
                    <button
                      type="button"
                      className={cn(filterButtonClass, "px-2 py-1")}
                      onClick={() => selectIds([])}
                    >
                      Clear selection
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-stone-300">
                      Return destination
                      <select
                        value={returnDestinationId}
                        onChange={(event) =>
                          setReturnDestinationId(event.target.value)
                        }
                        className={filterSelectClass}
                      >
                        <option value="">Choose...</option>
                        {returnLocations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={cn(
                        filterPrimaryButtonClass,
                        "border-emerald-700 px-2 py-1 text-emerald-100 hover:bg-emerald-950/40",
                      )}
                      disabled={Boolean(pending)}
                      onClick={() => loadPreview("owned", otherOwnedIds)}
                    >
                      Preview missing to owned
                    </button>
                    <button
                      type="button"
                      className={cn(
                        filterButtonClass,
                        "px-2 py-1 text-cyan-100",
                      )}
                      disabled={Boolean(pending)}
                      onClick={() => loadPreview("cheapest", missingIds)}
                    >
                      Preview missing to cheapest
                    </button>
                  </div>
                  {selectedRows.length ? (
                    <div className="grid gap-2 rounded-md border border-cyan-900 bg-cyan-950/20 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{selectedRows.length} rows selected</strong>
                        <span className="text-stone-300">
                          {selectedQuantity} deck-list cards /{" "}
                          {selectedCommittedQuantity} physically committed
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={cn(
                            filterPrimaryButtonClass,
                            "border-emerald-700 px-2 py-1 text-emerald-100 hover:bg-emerald-950/40",
                          )}
                          disabled={Boolean(pending)}
                          onClick={() => loadPreview("owned", [...selected])}
                        >
                          Switch selected to owned printings
                        </button>
                        <button
                          type="button"
                          className={cn(
                            filterButtonClass,
                            "px-2 py-1 text-cyan-100",
                          )}
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
                          className={filterSelectClass}
                        >
                          {sections.map((section) => (
                            <option key={section} value={section}>
                              {deckSectionLabel(section)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={cn(
                            filterButtonClass,
                            "px-2 py-1 text-amber-100",
                          )}
                          disabled={
                            Boolean(pending) || selectedCommittedQuantity === 0
                          }
                          onClick={returnSelectedCommitted}
                        >
                          Return selected committed cards
                        </button>
                        <button
                          type="button"
                          className={cn(filterButtonClass, "px-2 py-1")}
                          disabled={Boolean(pending)}
                          onClick={bulkMove}
                        >
                          Move selected
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-800 bg-red-950/30 px-2 py-1 text-red-100 hover:border-red-600"
                          disabled={Boolean(pending)}
                          onClick={bulkRemove}
                        >
                          Remove selected
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <p className="text-sm text-stone-400" aria-live="polite">
                    {pending ||
                      message ||
                      "Select cards to move, remove, or preview printing optimization without changing inventory."}
                  </p>
                </div>
              </div>
            </details>
          ) : null}
          <label className={filterFieldClass}>
            View
            <select
              value={viewMode}
              onChange={(event) =>
                setViewMode(event.target.value as DeckViewMode)
              }
              className={cn(filterSelectClass, "ml-2")}
            >
              {viewModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Group by
            <select
              value={groupMode}
              onChange={(event) =>
                setGroupMode(event.target.value as DeckGroupMode)
              }
              className={cn(filterSelectClass, "ml-2")}
            >
              {groupModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Sort by
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as DeckSortMode)
              }
              className={cn(filterSelectClass, "ml-2")}
            >
              {sortModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <div className="pb-2 text-sm text-stone-400">
            {rows.reduce((total, row) => total + row.quantity, 0)} cards ·{" "}
            {rows.length} rows · data preserved while switching views
          </div>
        </div>
      </div>

      {!canEdit ? (
        <p className="app-panel p-3 text-sm text-stone-400">
          Read-only deck view. You can change view, grouping, sorting, and open
          card details; editing and inventory locations are hidden.
        </p>
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

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <DeckPreviewRail
          row={previewRow}
          showLocations={showPrivateInventory}
        />
        {viewMode === "compact" ? (
          <CompactDeckView
            deckId={deckId}
            groups={groups}
            sections={sections}
            canEdit={canEdit}
            selected={selected}
            expanded={expanded}
            setExpanded={setExpanded}
            setPreviewRowId={setPreviewRowId}
            toggleSelected={toggleSelected}
            previewOwned={(rowId) => loadPreview("owned", [rowId])}
            previewCheapest={(rowId) => loadPreview("cheapest", [rowId])}
            showPrivateInventory={showPrivateInventory}
            returnLocations={returnLocations}
          />
        ) : viewMode === "text" ? (
          <TextDeckView
            deckId={deckId}
            groups={groups}
            sections={sections}
            canEdit={canEdit}
            selected={selected}
            expanded={expanded}
            setExpanded={setExpanded}
            setPreviewRowId={setPreviewRowId}
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
            setPreviewRowId={setPreviewRowId}
            toggleSelected={toggleSelected}
            previewOwned={(rowId) => loadPreview("owned", [rowId])}
            previewCheapest={(rowId) => loadPreview("cheapest", [rowId])}
            mode={viewMode}
            showPrivateInventory={showPrivateInventory}
            returnLocations={returnLocations}
          />
        )}
      </div>

      <DeckEntryDrawer
        deckId={deckId}
        row={selectedDrawerRow}
        sections={sections}
        canEdit={canEdit}
        showPrivateInventory={showPrivateInventory}
        returnLocations={returnLocations}
        onClose={() => setExpanded(null)}
        previewOwned={(rowId) => loadPreview("owned", [rowId])}
        previewCheapest={(rowId) => loadPreview("cheapest", [rowId])}
      />

      {rows.length === 0 ? (
        <p className="rounded border border-zinc-800 p-4 text-zinc-400">
          No cards in this deck yet.
        </p>
      ) : null}
    </section>
  );
}

type DeckViewProps = {
  deckId: string;
  groups: Array<{ label: string; rows: DeckEditorRow[]; quantity: number }>;
  sections: DeckSection[];
  canEdit: boolean;
  selected: Set<string>;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  setPreviewRowId: (id: string) => void;
  toggleSelected: (rowId: string, checked: boolean) => void;
  previewOwned: (rowId: string) => void;
  previewCheapest: (rowId: string) => void;
  showPrivateInventory: boolean;
  returnLocations: DeckReturnLocation[];
};

function DeckPreviewRail({
  row,
  showLocations,
}: {
  row: DeckEditorRow | null;
  showLocations: boolean;
}) {
  if (!row) {
    return (
      <aside className="hidden xl:block">
        <div className="sticky top-4 rounded-lg border border-[#2a332d] bg-[#101614] p-3 text-sm text-stone-500">
          Hover a card to preview it.
        </div>
      </aside>
    );
  }
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-4 space-y-3 rounded-lg border border-[#2a332d] bg-[#101614] p-3 shadow-xl shadow-black/20">
        {imageUri(row) ? (
          <img
            src={imageUri(row)}
            alt=""
            className="aspect-[488/680] w-full rounded-md object-cover"
          />
        ) : (
          <div className="flex aspect-[488/680] w-full items-center justify-center rounded-md bg-[#0d1210] text-xs text-stone-500">
            No image
          </div>
        )}
        <div>
          <h2 className="text-base font-semibold text-cyan-100">
            {row.cardName}
          </h2>
          <p className="mt-1 text-xs text-stone-400">
            {row.quantity} in {deckSectionLabel(row.section)} · MV{" "}
            {cardManaValue(row)}
          </p>
          <div className="mt-1">
            <ManaCost value={row.card?.manaCost ?? null} />
          </div>
        </div>
        <div className="grid gap-2 text-xs">
          <PreviewDetail
            label="Type"
            value={row.card?.typeLine ?? row.matchType}
          />
          <PreviewDetail
            label="Printing"
            value={
              row.card
                ? `${row.card.setCode.toUpperCase()} #${row.card.collectorNumber} · ${row.card.rarity}`
                : "No selected printing"
            }
          />
          <PreviewDetail label="Price" value={priceLabel(row.card?.prices)} />
          <PreviewDetail
            label="Committed"
            value={`${row.committedToThisDeck}/${row.quantity}`}
          />
          <PreviewDetail
            label="Available"
            value={`${row.available} total · ${row.availableExact} exact · ${row.availableOther} other`}
          />
          {showLocations && row.locationSummary ? (
            <PreviewDetail label="Locations" value={row.locationSummary} />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">{listStatusBadges(row)}</div>
        {row.notes ? (
          <p className="rounded border border-[#2a332d] bg-[#0d1210] p-2 text-xs text-stone-400">
            {row.notes}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function PreviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <span className="text-stone-500">{label}</span>
      <span className="min-w-0 text-stone-200">{value}</span>
    </div>
  );
}

function CompactDeckView(props: DeckViewProps) {
  return (
    <div className="columns-1 gap-3 [column-fill:_balance] md:columns-2 xl:columns-3 2xl:columns-4">
      {props.groups.map((group) => (
        <section
          key={group.label}
          className="mb-3 inline-block w-full break-inside-avoid rounded-md border border-[#2a332d] bg-[#101614]"
        >
          <CompactGroupHeader
            label={group.label}
            rows={group.rows}
            quantity={group.quantity}
          />
          <div className="divide-y divide-[#222a25]">
            {group.rows.map((row) => (
              <CompactDeckRow key={row.id} row={row} {...props} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CompactDeckRow({
  row,
  ...props
}: { row: DeckEditorRow } & DeckViewProps) {
  const expanded = props.expanded === row.id;
  const fullyCommitted = isFullyCommitted(row);
  const ownedStatus = fullyCommitted ? "Committed" : ownershipStatus(row);
  const ownedTone = fullyCommitted
    ? "bg-emerald-500"
    : ownedStatus === "Owned exact" || ownedStatus === "Basic land"
      ? "bg-emerald-500"
      : ownedStatus === "Owned other printing"
        ? "bg-cyan-400"
        : ownedStatus === "Partial"
          ? "bg-amber-400"
          : "bg-red-500";
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1 px-2 py-1 text-xs hover:bg-emerald-950/20",
        expanded && "bg-cyan-950/20",
      )}
      onMouseEnter={() => props.setPreviewRowId(row.id)}
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
      ) : (
        <span className="h-3 w-3" />
      )}
      <span className="w-5 text-right font-semibold text-stone-100">
        {row.quantity}
      </span>
      <button
        type="button"
        className="min-w-0 truncate text-left font-medium text-cyan-100 hover:text-amber-100 hover:underline"
        onClick={() => props.setExpanded(row.id)}
        onFocus={() => props.setPreviewRowId(row.id)}
        title={row.cardName}
      >
        {row.cardName}
      </button>
      <div className="flex items-center gap-1">
        <span
          className={cn("h-2 w-2 rounded-full", ownedTone)}
          title={ownedStatus}
        />
        {!fullyCommitted ? (
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              row.committedToThisDeck > 0 ? "bg-amber-300" : "bg-red-500",
            )}
            title={
              row.committedToThisDeck > 0
                ? "Partially committed"
                : "Not fully committed"
            }
          />
        ) : null}
        <button
          type="button"
          className="rounded px-1 text-[11px] text-stone-400 hover:bg-[#1b241f] hover:text-cyan-100"
          onClick={() => props.setExpanded(row.id)}
          aria-label={`Open details for ${row.cardName}`}
        >
          ...
        </button>
      </div>
      <div className="col-start-3 flex min-w-0 items-center gap-1 text-[11px] text-stone-500">
        <span>MV {cardManaValue(row)}</span>
        <ManaCost value={row.card?.manaCost ?? null} />
      </div>
    </div>
  );
}

function CompactGroupHeader({
  label,
  rows,
  quantity,
}: {
  label: string;
  rows: DeckEditorRow[];
  quantity: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[#2a332d] bg-[#121915] px-2 py-1">
      <h2 className="truncate text-sm font-semibold text-stone-100">{label}</h2>
      <span className="whitespace-nowrap text-xs text-stone-400">
        {quantity} / {rows.length}
      </span>
    </div>
  );
}

function TextDeckView(props: DeckViewProps) {
  return (
    <div className="space-y-3">
      {props.groups.map((group) => (
        <section key={group.label} className="app-panel overflow-hidden">
          <GroupHeader
            label={group.label}
            rows={group.rows}
            quantity={group.quantity}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-stone-300">
                <tr>
                  {props.canEdit ? (
                    <th className="px-2 py-1.5">Select</th>
                  ) : null}
                  <th className="px-2 py-1.5">Qty</th>
                  <th className="px-2 py-1.5">Card</th>
                  <th className="px-2 py-1.5">Mana</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Section</th>
                  <th className="px-2 py-1.5">Owned</th>
                  <th className="px-2 py-1.5">Commit</th>
                  <th className="px-2 py-1.5">Price</th>
                  <th className="px-2 py-1.5">
                    <span className="sr-only">Actions</span>
                  </th>
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
}: { row: DeckEditorRow } & DeckViewProps) {
  const expanded = props.expanded === row.id;
  return (
    <tr
      className={cn(
        "border-t border-[#252d28] align-middle hover:bg-emerald-950/20",
        expanded && "bg-cyan-950/20",
      )}
      onMouseEnter={() => props.setPreviewRowId(row.id)}
    >
      {props.canEdit ? (
        <td className="px-2 py-1.5">
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
      <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-stone-100">
        {row.quantity}
      </td>
      <td className="min-w-[220px] px-2 py-1.5">
        <button
          type="button"
          className="text-left font-medium text-cyan-100 hover:text-amber-100 hover:underline"
          onClick={() => props.setExpanded(row.id)}
          onFocus={() => props.setPreviewRowId(row.id)}
        >
          {row.cardName}
        </button>
        {row.card ? (
          <div className="text-[11px] text-stone-500">
            {row.card.setCode.toUpperCase()} #{row.card.collectorNumber}
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-stone-300">
        <span className="mr-1 text-stone-500">MV {cardManaValue(row)}</span>
        <ManaCost value={row.card?.manaCost ?? null} />
      </td>
      <td className="max-w-[20rem] px-2 py-1.5 text-xs text-stone-300">
        <span className="line-clamp-1">
          {row.card?.typeLine ?? row.matchType}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-stone-300">
        {deckSectionLabel(row.section)}
      </td>
      <td className="px-2 py-1.5">{listOwnershipBadge(row)}</td>
      <td className="px-2 py-1.5">{listCommitmentBadge(row)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-stone-300">
        {priceLabel(row.card?.prices)}
      </td>
      <td className="px-2 py-1.5 text-right">
        <CardActions
          expanded={expanded}
          toggleExpanded={() => props.setExpanded(row.id)}
        />
      </td>
    </tr>
  );
}

function VisualDeckView(props: DeckViewProps & { mode: "grid" | "spoiler" }) {
  const tileClass = props.mode === "spoiler" ? "w-56" : "w-40";
  return (
    <div className="space-y-4">
      {props.groups.map((group) => (
        <section key={group.label} className="app-panel p-3">
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
                  className={`${tileClass} app-card p-2`}
                  onMouseEnter={() => props.setPreviewRowId(row.id)}
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
                    onFocus={() => props.setPreviewRowId(row.id)}
                  >
                    {imageUri(row) ? (
                      <img
                        src={imageUri(row)}
                        alt=""
                        className="aspect-[488/680] w-full rounded object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[488/680] items-center justify-center rounded bg-[#0d1210] text-xs text-stone-500">
                        No image
                      </div>
                    )}
                    <div className="mt-2 font-semibold text-cyan-100">
                      {row.quantity} {row.cardName}
                    </div>
                    <div className="text-xs text-stone-400">
                      MV {cardManaValue(row)} ·{" "}
                      {row.card?.setCode.toUpperCase() ?? "—"} ·{" "}
                      {priceLabel(row.card?.prices)}
                    </div>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {listStatusBadges(row)}
                  </div>
                  <div className="mt-2">
                    <CardActions
                      expanded={expanded}
                      toggleExpanded={() => props.setExpanded(row.id)}
                    />
                  </div>
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a332d] bg-[#121915] px-3 py-2">
      <h2 className="text-xl font-semibold">
        {label}{" "}
        <span className="text-sm text-stone-400">
          ({quantity} cards · {rows.length} rows)
        </span>
      </h2>
    </div>
  );
}

function CardActions({
  expanded,
  toggleExpanded,
}: {
  expanded: boolean;
  toggleExpanded: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-md border border-[#364139] px-2 py-1 text-xs text-stone-200 hover:border-cyan-700 hover:text-cyan-100"
      onClick={toggleExpanded}
      aria-label={
        expanded ? "Deck entry details open" : "Open deck entry details"
      }
    >
      {expanded ? "Details open" : "Details"}
    </button>
  );
}

function DeckEntryDrawer({
  deckId,
  row,
  sections,
  canEdit,
  showPrivateInventory,
  returnLocations,
  onClose,
  previewOwned,
  previewCheapest,
}: {
  deckId: string;
  row: DeckEditorRow | null;
  sections: DeckSection[];
  canEdit: boolean;
  showPrivateInventory: boolean;
  returnLocations: DeckReturnLocation[];
  onClose: () => void;
  previewOwned: (rowId: string) => void;
  previewCheapest: (rowId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "inventory" | "commit"
  >("overview");
  if (!row) return null;
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "inventory", label: "Inventory" },
    ...(canEdit ? [{ id: "commit" as const, label: "Commit" }] : []),
  ] as const;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close deck entry details"
        onClick={onClose}
      />
      <aside className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-[min(92vw,760px)] md:rounded-l-2xl md:rounded-tr-none">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-950/95 p-4 backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Deck entry details
            </p>
            <h2 className="text-xl font-semibold text-sky-100">
              {row.cardName}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              <span>
                {row.quantity} in {deckSectionLabel(row.section)}
              </span>
              <span>MV {cardManaValue(row)}</span>
              <ManaCost value={row.card?.manaCost ?? null} />
              {commitmentBadge(row)}
            </div>
            <p className="hidden text-sm text-zinc-400">
              {row.quantity} × {deckSectionLabel(row.section)} · MV{" "}
              {cardManaValue(row)} · {row.card?.typeLine ?? row.matchType}
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="border-b border-zinc-800 px-4 pt-3">
          <div
            className="flex gap-2"
            role="tablist"
            aria-label="Deck row details"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={cn(
                  "rounded-t border border-b-0 border-zinc-800 px-3 py-2 text-sm text-zinc-300",
                  activeTab === tab.id
                    ? "bg-zinc-900 text-sky-100"
                    : "bg-zinc-950 hover:bg-zinc-900",
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3 p-4">
          <RowEditor
            deckId={deckId}
            row={row}
            sections={sections}
            canEdit={canEdit}
            showPrivateInventory={showPrivateInventory}
            returnLocations={returnLocations}
            activeTab={activeTab}
            previewOwned={previewOwned}
            previewCheapest={previewCheapest}
          />
        </div>
      </aside>
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
  activeTab,
  previewOwned,
  previewCheapest,
}: {
  deckId: string;
  row: DeckEditorRow;
  sections: DeckSection[];
  canEdit: boolean;
  showPrivateInventory: boolean;
  returnLocations: DeckReturnLocation[];
  activeTab: "overview" | "inventory" | "commit";
  previewOwned: (rowId: string) => void;
  previewCheapest: (rowId: string) => void;
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
        {activeTab === "overview" ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-sky-100">
              {row.cardName}
            </h3>
            <p className="text-sm text-zinc-300">
              {row.card?.typeLine ?? "No selected printing"}
            </p>
            <p className="text-sm text-zinc-400">
              {row.card
                ? `${row.card.setCode.toUpperCase()} #${row.card.collectorNumber} · ${row.card.rarity} · ${priceLabel(row.card.prices)}`
                : "Generic card row"}
            </p>
            <div className="mt-2">{commitmentBadge(row)}</div>
            <p className="text-xs text-zinc-400">
              Inventory detail and commit controls are available in the
              Inventory and Commit tabs.
            </p>
          </div>
        ) : null}
        {activeTab === "inventory" ? (
          <div className="space-y-3">
            <InventoryBreakdown
              row={row}
              showPrivateInventory={showPrivateInventory}
            />
            {canEdit ? (
              <div className="flex flex-wrap gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-2 text-sm">
                <button
                  type="button"
                  className={cn(
                    filterPrimaryButtonClass,
                    "px-2 py-1 border-emerald-700 text-emerald-100 hover:bg-emerald-950/40",
                  )}
                  onClick={() => previewOwned(row.id)}
                >
                  Use owned printing
                </button>
                <button
                  type="button"
                  className="rounded border border-sky-700 px-2 py-1 text-sky-100"
                  onClick={() => previewCheapest(row.id)}
                >
                  Use cheapest printing
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="space-y-3">
            {activeTab === "overview" ? (
              <form
                action={updateDeckCard}
                className="grid gap-3 rounded border border-zinc-800 p-3 md:grid-cols-3"
              >
                <input type="hidden" name="deckId" value={deckId} />
                <input type="hidden" name="deckCardId" value={row.id} />
                <label className={filterFieldClass}>
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    defaultValue={row.quantity}
                    className={cn(filterInputClass, "mt-1 w-full")}
                  />
                </label>
                <label className={filterFieldClass}>
                  Section
                  <select
                    name="section"
                    defaultValue={row.section}
                    className={cn(filterSelectClass, "mt-1 w-full")}
                  >
                    {sections.map((section) => (
                      <option key={section} value={section}>
                        {deckSectionLabel(section)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={cn(filterFieldClass, "md:col-span-3")}>
                  Notes
                  <textarea
                    name="notes"
                    defaultValue={row.notes ?? ""}
                    className={cn(filterTextareaClass, "mt-1 w-full")}
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
                    <label className={cn(filterFieldClass, "mt-2 block")}>
                      Maybeboard committed-copy handling
                      <select
                        name="maybeboardCommittedMode"
                        defaultValue="return"
                        className={cn(filterSelectClass, "mt-1 w-full")}
                      >
                        <option value="return">
                          Move to Maybeboard and return committed copies
                        </option>
                        <option value="keep">
                          Move to Maybeboard but keep copies physically in deck
                        </option>
                      </select>
                    </label>
                    <label className={cn(filterFieldClass, "mt-2 block")}>
                      Destination location for returned copies
                      <select
                        name="destinationLocationId"
                        className={cn(filterSelectClass, "mt-1 w-full")}
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
                  className={cn(filterPrimaryButtonClass, "md:col-span-2")}
                >
                  Save quantity, section, notes
                </SubmitButton>
              </form>
            ) : null}
            {activeTab === "commit" ? (
              <div className="space-y-3 rounded border border-zinc-800 p-3">
                <CommitInventoryToDeck deckId={deckId} row={row} />
                <AddRealCopyToDeck
                  deckId={deckId}
                  row={row}
                  locations={returnLocations}
                />
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
                    <label className={cn(filterFieldClass, "mb-2 block")}>
                      Return committed copies to this location before removing
                      <select
                        name="destinationLocationId"
                        required
                        className={cn(filterSelectClass, "mt-1 w-full")}
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
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function sortedCommitOptions(row: DeckEditorRow) {
  return [...row.commitOptions]
    .filter((option) => option.quantity > 0)
    .sort((a, b) => {
      if (a.matchType !== b.matchType) {
        return a.matchType === "exact" ? -1 : 1;
      }
      return (
        a.locationName.localeCompare(b.locationName) ||
        a.setCode.localeCompare(b.setCode) ||
        a.collectorNumber.localeCompare(b.collectorNumber)
      );
    });
}

function CommitInventoryToDeck({
  deckId,
  row,
}: {
  deckId: string;
  row: DeckEditorRow;
}) {
  const options = useMemo(() => sortedCommitOptions(row), [row]);
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState(
    options[0]?.inventoryItemId ?? "",
  );
  const selectedOption =
    options.find(
      (option) => option.inventoryItemId === selectedInventoryItemId,
    ) ?? options[0];
  const remainingNeeded = Math.max(
    0,
    row.commitmentMissing ?? row.quantity - row.committedQuantity,
  );
  const fullyCommitted =
    row.committedQuantity >= row.quantity || remainingNeeded <= 0;
  const quantityMax = selectedOption
    ? Math.max(1, Math.min(selectedOption.quantity, remainingNeeded))
    : 1;

  return (
    <section className="space-y-2 rounded border border-emerald-900 bg-emerald-950/10 p-2">
      <h4 className="font-semibold text-emerald-100">
        Commit inventory to deck
      </h4>
      <p className="text-xs text-zinc-300">
        Move available inventory copies into this deck&apos;s system location
        for this specific deck-list row.
      </p>
      {fullyCommitted ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/40 p-2 text-sm text-emerald-100">
          This deck row is fully committed.
        </p>
      ) : options.length ? (
        <form
          action={commitDeckCardToDeck}
          className="grid gap-2 md:grid-cols-4"
        >
          <input type="hidden" name="deckId" value={deckId} />
          <input type="hidden" name="deckCardId" value={row.id} />
          <label className={cn(filterFieldClass, "md:col-span-2")}>
            Source inventory
            <select
              name="inventoryItemId"
              value={selectedOption?.inventoryItemId ?? ""}
              onChange={(event) =>
                setSelectedInventoryItemId(event.target.value)
              }
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {options.map((option) => (
                <option
                  key={option.inventoryItemId}
                  value={option.inventoryItemId}
                >
                  {option.locationName} — {option.cardName} —{" "}
                  {option.setCode.toUpperCase()} #{option.collectorNumber} —{" "}
                  {option.quantity} available
                  {option.matchType === "other" ? " — other printing" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={filterFieldClass}>
            Quantity
            <input
              key={selectedOption?.inventoryItemId ?? "quantity"}
              name="quantity"
              type="number"
              min={1}
              max={quantityMax}
              defaultValue={quantityMax}
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
          <SubmitButton
            pendingLabel="Committing…"
            className={cn(
              filterPrimaryButtonClass,
              "self-end border-emerald-700 text-emerald-100 hover:bg-emerald-950/40",
            )}
          >
            Commit to deck
          </SubmitButton>
          <p className="text-xs text-zinc-400 md:col-span-4">
            {selectedOption
              ? `${remainingNeeded} still needed for this row; selected source has ${selectedOption.quantity} available.`
              : `${remainingNeeded} still needed for this row.`}
          </p>
        </form>
      ) : (
        <p className="rounded border border-zinc-800 p-2 text-sm text-zinc-400">
          No available inventory copies to commit for this row.
        </p>
      )}
    </section>
  );
}

function AddRealCopyToDeck({
  deckId,
  row,
  locations,
}: {
  deckId: string;
  row: DeckEditorRow;
  locations: DeckReturnLocation[];
}) {
  const [query, setQuery] = useState(row.cardName);
  const [results, setResults] = useState<DeckCardSearchResult[]>([]);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [status, setStatus] = useState(
    "Use the current deck printing, or search to choose the printing you acquired.",
  );
  const [loading, setLoading] = useState(false);
  const defaultCardId = selected?.cardId ?? row.card?.id ?? "";
  const remainingNeeded = Math.max(0, row.commitmentMissing);
  const defaultQuantity = Math.max(1, Math.min(remainingNeeded || 1, 1));
  const selectedLabel = selected
    ? `${selected.name} — ${selected.setCode.toUpperCase()} #${selected.collectorNumber}`
    : row.card
      ? `${row.card.name} — ${row.card.setCode.toUpperCase()} #${row.card.collectorNumber}`
      : "Search and select a printing";

  async function search() {
    const term = query.trim();
    if (term.length < 2) {
      setStatus("Enter at least 2 characters.");
      return;
    }
    setLoading(true);
    setStatus(
      "Searching owned printings, local cache, then Scryfall fallback…",
    );
    try {
      const res = await fetch(
        `/api/decks/card-search?q=${encodeURIComponent(term)}&scryfall=1`,
      );
      if (!res.ok) throw new Error("Printing search failed.");
      const json = (await res.json()) as DeckCardSearchResponse;
      setResults(json.results);
      setStatus(json.message);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Printing search failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-2 rounded border border-sky-900 bg-sky-950/10 p-2">
      <h4 className="font-semibold text-sky-100">Add real copy</h4>
      <p className="text-xs text-zinc-300">
        Add a physical copy of this printing to inventory, optionally committing
        it to this deck immediately.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(filterInputClass, "w-full")}
          placeholder="Search printings"
        />
        <button
          type="button"
          onClick={search}
          disabled={loading}
          className="rounded border border-zinc-700 px-3 py-2 text-sm"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="text-xs text-zinc-400" aria-live="polite">
        {status}
      </p>
      <div className="max-h-44 space-y-2 overflow-auto">
        {results.map((result) => (
          <button
            key={result.cardId}
            type="button"
            onClick={() => setSelected(result)}
            className={`w-full rounded border p-2 text-left text-sm ${selected?.cardId === result.cardId ? "border-sky-500 bg-sky-950/30" : "border-zinc-800"}`}
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
          </button>
        ))}
      </div>
      <form action={addRealCopyToDeck} className="grid gap-2 md:grid-cols-4">
        <input type="hidden" name="deckId" value={deckId} />
        <input type="hidden" name="deckCardId" value={row.id} />
        <input type="hidden" name="cardId" value={defaultCardId} />
        <p className="text-xs text-zinc-300 md:col-span-4">
          Printing: <span className="text-sky-100">{selectedLabel}</span>
        </p>
        <label className={filterFieldClass}>
          Quantity
          <input
            name="quantity"
            type="number"
            min={1}
            max={remainingNeeded || row.quantity}
            defaultValue={defaultQuantity}
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={filterFieldClass}>
          Finish
          <select
            name="foilStatus"
            defaultValue={FoilStatus.NONFOIL}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value={FoilStatus.NONFOIL}>Nonfoil</option>
            <option value={FoilStatus.FOIL}>Foil</option>
            <option value={FoilStatus.ETCHED}>Etched</option>
          </select>
        </label>
        <label className={filterFieldClass}>
          Condition
          <input
            name="condition"
            defaultValue="NM"
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={filterFieldClass}>
          Language
          <input
            name="language"
            defaultValue="EN"
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <label className={cn(filterFieldClass, "md:col-span-2")}>
          Normal inventory location
          <select
            name="locationId"
            required
            defaultValue={locations[0]?.id ?? ""}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">Choose…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-sm text-zinc-300 md:col-span-2">
          <input
            name="commitImmediately"
            type="checkbox"
            defaultChecked={remainingNeeded > 0}
          />
          Commit to this deck immediately
        </label>
        <input
          type="hidden"
          name="notes"
          value={`Added for deck row ${row.cardName}`}
        />
        <SubmitButton
          pendingLabel="Adding…"
          disabled={!defaultCardId || locations.length === 0}
          className={cn(
            filterPrimaryButtonClass,
            "md:col-span-4 border-sky-700 text-sky-100 hover:bg-sky-950/40",
          )}
        >
          Add real copy
        </SubmitButton>
      </form>
    </section>
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
  const options = useMemo(
    () => [...row.returnOptions].filter((option) => option.quantity > 0),
    [row.returnOptions],
  );
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState(
    options[0]?.inventoryItemId ?? "",
  );
  const selectedOption =
    options.find(
      (option) => option.inventoryItemId === selectedInventoryItemId,
    ) ?? options[0];
  const quantityMax = selectedOption ? Math.max(1, selectedOption.quantity) : 1;

  if (!options.length) {
    return null;
  }

  return (
    <section className="space-y-2 rounded border border-amber-900 bg-amber-950/10 p-2">
      <h4 className="font-semibold text-amber-100">Return committed copies</h4>
      <p className="text-xs text-zinc-300">
        Return physical inventory from this deck&apos;s system location. The
        deck-list row stays intact.
      </p>
      <form
        action={returnDeckCardToInventory}
        className="grid gap-2 md:grid-cols-5"
      >
        <input type="hidden" name="deckId" value={deckId} />
        <input type="hidden" name="deckCardId" value={row.id} />
        <label className={cn(filterFieldClass, "md:col-span-2")}>
          Committed source
          <select
            name="inventoryItemId"
            value={selectedOption?.inventoryItemId ?? ""}
            onChange={(event) => setSelectedInventoryItemId(event.target.value)}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            {options.map((option) => (
              <option
                key={option.inventoryItemId}
                value={option.inventoryItemId}
              >
                {option.locationName} — {option.cardName} —{" "}
                {option.setCode.toUpperCase()} #{option.collectorNumber} —{" "}
                {option.quantity} committed
              </option>
            ))}
          </select>
        </label>
        <label className={filterFieldClass}>
          Destination
          <select
            name="destinationLocationId"
            required
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">Choose…</option>
            {returnLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className={filterFieldClass}>
          Quantity
          <input
            key={selectedOption?.inventoryItemId ?? "return-quantity"}
            name="quantity"
            type="number"
            min={1}
            max={quantityMax}
            defaultValue={1}
            className={cn(filterInputClass, "mt-1 w-full")}
          />
        </label>
        <SubmitButton
          pendingLabel="Returning…"
          className={cn(
            filterPrimaryButtonClass,
            "self-end border-amber-700 text-amber-100 hover:bg-amber-950/40",
          )}
        >
          Return to inventory
        </SubmitButton>
      </form>
    </section>
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
          className={cn(
            filterPrimaryButtonClass,
            "border-emerald-700 text-emerald-100 hover:bg-emerald-950/40",
          )}
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
