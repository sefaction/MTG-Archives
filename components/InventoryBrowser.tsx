"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DeckSection } from "@prisma/client";
import { deckFormatLabel, deckSectionLabel } from "@/lib/decks";
import {
  getInventoryCardImagePair,
  type InventoryCardImageFace,
} from "@/lib/inventory-card-images";
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
  ManaCost,
  ManaSymbol,
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

type PickRef = {
  id: string;
  name: string;
  color?: string;
  ownerPlayerId?: string;
  active?: boolean;
  kind?: "NORMAL" | "DECK";
};

export type InventoryDeckTarget = {
  id: string;
  name: string;
  format: string;
  ownerName?: string;
};

type InventoryLocationStack = {
  inventoryItemId?: string;
  locationId: string | null;
  name: string;
  quantity: number;
  foilStatus?: string | null;
  condition?: string | null;
  language?: string | null;
  sourceType?: string | null;
  locationKind?: "NORMAL" | "DECK" | null;
  locationActive?: boolean | null;
  locationSystemManaged?: boolean | null;
};

type InventoryCardFace = InventoryCardImageFace & {
  name?: string | null;
  manaCost?: string | null;
  mana_cost?: string | null;
  typeLine?: string | null;
  type_line?: string | null;
  oracleText?: string | null;
  oracle_text?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
};

type InventoryRelatedPart = {
  id?: string | null;
  component?: string | null;
  name?: string | null;
  typeLine?: string | null;
  type_line?: string | null;
  uri?: string | null;
  scryfallUri?: string | null;
  scryfall_uri?: string | null;
  imageUri?: string | null;
  image_uri?: string | null;
  imageUris?: InventoryCardFace["imageUris"];
  image_uris?: InventoryCardFace["image_uris"];
  setCode?: string | null;
  collectorNumber?: string | null;
};

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
  cardFaces?: InventoryCardFace[];
  allParts?: InventoryRelatedPart[];
  layout?: string;
  manaValue?: number;
  typeLine: string;
  colorIdentity: string;
  priceUsd?: string;
  priceUsdFoil?: string;
  preferredPriceLabel?: string;
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
  releasedAt?: string;
  keywords?: string;
  notes?: string;
  language?: string;
  imageUri?: string;
  imageSmall?: string;
  scryfallUri?: string;
  condition?: string;
  displayMode?: "exact" | "grouped";
  sourceItemIds?: string[];
  tradeWishlistTargets?: Array<{
    inventoryItemId: string;
    ownerName: string;
    ownerColor?: string;
    setCode: string;
    collectorNumber: string;
    foilStatus?: string;
    condition?: string;
    language?: string;
    availableQuantity: number;
  }>;
  printingCount?: number;
  locationCount?: number;
  locationId?: string;
  locationName?: string;
  locationSummary?: string;
  locationBreakdown?: InventoryLocationStack[];
  printings?: Array<{
    id: string;
    cardId: string;
    cardName: string;
    setCode: string;
    collectorNumber: string;
    rarity?: string;
    foilStatus?: string;
    condition?: string;
    language?: string;
    quantity: number;
    locationBreakdown: InventoryLocationStack[];
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
  "owner-editable" | "admin-editable" | "public-readonly";

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
  effectiveVisibility: false,
  sourceType: false,
  releasedAt: false,
  locationSummary: true,
};

const INVENTORY_SCROLL_STORAGE_KEY = "mtg-inventory-scroll-y";
const detailBlockClass = "rounded border border-zinc-800 bg-zinc-950/70";
const detailHeaderClass =
  "border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-200";
const detailBodyClass = "space-y-3 p-3";

type CardPriceHistoryResponse = {
  available: boolean;
  card: { id: string; name: string; mtgjsonUuid: string | null } | null;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  range: "7" | "30" | "90" | "all";
  points: Array<{ observedDate: string; price: number }>;
  change: {
    start: number | null;
    current: number | null;
    absolute: number | null;
    percent: number | null;
  };
  error?: string;
};

function isHexColor(value?: string) {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}
function getPlayerColor(color?: string) {
  return isHexColor(color) ? color! : "#64748b";
}

function formatReleaseDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
function withOpacity(hexColor: string, opacity: number) {
  const c = getPlayerColor(hexColor).replace("#", "");
  return `rgba(${parseInt(c.slice(0, 2), 16)}, ${parseInt(c.slice(2, 4), 16)}, ${parseInt(c.slice(4, 6), 16)}, ${opacity})`;
}

function ownerColorStyles(hexColor?: string) {
  const color = getPlayerColor(hexColor);
  return {
    color,
    subtle: withOpacity(color, 0.12),
    fill: withOpacity(color, 0.22),
    strong: withOpacity(color, 0.42),
  };
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

function normalizeCardFaces(row: InventoryRow) {
  return (row.cardFaces ?? [])
    .map((face) => ({
      name: face.name?.trim() ?? "",
      manaCost: (face.manaCost ?? face.mana_cost ?? "").trim(),
      typeLine: (face.typeLine ?? face.type_line ?? "").trim(),
      oracleText: (face.oracleText ?? face.oracle_text ?? "").trim(),
      power: face.power?.trim() ?? "",
      toughness: face.toughness?.trim() ?? "",
      loyalty: face.loyalty?.trim() ?? "",
      defense: face.defense?.trim() ?? "",
    }))
    .filter(
      (face) =>
        face.name ||
        face.manaCost ||
        face.typeLine ||
        face.oracleText ||
        face.power ||
        face.toughness ||
        face.loyalty ||
        face.defense,
    );
}

function oracleParagraphs(text?: string | null) {
  return (text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function OracleText({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}]+\})/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        const symbol = part.match(/^\{([^{}]+)\}$/)?.[1];
        if (!symbol) return <span key={`${index}-${part}`}>{part}</span>;
        return (
          <ManaSymbol
            key={`${index}-${part}`}
            token={symbol}
            className="mx-0.5 text-[1.05em]"
          />
        );
      })}
    </>
  );
}

function FaceStats({
  powerToughness,
  power,
  toughness,
  loyalty,
  defense,
}: {
  powerToughness?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
}) {
  const displayPowerToughness =
    powerToughness || [power, toughness].filter(Boolean).join("/");
  if (!displayPowerToughness && !loyalty && !defense) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-2">
      {displayPowerToughness ? (
        <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-semibold">
          {displayPowerToughness}
        </span>
      ) : null}
      {loyalty ? (
        <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Loyalty {loyalty}
        </span>
      ) : null}
      {defense ? (
        <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Defense {defense}
        </span>
      ) : null}
    </div>
  );
}

function CardFaceMechanics({
  face,
  index,
}: {
  face: ReturnType<typeof normalizeCardFaces>[number];
  index: number;
}) {
  const paragraphs = oracleParagraphs(face.oracleText);
  return (
    <div className={cn(index > 0 && "border-t border-zinc-800 pt-3")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {face.name ? <div className="font-semibold">{face.name}</div> : null}
          <div className="mt-1 font-medium text-zinc-200">
            {face.typeLine || "-"}
          </div>
        </div>
        {face.manaCost ? (
          <div className="shrink-0">
            <ManaCost value={face.manaCost} />
          </div>
        ) : null}
      </div>
      {paragraphs.length ? (
        <div className="mt-3 space-y-2 leading-relaxed text-zinc-100">
          {paragraphs.map((paragraph, paragraphIndex) => (
            <p key={`${paragraphIndex}-${paragraph.slice(0, 16)}`}>
              <OracleText text={paragraph} />
            </p>
          ))}
        </div>
      ) : null}
      <FaceStats
        power={face.power}
        toughness={face.toughness}
        loyalty={face.loyalty}
        defense={face.defense}
      />
    </div>
  );
}

function CardImageFlipper({ row }: { row: InventoryRow }) {
  const [showBack, setShowBack] = useState(false);
  const { front, back } = getInventoryCardImagePair(row);
  const canFlip = Boolean(front && back);
  const currentLabel = showBack ? "Show front face" : "Show back face";

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
      {front ? (
        <>
          <div className="[perspective:1000px]">
            <div
              className={cn(
                "relative aspect-[63/88] w-full transition-transform duration-500 motion-reduce:transition-none",
                "[transform-style:preserve-3d]",
              )}
              style={{
                transform: showBack ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              <img
                src={front}
                alt={row.cardName}
                loading="lazy"
                decoding="async"
                width={240}
                height={336}
                className="absolute inset-0 h-full w-full rounded object-cover [backface-visibility:hidden]"
              />
              {back ? (
                <img
                  src={back}
                  alt={`${row.cardName} back face`}
                  loading="lazy"
                  decoding="async"
                  width={240}
                  height={336}
                  className="absolute inset-0 h-full w-full rounded object-cover [backface-visibility:hidden] [transform:rotateY(180deg)]"
                />
              ) : null}
            </div>
          </div>
          {canFlip ? (
            <button
              type="button"
              aria-label={currentLabel}
              className={cn(
                filterButtonClass,
                "mt-2 inline-flex w-full justify-center px-2 py-1 text-xs",
              )}
              onClick={() => setShowBack((value) => !value)}
            >
              {currentLabel}
            </button>
          ) : null}
        </>
      ) : (
        <div className="aspect-[63/88] flex items-center justify-center text-sm text-zinc-400">
          No image
        </div>
      )}
    </div>
  );
}

function getMeldPartner(row: InventoryRow) {
  const allParts = row.allParts ?? [];
  if (!allParts.length) return null;

  const hasMeldParts =
    row.layout === "meld" ||
    allParts.some((part) =>
      ["meld_part", "meld_result"].includes(part.component ?? ""),
    );
  if (!hasMeldParts) return null;

  const currentName = row.cardName.toLowerCase();
  const isDifferentCard = (part: InventoryRelatedPart) =>
    part.name && part.name.toLowerCase() !== currentName;
  const partner = allParts.find(
    (part) => part.component === "meld_part" && isDifferentCard(part),
  );

  if (!partner?.name) return null;
  return {
    name: partner.name,
    typeLine: partner.typeLine ?? partner.type_line ?? "",
    scryfallUri: partner.scryfallUri ?? partner.scryfall_uri ?? "",
  };
}

function MeldPartnerLink({ row }: { row: InventoryRow }) {
  const partner = getMeldPartner(row);
  if (!partner) return null;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-300">
      <div className="font-semibold text-zinc-100">Meld partner</div>
      <div className="mt-1">{partner.name}</div>
      {partner.typeLine ? (
        <div className="mt-1 text-zinc-500">{partner.typeLine}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          className="underline"
          href={`/inventory?cardName=${encodeURIComponent(partner.name)}`}
        >
          Find in inventory
        </a>
        {partner.scryfallUri ? (
          <a
            className="underline"
            href={partner.scryfallUri}
            target="_blank"
            rel="noreferrer"
          >
            View on Scryfall
          </a>
        ) : null}
      </div>
    </div>
  );
}

function InventoryDetailPanel({
  row,
  capabilities,
  visibleLocationBreakdown,
  priceLabel,
}: {
  row: InventoryRow;
  capabilities: InventoryCapabilities;
  visibleLocationBreakdown: InventoryLocationStack[];
  priceLabel: string;
}) {
  return (
    <section className={detailBlockClass}>
      <div className={detailHeaderClass}>Inventory</div>
      <div className={detailBodyClass}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase text-zinc-500">Quantity</div>
            {row.quantity}
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-500">Price</div>
            {priceLabel}
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-500">Condition</div>
            {row.condition || "-"}
          </div>
          {capabilities.canViewVisibility ? (
            <div>
              <div className="text-xs uppercase text-zinc-500">Visibility</div>
              {friendlyVisibility(row.effectiveVisibility)}
            </div>
          ) : null}
          {capabilities.canViewOwnerAdminFields ? (
            <div>
              <div className="text-xs uppercase text-zinc-500">Owner</div>
              {row.currentOwner}
            </div>
          ) : null}
          {capabilities.canViewPrivateSourceInfo ? (
            <div>
              <div className="text-xs uppercase text-zinc-500">Source</div>
              {friendlySource(row.sourceType)}
            </div>
          ) : null}
        </div>
        {visibleLocationBreakdown.length ? (
          <div className="border-t border-zinc-800 pt-3">
            <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">
              Copies by location
            </div>
            <div className="space-y-1">
              {visibleLocationBreakdown.map((location, index) => (
                <div
                  key={`${location.locationId ?? location.name}-${index}`}
                  className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1"
                >
                  <span>{location.name}</span>
                  <span className="font-semibold">{location.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {capabilities.canViewPrivateSourceInfo && row.notes ? (
          <div className="border-t border-zinc-800 pt-3">
            <div className="text-xs uppercase text-zinc-500">Notes</div>
            <div>{row.notes}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function priceHistoryFinish(row: InventoryRow) {
  if (row.foilStatus === "FOIL") return "foil";
  if (row.foilStatus === "ETCHED") return "etched";
  return "normal";
}

function formatHistoryMoney(
  value: number | null | undefined,
  currency = "USD",
) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "-";
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${value.toFixed(2)}`;
}

function formatHistoryChange(
  change: CardPriceHistoryResponse["change"],
  currency: string,
) {
  if (change.absolute === null) return "-";
  const sign = change.absolute > 0 ? "+" : "";
  const percent =
    change.percent === null ? "" : ` (${sign}${change.percent.toFixed(1)}%)`;
  return `${sign}${formatHistoryMoney(change.absolute, currency)}${percent}`;
}

function CardPriceHistoryPanel({ row }: { row: InventoryRow }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CardPriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const finish = priceHistoryFinish(row);

  useEffect(() => {
    if (!open || history) return;
    let cancelled = false;
    async function loadHistory() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          cardId: row.cardId,
          finish,
          provider: "tcgplayer",
          priceType: "retail",
          currency: "USD",
          range: "90",
        });
        const response = await fetch(`/api/pricing/card-history?${params}`);
        const data = (await response.json()) as CardPriceHistoryResponse & {
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error || "Unable to load price history.");
          setHistory(null);
          return;
        }
        setHistory(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load price history.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [finish, history, open, row.cardId]);

  const points = history?.points ?? [];
  const latestPoints = points.slice(-6).reverse();
  return (
    <section className={detailBlockClass}>
      <button
        type="button"
        className={cn(
          detailHeaderClass,
          "flex w-full items-center justify-between text-left",
        )}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>Price history</span>
        <span className="text-zinc-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className={detailBodyClass}>
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400">
              <LoadingSpinner className="h-3 w-3" />
              Loading price history...
            </div>
          ) : error ? (
            <p className="text-red-200">{error}</p>
          ) : history && !history.available ? (
            <p className="text-zinc-400">
              Pricing history is unavailable right now.
            </p>
          ) : history && !history.card?.mtgjsonUuid ? (
            <p className="text-zinc-400">
              This printing has not been mapped to MTGJSON yet.
            </p>
          ) : history && !points.length ? (
            <p className="text-zinc-400">
              No 90-day TCGplayer history has been imported for this printing.
            </p>
          ) : history ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                  <div className="text-xs uppercase text-zinc-500">Current</div>
                  <div className="font-semibold">
                    {formatHistoryMoney(
                      history.change.current,
                      history.currency,
                    )}
                  </div>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                  <div className="text-xs uppercase text-zinc-500">Start</div>
                  <div className="font-semibold">
                    {formatHistoryMoney(history.change.start, history.currency)}
                  </div>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                  <div className="text-xs uppercase text-zinc-500">Change</div>
                  <div className="font-semibold">
                    {formatHistoryChange(history.change, history.currency)}
                  </div>
                </div>
              </div>
              <div className="overflow-hidden rounded border border-zinc-800">
                {latestPoints.map((point) => (
                  <div
                    key={point.observedDate}
                    className="flex justify-between border-t border-zinc-800 px-2 py-1 first:border-t-0"
                  >
                    <span className="text-zinc-400">{point.observedDate}</span>
                    <span className="font-medium">
                      {formatHistoryMoney(point.price, history.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const inventoryDeckSections = [
  DeckSection.MAINBOARD,
  DeckSection.COMMANDER,
  DeckSection.SIDEBOARD,
  DeckSection.MAYBEBOARD,
];

function inventoryDeckPrintingOptions(row: InventoryRow) {
  const options = new Map<string, string>();
  if (row.displayMode === "grouped") {
    for (const printing of row.printings ?? []) {
      if (!printing.cardId || options.has(printing.cardId)) continue;
      options.set(
        printing.cardId,
        `${printing.setCode.toUpperCase()} #${printing.collectorNumber}`,
      );
    }
  }
  if (!options.size && row.cardId) {
    options.set(
      row.cardId,
      `${row.setCode.toUpperCase()} #${row.collectorNumber || "?"}`,
    );
  }
  return Array.from(options, ([cardId, label]) => ({ cardId, label }));
}

function InventoryAddToDeckControl({
  row,
  deckTargets,
  onAddToDeck,
}: {
  row: InventoryRow;
  deckTargets: InventoryDeckTarget[];
  onAddToDeck: (formData: FormData) => Promise<void>;
}) {
  const printingOptions = inventoryDeckPrintingOptions(row);
  if (!deckTargets.length || !printingOptions.length) return null;

  return (
    <details className="relative w-full sm:w-80">
      <summary
        className={cn(
          filterPrimaryButtonClass,
          "cursor-pointer list-none px-2 py-1 text-center",
        )}
      >
        Add to deck
      </summary>
      <form
        action={onAddToDeck}
        className="mt-2 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl"
      >
        <p className="text-xs text-zinc-400">
          Adds this printing to the deck list. Inventory stays where it is.
        </p>
        <label className={filterLabelClass}>
          Deck
          <select
            name="deckId"
            className={cn(filterSelectClass, "mt-1 w-full")}
            required
          >
            {deckTargets.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.ownerName ? `${deck.ownerName} — ` : ""}
                {deck.name} ({deckFormatLabel(deck.format)})
              </option>
            ))}
          </select>
        </label>
        {printingOptions.length === 1 ? (
          <input
            type="hidden"
            name="cardId"
            value={printingOptions[0].cardId}
          />
        ) : (
          <label className={filterLabelClass}>
            Printing
            <select
              name="cardId"
              className={cn(filterSelectClass, "mt-1 w-full")}
              required
            >
              {printingOptions.map((printing) => (
                <option key={printing.cardId} value={printing.cardId}>
                  {printing.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
          <label className={filterLabelClass}>
            Section
            <select
              name="section"
              defaultValue={DeckSection.MAINBOARD}
              className={cn(filterSelectClass, "mt-1 w-full")}
            >
              {inventoryDeckSections.map((section) => (
                <option key={section} value={section}>
                  {deckSectionLabel(section)}
                </option>
              ))}
            </select>
          </label>
          <label className={filterLabelClass}>
            Qty
            <input
              type="number"
              name="quantity"
              min={1}
              max={999}
              defaultValue={1}
              className={cn(filterInputClass, "mt-1 w-full")}
            />
          </label>
        </div>
        <SubmitButton
          pendingLabel="Adding..."
          className={cn(filterPrimaryButtonClass, "w-full")}
        >
          Add to deck list
        </SubmitButton>
      </form>
    </details>
  );
}

function CardDetail({
  row,
  onClose,
  capabilities,
  deleting = false,
  onAddTradeWishlist,
  deckTargets,
  onAddToDeck,
  onEdit,
  onAudit,
  onDelete,
}: {
  row: InventoryRow;
  onClose: () => void;
  capabilities: InventoryCapabilities;
  deleting?: boolean;
  onAddTradeWishlist?: (formData: FormData) => Promise<void>;
  deckTargets: InventoryDeckTarget[];
  onAddToDeck?: (formData: FormData) => Promise<void>;
  onEdit?: () => void;
  onAudit?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const legalities = row.legalities || {};
  const cardFaces = normalizeCardFaces(row);
  const topLevelOracleParagraphs = oracleParagraphs(row.oracleText);
  const hasPowerToughness = Boolean(
    row.powerToughness || row.power || row.toughness,
  );
  const hasLoyalty = Boolean(row.loyalty);
  const hasDefense = Boolean(row.defense);
  const treatment = row.foilStatus || (row.foil ? "FOIL" : "NONFOIL");
  const priceLabel =
    row.preferredPriceLabel ||
    row.priceUsd ||
    row.priceUsdFoil ||
    row.priceUsdEtched ||
    "-";
  const legalityFormats = [
    ["Standard", legalities.standard],
    ["Pioneer", legalities.pioneer],
    ["Modern", legalities.modern],
    ["Legacy", legalities.legacy],
    ["Vintage", legalities.vintage],
    ["Commander", legalities.commander],
    ["Pauper", legalities.pauper],
    ["Brawl", legalities.brawl],
    ["Historic", legalities.historic],
    ["Alchemy", legalities.alchemy],
    ["Penny", legalities.penny],
    ["Oathbreaker", legalities.oathbreaker],
  ].filter(([, value]) => value);
  const visibleLocationBreakdown = row.locationBreakdown ?? [];
  const tradeWishlistTargets = row.tradeWishlistTargets ?? [];
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-zinc-950 border-l border-zinc-800 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold">{row.cardName}</h2>
          <div className="flex flex-wrap justify-end gap-2">
            {onAddToDeck && deckTargets.length ? (
              <InventoryAddToDeckControl
                row={row}
                deckTargets={deckTargets}
                onAddToDeck={onAddToDeck}
              />
            ) : null}
            {onAddTradeWishlist && tradeWishlistTargets.length === 1 ? (
              <form action={onAddTradeWishlist}>
                <input
                  type="hidden"
                  name="inventoryItemId"
                  value={tradeWishlistTargets[0].inventoryItemId}
                />
                <input type="hidden" name="quantity" value="1" />
                <SubmitButton
                  pendingLabel="Adding..."
                  className={cn(filterPrimaryButtonClass, "px-2 py-1")}
                >
                  Wishlist from {tradeWishlistTargets[0].ownerName}
                </SubmitButton>
              </form>
            ) : null}
            {onAddTradeWishlist && tradeWishlistTargets.length > 1 ? (
              <details className="w-72">
                <summary
                  className={cn(
                    filterPrimaryButtonClass,
                    "cursor-pointer list-none px-2 py-1 text-center",
                  )}
                >
                  Choose trade target
                </summary>
                <div className="mt-2 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                  <p className="px-1 text-xs text-zinc-400">
                    Choose an owner and exact printing.
                  </p>
                  {tradeWishlistTargets.map((target) => (
                    <form
                      key={`${target.inventoryItemId}-${target.ownerName}`}
                      action={onAddTradeWishlist}
                      className="flex items-center justify-between gap-3 rounded border border-zinc-700 bg-zinc-950/70 p-2"
                    >
                      <input
                        type="hidden"
                        name="inventoryItemId"
                        value={target.inventoryItemId}
                      />
                      <input type="hidden" name="quantity" value="1" />
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-2 font-medium">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: target.ownerColor || "#64748b",
                            }}
                          />
                          <span className="truncate">{target.ownerName}</span>
                          <span className="text-xs text-zinc-500">
                            ×{target.availableQuantity}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400">
                          {[
                            `${target.setCode.toUpperCase()} #${target.collectorNumber}`,
                            target.foilStatus,
                            target.condition,
                            target.language,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <SubmitButton
                        pendingLabel="Adding..."
                        className={cn(
                          filterButtonClass,
                          "shrink-0 px-2 py-1 text-xs",
                        )}
                      >
                        Select
                      </SubmitButton>
                    </form>
                  ))}
                </div>
              </details>
            ) : null}
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
                type="button"
                disabled={deleting}
                aria-disabled={deleting}
                onClick={() => void onDelete()}
                className={cn(filterDangerButtonClass, "px-2 py-1")}
              >
                {deleting ? "Deleting…" : "Delete inventory entry"}
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
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <aside className="space-y-3 text-sm">
            <CardImageFlipper row={row} />
            <MeldPartnerLink row={row} />
            <InventoryDetailPanel
              row={row}
              capabilities={capabilities}
              visibleLocationBreakdown={visibleLocationBreakdown}
              priceLabel={priceLabel}
            />
            {capabilities.canViewPrivateSourceInfo ? (
              <CardPriceHistoryPanel row={row} />
            ) : null}
          </aside>
          <div className="space-y-3 text-sm">
            <section className={detailBlockClass}>
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
                <h3 className="font-semibold">{row.cardName}</h3>
                <div className="shrink-0">
                  <CardManaCost card={row} showFaceNames={!cardFaces.length} />
                </div>
              </div>
              <div className={detailBodyClass}>
                {cardFaces.length ? (
                  cardFaces.map((face, index) => (
                    <CardFaceMechanics
                      key={`${face.name || "face"}-${index}`}
                      face={face}
                      index={index}
                    />
                  ))
                ) : (
                  <>
                    <div className="border-b border-zinc-800 pb-2 font-medium">
                      {row.typeLine || "-"}
                    </div>
                    {topLevelOracleParagraphs.length ? (
                      <div className="space-y-2 leading-relaxed text-zinc-100">
                        {topLevelOracleParagraphs.map((paragraph, index) => (
                          <p key={`${index}-${paragraph.slice(0, 16)}`}>
                            <OracleText text={paragraph} />
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {hasPowerToughness || hasLoyalty || hasDefense ? (
                      <FaceStats
                        powerToughness={row.powerToughness}
                        power={row.power}
                        toughness={row.toughness}
                        loyalty={row.loyalty}
                        defense={row.defense}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </section>

            <section className={detailBlockClass}>
              <div className={detailHeaderClass}>Printing</div>
              <div className="grid grid-cols-2 gap-3 p-3">
                <div>
                  <div className="text-xs uppercase text-zinc-500">Set</div>
                  <SetLabel
                    setCode={row.setCode}
                    setName={row.setName}
                    rarity={row.rarity}
                    symbolClassName="h-5 w-5"
                  />
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">
                    Collector #
                  </div>
                  {row.collectorNumber || "-"}
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">
                    Released
                  </div>
                  {formatReleaseDate(row.releasedAt)}
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">Rarity</div>
                  {row.rarity || "-"}
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">
                    Treatment
                  </div>
                  {treatment}
                </div>
                <div className="col-span-2">
                  <div className="text-xs uppercase text-zinc-500">Artist</div>
                  {row.artist || "-"}
                </div>
              </div>
            </section>

            <section className={detailBlockClass}>
              <div className={detailHeaderClass}>Legalities</div>
              <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
                {legalityFormats.map(([format, status]) => {
                  const legal = String(status).toLowerCase() === "legal";
                  return (
                    <div
                      key={format}
                      className="grid min-h-8 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2"
                    >
                      <span className="truncate text-xs font-medium text-zinc-200">
                        {format}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-5 w-full items-center justify-center rounded px-1.5 text-[10px] font-semibold uppercase",
                          legal
                            ? "bg-emerald-900/70 text-emerald-100"
                            : "bg-zinc-700 text-zinc-200",
                        )}
                      >
                        {String(status).replace("_", " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

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
  onMoveInventoryCopies,
  onSplitInventoryStack,
  onSaveEdit,
  onSearchPrintings,
  onDeleteInventoryItem,
  onAddTradeWishlist,
  deckTargets = [],
  onAddToDeck,
  importExportHref,
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
  onMoveInventoryCopies?: (formData: FormData) => Promise<
    | {
        success: true;
        cardName: string;
        quantityMoved: number;
        sourceLocationName: string;
        destinationLocationName: string;
      }
    | { success: false; message: string }
  >;
  onSplitInventoryStack?: (formData: FormData) => Promise<void>;
  onSaveEdit?: (formData: FormData) => Promise<void>;
  onSearchPrintings?: (formData: FormData) => Promise<ScryfallResult[]>;
  onDeleteInventoryItem?: (formData: FormData) => Promise<void>;
  onAddTradeWishlist?: (formData: FormData) => Promise<void>;
  deckTargets?: InventoryDeckTarget[];
  onAddToDeck?: (formData: FormData) => Promise<void>;
  importExportHref?: string;
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
  const [editingStackId, setEditingStackId] = useState("");
  const [splittingStackId, setSplittingStackId] = useState("");
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
  const canShowPublicOwnerIdentity =
    capabilities.canViewOwnerAdminFields || uiMode === "public-readonly";
  const shouldShowOwnerColor =
    capabilities.canViewOwnerAdminFields || uiMode === "public-readonly";
  const editableNormalLocations = useMemo(
    () =>
      locations.filter(
        (location) =>
          location.kind !== "DECK" &&
          location.active !== false &&
          (!editing?.currentOwnerId ||
            !location.ownerPlayerId ||
            location.ownerPlayerId === editing.currentOwnerId),
      ),
    [editing?.currentOwnerId, locations],
  );

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

  const submitStackMove = useCallback(
    async (fd: FormData) => {
      if (!capabilities.canMove || !onMoveInventoryCopies) {
        throw new Error("This inventory is read-only.");
      }
      rememberScrollPosition();
      const result = await onMoveInventoryCopies(fd);
      if (!result.success) {
        throw new Error(result.message);
      }
      setMessage(
        `Moved ${result.quantityMoved} ${result.cardName} from ${result.sourceLocationName} to ${result.destinationLocationName}.`,
      );
      setSelected(null);
      router.refresh();
    },
    [capabilities.canMove, onMoveInventoryCopies, router],
  );

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
              enableHiding: false,
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
      ...(canShowPublicOwnerIdentity
        ? [
            {
              accessorKey: "currentOwner",
              header: "Owner",
              cell: ({ row }: any) => {
                const ownerStyles = ownerColorStyles(
                  row.original.currentOwnerColor,
                );
                return (
                  <span
                    className="inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-semibold"
                    style={{
                      borderColor: ownerStyles.strong,
                      backgroundColor: ownerStyles.fill,
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-1 ring-white/40"
                      style={{ backgroundColor: ownerStyles.color }}
                    />
                    {row.original.currentOwner}
                  </span>
                );
              },
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
      {
        accessorKey: "releasedAt",
        header: "Released",
        sortDescFirst: true,
        cell: ({ row }) => formatReleaseDate(row.original.releasedAt),
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
              enableHiding: false,
              header: "Actions",
              cell: ({ row }: any) => {
                const exact = row.original.displayMode === "exact";
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
                      {capabilities.canEdit ? (
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
                              entriesCount: getRowSourceIds(row.original)
                                .length,
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
      capabilities.canViewPrivateSourceInfo,
      capabilities.canViewVisibility,
      canShowPublicOwnerIdentity,
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
            <span className="text-xs font-semibold uppercase text-zinc-500">
              Actions
            </span>
            {importExportHref ? (
              <a
                className={cn(filterButtonClass, "px-2 py-1")}
                href={importExportHref}
              >
                Import / Export
              </a>
            ) : null}
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
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
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
                {table.getRowModel().rows.map((r) => {
                  const ownerStyles = ownerColorStyles(
                    r.original.currentOwnerColor,
                  );
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-800"
                      style={
                        shouldShowOwnerColor
                          ? {
                              borderLeft: `8px solid ${ownerStyles.color}`,
                              background: `linear-gradient(90deg, ${ownerStyles.fill} 0%, ${ownerStyles.subtle} 18%, rgba(24,24,27,0.96) 72%)`,
                              boxShadow: `inset 0 1px 0 ${ownerStyles.strong}`,
                            }
                          : undefined
                      }
                    >
                      {r.getVisibleCells().map((c) => (
                        <td key={c.id} className="p-2 align-middle">
                          {c.column.columnDef.cell
                            ? flexRender(
                                c.column.columnDef.cell,
                                c.getContext(),
                              )
                            : String(c.getValue() ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className={`grid gap-3 ${sizeClass}`}>
          {table.getRowModel().rows.map((r) => {
            const row = r.original;
            const ownerStyles = ownerColorStyles(row.currentOwnerColor);
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
                  className="w-full overflow-hidden rounded border-2 bg-zinc-900 p-2 text-left hover:bg-zinc-800"
                  style={
                    shouldShowOwnerColor
                      ? {
                          borderColor: ownerStyles.color,
                          background: `linear-gradient(180deg, ${ownerStyles.fill} 0%, rgba(24,24,27,0.98) 42%, rgba(24,24,27,0.95) 100%)`,
                          boxShadow: `0 0 0 1px ${ownerStyles.strong}, 0 0 24px ${ownerStyles.strong}`,
                        }
                      : undefined
                  }
                >
                  {shouldShowOwnerColor ? (
                    <div
                      className="-mx-2 -mt-2 mb-2 h-1.5"
                      style={{ backgroundColor: ownerStyles.color }}
                    />
                  ) : null}
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
                    {canShowPublicOwnerIdentity ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold text-zinc-100"
                        style={{
                          borderColor: ownerStyles.strong,
                          backgroundColor: ownerStyles.fill,
                        }}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full ring-1 ring-white/40"
                          style={{ backgroundColor: ownerStyles.color }}
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
          deleting={deletingBulk}
          onAddTradeWishlist={onAddTradeWishlist}
          deckTargets={deckTargets}
          onAddToDeck={onAddToDeck}
          onEdit={
            capabilities.canEdit && selected.displayMode === "exact"
              ? () => {
                  setEditing(selected);
                  setConfirmed(null);
                  setResults([]);
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
            <section className="mb-4 rounded border border-zinc-800 bg-zinc-950/60 p-3 text-sm">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold">Copies by location</h4>
                  <p className="text-xs text-zinc-400">
                    Edit a stack directly, or split part of it into another
                    stack. Matching stacks merge automatically.
                  </p>
                </div>
                {confirmed ? (
                  <span className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-200">
                    Selected printing: {confirmed.set.toUpperCase()} #
                    {confirmed.collector_number}
                  </span>
                ) : null}
              </div>
              {capabilities.canEdit ? (
                <div className="mb-3 rounded border border-zinc-800 bg-black/20 p-2">
                  <div className="mb-2 text-xs text-zinc-400">
                    Current printing: {editing.cardName} ({editing.setCode}) #
                    {editing.collectorNumber || "-"}
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="stackPrintingQuery"
                      name="stackPrintingQuery"
                      className={cn(filterInputClass, "flex-1")}
                      placeholder="Card name or Scryfall query, e.g. command tower set:c20"
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
                              "stackPrintingQuery",
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
                      {searchingPrintings ? "Searching..." : "Search"}
                    </button>
                  </div>
                  {results.length ? (
                    <div className="mt-2 max-h-40 overflow-auto space-y-1">
                      {results.map((r) => (
                        <button
                          type="button"
                          key={r.id}
                          onClick={() => setConfirmed(r)}
                          className={`w-full rounded border p-1 text-left text-xs ${
                            confirmed?.id === r.id
                              ? "border-emerald-500 bg-emerald-950/30"
                              : "border-zinc-700 hover:bg-zinc-900"
                          }`}
                        >
                          {r.name} ({r.set.toUpperCase()}) #{r.collector_number}{" "}
                          - {r.rarity}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 text-xs text-zinc-500">
                    Select the correct result, then edit the affected stack and
                    save it. You can also correct foil status in that stack.
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                {(editing.locationBreakdown?.length
                  ? editing.locationBreakdown
                  : [
                      {
                        inventoryItemId: editing.id,
                        locationId: editing.locationId || null,
                        name: editing.locationName || "Unassigned",
                        quantity: editing.quantity,
                        foilStatus: editing.foilStatus,
                        condition: editing.condition,
                        language: editing.language,
                        sourceType: editing.sourceType,
                      },
                    ]
                ).map((stack, index) => {
                  const stackId = stack.inventoryItemId || "";
                  const stackKey = stackId || `${stack.locationId}-${index}`;
                  const isDeckStack =
                    stack.locationKind === "DECK" ||
                    stack.locationSystemManaged;
                  const stackSummary = [
                    `${stack.quantity} ${stack.quantity === 1 ? "copy" : "copies"}`,
                    stack.foilStatus || editing.foilStatus,
                    stack.condition || editing.condition,
                    stack.language || editing.language,
                    stack.sourceType
                      ? friendlySource(
                          stack.sourceType as InventoryRow["sourceType"],
                        )
                      : friendlySource(editing.sourceType),
                  ].filter(Boolean);
                  const defaultLocationId = stack.locationId || "";
                  const defaultFoilStatus =
                    stack.foilStatus || editing.foilStatus || "NONFOIL";
                  const defaultCondition =
                    stack.condition || editing.condition || "NM";
                  const defaultLanguage =
                    stack.language || editing.language || "EN";
                  const defaultSourceType =
                    stack.sourceType || editing.sourceType || "CORRECTION";
                  const stackFormFields = (
                    <>
                      <input
                        type="hidden"
                        name="inventoryItemId"
                        value={stackId}
                      />
                      <input
                        type="hidden"
                        name="existingCardId"
                        value={editing.cardId}
                      />
                      <input
                        type="hidden"
                        name="currentOwnerId"
                        value={editing.currentOwnerId}
                      />
                      <input
                        type="hidden"
                        name="newScryfallId"
                        value={confirmed?.id || ""}
                      />
                    </>
                  );
                  return (
                    <div
                      key={stackKey}
                      className="rounded border border-zinc-800 bg-zinc-900/80 p-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{stack.name}</div>
                          <div className="text-xs text-zinc-400">
                            {stackSummary.join(" Â· ")}
                          </div>
                        </div>
                        {isDeckStack ? (
                          <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400">
                            Use deck return
                          </span>
                        ) : stackId ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={cn(filterButtonClass, "px-2 py-1")}
                              onClick={() => {
                                setEditingStackId(
                                  editingStackId === stackId ? "" : stackId,
                                );
                                setSplittingStackId("");
                              }}
                            >
                              {editingStackId === stackId ? "Cancel" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className={cn(filterButtonClass, "px-2 py-1")}
                              onClick={() => {
                                setSplittingStackId(
                                  splittingStackId === stackId ? "" : stackId,
                                );
                                setEditingStackId("");
                              }}
                              disabled={stack.quantity < 2}
                            >
                              {splittingStackId === stackId
                                ? "Cancel"
                                : "Split"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {editingStackId === stackId ? (
                        <form
                          action={async (fd) => {
                            try {
                              if (!onSaveEdit) {
                                throw new Error(
                                  "Editing is unavailable in read-only mode.",
                                );
                              }
                              await onSaveEdit(fd);
                              setMessage("Inventory stack updated.");
                              setEditing(null);
                              setEditingStackId("");
                              router.refresh();
                            } catch (e: any) {
                              setMessage(
                                e?.message || "Failed to save stack edit.",
                              );
                            }
                          }}
                          className="mt-3 grid gap-2 rounded border border-zinc-800 bg-black/20 p-2"
                        >
                          {stackFormFields}
                          <div className="grid gap-2 md:grid-cols-3">
                            <label className={filterLabelClass}>
                              Quantity
                              <input
                                name="quantity"
                                type="number"
                                min={1}
                                defaultValue={stack.quantity}
                                className={cn(filterInputClass, "mt-1 w-full")}
                              />
                            </label>
                            <label className={filterLabelClass}>
                              Location
                              <select
                                name="locationId"
                                defaultValue={defaultLocationId}
                                className={cn(filterSelectClass, "mt-1 w-full")}
                              >
                                {editableNormalLocations.map((location) => (
                                  <option key={location.id} value={location.id}>
                                    {location.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={filterLabelClass}>
                              Foil status
                              <select
                                name="foilStatus"
                                defaultValue={defaultFoilStatus}
                                className={cn(filterSelectClass, "mt-1 w-full")}
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
                                defaultValue={defaultCondition}
                                className={cn(filterSelectClass, "mt-1 w-full")}
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
                                defaultValue={defaultLanguage}
                                className={cn(filterInputClass, "mt-1 w-full")}
                                maxLength={8}
                              />
                            </label>
                            {capabilities.canViewOwnerAdminFields ? (
                              <label className={filterLabelClass}>
                                Source type
                                <select
                                  name="sourceType"
                                  defaultValue={defaultSourceType}
                                  className={cn(
                                    filterSelectClass,
                                    "mt-1 w-full",
                                  )}
                                >
                                  <option value="PULL">legacy</option>
                                  <option value="CSV_PULL_IMPORT">
                                    import
                                  </option>
                                  <option value="TRADE">trade</option>
                                  <option value="MANUAL">manual</option>
                                  <option value="CORRECTION">correction</option>
                                  <option value="PRIZE">prize</option>
                                  <option value="OTHER">other</option>
                                </select>
                              </label>
                            ) : null}
                          </div>
                          <label className={filterLabelClass}>
                            Notes
                            <textarea
                              name="notes"
                              defaultValue={editing.notes || ""}
                              className={cn(filterTextareaClass, "mt-1 w-full")}
                            />
                          </label>
                          <label className={filterLabelClass}>
                            Reason
                            <input
                              name="reason"
                              className={cn(filterInputClass, "mt-1 w-full")}
                              defaultValue="Inventory stack edit."
                              required={capabilities.canViewOwnerAdminFields}
                            />
                          </label>
                          <div className="flex justify-end">
                            <SubmitButton
                              pendingLabel="Saving..."
                              className={filterPrimaryButtonClass}
                            >
                              Save stack
                            </SubmitButton>
                          </div>
                        </form>
                      ) : null}
                      {splittingStackId === stackId ? (
                        <form
                          action={async (fd) => {
                            try {
                              if (!onSplitInventoryStack) {
                                throw new Error(
                                  "Splitting is unavailable in read-only mode.",
                                );
                              }
                              await onSplitInventoryStack(fd);
                              setMessage("Inventory stack split.");
                              setEditing(null);
                              setSplittingStackId("");
                              router.refresh();
                            } catch (e: any) {
                              setMessage(
                                e?.message ||
                                  "Failed to split inventory stack.",
                              );
                            }
                          }}
                          className="mt-3 grid gap-2 rounded border border-zinc-800 bg-black/20 p-2"
                        >
                          {stackFormFields}
                          <div className="grid gap-2 md:grid-cols-3">
                            <label className={filterLabelClass}>
                              Split quantity
                              <input
                                name="quantity"
                                type="number"
                                min={1}
                                max={Math.max(1, stack.quantity - 1)}
                                defaultValue={1}
                                className={cn(filterInputClass, "mt-1 w-full")}
                              />
                            </label>
                            <label className={filterLabelClass}>
                              New location
                              <select
                                name="locationId"
                                defaultValue={defaultLocationId}
                                className={cn(filterSelectClass, "mt-1 w-full")}
                              >
                                {editableNormalLocations.map((location) => (
                                  <option key={location.id} value={location.id}>
                                    {location.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={filterLabelClass}>
                              Foil status
                              <select
                                name="foilStatus"
                                defaultValue={defaultFoilStatus}
                                className={cn(filterSelectClass, "mt-1 w-full")}
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
                                defaultValue={defaultCondition}
                                className={cn(filterSelectClass, "mt-1 w-full")}
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
                                defaultValue={defaultLanguage}
                                className={cn(filterInputClass, "mt-1 w-full")}
                                maxLength={8}
                              />
                            </label>
                            {capabilities.canViewOwnerAdminFields ? (
                              <label className={filterLabelClass}>
                                Source type
                                <select
                                  name="sourceType"
                                  defaultValue={defaultSourceType}
                                  className={cn(
                                    filterSelectClass,
                                    "mt-1 w-full",
                                  )}
                                >
                                  <option value="PULL">legacy</option>
                                  <option value="CSV_PULL_IMPORT">
                                    import
                                  </option>
                                  <option value="TRADE">trade</option>
                                  <option value="MANUAL">manual</option>
                                  <option value="CORRECTION">correction</option>
                                  <option value="PRIZE">prize</option>
                                  <option value="OTHER">other</option>
                                </select>
                              </label>
                            ) : null}
                          </div>
                          <label className={filterLabelClass}>
                            Notes for split stack
                            <textarea
                              name="notes"
                              defaultValue={editing.notes || ""}
                              className={cn(filterTextareaClass, "mt-1 w-full")}
                            />
                          </label>
                          <label className={filterLabelClass}>
                            Reason
                            <input
                              name="reason"
                              className={cn(filterInputClass, "mt-1 w-full")}
                              defaultValue="Inventory stack split."
                              required={capabilities.canViewOwnerAdminFields}
                            />
                          </label>
                          <div className="flex justify-end">
                            <SubmitButton
                              pendingLabel="Splitting..."
                              className={filterPrimaryButtonClass}
                            >
                              Split stack
                            </SubmitButton>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
            {false ? (
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
                <input
                  type="hidden"
                  name="inventoryItemId"
                  value={editing!.id}
                />
                <input
                  type="hidden"
                  name="existingCardId"
                  value={editing!.cardId}
                />
                {!capabilities.canViewOwnerAdminFields ? (
                  <input
                    type="hidden"
                    name="currentOwnerId"
                    value={editing!.currentOwnerId}
                  />
                ) : null}
                <div className="grid md:grid-cols-2 gap-2">
                  {capabilities.canViewOwnerAdminFields ? (
                    <label className={filterLabelClass}>
                      Current owner
                      <select
                        name="currentOwnerId"
                        defaultValue={editing!.currentOwnerId}
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
                      defaultValue={editing!.locationId || ""}
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
                      defaultValue={editing!.quantity}
                      className={cn(filterInputClass, "w-full")}
                    />
                  </label>
                  <label className={filterLabelClass}>
                    Foil status
                    <select
                      name="foilStatus"
                      defaultValue={editing!.foilStatus || "NONFOIL"}
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
                      defaultValue={editing!.condition || "NM"}
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
                      defaultValue={editing!.language || "EN"}
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
                          defaultValue={editing!.sourceType || "CORRECTION"}
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
                    defaultValue={editing!.notes || ""}
                    className={cn(filterTextareaClass, "w-full")}
                  />
                </label>
                {capabilities.canViewOwnerAdminFields ? (
                  <>
                    <div className="border border-zinc-800 p-2 text-sm">
                      Current printing: {editing!.cardName} ({editing!.setCode})
                      #{editing!.collectorNumber || "-"} • {editing!.rarity}
                    </div>
                    <div className="border border-zinc-800 p-2 space-y-2">
                      <div className="font-semibold text-sm">
                        Change Printing
                      </div>
                      <div className="flex gap-2">
                        <input
                          id="printingQuery"
                          name="printingQuery"
                          className={cn(filterInputClass, "flex-1")}
                          placeholder="Card name or Scryfall query, e.g. command tower set:c20"
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
                            {r.name} ({r.set.toUpperCase()}) #
                            {r.collector_number} • {r.rarity}
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
            ) : null}
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
                      Set: {editing.setCode} #{editing!.collectorNumber || "-"}
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
