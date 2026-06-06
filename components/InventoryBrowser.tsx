"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  InventoryAuditEntry,
  InventoryAuditTrail,
} from "./InventoryAuditTrail";
import { SubmitButton } from "./feedback/SubmitButton";

type PickRef = { id: string; name: string; color?: string };

export type InventoryRow = {
  id: string;
  cardId: string;
  cardName: string;
  quantity: number;
  currentOwnerId: string;
  currentOwner: string;
  currentOwnerColor?: string;
  originalOpenerId: string;
  originalOpener: string;
  roundId: string;
  roundOpened: string;
  setCode: string;
  setName?: string;
  rarity: string;
  manaCost?: string;
  manaValue?: number;
  typeLine: string;
  colorIdentity: string;
  priceUsd?: string;
  priceUsdFoil?: string;
  foil: boolean;
  foilStatus?: "NONFOIL" | "FOIL" | "ETCHED";
  sourceType?:
    | "PULL"
    | "CSV_PULL_IMPORT"
    | "TRADE"
    | "MANUAL"
    | "CORRECTION"
    | "PRIZE"
    | "OTHER";
  oracleText?: string;
  powerToughness?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string;
  legalities?: Record<string, string>;
  artist?: string;
  collectorNumber?: string;
  keywords?: string;
  notes?: string;
  imageUri?: string;
  imageSmall?: string;
  scryfallUri?: string;
  condition?: string;
  displayMode?: "exact" | "grouped";
  sourceItemIds?: string[];
  printingCount?: number;
  locationCount?: number;
  locationId?: string;
  locationName?: string;
  locationSummary?: string;
  locationBreakdown?: Array<{
    locationId: string | null;
    name: string;
    quantity: number;
  }>;
  printings?: Array<{
    id: string;
    cardName: string;
    setCode: string;
    collectorNumber: string;
    foilStatus?: string;
    condition?: string;
    language?: string;
    quantity: number;
    locationBreakdown: Array<{
      locationId: string | null;
      name: string;
      quantity: number;
    }>;
  }>;
  priceUsdEtched?: string;
  priceEur?: string;
  priceEurFoil?: string;
  priceTix?: string;
  auditHistory?: InventoryAuditEntry[];
};

export type ScryfallResult = {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  image_uris?: { normal?: string; small?: string };
};

const defaults: VisibilityState = {
  cardName: true,
  quantity: true,
  currentOwner: true,
  originalOpener: true,
  setCode: true,
  rarity: true,
  manaCost: true,
  typeLine: true,
  colorIdentity: true,
  priceUsd: true,
  foil: true,
  roundOpened: true,
  locationSummary: true,
};

function isHexColor(value?: string) {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}
function getPlayerColor(color?: string) {
  return isHexColor(color) ? color! : "#64748b";
}
function withOpacity(hexColor: string, opacity: number) {
  const c = getPlayerColor(hexColor).replace("#", "");
  return `rgba(${parseInt(c.slice(0, 2), 16)}, ${parseInt(c.slice(2, 4), 16)}, ${parseInt(c.slice(4, 6), 16)}, ${opacity})`;
}
function getCardImage(row: InventoryRow) {
  return row.imageUri || row.imageSmall || "";
}

function CardDetail({
  row,
  onClose,
  isAdmin,
  onEdit,
  onAudit,
}: {
  row: InventoryRow;
  onClose: () => void;
  isAdmin: boolean;
  onEdit: () => void;
  onAudit: () => void;
}) {
  const legalities = row.legalities || {};
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-zinc-950 border-l border-zinc-800 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold">{row.cardName}</h2>
          <div className="flex gap-2">
            {isAdmin ? (
              <button onClick={onEdit} className="border px-2">
                Edit Inventory Item
              </button>
            ) : null}
            <button onClick={onAudit} className="border px-2">
              Audit Trail
            </button>
            <button onClick={onClose} className="border px-2">
              Close
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-[240px_1fr] gap-4">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
            {getCardImage(row) ? (
              <img
                src={getCardImage(row)}
                alt={row.cardName}
                className="w-full rounded"
              />
            ) : (
              <div className="aspect-[63/88] flex items-center justify-center text-sm text-zinc-400">
                No image
              </div>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <p>
              <b>Mana Cost:</b> {row.manaCost || "-"}
            </p>
            <p>
              <b>Type Line:</b> {row.typeLine}
            </p>
            <p>
              <b>Oracle Text:</b> {row.oracleText || "-"}
            </p>
            <p>
              <b>Power/Toughness:</b> {row.powerToughness || "-"}
            </p>
            <p>
              <b>Loyalty:</b> {row.loyalty || "-"}
            </p>
            <p>
              <b>Defense:</b> {row.defense || "-"}
            </p>
            <p>
              <b>Colors:</b> {row.colors || "-"}
            </p>
            <p>
              <b>Color Identity:</b> {row.colorIdentity || "-"}
            </p>
            <p>
              <b>Set:</b> {row.setName || "-"} ({row.setCode})
            </p>
            <p>
              <b>Collector #:</b> {row.collectorNumber || "-"}
            </p>
            <p>
              <b>Rarity:</b> {row.rarity}
            </p>
            <p>
              <b>Artist:</b> {row.artist || "-"}
            </p>
            <p>
              <b>Total Quantity:</b> {row.quantity}
            </p>
            <p>
              <b>Location Summary:</b>{" "}
              {row.locationSummary || row.locationName || "Unassigned"}
            </p>
            {row.locationBreakdown?.length ? (
              <div>
                <b>Location Breakdown:</b>
                <ul className="mt-1 list-disc pl-5">
                  {row.locationBreakdown.map((location) => (
                    <li key={location.locationId ?? location.name}>
                      {location.name}: {location.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p>
              <b>Owner:</b> {row.currentOwner}
            </p>
            <p>
              <b>Original Owner:</b> {row.originalOpener}
            </p>
            <p>
              <b>Acquisition Group:</b> {row.roundOpened}
            </p>
            <p>
              <b>Foil:</b> {row.foilStatus || (row.foil ? "FOIL" : "NONFOIL")}
            </p>
            <p>
              <b>Condition:</b> {row.condition || "-"}
            </p>
            <p>
              <b>Source Type:</b> {row.sourceType || "-"}
            </p>
            <p>
              <b>Notes:</b> {row.notes || "-"}
            </p>
            {row.displayMode === "grouped" && row.printings?.length ? (
              <div>
                <b>Owned Printings:</b>
                <div className="mt-2 space-y-2">
                  {row.printings.map((printing) => (
                    <div
                      key={printing.id}
                      className="rounded border border-zinc-800 p-2"
                    >
                      <div className="font-semibold">
                        {printing.cardName} ({printing.setCode}) #
                        {printing.collectorNumber}
                      </div>
                      <div className="text-zinc-400">
                        {printing.foilStatus} · {printing.condition} ·{" "}
                        {printing.language} · Qty {printing.quantity}
                      </div>
                      <div className="text-zinc-300">
                        {printing.locationBreakdown
                          .map((loc) => `${loc.name}: ${loc.quantity}`)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <p>
              <b>Legalities:</b> CMD {legalities.commander || "-"} | STD{" "}
              {legalities.standard || "-"} | PIO {legalities.pioneer || "-"} |
              MOD {legalities.modern || "-"} | LEG {legalities.legacy || "-"} |
              VIN {legalities.vintage || "-"} | PAU {legalities.pauper || "-"}
            </p>
            <p>
              <b>Prices:</b> USD {row.priceUsd || "-"} / USD Foil{" "}
              {row.priceUsdFoil || "-"} / USD Etched {row.priceUsdEtched || "-"}{" "}
              / EUR {row.priceEur || "-"} / EUR Foil {row.priceEurFoil || "-"} /
              TIX {row.priceTix || "-"}
            </p>
            {row.scryfallUri ? (
              <p>
                <a
                  className="underline"
                  href={row.scryfallUri}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Scryfall
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InventoryBrowser({
  rows,
  players,
  rounds,
  locations,
  cardLabels,
  isAdmin,
  displayMode,
  onSaveEdit,
  onSearchPrintings,
  onDeleteInventoryItem,
}: {
  rows: InventoryRow[];
  players: PickRef[];
  rounds: PickRef[];
  locations: PickRef[];
  cardLabels: Record<string, string>;
  isAdmin: boolean;
  displayMode: "exact" | "grouped";
  onSaveEdit: (formData: FormData) => Promise<void>;
  onSearchPrintings: (formData: FormData) => Promise<ScryfallResult[]>;
  onDeleteInventoryItem?: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [auditRow, setAuditRow] = useState<InventoryRow | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "binder">(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("inventoryViewMode") as any) || "table"
      : "table",
  );
  const [cardSize, setCardSize] = useState<"small" | "medium" | "large">(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("inventoryCardSize") as any) || "medium"
      : "medium",
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      if (typeof window === "undefined") return defaults;
      try {
        return (
          JSON.parse(localStorage.getItem("inventoryColumns") || "null") ||
          defaults
        );
      } catch {
        return defaults;
      }
    },
  );
  const [message, setMessage] = useState<string>("");
  const [results, setResults] = useState<ScryfallResult[]>([]);
  const [confirmed, setConfirmed] = useState<ScryfallResult | null>(null);
  const [searchingPrintings, setSearchingPrintings] = useState(false);

  const cols = useMemo<ColumnDef<InventoryRow>[]>(
    () => [
      {
        accessorKey: "cardName",
        header: "Card Name",
        cell: ({ row }) => (
          <button
            className="underline text-left"
            onClick={() => setSelected(row.original)}
          >
            {row.original.cardName}
          </button>
        ),
      },
      { accessorKey: "quantity", header: "Total cards" },
      { accessorKey: "locationSummary", header: "Location summary" },
      ...(displayMode === "grouped"
        ? [
            { accessorKey: "printingCount", header: "Printings" },
            { accessorKey: "locationCount", header: "Locations" },
          ]
        : []),
      {
        accessorKey: "currentOwner",
        header: "Owner",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: getPlayerColor(row.original.currentOwnerColor),
              }}
            />
            {row.original.currentOwner}
          </span>
        ),
      },
      { accessorKey: "originalOpener", header: "Original Owner" },
      { accessorKey: "setCode", header: "Set" },
      { accessorKey: "rarity", header: "Rarity" },
      { accessorKey: "manaCost", header: "Mana Cost" },
      { accessorKey: "typeLine", header: "Type Line" },
      { accessorKey: "colorIdentity", header: "Color Identity" },
      { accessorKey: "priceUsd", header: "Scryfall USD Price" },
      { accessorKey: "foilStatus", header: "Foil" },
      { accessorKey: "roundOpened", header: "Acquisition Group" },
      ...(isAdmin
        ? [
            {
              id: "actions",
              header: "Actions",
              cell: ({ row }: any) =>
                row.original.displayMode === "exact" &&
                (row.original.sourceItemIds?.length ?? 1) === 1 ? (
                  <button
                    className="border px-2"
                    onClick={() => {
                      setEditing(row.original);
                      setConfirmed(null);
                      setResults([]);
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">Grouped</span>
                ),
            },
          ]
        : []),
    ],
    [isAdmin, displayMode],
  );

  const table = useReactTable({
    data: rows,
    columns: cols,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (v) => {
      const next = typeof v === "function" ? v(columnVisibility) : v;
      setColumnVisibility(next);
      localStorage.setItem("inventoryColumns", JSON.stringify(next));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const sizeClass =
    cardSize === "small"
      ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-8"
      : cardSize === "large"
        ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
        : "grid-cols-2 md:grid-cols-4 lg:grid-cols-6";

  return (
    <div className="space-y-3">
      {message ? (
        <div
          className="border border-emerald-700 bg-emerald-950 text-emerald-300 p-2 text-sm"
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      ) : null}
      {isAdmin ? (
        <div className="border border-sky-800 bg-sky-950/40 text-sky-200 p-2 text-sm">
          Admin edit mode is active. Use the Actions column in Table View, or
          open a card detail from either view and choose Edit Inventory Item.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm">View:</span>
        <button
          className={`border px-2 ${viewMode === "table" ? "bg-zinc-800" : ""}`}
          onClick={() => {
            setViewMode("table");
            localStorage.setItem("inventoryViewMode", "table");
          }}
        >
          Table View
        </button>
        <button
          className={`border px-2 ${viewMode === "binder" ? "bg-zinc-800" : ""}`}
          onClick={() => {
            setViewMode("binder");
            localStorage.setItem("inventoryViewMode", "binder");
          }}
        >
          Binder View
        </button>
        {viewMode === "binder" ? (
          <>
            <span className="text-sm ml-4">Card Size:</span>
            <button
              className={`border px-2 ${cardSize === "small" ? "bg-zinc-800" : ""}`}
              onClick={() => {
                setCardSize("small");
                localStorage.setItem("inventoryCardSize", "small");
              }}
            >
              Small
            </button>
            <button
              className={`border px-2 ${cardSize === "medium" ? "bg-zinc-800" : ""}`}
              onClick={() => {
                setCardSize("medium");
                localStorage.setItem("inventoryCardSize", "medium");
              }}
            >
              Medium
            </button>
            <button
              className={`border px-2 ${cardSize === "large" ? "bg-zinc-800" : ""}`}
              onClick={() => {
                setCardSize("large");
                localStorage.setItem("inventoryCardSize", "large");
              }}
            >
              Large
            </button>
          </>
        ) : null}
      </div>

      {viewMode === "table" ? (
        <>
          <details>
            <summary className="cursor-pointer">Columns</summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {table.getAllLeafColumns().map((c) => (
                <label key={c.id} className="text-sm">
                  <input
                    type="checkbox"
                    checked={c.getIsVisible()}
                    onChange={c.getToggleVisibilityHandler()}
                  />{" "}
                  {c.columnDef.header as string}
                </label>
              ))}
            </div>
          </details>
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className="p-2 text-left border-b border-zinc-800 cursor-pointer"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-800"
                    style={{
                      borderLeft: `4px solid ${getPlayerColor(r.original.currentOwnerColor)}`,
                      backgroundColor: withOpacity(
                        r.original.currentOwnerColor || "",
                        0.06,
                      ),
                    }}
                  >
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className="p-2">
                        {c.column.columnDef.cell
                          ? flexRender(c.column.columnDef.cell, c.getContext())
                          : String(c.getValue() ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className={`grid gap-3 ${sizeClass}`}>
          {table.getRowModel().rows.map((r) => {
            const row = r.original;
            const ownerColor = getPlayerColor(row.currentOwnerColor);
            return (
              <button
                key={row.id}
                onClick={() => setSelected(row)}
                className="text-left border rounded p-2 bg-zinc-900 hover:bg-zinc-800"
                style={{
                  borderColor: ownerColor,
                  background: `linear-gradient(180deg, ${withOpacity(ownerColor, 0.13)} 0%, rgba(24,24,27,0.95) 50%)`,
                  boxShadow: `0 0 18px ${withOpacity(ownerColor, 0.28)}`,
                }}
              >
                <div className="relative">
                  {getCardImage(row) ? (
                    <img
                      src={getCardImage(row)}
                      alt={row.cardName}
                      className="w-full rounded aspect-[63/88] object-cover"
                    />
                  ) : (
                    <div className="w-full rounded aspect-[63/88] border border-zinc-700 flex items-center justify-center text-xs text-zinc-400 p-2">
                      {row.cardName}
                    </div>
                  )}
                  <span className="absolute top-1 right-1 bg-black/80 text-white text-xs px-2 py-0.5 rounded">
                    x{row.quantity}
                  </span>
                  {row.foilStatus && row.foilStatus !== "NONFOIL" ? (
                    <span className="absolute top-1 left-1 bg-amber-400 text-black text-[10px] px-1 rounded">
                      {row.foilStatus}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm font-medium truncate">
                  {row.cardName}
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-2">
                  <span>
                    {row.displayMode === "grouped"
                      ? `${row.printingCount} printings`
                      : `${row.setCode} · ${row.rarity}`}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ownerColor }}
                    />
                    {row.currentOwner}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <button
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="border px-2"
        >
          Prev
        </button>
        <span>
          Page {table.getState().pagination.pageIndex + 1} /{" "}
          {table.getPageCount() || 1}
        </span>
        <button
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="border px-2"
        >
          Next
        </button>
      </div>

      {selected ? (
        <CardDetail
          row={selected}
          onClose={() => setSelected(null)}
          isAdmin={isAdmin}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onAudit={() => {
            setAuditRow(selected);
            setSelected(null);
          }}
        />
      ) : null}

      {auditRow ? (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setAuditRow(null)}
        >
          <div
            className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-zinc-950 border-l border-zinc-800 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold">Audit Trail</h2>
                <p className="text-sm text-zinc-400">{auditRow.cardName}</p>
              </div>
              <button onClick={() => setAuditRow(null)} className="border px-2">
                Close
              </button>
            </div>
            <InventoryAuditTrail
              entries={auditRow.auditHistory}
              playerLabels={Object.fromEntries(
                players.map((p) => [p.id, p.name]),
              )}
              roundLabels={Object.fromEntries(
                rounds.map((r) => [r.id, r.name]),
              )}
              cardLabels={cardLabels}
            />
          </div>
        </div>
      ) : null}

      {editing && isAdmin ? (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setEditing(null)}
        >
          <div
            className="max-w-3xl mx-auto mt-8 bg-zinc-950 border border-zinc-700 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Edit Inventory Item</h3>
            <form
              action={async (fd) => {
                try {
                  await onSaveEdit(fd);
                  setMessage("Inventory item updated.");
                  setEditing(null);
                  router.refresh();
                } catch (e: any) {
                  setMessage(e?.message || "Failed to save inventory edit.");
                }
              }}
              className="space-y-3"
            >
              <input type="hidden" name="inventoryItemId" value={editing.id} />
              <input
                type="hidden"
                name="existingCardId"
                value={editing.cardId}
              />
              <div className="grid md:grid-cols-2 gap-2">
                <label className="text-sm">
                  Current owner
                  <select
                    name="currentOwnerId"
                    defaultValue={editing.currentOwnerId}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Original opener
                  <select
                    name="originalOpenerId"
                    defaultValue={editing.originalOpenerId}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option value="">(none)</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Acquisition group
                  <select
                    name="roundId"
                    defaultValue={editing.roundId}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option value="">(none)</option>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Location
                  <select
                    name="locationId"
                    defaultValue={editing.locationId || ""}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option value="">Unassigned</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    defaultValue={editing.quantity}
                    className="w-full border p-1 bg-zinc-900"
                  />
                </label>
                <label className="text-sm">
                  Foil status
                  <select
                    name="foilStatus"
                    defaultValue={editing.foilStatus || "NONFOIL"}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option value="NONFOIL">nonfoil</option>
                    <option value="FOIL">foil</option>
                    <option value="ETCHED">etched</option>
                  </select>
                </label>
                <label className="text-sm">
                  Condition
                  <select
                    name="condition"
                    defaultValue={editing.condition || "NM"}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option>NM</option>
                    <option>LP</option>
                    <option>MP</option>
                    <option>HP</option>
                    <option>DMG</option>
                  </select>
                </label>
                <label className="text-sm">
                  Source type
                  <select
                    name="sourceType"
                    defaultValue={editing.sourceType || "CORRECTION"}
                    className="w-full border p-1 bg-zinc-900"
                  >
                    <option value="PULL">legacy pull</option>
                    <option value="CSV_PULL_IMPORT">
                      csv inventory import
                    </option>
                    <option value="TRADE">trade</option>
                    <option value="MANUAL">manual</option>
                    <option value="CORRECTION">correction</option>
                    <option value="PRIZE">prize</option>
                    <option value="OTHER">other</option>
                  </select>
                </label>
                <label className="text-sm">
                  Reason
                  <input
                    name="reason"
                    required
                    className="w-full border p-1 bg-zinc-900"
                    placeholder="Reason for change"
                  />
                </label>
              </div>
              <label className="text-sm block">
                Notes
                <textarea
                  name="notes"
                  defaultValue={editing.notes || ""}
                  className="w-full border p-1 bg-zinc-900"
                />
              </label>
              <div className="border border-zinc-800 p-2 text-sm">
                Current printing: {editing.cardName} ({editing.setCode}) #
                {editing.collectorNumber || "-"} • {editing.rarity}
              </div>
              <div className="border border-zinc-800 p-2 space-y-2">
                <div className="font-semibold text-sm">Change Printing</div>
                <div className="flex gap-2">
                  <input
                    id="printingQuery"
                    name="printingQuery"
                    className="border p-1 bg-zinc-900 flex-1"
                    placeholder="Search Scryfall"
                  />
                  <button
                    type="button"
                    className="border px-2 disabled:opacity-60"
                    disabled={searchingPrintings}
                    aria-disabled={searchingPrintings}
                    onClick={async () => {
                      const q =
                        (
                          document.getElementById(
                            "printingQuery",
                          ) as HTMLInputElement
                        )?.value || "";
                      setSearchingPrintings(true);
                      try {
                        const f = new FormData();
                        f.set("q", q);
                        const r = await onSearchPrintings(f);
                        setResults(r || []);
                        setMessage(
                          `${r?.length || 0} Scryfall printings found.`,
                        );
                      } catch (e: any) {
                        setMessage(e?.message || "Failed to search printings.");
                      } finally {
                        setSearchingPrintings(false);
                      }
                    }}
                  >
                    {searchingPrintings ? "Searching…" : "Search"}
                  </button>
                </div>
                <div className="max-h-40 overflow-auto space-y-1">
                  {results.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setConfirmed(r)}
                      className={`w-full text-left border p-1 ${confirmed?.id === r.id ? "border-emerald-500" : "border-zinc-700"}`}
                    >
                      {r.name} ({r.set.toUpperCase()}) #{r.collector_number} •{" "}
                      {r.rarity}
                    </button>
                  ))}
                </div>
                <input
                  type="hidden"
                  name="newScryfallId"
                  value={confirmed?.id || ""}
                />
                <div className="text-xs text-zinc-400">
                  Select a search result to confirm printing replacement.
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="border px-3"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <SubmitButton pendingLabel="Saving…" className="border px-3">
                  Save Changes
                </SubmitButton>
              </div>
            </form>
            {onDeleteInventoryItem ? (
              <details className="mt-4 rounded border border-red-900/70 bg-red-950/20 p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-red-200">
                  Delete Inventory Item
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-red-100">
                    This removes <b>{editing.cardName}</b> from active inventory
                    for <b>{editing.currentOwner}</b>.
                  </p>
                  <div className="grid md:grid-cols-2 gap-2 text-zinc-300">
                    <div>Quantity: {editing.quantity}</div>
                    <div>
                      Set: {editing.setCode} #{editing.collectorNumber || "-"}
                    </div>
                    <div>
                      Foil:{" "}
                      {editing.foilStatus ||
                        (editing.foil ? "FOIL" : "NONFOIL")}
                    </div>
                    <div>Condition: {editing.condition || "-"}</div>
                  </div>
                  <form
                    action={async (fd) => {
                      try {
                        if (
                          !window.confirm(
                            "Delete this inventory item? This cannot be undone from this dialog.",
                          )
                        )
                          return;
                        await onDeleteInventoryItem(fd);
                        setMessage("Inventory item deleted.");
                        setEditing(null);
                        router.refresh();
                      } catch (e: any) {
                        setMessage(
                          e?.message || "Failed to delete inventory item.",
                        );
                      }
                    }}
                    className="space-y-2"
                  >
                    <input
                      type="hidden"
                      name="inventoryItemId"
                      value={editing.id}
                    />
                    <label className="block">
                      Delete reason
                      <input
                        name="deleteReason"
                        required
                        className="mt-1 w-full border p-2 bg-zinc-900"
                        placeholder="Reason for deleting this inventory item"
                      />
                    </label>
                    <SubmitButton
                      pendingLabel="Deleting…"
                      className="border border-red-700 px-3 py-2 text-red-100"
                    >
                      Confirm Delete Inventory Item
                    </SubmitButton>
                  </form>
                </div>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
