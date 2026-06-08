"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { WishlistGroup } from "@/lib/wishlist";
import { CardManaCost, ColorIdentityIcons, SetSymbol } from "./mtg/CardSymbols";
import { SubmitButton } from "./feedback/SubmitButton";
import { commitDeckCardToDeck } from "@/app/decks/actions";
import {
  addManualWishlistItem,
  removeManualWishlistItem,
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
  const firstCommitOption = row.sources.decks.flatMap((need) =>
    need.commitOptions.map((option) => ({ need, option })),
  )[0];
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
            {firstManual
              ? "Add manual quantity"
              : "Add manual wishlist quantity"}
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
        {firstCommitOption ? (
          <form action={commitDeckCardToDeck}>
            <input
              type="hidden"
              name="deckId"
              value={firstCommitOption.need.deckId}
            />
            <input
              type="hidden"
              name="deckCardId"
              value={firstCommitOption.need.deckCardId}
            />
            <input
              type="hidden"
              name="inventoryItemId"
              value={firstCommitOption.option.inventoryItemId}
            />
            <input
              type="hidden"
              name="quantity"
              value={Math.min(
                firstCommitOption.option.quantity,
                firstCommitOption.need.missingQuantity,
              )}
            />
            <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-800">
              Commit available copy
            </button>
          </form>
        ) : null}
        {firstDeckNeed ? (
          <>
            <form action={switchWishlistDeckCardToOwnedPrinting}>
              <input type="hidden" name="deckId" value={firstDeckNeed.deckId} />
              <input
                type="hidden"
                name="deckCardId"
                value={firstDeckNeed.deckCardId}
              />
              <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-800">
                Use owned printing
              </button>
            </form>
            <form action={switchWishlistDeckCardToCheapestPrinting}>
              <input type="hidden" name="deckId" value={firstDeckNeed.deckId} />
              <input
                type="hidden"
                name="deckCardId"
                value={firstDeckNeed.deckCardId}
              />
              <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-800">
                Use cheapest printing
              </button>
            </form>
            <Link
              href={`/decks/${firstDeckNeed.deckId}`}
              className="block rounded px-3 py-2 text-sm hover:bg-zinc-800"
            >
              View deck
            </Link>
          </>
        ) : null}
        <Link
          href={`/inventory?q=${encodeURIComponent(row.card.name)}`}
          className="block rounded px-3 py-2 text-sm hover:bg-zinc-800"
        >
          View in inventory
        </Link>
      </div>
    </details>
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
        className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4"
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
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
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
            <p>
              <b>Mana Cost:</b> <CardManaCost card={row.card} showFaceNames />
            </p>
            <p>
              <b>Type Line:</b> {row.card.typeLine}
            </p>
            <p>
              <b>Set:</b> {row.card.setCode.toUpperCase()} #
              {row.card.collectorNumber} · {row.card.rarity}
            </p>
            <p>
              <b>Color Identity:</b>{" "}
              <ColorIdentityIcons value={row.colorIdentityLabel} />
            </p>
            <p>
              <b>Price:</b> {row.priceLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Wanted Qty" value={row.totalWanted} />
              <Metric label="Manual Qty" value={row.manualQuantity} />
              <Metric label="Deck Needed Qty" value={row.deckQuantity} />
              <Metric label="Owned Total" value={row.inventory.ownedTotal} />
              <Metric label="Available" value={row.inventory.available} />
              <Metric
                label="Committed"
                value={row.inventory.committedToDecks}
              />
            </div>
          </div>
        </div>
        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Manual wishlist</h3>
          {row.sources.manual.length ? (
            row.sources.manual.map((item) => (
              <form
                key={item.id}
                action={updateManualWishlistItem}
                className="grid gap-2 rounded border border-zinc-800 p-3 md:grid-cols-[80px_120px_1fr_auto]"
              >
                <input type="hidden" name="wishlistItemId" value={item.id} />
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue={item.quantity}
                  className="border bg-zinc-900 p-2"
                />
                <input
                  name="priority"
                  defaultValue={item.priority || ""}
                  placeholder="Priority"
                  className="border bg-zinc-900 p-2"
                />
                <input
                  name="notes"
                  defaultValue={item.notes || ""}
                  placeholder="Notes"
                  className="border bg-zinc-900 p-2"
                />
                <SubmitButton
                  pendingLabel="Saving…"
                  className="rounded border px-3 py-2"
                >
                  Save
                </SubmitButton>
              </form>
            ))
          ) : (
            <p className="text-zinc-400">No manual wishlist entry.</p>
          )}
        </section>
        <section className="mt-4 space-y-3">
          <h3 className="font-semibold">Deck-derived breakdown</h3>
          {row.sources.decks.length ? (
            row.sources.decks.map((need) => (
              <div
                key={need.deckCardId}
                className="rounded border border-zinc-800 p-3 text-sm"
              >
                <Link
                  href={`/decks/${need.deckId}`}
                  className="font-medium text-sky-200"
                >
                  {need.deckName}
                </Link>
                <p className="text-zinc-400">
                  {need.section.toLowerCase()} · required{" "}
                  {need.requiredQuantity} · committed here{" "}
                  {need.committedQuantity} · committed other decks{" "}
                  {need.committedToOtherDecks} · missing {need.missingQuantity}
                </p>
                <p className="text-zinc-500">
                  Selected printing:{" "}
                  {need.selectedPrinting?.setCode.toUpperCase()} #
                  {need.selectedPrinting?.collectorNumber}; available to commit{" "}
                  {need.availableExact + need.availableOther} (
                  {need.availableExact} exact, {need.availableOther} other)
                </p>
              </div>
            ))
          ) : (
            <p className="text-zinc-400">No deck-derived needs.</p>
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

export function WishlistTable({ groups }: { groups: WishlistGroup[] }) {
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

  return (
    <section className="space-y-3">
      {selectedCount > 0 ? (
        <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-100">
          {selectedCount} selected · bulk actions are available when selected.
          Use row menus for commit or printing actions.
        </div>
      ) : null}
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
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
      {detailRow ? (
        <WishlistDetailDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
        />
      ) : null}
    </section>
  );
}
