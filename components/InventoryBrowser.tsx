"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ColumnDef,
  PaginationState,
  flexRender,
  getCoreRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  InventoryAuditEntry,
  InventoryAuditTrail,
} from "./InventoryAuditTrail";
import { SubmitButton } from "./feedback/SubmitButton";
import { LoadingSpinner } from "./feedback/LoadingSpinner";
import {
  CardManaCost,
  ColorIdentityIcons,
  SetLabel,
  SetSymbol,
} from "./mtg/CardSymbols";
import {
  collectionCardGridClass,
  normalizeCollectionCardSize,
  type CollectionCardSize,
} from "./cardGrid";
import {
  cn,
  filterButtonClass,
  filterDangerButtonClass,
  filterInputClass,
  filterLabelClass,
  filterPanelClass,
  filterPrimaryButtonClass,
  filterSelectClass,
  filterTextareaClass,
} from "./filterStyles";

type PickRef = { id: string; name: string; color?: string };

export type InventoryRow = {
  id: string;
  cardId: string;
  cardName: string;
  quantity: number;
  currentOwnerId: string;
  currentOwner: string;
  currentOwnerColor?: string;
  setCode: string;
  setName?: string;
  rarity: string;
  manaCost?: string;
  manaFaces?: Array<{ name?: string; manaCost?: string | null }>;
  layout?: string;
  manaValue?: number;
  typeLine: string;
  colorIdentity: string;
  priceUsd?: string;
  priceUsdFoil?: string;
  preferredPriceLabel?: string;
  priceSourceLabel?: string;
  priceHistoryUrl?: string;
  priceChange7Day?: string;
  priceChange30Day?: string;
  priceChange90Day?: string;
  priceHistory?: Array<{
    provider: string;
    finish: string;
    priceType: string;
    currency: string;
    price: string;
    observedDate: string;
  }>;
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
  effectiveVisibility?: "PRIVATE" | "PUBLIC";
  locationVisibility?: "PRIVATE" | "PUBLIC" | "INHERIT";
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
  language?: string;
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
    rarity?: string;
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

export type InventoryUiMode =
  | "owner-editable"
  | "admin-editable"
  | "public-readonly";

export type InventoryCapabilities = {
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canBulkSelect: boolean;
  canBulkMove: boolean;
  canBulkDelete: boolean;
  canViewAuditTrail: boolean;
  canViewPrivateSourceInfo: boolean;
  canViewOwnerAdminFields: boolean;
  canViewVisibility: boolean;
};

const READ_ONLY_CAPABILITIES: InventoryCapabilities = {
  canEdit: false,
  canMove: false,
  canDelete: false,
  canBulkSelect: false,
  canBulkMove: false,
  canBulkDelete: false,
  canViewAuditTrail: false,
  canViewPrivateSourceInfo: false,
  canViewOwnerAdminFields: false,
  canViewVisibility: false,
};

function defaultCapabilities(uiMode: InventoryUiMode): InventoryCapabilities {
  if (uiMode === "public-readonly") return READ_ONLY_CAPABILITIES;

  const isAdminEditable = uiMode === "admin-editable";
  return {
    canEdit: true,
    canMove: true,
    canDelete: true,
    canBulkSelect: true,
    canBulkMove: true,
    canBulkDelete: true,
    canViewAuditTrail: true,
    canViewPrivateSourceInfo: true,
    canViewOwnerAdminFields: isAdminEditable,
    canViewVisibility: true,
  };
}

const defaults: VisibilityState = {
  cardName: true,
  quantity: true,
  currentOwner: true,
  setCode: true,
  rarity: true,
  manaCost: true,
  typeLine: true,
  colorIdentity: true,
  priceUsd: true,
  foil: true,
  effectiveVisibility: true,
  locationSummary: true,
};

const INVENTORY_SCROLL_STORAGE_KEY = "mtg-inventory-scroll-y";

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

function getRowSourceIds(row: InventoryRow) {
  return row.sourceItemIds?.length ? row.sourceItemIds : [row.id];
}

function friendlyVisibility(value?: InventoryRow["effectiveVisibility"]) {
  return value === "PUBLIC" ? "Public" : "Private";
}

function friendlySource(value?: InventoryRow["sourceType"]) {
  switch (value) {
    case "CSV_PULL_IMPORT":
      return "Import";
    case "PULL":
      return "Legacy";
    case "TRADE":
      return "Trade";
    case "MANUAL":
      return "Manual add";
    case "CORRECTION":
      return "Correction";
    case "PRIZE":
      return "Prize";
    case "OTHER":
      return "Other";
    default:
      return "Unknown";
  }
}

function CardDetail({
  row,
  onClose,
  capabilities,
  onEdit,
  onAudit,
  onDelete,
}: {
  row: InventoryRow;
  onClose: () => void;
  capabilities: InventoryCapabilities;
  onEdit?: () => void;
  onAudit?: () => void;
  onDelete?: () => void;
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
            {capabilities.canEdit && onEdit ? (
              <button
                onClick={onEdit}
                className={cn(filterButtonClass, "px-2 py-1")}
              >
                Edit Inventory Item
              </button>
            ) : null}
            {capabilities.canViewAuditTrail && onAudit ? (
              <button
                onClick={onAudit}
                className={cn(filterButtonClass, "px-2 py-1")}
              >
                Audit Trail
              </button>
            ) : null}
            {capabilities.canDelete && onDelete ? (
              <button
                onClick={onDelete}
                className={cn(filterDangerButtonClass, "px-2 py-1")}
              >
                Delete inventory entry
              </button>
            ) : null}
            <button
              onClick={onClose}
              className={cn(filterButtonClass, "px-2 py-1")}
            >
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
                loading="lazy"
                decoding="async"
                width={240}
                height={336}
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
              <b>Mana Cost:</b> <CardManaCost card={row} showFaceNames />
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
              <b>Color Identity:</b>{" "}
              <ColorIdentityIcons value={row.colorIdentity} />
            </p>
            <p>
              <b>Set:</b>{" "}
              <SetLabel
                setCode={row.setCode}
                setName={row.setName}
                rarity={row.rarity}
              />
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
            {capabilities.canViewOwnerAdminFields ? (
              <p>
                <b>Owner:</b> {row.currentOwner}
              </p>
            ) : null}
            <p>
              <b>Foil:</b> {row.foilStatus || (row.foil ? "FOIL" : "NONFOIL")}
            </p>
            <p>
              <b>Condition:</b> {row.condition || "-"}
            </p>
            {capabilities.canViewPrivateSourceInfo ? (
              <p>
                <b>Source:</b> {friendlySource(row.sourceType)}
              </p>
            ) : null}
            {capabilities.canViewVisibility ? (
              <p>
                <b>Visibility:</b> {friendlyVisibility(row.effectiveVisibility)}
              </p>
            ) : null}
            {capabilities.canViewPrivateSourceInfo ? (
              <p>
                <b>Notes:</b> {row.notes || "-"}
              </p>
            ) : null}
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
                        {printing.cardName} (
                        <SetSymbol
                          setCode={printing.setCode}
                          rarity={printing.rarity}
                        />
                        ) #{printing.collectorNumber}
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
              <b>Preferred price:</b> {row.preferredPriceLabel || "—"}
              {row.priceSourceLabel ? ` · ${row.priceSourceLabel}` : ""}
            </p>
            <p>
              <b>Scryfall fallback prices:</b> USD {row.priceUsd || "-"} / USD
              Foil {row.priceUsdFoil || "-"} / USD Etched{" "}
              {row.priceUsdEtched || "-"} / EUR {row.priceEur || "-"} / EUR Foil{" "}
              {row.priceEurFoil || "-"} / TIX {row.priceTix || "-"}
            </p>
            {row.priceHistory?.length ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>Price history:</b>
                  {row.priceHistoryUrl ? (
                    <a
                      className="text-xs text-sky-300 underline"
                      href={row.priceHistoryUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View price history JSON
                    </a>
                  ) : null}
                </div>
                <p className="text-xs text-zinc-400">
                  7d {row.priceChange7Day || "—"} · 30d{" "}
                  {row.priceChange30Day || "—"} · 90d{" "}
                  {row.priceChange90Day || "—"}
                </p>
                <div className="overflow-x-auto">
                  <table className="mt-1 min-w-full text-xs">
                    <thead className="text-zinc-400">
                      <tr>
                        <th className="pr-3 text-left">Date</th>
                        <th className="pr-3 text-left">Provider</th>
                        <th className="pr-3 text-left">Finish</th>
                        <th className="pr-3 text-left">Type</th>
                        <th className="text-left">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.priceHistory.slice(0, 8).map((entry) => (
                        <tr
                          key={`${entry.provider}-${entry.finish}-${entry.priceType}-${entry.currency}-${entry.observedDate}`}
                        >
                          <td className="pr-3">{entry.observedDate}</td>
                          <td className="pr-3">{entry.provider}</td>
                          <td className="pr-3">{entry.finish}</td>
                          <td className="pr-3">{entry.priceType}</td>
                          <td>
                            {entry.currency} {entry.price}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
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
  locations,
  cardLabels,
  isAdmin,
  uiMode = isAdmin ? "admin-editable" : "owner-editable",
  capabilities: capabilityOverrides,
  displayMode,
  totalMatchingCount,
  totalMatchingCards,
  currentPage = 1,
  totalPages = 1,
  hasNextPage = false,
  hasPreviousPage = false,
  pageHrefBase,
  infiniteApiPath,
  initialPageSize,
  initialBrowsingMode,
  initialSortField = "cardName",
  initialSortDirection = "asc",
  currentLocationId,
  onBulkMoveLocation,
  onBulkDeleteInventory,
  onSaveEdit,
  onSearchPrintings,
  onDeleteInventoryItem,
}: {
  rows: InventoryRow[];
  players: PickRef[];
  locations: PickRef[];
  cardLabels: Record<string, string>;
  isAdmin: boolean;
  uiMode?: InventoryUiMode;
  capabilities?: Partial<InventoryCapabilities>;
  displayMode: "exact" | "grouped";
  totalMatchingCount: number;
  totalMatchingCards: number;
  currentPage?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  pageHrefBase?: string;
  infiniteApiPath?: string;
  initialPageSize: number;
  initialBrowsingMode: "paginated" | "infinite";
  initialSortField?: string;
  initialSortDirection?: "asc" | "desc";
  currentLocationId?: string;
  onBulkMoveLocation?: (formData: FormData) => Promise<
    | {
        success: true;
        movedEntries: number;
        movedCards: number;
        skippedEntries: number;
        destinationLocationName: string;
        sourceLocationName?: string;
      }
    | { success: false; message: string }
  >;
  onBulkDeleteInventory?: (formData: FormData) => Promise<
    | {
        success: true;
        deletedEntries: number;
        deletedCards: number;
        scope: "selected" | "matching" | "location";
        locationName?: string;
      }
    | { success: false; message: string }
  >;
  onSaveEdit?: (formData: FormData) => Promise<void>;
  onSearchPrintings?: (formData: FormData) => Promise<ScryfallResult[]>;
  onDeleteInventoryItem?: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>(
    initialSortField
      ? [{ id: initialSortField, desc: initialSortDirection === "desc" }]
      : [],
  );
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [auditRow, setAuditRow] = useState<InventoryRow | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "binder">(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("inventoryViewMode") as any) || "table"
      : "table",
  );
  const [cardSize, setCardSize] = useState<CollectionCardSize>(() =>
    typeof window !== "undefined"
      ? normalizeCollectionCardSize(localStorage.getItem("inventoryCardSize"))
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
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [movingBulk, setMovingBulk] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [bulkDestinationLocationId, setBulkDestinationLocationId] =
    useState("");
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [browsingMode, setBrowsingMode] = useState<"paginated" | "infinite">(
    initialBrowsingMode,
  );
  const [loadedRows, setLoadedRows] = useState<InventoryRow[]>(rows);
  const [infiniteHasNextPage, setInfiniteHasNextPage] = useState(hasNextPage);
  const [nextInfinitePage, setNextInfinitePage] = useState(currentPage + 1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const queryKey = useMemo(
    () =>
      JSON.stringify({
        pageHrefBase: pageHrefBase || "",
        displayMode,
        pageSize,
        uiMode,
        infiniteApiPath: infiniteApiPath || "",
      }),
    [displayMode, infiniteApiPath, pageHrefBase, pageSize, uiMode],
  );
  const queryKeyRef = useRef(queryKey);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const infiniteSentinelRef = useRef<HTMLDivElement | null>(null);
  const capabilities = useMemo<InventoryCapabilities>(() => {
    return { ...defaultCapabilities(uiMode), ...capabilityOverrides };
  }, [capabilityOverrides, uiMode]);

  function rememberScrollPosition() {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      INVENTORY_SCROLL_STORAGE_KEY,
      String(window.scrollY),
    );
  }

  const pageHref = useCallback(
    (page: number) => {
      const params = new URLSearchParams(
        pageHrefBase ||
          (typeof window !== "undefined" ? window.location.search : ""),
      );
      params.set("page", String(Math.max(1, page)));
      return `${typeof window !== "undefined" ? window.location.pathname : ""}?${params.toString()}`;
    },
    [pageHrefBase],
  );

  const selectionAvailable =
    displayMode === "exact" && capabilities.canBulkSelect;
  const renderedRows = browsingMode === "infinite" ? loadedRows : rows;
  const selectedEntriesCount = allMatchingSelected
    ? totalMatchingCount
    : selectedItemIds.size;
  const selectedCardsCount = allMatchingSelected
    ? totalMatchingCards
    : renderedRows
        .filter((row) =>
          (row.sourceItemIds ?? [row.id]).some((id) => selectedItemIds.has(id)),
        )
        .reduce((sum, row) => sum + row.quantity, 0);

  async function openAuditTrail(row: InventoryRow) {
    setSelected(null);
    setAuditRow({ ...row, auditHistory: row.auditHistory || [] });
    setAuditLoading(true);
    setAuditError("");
    try {
      const itemIds = getRowSourceIds(row).join(",");
      const response = await fetch(
        `/api/inventory/audit?itemIds=${encodeURIComponent(itemIds)}`,
      );
      if (!response.ok) throw new Error("Audit trail could not be loaded.");
      const data = (await response.json()) as {
        entries?: InventoryAuditEntry[];
      };
      setAuditRow({ ...row, auditHistory: data.entries || [] });
    } catch (error) {
      console.error("[inventory-audit] load failed", error);
      setAuditError("Audit trail could not be loaded.");
    } finally {
      setAuditLoading(false);
    }
  }

  const selectedItemIdList = useMemo(
    () => Array.from(selectedItemIds),
    [selectedItemIds],
  );

  const isRowSelected = useCallback(
    (row: InventoryRow) =>
      allMatchingSelected ||
      getRowSourceIds(row).every((id) => selectedItemIds.has(id)),
    [allMatchingSelected, selectedItemIds],
  );

  const clearSelection = useCallback(() => {
    setSelectedItemIds(new Set());
    setAllMatchingSelected(false);
  }, []);

  const submitBulkDelete = useCallback(
    async (input?: {
      itemIds?: string[];
      entriesCount?: number;
      cardsCount?: number;
      cardName?: string;
    }) => {
      if (!capabilities.canDelete || !onBulkDeleteInventory) {
        setMessage("This inventory is read-only.");
        return;
      }
      const itemIds = input?.itemIds ?? selectedItemIdList;
      const entriesCount = input?.entriesCount ?? selectedEntriesCount;
      const cardsCount = input?.cardsCount ?? selectedCardsCount;
      const selectionMode = input?.itemIds
        ? "selected"
        : allMatchingSelected
          ? "all"
          : "selected";
      if (!entriesCount || (selectionMode === "selected" && !itemIds.length)) {
        setMessage("Choose inventory to delete.");
        return;
      }
      const subject = input?.cardName
        ? `${cardsCount} copies of ${input.cardName}`
        : selectionMode === "all"
          ? `${entriesCount} matching inventory entries containing ${cardsCount} total cards`
          : `${entriesCount} selected inventory entries containing ${cardsCount} total cards`;
      if (entriesCount >= 100 || selectionMode === "all") {
        const typed = window.prompt(
          `Delete ${subject}? This cannot be undone. Type DELETE to confirm.`,
        );
        if (typed !== "DELETE") {
          setMessage(
            "Deletion cancelled. Type DELETE to confirm large deletes.",
          );
          return;
        }
      } else if (!window.confirm(`Delete ${subject}? This cannot be undone.`)) {
        setMessage("Deletion cancelled.");
        return;
      }

      const fd = new FormData();
      fd.set("selectionMode", selectionMode);
      fd.set("itemIds", JSON.stringify(itemIds));
      fd.set("sourceLocationId", currentLocationId || "");
      fd.set(
        "confirmDelete",
        entriesCount >= 100 || selectionMode === "all" ? "DELETE" : "confirmed",
      );
      fd.set(
        "reason",
        input?.cardName
          ? `Deleted ${input.cardName} from inventory.`
          : "Bulk inventory delete",
      );

      setDeletingBulk(true);
      setMessage(`Deleting ${entriesCount} entries (${cardsCount} cards)…`);
      try {
        const result = await onBulkDeleteInventory(fd);
        if (!result.success) {
          setMessage(result.message);
          return;
        }
        setMessage(
          `Deleted ${result.deletedCards} cards across ${result.deletedEntries} inventory entries.`,
        );
        clearSelection();
        if (input?.itemIds) setSelected(null);
        router.refresh();
      } catch (error: any) {
        setMessage(
          error?.message || "Delete failed. No inventory was removed.",
        );
      } finally {
        setDeletingBulk(false);
      }
    },
    [
      allMatchingSelected,
      clearSelection,
      currentLocationId,
      capabilities.canDelete,
      onBulkDeleteInventory,
      router,
      selectedCardsCount,
      selectedEntriesCount,
      selectedItemIdList,
    ],
  );

  function updateSortQuery(nextSorting: SortingState) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const primarySort = nextSorting[0];
    if (primarySort) {
      params.set("sort", primarySort.id);
      params.set("sortDir", primarySort.desc ? "desc" : "asc");
    } else {
      params.delete("sort");
      params.delete("sortDir");
    }
    params.delete("page");
    rememberScrollPosition();
    router.replace(`${window.location.pathname}?${params.toString()}`, {
      scroll: false,
    });
  }

  function updateBrowseQuery(next: {
    pageSize?: number;
    browse?: string;
    displayMode?: "exact" | "grouped";
  }) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next.pageSize) params.set("pageSize", String(next.pageSize));
    if (next.browse) params.set("browse", next.browse);
    if (next.displayMode) params.set("displayMode", next.displayMode);
    params.delete("page");
    rememberScrollPosition();
    router.replace(`${window.location.pathname}?${params.toString()}`, {
      scroll: false,
    });
  }

  useEffect(() => {
    clearSelection();
    setPagination((current) => ({ ...current, pageIndex: 0 }));
    setSorting(
      initialSortField
        ? [{ id: initialSortField, desc: initialSortDirection === "desc" }]
        : [],
    );
    setLoadedRows(rows);
    setInfiniteHasNextPage(hasNextPage);
    setNextInfinitePage(currentPage + 1);
    setLoadMoreError("");
    queryKeyRef.current = queryKey;
  }, [
    rows,
    displayMode,
    pageSize,
    clearSelection,
    currentPage,
    hasNextPage,
    initialSortDirection,
    initialSortField,
    queryKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawScrollY = window.sessionStorage.getItem(
      INVENTORY_SCROLL_STORAGE_KEY,
    );
    if (!rawScrollY) return;
    window.sessionStorage.removeItem(INVENTORY_SCROLL_STORAGE_KEY);
    const scrollY = Number(rawScrollY);
    if (!Number.isFinite(scrollY)) return;
    window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }, [rows, displayMode]);

  const loadMoreRows = useCallback(async () => {
    if (
      browsingMode !== "infinite" ||
      !infiniteApiPath ||
      !infiniteHasNextPage ||
      isLoadingMore
    )
      return;
    const requestQueryKey = queryKeyRef.current;
    const params = new URLSearchParams(pageHrefBase || "");
    params.set("page", String(nextInfinitePage));
    params.set("browse", "infinite");
    setIsLoadingMore(true);
    setLoadMoreError("");
    try {
      const response = await fetch(`${infiniteApiPath}?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const payload: {
        rows: InventoryRow[];
        hasNextPage: boolean;
        nextPage?: number;
        totalMatchingCount?: number;
      } = await response.json();
      if (queryKeyRef.current !== requestQueryKey) return;
      setLoadedRows((current) => {
        const seen = new Set(current.map((row) => row.id));
        const appended = payload.rows.filter((row) => !seen.has(row.id));
        return [...current, ...appended];
      });
      setInfiniteHasNextPage(payload.hasNextPage);
      setNextInfinitePage(payload.nextPage ?? nextInfinitePage + 1);
    } catch (error: any) {
      if (queryKeyRef.current !== requestQueryKey) return;
      setLoadMoreError(error?.message || "Failed to load more results.");
    } finally {
      if (queryKeyRef.current === requestQueryKey) setIsLoadingMore(false);
    }
  }, [
    browsingMode,
    infiniteApiPath,
    infiniteHasNextPage,
    isLoadingMore,
    nextInfinitePage,
    pageHrefBase,
  ]);

  useEffect(() => {
    if (browsingMode !== "infinite" || !infiniteHasNextPage || loadMoreError)
      return;
    const node = infiniteSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRows();
        }
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [browsingMode, infiniteHasNextPage, loadMoreError, loadMoreRows]);

  const cols = useMemo<ColumnDef<InventoryRow>[]>(
    () => [
      ...(selectionAvailable
        ? [
            {
              id: "select",
              header: () => <span className="sr-only">Select</span>,
              cell: ({ row }: any) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.original.cardName}`}
                  checked={isRowSelected(row.original)}
                  onChange={(event) => {
                    const ids = getRowSourceIds(row.original);
                    setAllMatchingSelected(false);
                    setSelectedItemIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked)
                        ids.forEach((id) => next.add(id));
                      else ids.forEach((id) => next.delete(id));
                      return next;
                    });
                  }}
                />
              ),
            } satisfies ColumnDef<InventoryRow>,
          ]
        : []),
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
      ...(capabilities.canViewOwnerAdminFields
        ? [
            {
              accessorKey: "currentOwner",
              header: "Owner",
              cell: ({ row }: any) => (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: getPlayerColor(
                        row.original.currentOwnerColor,
                      ),
                    }}
                  />
                  {row.original.currentOwner}
                </span>
              ),
            } satisfies ColumnDef<InventoryRow>,
          ]
        : []),
      {
        accessorKey: "setCode",
        header: "Set",
        cell: ({ row }) => (
          <SetSymbol
            setCode={row.original.setCode}
            setName={row.original.setName}
            rarity={row.original.rarity}
          />
        ),
      },
      { accessorKey: "rarity", header: "Rarity" },
      {
        accessorKey: "manaCost",
        header: "Mana Cost",
        cell: ({ row }) => <CardManaCost card={row.original} />,
      },
      { accessorKey: "typeLine", header: "Type Line" },
      {
        accessorKey: "colorIdentity",
        header: "Color Identity",
        cell: ({ row }) => (
          <ColorIdentityIcons value={row.original.colorIdentity} />
        ),
      },
      { accessorKey: "preferredPriceLabel", header: "Preferred Price" },
      { accessorKey: "foilStatus", header: "Foil" },
      ...(capabilities.canViewVisibility
        ? [
            {
              accessorKey: "effectiveVisibility",
              header: "Visibility",
              cell: ({ row }: any) =>
                friendlyVisibility(row.original.effectiveVisibility),
            } satisfies ColumnDef<InventoryRow>,
          ]
        : []),
      ...(capabilities.canViewPrivateSourceInfo
        ? [
            {
              accessorKey: "sourceType",
              header: "Source",
              cell: ({ row }: any) => friendlySource(row.original.sourceType),
            } satisfies ColumnDef<InventoryRow>,
          ]
        : []),
      ...(capabilities.canEdit || capabilities.canDelete
        ? [
            {
              id: "actions",
              header: "Actions",
              cell: ({ row }: any) => {
                const exact = row.original.displayMode === "exact";
                const single = (row.original.sourceItemIds?.length ?? 1) === 1;
                return exact ? (
                  <details className="relative">
                    <summary
                      className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-700"
                      aria-label={`Actions for ${row.original.cardName}`}
                    >
                      ...
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 w-48 space-y-1 rounded border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-900"
                        onClick={() => setSelected(row.original)}
                      >
                        View details
                      </button>
                    {capabilities.canEdit && single ? (
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-900"
                        onClick={() => {
                          setEditing(row.original);
                          setConfirmed(null);
                          setResults([]);
                        }}
                      >
                        Edit inventory
                      </button>
                    ) : null}
                    {capabilities.canDelete ? (
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left text-xs text-red-200 hover:bg-red-950/40"
                        disabled={deletingBulk}
                        onClick={() =>
                          submitBulkDelete({
                            itemIds: getRowSourceIds(row.original),
                            entriesCount: getRowSourceIds(row.original).length,
                            cardsCount: row.original.quantity,
                            cardName: row.original.cardName,
                          })
                        }
                      >
                        Delete inventory
                      </button>
                    ) : null}
                    </div>
                  </details>
                ) : (
                  <span className="text-xs text-zinc-500">Grouped</span>
                );
              },
            } satisfies ColumnDef<InventoryRow>,
          ]
        : []),
    ],
    [
      capabilities.canDelete,
      capabilities.canEdit,
      capabilities.canViewOwnerAdminFields,
      capabilities.canViewPrivateSourceInfo,
      capabilities.canViewVisibility,
      displayMode,
      selectionAvailable,
      isRowSelected,
      deletingBulk,
      submitBulkDelete,
    ],
  );

  const effectivePagination =
    browsingMode === "infinite"
      ? { pageIndex: 0, pageSize: Math.max(1, renderedRows.length) }
      : { pageIndex: 0, pageSize: Math.max(1, rows.length) };

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table manages its own stable table instance API.
  const table = useReactTable({
    data: renderedRows,
    columns: cols,
    state: { sorting, columnVisibility, pagination: effectivePagination },
    onSortingChange: (updater) => {
      const nextSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(nextSorting);
      updateSortQuery(nextSorting);
    },
    onPaginationChange: setPagination,
    onColumnVisibilityChange: (v) => {
      const next = typeof v === "function" ? v(columnVisibility) : v;
      setColumnVisibility(next);
      localStorage.setItem("inventoryColumns", JSON.stringify(next));
    },
    getCoreRowModel: getCoreRowModel(),
  });
  const sizeClass = collectionCardGridClass(cardSize);

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
        <span className={filterLabelClass}>View:</span>
        <button
          className={cn(
            filterButtonClass,
            "px-2 py-1",
            viewMode === "table" && "bg-zinc-800",
          )}
          onClick={() => {
            setViewMode("table");
            localStorage.setItem("inventoryViewMode", "table");
          }}
        >
          Table View
        </button>
        <button
          className={cn(
            filterButtonClass,
            "px-2 py-1",
            viewMode === "binder" && "bg-zinc-800",
          )}
          onClick={() => {
            setViewMode("binder");
            localStorage.setItem("inventoryViewMode", "binder");
          }}
        >
          Binder View
        </button>
        <span className={cn(filterLabelClass, "ml-4")}>Display:</span>
        <select
          value={displayMode}
          onChange={(event) => {
            const next = event.target.value as "exact" | "grouped";
            setLoadedRows(rows);
            setPagination((current) => ({ ...current, pageIndex: 0 }));
            updateBrowseQuery({ displayMode: next });
          }}
          className={filterSelectClass}
        >
          <option value="exact">Exact printings</option>
          <option value="grouped">Grouped by card</option>
        </select>
        {viewMode === "binder" ? (
          <>
            <span className={cn(filterLabelClass, "ml-4")}>Card Size:</span>
            <button
              className={cn(
                filterButtonClass,
                "px-2 py-1",
                cardSize === "small" && "bg-zinc-800",
              )}
              onClick={() => {
                setCardSize("small");
                localStorage.setItem("inventoryCardSize", "small");
              }}
            >
              Small
            </button>
            <button
              className={cn(
                filterButtonClass,
                "px-2 py-1",
                cardSize === "medium" && "bg-zinc-800",
              )}
              onClick={() => {
                setCardSize("medium");
                localStorage.setItem("inventoryCardSize", "medium");
              }}
            >
              Medium
            </button>
            <button
              className={cn(
                filterButtonClass,
                "px-2 py-1",
                cardSize === "large" && "bg-zinc-800",
              )}
              onClick={() => {
                setCardSize("large");
                localStorage.setItem("inventoryCardSize", "large");
              }}
            >
              Large
            </button>
          </>
        ) : null}
        <span className={cn(filterLabelClass, "ml-4")}>Page size:</span>
        <select
          value={pageSize}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPageSize(next);
            setPagination({ pageIndex: 0, pageSize: next });
            setLoadedRows(rows);
            updateBrowseQuery({ pageSize: next });
          }}
          className={filterSelectClass}
        >
          {[10, 25, 50, 100, 250].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className={cn(filterLabelClass, "ml-4")}>Browsing mode:</span>
        <select
          value={browsingMode}
          onChange={(event) => {
            const next = event.target.value as "paginated" | "infinite";
            setBrowsingMode(next);
            setLoadedRows(rows);
            setPagination((current) => ({ ...current, pageIndex: 0 }));
            updateBrowseQuery({ browse: next });
          }}
          className={filterSelectClass}
        >
          <option value="paginated">Paginated</option>
          <option value="infinite">Infinite scroll</option>
        </select>
      </div>

      {capabilities.canBulkSelect && !selectionAvailable ? (
        <div className="border border-amber-800 bg-amber-950/40 text-amber-200 p-2 text-sm">
          Bulk editing is available in Exact printings mode. Switch to Exact
          printings to select specific inventory entries.
        </div>
      ) : capabilities.canBulkSelect ? (
        <div className={cn(filterPanelClass, "space-y-3")}>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <button
              type="button"
              className={cn(filterButtonClass, "px-2 py-1")}
              onClick={() => {
                setAllMatchingSelected(false);
                setSelectedItemIds((current) => {
                  const next = new Set(current);
                  table
                    .getRowModel()
                    .rows.flatMap((row) => getRowSourceIds(row.original))
                    .forEach((id) => next.add(id));
                  return next;
                });
              }}
            >
              {browsingMode === "infinite" ? "Select loaded" : "Select visible"}
            </button>
            <button
              type="button"
              className={cn(filterButtonClass, "px-2 py-1")}
              onClick={() => {
                setSelectedItemIds(new Set());
                setAllMatchingSelected(true);
              }}
            >
              Select all matching filters
            </button>
            <button
              type="button"
              className={cn(filterButtonClass, "px-2 py-1")}
              onClick={clearSelection}
            >
              Clear selection
            </button>
            <span className="text-zinc-300">
              {allMatchingSelected
                ? `All ${totalMatchingCount} matching inventory entries are selected.`
                : `${selectedEntriesCount} selected`}
            </span>
          </div>
          {selectedEntriesCount > 0 && capabilities.canBulkMove ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const fd = new FormData(form);
                fd.set("destinationLocationId", bulkDestinationLocationId);
                fd.set(
                  "clientDestinationLocationId",
                  bulkDestinationLocationId,
                );
                if (!bulkDestinationLocationId) {
                  setMessage(
                    "Choose a destination location before moving cards.",
                  );
                  return;
                }
                setMovingBulk(true);
                setMessage(
                  `Moving ${selectedEntriesCount} entries (${selectedCardsCount} cards)…`,
                );
                try {
                  if (!onBulkMoveLocation) {
                    setMessage("This inventory is read-only.");
                    return;
                  }
                  const result = await onBulkMoveLocation(fd);
                  if (!result.success) {
                    setMessage(result.message);
                    return;
                  }
                  setMessage(
                    `Moved ${result.movedCards} cards across ${result.movedEntries} entries to ${result.destinationLocationName}.`,
                  );
                  clearSelection();
                  setBulkDestinationLocationId("");
                  router.refresh();
                } catch (error: any) {
                  setMessage(error?.message || "Bulk move failed.");
                } finally {
                  setMovingBulk(false);
                }
              }}
              className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto] items-end"
            >
              <input
                type="hidden"
                name="selectionMode"
                value={allMatchingSelected ? "all" : "selected"}
              />
              <input
                type="hidden"
                name="itemIds"
                value={JSON.stringify(selectedItemIdList)}
              />
              <input
                type="hidden"
                name="sourceLocationId"
                value={currentLocationId || ""}
              />
              <label className={filterLabelClass}>
                Move to location
                <select
                  name="destinationLocationId"
                  required
                  value={bulkDestinationLocationId}
                  onChange={(event) =>
                    setBulkDestinationLocationId(event.target.value)
                  }
                  disabled={movingBulk}
                  className={cn(filterSelectClass, "w-full")}
                >
                  <option value="">Choose destination</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={filterLabelClass}>
                Preview
                <div className="min-h-10 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-zinc-300">
                  {selectedEntriesCount} entries · {selectedCardsCount} cards
                  {currentLocationId ? " · current location filter only" : ""}
                </div>
              </label>
              <label className={filterLabelClass}>
                Reason
                <input
                  name="reason"
                  className={cn(filterInputClass, "w-full")}
                  defaultValue="Bulk location move"
                />
              </label>
              <button
                type="submit"
                className={filterPrimaryButtonClass}
                disabled={movingBulk || !bulkDestinationLocationId}
                aria-disabled={movingBulk || !bulkDestinationLocationId}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {movingBulk ? <LoadingSpinner /> : null}
                  {movingBulk
                    ? `Moving ${selectedEntriesCount} entries…`
                    : "Move selected"}
                </span>
              </button>
            </form>
          ) : null}
          {selectedEntriesCount > 0 && capabilities.canBulkDelete ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3 text-sm">
              <span className="text-red-200">
                Delete scope:{" "}
                {allMatchingSelected ? "all matching filters" : "selected rows"}{" "}
                · {selectedEntriesCount} entries · {selectedCardsCount} cards
              </span>
              <button
                type="button"
                className={filterDangerButtonClass}
                disabled={deletingBulk}
                onClick={() => submitBulkDelete()}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {deletingBulk ? <LoadingSpinner /> : null}
                  {deletingBulk
                    ? `Deleting ${selectedEntriesCount} entries…`
                    : allMatchingSelected
                      ? "Delete all matching"
                      : "Delete selected"}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {viewMode === "table" ? (
        <>
          <details>
            <summary
              className={cn(
                filterButtonClass,
                "inline-flex cursor-pointer list-none px-2 py-1",
              )}
            >
              Columns
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {table.getAllLeafColumns().map((c) => (
                <label key={c.id} className={filterLabelClass}>
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
                        className="p-2 text-left align-middle border-b border-zinc-800 cursor-pointer"
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
                      <td key={c.id} className="p-2 align-middle">
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
              <div key={row.id} className="relative">
                {selectionAvailable ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.cardName}`}
                    className="absolute left-2 top-2 z-10 h-5 w-5"
                    checked={isRowSelected(row)}
                    onChange={(event) => {
                      const ids = getRowSourceIds(row);
                      setAllMatchingSelected(false);
                      setSelectedItemIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked)
                          ids.forEach((id) => next.add(id));
                        else ids.forEach((id) => next.delete(id));
                        return next;
                      });
                    }}
                  />
                ) : null}
                <button
                  onClick={() => setSelected(row)}
                  className="w-full text-left border rounded p-2 bg-zinc-900 hover:bg-zinc-800"
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
                        loading="lazy"
                        decoding="async"
                        width={265}
                        height={370}
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
                  {row.manaCost ||
                  row.manaFaces?.length ||
                  row.colorIdentity ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      {row.manaCost || row.manaFaces?.length ? (
                        <CardManaCost card={row} />
                      ) : null}
                      {!row.manaCost &&
                      !row.manaFaces?.length &&
                      row.colorIdentity ? (
                        <ColorIdentityIcons value={row.colorIdentity} />
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-xs text-zinc-400 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      {row.displayMode === "grouped" ? (
                        `${row.printingCount} printings`
                      ) : (
                        <>
                          <SetSymbol
                            setCode={row.setCode}
                            setName={row.setName}
                            rarity={row.rarity}
                          />
                          <span>· {row.rarity}</span>
                        </>
                      )}
                    </span>
                    {capabilities.canViewOwnerAdminFields ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: ownerColor }}
                        />
                        {row.currentOwner}
                      </span>
                    ) : null}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {browsingMode === "paginated" ? (
        <div className="flex gap-2 items-center">
          <button
            onClick={() => pageHref && router.push(pageHref(currentPage - 1))}
            disabled={!hasPreviousPage}
            className={cn(filterButtonClass, "px-2 py-1")}
          >
            Previous page
          </button>
          <span>
            {totalMatchingCount} matching cards · Page {currentPage} of{" "}
            {totalPages || 1}
          </span>
          <button
            onClick={() => pageHref && router.push(pageHref(currentPage + 1))}
            disabled={!hasNextPage}
            className={cn(filterButtonClass, "px-2 py-1")}
          >
            Next page
          </button>
        </div>
      ) : (
        <div
          ref={infiniteSentinelRef}
          className="py-3 text-center text-sm text-zinc-400"
        >
          {loadMoreError ? (
            <span className="inline-flex items-center gap-2 text-red-300">
              Failed to load more results: {loadMoreError}
              <button
                type="button"
                className={cn(filterButtonClass, "px-2 py-1")}
                onClick={() => {
                  setLoadMoreError("");
                  void loadMoreRows();
                }}
              >
                Retry
              </button>
            </span>
          ) : isLoadingMore ? (
            "Loading more…"
          ) : infiniteHasNextPage ? (
            `Loaded ${loadedRows.length} of ${totalMatchingCount}. Loading more as you scroll…`
          ) : (
            `End of results · ${loadedRows.length} loaded of ${totalMatchingCount}`
          )}
        </div>
      )}

      {selected ? (
        <CardDetail
          row={selected}
          onClose={() => setSelected(null)}
          capabilities={capabilities}
          onEdit={
            capabilities.canEdit
              ? () => {
                  setEditing(selected);
                  setSelected(null);
                }
              : undefined
          }
          onAudit={
            capabilities.canViewAuditTrail
              ? () => void openAuditTrail(selected)
              : undefined
          }
          onDelete={
            capabilities.canDelete && selected.displayMode === "exact"
              ? () =>
                  submitBulkDelete({
                    itemIds: getRowSourceIds(selected),
                    entriesCount: getRowSourceIds(selected).length,
                    cardsCount: selected.quantity,
                    cardName: selected.cardName,
                  })
              : undefined
          }
        />
      ) : null}

      {auditRow && capabilities.canViewAuditTrail ? (
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
              <button
                onClick={() => setAuditRow(null)}
                className={cn(filterButtonClass, "px-2 py-1")}
              >
                Close
              </button>
            </div>
            {auditLoading ? (
              <div className="rounded border border-zinc-800 p-4 text-sm text-zinc-400">
                Loading audit trail…
              </div>
            ) : auditError ? (
              <div className="rounded border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">
                {auditError}
              </div>
            ) : null}
            <InventoryAuditTrail
              entries={auditRow.auditHistory}
              playerLabels={Object.fromEntries(
                players.map((p) => [p.id, p.name]),
              )}
              cardLabels={cardLabels}
            />
          </div>
        </div>
      ) : null}

      {editing && capabilities.canEdit ? (
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
                  if (!onSaveEdit)
                    throw new Error(
                      "Editing is unavailable in read-only mode.",
                    );
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
              {!capabilities.canViewOwnerAdminFields ? (
                <input
                  type="hidden"
                  name="currentOwnerId"
                  value={editing.currentOwnerId}
                />
              ) : null}
              <div className="grid md:grid-cols-2 gap-2">
                {capabilities.canViewOwnerAdminFields ? (
                  <label className={filterLabelClass}>
                    Current owner
                    <select
                      name="currentOwnerId"
                      defaultValue={editing.currentOwnerId}
                      className={cn(filterSelectClass, "w-full")}
                    >
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={filterLabelClass}>
                  Location
                  <select
                    name="locationId"
                    defaultValue={editing.locationId || ""}
                    className={cn(filterSelectClass, "w-full")}
                  >
                    <option value="">Unassigned</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={filterLabelClass}>
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    defaultValue={editing.quantity}
                    className={cn(filterInputClass, "w-full")}
                  />
                </label>
                <label className={filterLabelClass}>
                  Foil status
                  <select
                    name="foilStatus"
                    defaultValue={editing.foilStatus || "NONFOIL"}
                    className={cn(filterSelectClass, "w-full")}
                  >
                    <option value="NONFOIL">nonfoil</option>
                    <option value="FOIL">foil</option>
                    <option value="ETCHED">etched</option>
                  </select>
                </label>
                <label className={filterLabelClass}>
                  Condition
                  <select
                    name="condition"
                    defaultValue={editing.condition || "NM"}
                    className={cn(filterSelectClass, "w-full")}
                  >
                    <option>NM</option>
                    <option>LP</option>
                    <option>MP</option>
                    <option>HP</option>
                    <option>DMG</option>
                  </select>
                </label>
                <label className={filterLabelClass}>
                  Language
                  <input
                    name="language"
                    defaultValue={editing.language || "EN"}
                    className={cn(filterInputClass, "w-full")}
                    maxLength={8}
                  />
                </label>
                {capabilities.canViewOwnerAdminFields ? (
                  <>
                    <label className={filterLabelClass}>
                      Source type
                      <select
                        name="sourceType"
                        defaultValue={editing.sourceType || "CORRECTION"}
                        className={cn(filterSelectClass, "w-full")}
                      >
                        <option value="PULL">legacy</option>
                        <option value="CSV_PULL_IMPORT">import</option>
                        <option value="TRADE">trade</option>
                        <option value="MANUAL">manual</option>
                        <option value="CORRECTION">correction</option>
                        <option value="PRIZE">prize</option>
                        <option value="OTHER">other</option>
                      </select>
                    </label>
                    <label className={filterLabelClass}>
                      Admin correction reason
                      <input
                        name="reason"
                        required
                        className={cn(filterInputClass, "w-full")}
                        placeholder="Reason for change"
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <label className={cn(filterLabelClass, "block")}>
                Notes
                <textarea
                  name="notes"
                  defaultValue={editing.notes || ""}
                  className={cn(filterTextareaClass, "w-full")}
                />
              </label>
              {capabilities.canViewOwnerAdminFields ? (
                <>
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
                        className={cn(filterInputClass, "flex-1")}
                        placeholder="Search Scryfall"
                      />
                      <button
                        type="button"
                        className={filterButtonClass}
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
                            if (!onSearchPrintings) {
                              setMessage(
                                "Printing search is unavailable in read-only mode.",
                              );
                              return;
                            }
                            const r = await onSearchPrintings(f);
                            setResults(r || []);
                            setMessage(
                              `${r?.length || 0} Scryfall printings found.`,
                            );
                          } catch (e: any) {
                            setMessage(
                              e?.message || "Failed to search printings.",
                            );
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
                          {r.name} ({r.set.toUpperCase()}) #{r.collector_number}{" "}
                          • {r.rarity}
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
                </>
              ) : null}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className={filterButtonClass}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Saving…"
                  className={filterButtonClass}
                >
                  Save Changes
                </SubmitButton>
              </div>
            </form>
            {capabilities.canDelete && onDeleteInventoryItem ? (
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
                        className={cn(filterInputClass, "mt-1 w-full")}
                        placeholder="Reason for deleting this inventory item"
                      />
                    </label>
                    <SubmitButton
                      pendingLabel="Deleting…"
                      className={filterDangerButtonClass}
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
