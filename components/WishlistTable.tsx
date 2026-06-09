"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  DeckCardSearchResponse,
  DeckCardSearchResult,
} from "@/lib/deck-search";
import type { WishlistGroup } from "@/lib/wishlist";
import { CardManaCost, ColorIdentityIcons, SetSymbol } from "./mtg/CardSymbols";
import {
  collectionCardGridClass,
  normalizeCollectionCardSize,
  type CollectionCardSize,
} from "./cardGrid";
import { SubmitButton } from "./feedback/SubmitButton";
import { commitDeckCardToDeck } from "@/app/decks/actions";
import {
  addManualWishlistItem,
  changeManualWishlistPrinting,
  changeWishlistDeckCardPrinting,
  removeManualWishlistItem,
  switchManualWishlistToCheapestPrinting,
  switchManualWishlistToOwnedPrinting,
  switchWishlistDeckCardToCheapestPrinting,
  switchWishlistDeckCardToOwnedPrinting,
  updateManualWishlistItem,
} from "@/app/wishlist/actions";

type WishlistTableRow = WishlistGroup & {
  missingQuantity: number;
  deckNamesLabel: string;
  deckNamesTitle: string;
  priorityLabel: string;
  notesLabel: string;
  colorIdentityLabel: string;
  priceLabel: string;
  setLabel: string;
};

const defaultVisibility: VisibilityState = {
  select: true,
  cardName: true,
  wantedQty: true,
  manualQty: false,
  deckNeededQty: false,
  ownedTotal: true,
  available: true,
  committed: true,
  missing: true,
  source: true,
  decks: true,
  set: false,
  rarity: false,
  manaCost: false,
  typeLine: false,
  colorIdentity: false,
  price: true,
  priority: true,
  notes: false,
  actions: true,
};

function money(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function colorIdentityLabel(value: unknown) {
  if (Array.isArray(value)) return value.join("") || "Colorless";
  if (typeof value === "string") return value || "Colorless";
  return "Colorless";
}

function decksLabel(group: WishlistGroup) {
  const names = [...new Set(group.sources.decks.map((deck) => deck.deckName))];
  if (!names.length) return "—";
  const visible = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return rest > 0 ? `${visible} +${rest} more` : visible;
}

function getRowId(group: WishlistGroup) {
  return group.key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function RowActionMenu({
  row,
  onDetails,
}: {
  row: WishlistTableRow;
  onDetails: () => void;
}) {
  const firstDeckNeed = row.sources.decks[0];
  const firstManual = row.sources.manual[0];

  return (
    <details className="relative inline-block text-left">
      <summary
        className="list-none rounded border border-zinc-700 px-2 py-1 text-zinc-200 marker:hidden hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
        aria-label={`Actions for ${row.card.name}`}
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-56 rounded border border-zinc-700 bg-zinc-950 p-1 shadow-xl">
        <button
          type="button"
          onClick={onDetails}
          className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-800"
        >
          View details
        </button>
        <form action={addManualWishlistItem}>
          <input type="hidden" name="cardId" value={row.card.id} />
          <input type="hidden" name="quantity" value="1" />
          <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-800">
            Quick add manual quantity
          </button>
        </form>
        {firstManual ? (
          <form action={removeManualWishlistItem}>
            <input type="hidden" name="wishlistItemId" value={firstManual.id} />
            <button className="block w-full rounded px-3 py-2 text-left text-sm text-red-200 hover:bg-red-950/40">
              Remove manual wishlist entry
            </button>
          </form>
        ) : null}
        {firstDeckNeed ? (
          <Link
            href={`/decks/${firstDeckNeed.deckId}`}
            className="block rounded px-3 py-2 text-sm hover:bg-zinc-800"
          >
            View deck
          </Link>
        ) : null}
        {row.inventory.ownedTotal > 0 ? (
          <Link
            href={`/inventory?q=${encodeURIComponent(row.card.name)}`}
            className="block rounded px-3 py-2 text-sm hover:bg-zinc-800"
          >
            View in inventory
          </Link>
        ) : null}
      </div>
    </details>
  );
}

function WishlistPrintingPicker({
  label,
  action,
  hiddenFields,
  defaultQuery,
}: {
  label: string;
  action: (fd: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  defaultQuery: string;
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<DeckCardSearchResult[]>([]);
  const [selected, setSelected] = useState<DeckCardSearchResult | null>(null);
  const [message, setMessage] = useState(
    "Search owned/local printings first; use Scryfall fallback if needed.",
  );
  const [pending, startTransition] = useTransition();

  function search(includeScryfall = false) {
    const clean = query.trim();
    if (clean.length < 2) {
      setMessage("Enter at least two characters.");
      return;
    }
    startTransition(async () => {
      setMessage(
        includeScryfall
          ? "Searching server Scryfall fallback…"
          : "Searching owned and local printings…",
      );
      const res = await fetch(
        `/api/decks/card-search?q=${encodeURIComponent(clean)}${includeScryfall ? "&scryfall=1" : ""}`,
      );
      const json = (await res.json()) as DeckCardSearchResponse;
      setResults(json.results);
      setSelected(json.results[0] ?? null);
      setMessage(json.message);
    });
  }

  return (
    <div className="space-y-2 rounded border border-zinc-800 p-3">
      <h4 className="font-medium">{label}</h4>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          Printing search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 block min-w-56 border bg-zinc-900 p-2 text-sm text-zinc-100"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => search(false)}
          className="rounded border border-sky-700 px-3 py-2 text-sm text-sky-100 disabled:opacity-60"
        >
          Search local
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => search(true)}
          className="rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-60"
        >
          Search Scryfall
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {pending ? "Searching…" : message}
      </p>
      {results.length ? (
        <form action={action} className="grid gap-2 md:grid-cols-[1fr_auto]">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="cardId" value={selected?.cardId || ""} />
          <select
            value={selected?.cardId || ""}
            onChange={(event) =>
              setSelected(
                results.find(
                  (result) => result.cardId === event.target.value,
                ) ?? null,
              )
            }
            className="border bg-zinc-900 p-2 text-sm"
          >
            {results.map((result) => (
              <option key={result.cardId} value={result.cardId}>
                {result.name} — {result.setCode.toUpperCase()} #
                {result.collectorNumber} · owned {result.ownedExactQuantity} (+
                {result.ownedOtherPrintingQuantity} other) · {result.priceLabel}
              </option>
            ))}
          </select>
          <SubmitButton
            pendingLabel="Changing…"
            className="rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-100"
            disabled={!selected}
          >
            Change printing
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function WishlistDetailDrawer({
  row,
  onClose,
}: {
  row: WishlistTableRow;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-sky-100">{row.card.name}</h2>
            <p className="text-sm text-zinc-400">
              {row.sourceLabel} · wanted {row.totalWanted} · missing{" "}
              {row.missingQuantity}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1"
          >
            Close
          </button>
        </div>

        <section className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            {row.card.imageUri ? (
              <img
                src={row.card.imageUri}
                alt={row.card.name}
                className="w-full rounded"
              />
            ) : (
              <div className="flex aspect-[63/88] items-center justify-center text-sm text-zinc-400">
                No image
              </div>
            )}
          </div>
          <div className="space-y-3 text-sm">
            <h3 className="font-semibold">Card summary</h3>
            <p>
              <b>Mana Cost:</b> <CardManaCost card={row.card} showFaceNames />
            </p>
            <p>
              <b>Type Line:</b> {row.card.typeLine}
            </p>
            <p>
              <b>Set:</b> {row.card.setCode.toUpperCase()} #
              {row.card.collectorNumber}
            </p>
            <p>
              <b>Rarity:</b> {row.card.rarity}
            </p>
            <p>
              <b>Color Identity:</b>{" "}
              <ColorIdentityIcons value={row.colorIdentityLabel} />
            </p>
            <p>
              <b>Price:</b> {row.priceLabel}
            </p>
            <p>
              <b>Source:</b> {row.sourceLabel}
            </p>
          </div>
        </section>

        <section className="mt-4 space-y-2">
          <h3 className="font-semibold">Quantity summary</h3>
          <p className="text-sm text-zinc-400">
            Available means owned but not committed to a deck. Deck-derived
            needs remain until copies are committed to the relevant deck
            location.
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Wanted Qty" value={row.totalWanted} />
            <Metric label="Manual Qty" value={row.manualQuantity} />
            <Metric label="Deck Needed Qty" value={row.deckQuantity} />
            <Metric label="Owned Total" value={row.inventory.ownedTotal} />
            <Metric label="Available" value={row.inventory.available} />
            <Metric label="Committed" value={row.inventory.committedToDecks} />
            <Metric label="Missing" value={row.missingQuantity} />
          </div>
        </section>

        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Manual wishlist controls</h3>
          {row.sources.manual.length ? (
            row.sources.manual.map((item) => (
              <form
                key={item.id}
                action={updateManualWishlistItem}
                className="grid gap-2 rounded border border-zinc-800 p-3 md:grid-cols-[90px_130px_1fr_auto_auto]"
              >
                <input type="hidden" name="wishlistItemId" value={item.id} />
                <label className="text-xs text-zinc-400">
                  Qty
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    defaultValue={item.quantity}
                    className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Priority
                  <input
                    name="priority"
                    defaultValue={item.priority || ""}
                    placeholder="Priority"
                    className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Notes
                  <input
                    name="notes"
                    defaultValue={item.notes || ""}
                    placeholder="Notes"
                    className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                  />
                </label>
                <SubmitButton
                  pendingLabel="Saving…"
                  className="rounded border px-3 py-2"
                >
                  Save
                </SubmitButton>
                <SubmitButton
                  formAction={removeManualWishlistItem}
                  pendingLabel="Removing…"
                  className="rounded border border-red-800 px-3 py-2 text-red-200"
                >
                  Remove
                </SubmitButton>
              </form>
            ))
          ) : (
            <form
              action={addManualWishlistItem}
              className="grid gap-2 rounded border border-zinc-800 p-3 md:grid-cols-[90px_130px_1fr_auto]"
            >
              <input type="hidden" name="cardId" value={row.card.id} />
              <label className="text-xs text-zinc-400">
                Qty
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue="1"
                  className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Priority
                <input
                  name="priority"
                  placeholder="Priority"
                  className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Notes
                <input
                  name="notes"
                  placeholder="Notes"
                  className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                />
              </label>
              <SubmitButton
                pendingLabel="Adding…"
                className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
              >
                Add manual quantity
              </SubmitButton>
            </form>
          )}
        </section>

        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Needed for decks</h3>
          {row.sources.decks.length ? (
            row.sources.decks.map((need) => (
              <div
                key={need.deckCardId}
                className="space-y-3 rounded border border-zinc-800 p-3 text-sm"
              >
                <div>
                  <Link
                    href={`/decks/${need.deckId}`}
                    className="font-medium text-sky-200"
                  >
                    {need.deckName}
                  </Link>
                  <p className="text-zinc-400">
                    {need.section.toLowerCase()} · required{" "}
                    {need.requiredQuantity} · committed to this deck{" "}
                    {need.committedQuantity} · committed to other decks{" "}
                    {need.committedToOtherDecks} · missing{" "}
                    {need.missingQuantity}
                  </p>
                  <p className="text-zinc-500">
                    Selected printing: {need.selectedPrinting?.name} —{" "}
                    {need.selectedPrinting?.setCode.toUpperCase()} #
                    {need.selectedPrinting?.collectorNumber}; available exact{" "}
                    {need.availableExact}, other printings {need.availableOther}
                  </p>
                </div>
                {need.commitOptions.length ? (
                  <form
                    action={commitDeckCardToDeck}
                    className="grid gap-2 md:grid-cols-[1fr_90px_auto]"
                  >
                    <input type="hidden" name="deckId" value={need.deckId} />
                    <input
                      type="hidden"
                      name="deckCardId"
                      value={need.deckCardId}
                    />
                    <label className="text-xs text-zinc-400">
                      Source location
                      <select
                        name="inventoryItemId"
                        className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                      >
                        {need.commitOptions.map((option) => (
                          <option
                            key={option.inventoryItemId}
                            value={option.inventoryItemId}
                          >
                            {option.locationName}: {option.quantity}{" "}
                            {option.exact ? "exact" : "other printing"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-zinc-400">
                      Qty
                      <input
                        name="quantity"
                        type="number"
                        min="1"
                        max={need.missingQuantity}
                        defaultValue="1"
                        className="mt-1 w-full border bg-zinc-900 p-2 text-zinc-100"
                      />
                    </label>
                    <SubmitButton
                      pendingLabel="Committing…"
                      className="rounded border border-emerald-700 px-3 py-2 text-emerald-100"
                    >
                      Commit available copy
                    </SubmitButton>
                  </form>
                ) : (
                  <p className="text-zinc-500">
                    No available uncommitted copies to commit.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <form action={switchWishlistDeckCardToOwnedPrinting}>
                    <input type="hidden" name="deckId" value={need.deckId} />
                    <input
                      type="hidden"
                      name="deckCardId"
                      value={need.deckCardId}
                    />
                    <SubmitButton
                      pendingLabel="Switching…"
                      className="rounded border border-sky-700 px-3 py-2 text-sky-100"
                    >
                      Use owned printing for this deck card
                    </SubmitButton>
                  </form>
                  <form action={switchWishlistDeckCardToCheapestPrinting}>
                    <input type="hidden" name="deckId" value={need.deckId} />
                    <input
                      type="hidden"
                      name="deckCardId"
                      value={need.deckCardId}
                    />
                    <SubmitButton
                      pendingLabel="Switching…"
                      className="rounded border border-violet-700 px-3 py-2 text-violet-100"
                    >
                      Use cheapest printing for this deck card
                    </SubmitButton>
                  </form>
                  <Link
                    href={`/decks/${need.deckId}`}
                    className="rounded border border-zinc-700 px-3 py-2"
                  >
                    View deck
                  </Link>
                </div>
                <WishlistPrintingPicker
                  label="Change deck card printing"
                  action={changeWishlistDeckCardPrinting}
                  hiddenFields={{
                    deckId: need.deckId,
                    deckCardId: need.deckCardId,
                  }}
                  defaultQuery={row.card.name}
                />
              </div>
            ))
          ) : (
            <p className="text-zinc-400">No deck-derived needs.</p>
          )}
        </section>

        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Inventory availability breakdown</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-zinc-800 p-3">
              <h4 className="font-medium">Available to commit</h4>
              {row.inventoryBreakdown.availableByLocation.length ? (
                row.inventoryBreakdown.availableByLocation.map((part) => (
                  <p key={part.name} className="text-sm text-zinc-300">
                    {part.name}: {part.quantity}
                  </p>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No available copies.</p>
              )}
            </div>
            <div className="rounded border border-zinc-800 p-3">
              <h4 className="font-medium">Committed to decks</h4>
              {row.inventoryBreakdown.committedByDeck.length ? (
                row.inventoryBreakdown.committedByDeck.map((part) => (
                  <p key={part.name} className="text-sm text-zinc-300">
                    {part.name}: {part.quantity}
                  </p>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No committed copies.</p>
              )}
            </div>
            <div className="rounded border border-zinc-800 p-3">
              <h4 className="font-medium">Exact selected printing owned</h4>
              <p className="text-sm text-zinc-300">
                Owned {row.inventoryBreakdown.exactOwned}; available{" "}
                {row.inventoryBreakdown.exactAvailable}
              </p>
            </div>
            <div className="rounded border border-zinc-800 p-3">
              <h4 className="font-medium">Owned in other printings</h4>
              <p className="text-sm text-zinc-300">
                Owned {row.inventoryBreakdown.otherPrintingOwned}; available{" "}
                {row.inventoryBreakdown.otherPrintingAvailable}
              </p>
              {row.inventoryBreakdown.otherPrintings.map((printing) => (
                <p key={printing.cardId} className="text-sm text-zinc-400">
                  {printing.name} — {printing.setCode.toUpperCase()} #
                  {printing.collectorNumber}: {printing.quantity} owned,{" "}
                  {printing.available} available
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Printing tools</h3>
          {row.sources.manual.length ? (
            row.sources.manual.map((item) => (
              <div
                key={item.id}
                className="space-y-3 rounded border border-zinc-800 p-3"
              >
                <h4 className="font-medium">Manual wishlist printing</h4>
                <div className="flex flex-wrap gap-2">
                  <form action={switchManualWishlistToOwnedPrinting}>
                    <input
                      type="hidden"
                      name="wishlistItemId"
                      value={item.id}
                    />
                    <SubmitButton
                      pendingLabel="Switching…"
                      className="rounded border border-sky-700 px-3 py-2 text-sky-100"
                    >
                      Use owned printing
                    </SubmitButton>
                  </form>
                  <form action={switchManualWishlistToCheapestPrinting}>
                    <input
                      type="hidden"
                      name="wishlistItemId"
                      value={item.id}
                    />
                    <SubmitButton
                      pendingLabel="Switching…"
                      className="rounded border border-violet-700 px-3 py-2 text-violet-100"
                    >
                      Use cheapest printing
                    </SubmitButton>
                  </form>
                </div>
                <WishlistPrintingPicker
                  label="Change wishlist printing"
                  action={changeManualWishlistPrinting}
                  hiddenFields={{ wishlistItemId: item.id }}
                  defaultQuery={row.card.name}
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-400">
              Add a manual wishlist entry above to manage wishlist printing
              preferences.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-zinc-900 p-2">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

export function WishlistTable({
  groups,
  totalRows,
  page,
  pageSize,
  viewMode,
  cardSize: initialCardSize,
  query,
}: {
  groups: WishlistGroup[];
  totalRows: number;
  page: number;
  pageSize: number;
  viewMode: "table" | "binder";
  cardSize: CollectionCardSize;
  query: Record<string, string | undefined>;
}) {
  const [activeViewMode, setActiveViewMode] = useState<"table" | "binder">(
    () => {
      if (typeof window === "undefined") return viewMode;
      const stored = localStorage.getItem("wishlistViewMode");
      return stored === "table" || stored === "binder" ? stored : viewMode;
    },
  );
  const [cardSize, setCardSize] = useState<CollectionCardSize>(() =>
    typeof window !== "undefined"
      ? normalizeCollectionCardSize(
          localStorage.getItem("wishlistCardSize") || initialCardSize,
        )
      : initialCardSize,
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      if (typeof window === "undefined") return defaultVisibility;
      return (
        JSON.parse(localStorage.getItem("wishlistColumns") || "null") ||
        defaultVisibility
      );
    },
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<WishlistTableRow | null>(null);

  const data = useMemo<WishlistTableRow[]>(
    () =>
      groups.map((group) => {
        const missingQuantity = Math.max(
          0,
          group.totalWanted - group.inventory.ownedTotal,
        );
        return {
          ...group,
          missingQuantity,
          deckNamesLabel: decksLabel(group),
          deckNamesTitle: group.sources.decks
            .map((deck) => deck.deckName)
            .join(", "),
          priorityLabel:
            group.sources.manual
              .map((item) => item.priority)
              .filter(Boolean)
              .join(", ") || "—",
          notesLabel:
            group.sources.manual
              .map((item) => item.notes)
              .filter(Boolean)
              .join(" · ") || "—",
          colorIdentityLabel: colorIdentityLabel(
            (group.card as any).colorIdentity,
          ),
          priceLabel: money(group.estimatedPrice),
          setLabel: `${group.card.setCode.toUpperCase()} #${group.card.collectorNumber}`,
        };
      }),
    [groups],
  );

  const selectedCount = selectedKeys.size;

  const columns = useMemo<ColumnDef<WishlistTableRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all wishlist rows"
            checked={data.length > 0 && selectedKeys.size === data.length}
            onChange={(event) =>
              setSelectedKeys(
                event.target.checked
                  ? new Set(data.map((row) => row.key))
                  : new Set(),
              )
            }
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.card.name}`}
            checked={selectedKeys.has(row.original.key)}
            onChange={(event) =>
              setSelectedKeys((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(row.original.key);
                else next.delete(row.original.key);
                return next;
              })
            }
          />
        ),
        enableSorting: false,
      },
      {
        id: "cardName",
        accessorFn: (row) => row.card.name,
        header: "Card Name",
        cell: ({ row }) => (
          <button
            className="text-left text-sky-200 underline"
            onClick={() => setDetailRow(row.original)}
          >
            {row.original.card.name}
          </button>
        ),
      },
      { id: "wantedQty", accessorKey: "totalWanted", header: "Wanted Qty" },
      { id: "manualQty", accessorKey: "manualQuantity", header: "Manual Qty" },
      {
        id: "deckNeededQty",
        accessorKey: "deckQuantity",
        header: "Deck Needed Qty",
      },
      {
        id: "ownedTotal",
        accessorFn: (row) => row.inventory.ownedTotal,
        header: "Owned Total",
      },
      {
        id: "available",
        accessorFn: (row) => row.inventory.available,
        header: "Available",
      },
      {
        id: "committed",
        accessorFn: (row) => row.inventory.committedToDecks,
        header: "Committed",
      },
      { id: "missing", accessorKey: "missingQuantity", header: "Missing" },
      { id: "source", accessorKey: "sourceLabel", header: "Source" },
      {
        id: "decks",
        accessorKey: "deckNamesLabel",
        header: "Decks",
        cell: ({ row }) => (
          <span title={row.original.deckNamesTitle}>
            {row.original.deckNamesLabel}
          </span>
        ),
      },
      {
        id: "set",
        accessorKey: "setLabel",
        header: "Set",
        cell: ({ row }) => (
          <SetSymbol
            setCode={row.original.card.setCode}
            setName={row.original.card.setName}
            rarity={row.original.card.rarity}
          />
        ),
      },
      { id: "rarity", accessorFn: (row) => row.card.rarity, header: "Rarity" },
      {
        id: "manaCost",
        accessorFn: (row) => row.card.manaCost || "",
        header: "Mana Cost",
        cell: ({ row }) => <CardManaCost card={row.original.card} />,
      },
      {
        id: "typeLine",
        accessorFn: (row) => row.card.typeLine,
        header: "Type Line",
      },
      {
        id: "colorIdentity",
        accessorKey: "colorIdentityLabel",
        header: "Color Identity",
        cell: ({ row }) => (
          <ColorIdentityIcons value={row.original.colorIdentityLabel} />
        ),
      },
      {
        id: "price",
        accessorFn: (row) => row.estimatedPrice ?? -1,
        header: "Price",
        cell: ({ row }) => row.original.priceLabel,
      },
      { id: "priority", accessorKey: "priorityLabel", header: "Priority" },
      { id: "notes", accessorKey: "notesLabel", header: "Notes" },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <RowActionMenu
            row={row.original}
            onDetails={() => setDetailRow(row.original)}
          />
        ),
        enableSorting: false,
      },
    ],
    [data, selectedKeys],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table manages its own stable table instance API.
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        localStorage.setItem("wishlistColumns", JSON.stringify(next));
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  function hrefFor(next: Record<string, string | number>) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("viewMode", activeViewMode);
    params.set("cardSize", cardSize);
    Object.entries(next).forEach(([key, value]) =>
      params.set(key, String(value)),
    );
    return `/wishlist?${params.toString()}`;
  }

  const sizeClass = collectionCardGridClass(cardSize);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-400">View:</span>
          <button
            type="button"
            className={`border px-2 py-1 ${activeViewMode === "table" ? "bg-zinc-800" : ""}`}
            onClick={() => {
              setActiveViewMode("table");
              localStorage.setItem("wishlistViewMode", "table");
            }}
          >
            Table View
          </button>
          <button
            type="button"
            className={`border px-2 py-1 ${activeViewMode === "binder" ? "bg-zinc-800" : ""}`}
            onClick={() => {
              setActiveViewMode("binder");
              localStorage.setItem("wishlistViewMode", "binder");
            }}
          >
            Binder View
          </button>
          {activeViewMode === "binder" ? (
            <>
              <span className="ml-2 text-sm text-zinc-400">Card Size:</span>
              {(["small", "medium", "large"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`border px-2 py-1 capitalize ${cardSize === size ? "bg-zinc-800" : ""}`}
                  onClick={() => {
                    setCardSize(size);
                    localStorage.setItem("wishlistCardSize", size);
                  }}
                >
                  {size[0].toUpperCase() + size.slice(1)}
                </button>
              ))}
            </>
          ) : null}
        </div>
        <p className="text-sm text-zinc-400">
          Showing {(page - 1) * pageSize + (data.length ? 1 : 0)}–
          {(page - 1) * pageSize + data.length} of {totalRows}
        </p>
      </div>
      {selectedCount > 0 ? (
        <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
          {selectedCount} selected · bulk actions are available when selected.
          Use row menus for commit or printing actions.
        </div>
      ) : null}
      {activeViewMode === "table" ? (
        <>
          <details>
            <summary className="cursor-pointer text-sm text-zinc-300">
              Columns
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              {table.getAllLeafColumns().map((column) => (
                <label key={column.id} className="text-sm">
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                  />{" "}
                  {column.columnDef.header as string}
                </label>
              ))}
            </div>
          </details>
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="border-b border-zinc-800 p-2 text-left align-middle"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{ asc: " ↑", desc: " ↓" }[
                          header.column.getIsSorted() as string
                        ] ?? null}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={getRowId(row.original)}
                    className="border-b border-zinc-800 hover:bg-zinc-900/70"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2 align-middle">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 ? (
              <p className="p-6 text-zinc-400">
                No wishlist needs match this view.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className={`grid gap-3 ${sizeClass}`}>
          {data.map((row) => (
            <article
              key={getRowId(row)}
              className="relative rounded border border-zinc-800 bg-zinc-950 p-3 hover:bg-zinc-900/70"
            >
              <div className="absolute right-2 top-2">
                <RowActionMenu row={row} onDetails={() => setDetailRow(row)} />
              </div>
              <button
                type="button"
                onClick={() => setDetailRow(row)}
                className="block w-full text-left"
              >
                {row.card.imageUri ? (
                  <img
                    src={row.card.imageUri}
                    alt={row.card.name}
                    loading="lazy"
                    decoding="async"
                    width={265}
                    height={370}
                    className="mb-3 aspect-[63/88] w-full rounded object-cover"
                  />
                ) : (
                  <div className="mb-3 flex aspect-[63/88] items-center justify-center rounded bg-zinc-900 text-sm text-zinc-400">
                    No image
                  </div>
                )}
                <h3 className="font-semibold text-sky-100">{row.card.name}</h3>
                <p className="text-sm text-zinc-400">{row.card.typeLine}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <Metric label="Wanted" value={row.totalWanted} />
                  <Metric label="Missing" value={row.missingQuantity} />
                  <Metric label="Owned" value={row.inventory.ownedTotal} />
                  <Metric label="Available" value={row.inventory.available} />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                    {row.sourceLabel}
                  </span>
                  <span>{row.priceLabel}</span>
                </div>
              </button>
            </article>
          ))}
          {data.length === 0 ? (
            <p className="rounded border border-zinc-800 p-6 text-zinc-400 sm:col-span-2 lg:col-span-4">
              No wishlist needs match this view.
            </p>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 p-3 text-sm">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <a
            href={hrefFor({ page: Math.max(1, page - 1) })}
            className={`rounded border px-3 py-1 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </a>
          <a
            href={hrefFor({ page: Math.min(totalPages, page + 1) })}
            className={`rounded border px-3 py-1 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </a>
        </div>
      </div>
      <div className="rounded border border-dashed border-zinc-800 p-3 text-sm text-zinc-500">
        Infinite scroll sentinel: paginated mode is active; use Next to load the
        next wishlist page without duplicate rows.
      </div>
      {detailRow ? (
        <WishlistDetailDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
        />
      ) : null}
    </section>
  );
}
