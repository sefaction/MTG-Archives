"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import { TradeValueSummary } from "@/components/TradeValueSummary";
import { formatTradeMoney } from "@/lib/trade-value";
import {
  TRADE_PAIRING_ADD_EVENT,
  TRADE_PAIRING_MIME,
  parseTradePairingPayload,
  tradePairingSideMime,
  type TradePairingPayload,
  type TradePairingSide,
} from "@/lib/trade-pairing";
import {
  initialTradeProposalActionState,
  type TradeProposalActionState,
} from "@/lib/trade-proposal";
import {
  cn,
  filterFieldClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterTextareaClass,
} from "@/components/filterStyles";

export type TradeBuilderItem = {
  id: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  condition: string;
  foilStatus: string;
  quantity: number;
  available: number;
  imageUri?: string;
  typeLine?: string;
  colorIdentity?: unknown;
  priceLabel?: string;
  priceAmount?: number | null;
  priceProvider?: string;
  locationName?: string;
};

type SearchState = {
  query: string;
  loading: boolean;
  error: string;
  items: TradeBuilderItem[];
};

type TradeDraftLine = {
  item: TradeBuilderItem;
  quantity: number;
};

type TradeBuilderProps = {
  createTradeAction: (
    previousState: TradeProposalActionState,
    formData: FormData,
  ) => Promise<TradeProposalActionState>;
  proposerPlayerId?: string;
  proposerOwnerId: string;
  receiverPlayerId: string;
  counterTradeId?: string;
  proposerName: string;
  receiverName: string;
  initialOfferedItem?: TradeBuilderItem | null;
  initialRequestedItem?: TradeBuilderItem | null;
};

function formatItemMeta(item: TradeBuilderItem) {
  return `${item.setCode.toUpperCase()} #${item.collectorNumber} / ${item.foilStatus.toLowerCase()} / ${item.condition}`;
}

function colorIdentityLabel(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("") || "C";
  if (typeof value === "string") return value.replace(/[^A-Za-z]/g, "") || "C";
  return "C";
}

function emptySearchState(): SearchState {
  return { query: "", loading: false, error: "", items: [] };
}

function addTradeLine(
  setter: Dispatch<SetStateAction<TradeDraftLine[]>>,
  item: TradeBuilderItem,
) {
  setter((current) =>
    current.some((line) => line.item.id === item.id)
      ? current
      : [...current, { item, quantity: 1 }],
  );
}

function TradeSlot({
  title,
  emptyLabel,
  lines,
  side,
  onAdd,
  onRemove,
  onQuantityChange,
}: {
  title: string;
  emptyLabel: string;
  lines: TradeDraftLine[];
  side: TradePairingSide;
  onAdd: (item: TradeBuilderItem) => void;
  onRemove: (inventoryItemId: string) => void;
  onQuantityChange: (inventoryItemId: string, quantity: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        if (
          Array.from(event.dataTransfer.types).includes(
            tradePairingSideMime(side),
          )
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        setDragOver(false);
        const incoming = parseTradePairingPayload(
          event.dataTransfer.getData(TRADE_PAIRING_MIME),
        );
        if (!incoming || incoming.side !== side) return;
        event.preventDefault();
        onAdd(incoming.item);
      }}
      className={cn(
        "rounded-lg border bg-zinc-950/60 p-2.5 transition-all",
        dragOver
          ? "border-sky-500 bg-sky-950/35 shadow-lg shadow-sky-950/50"
          : "border-zinc-800",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <div className="flex items-center gap-2">
          {dragOver ? (
            <span className="text-xs font-medium text-sky-200">
              Drop to add
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-zinc-600">
              Drop cards here
            </span>
          )}
          <span className="text-xs text-zinc-500">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </div>
      </div>
      {lines.length ? (
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {lines.map(({ item, quantity }) => (
            <div
              key={item.id}
              className="grid grid-cols-[3rem_1fr_auto] gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2"
            >
              {item.imageUri ? (
                <img
                  src={item.imageUri}
                  alt=""
                  className="h-16 w-12 rounded object-cover"
                />
              ) : (
                <div className="flex h-16 w-12 items-center justify-center rounded border border-zinc-800 text-[10px] text-zinc-500">
                  No image
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-100">
                  {item.cardName}
                </p>
                <p className="truncate text-xs text-zinc-400">
                  {formatItemMeta(item)}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {[
                    item.priceLabel ? `${item.priceLabel} each` : "",
                    typeof item.priceAmount === "number"
                      ? `${formatTradeMoney(item.priceAmount * quantity)} line`
                      : "Price unavailable",
                    item.locationName,
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </p>
              </div>
              <div className="flex flex-col items-end justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="text-xs text-zinc-500 hover:text-red-200"
                  aria-label={`Remove ${item.cardName}`}
                >
                  Remove
                </button>
                <label className="text-[10px] uppercase text-zinc-500">
                  Qty
                  <input
                    type="number"
                    min={1}
                    max={item.available}
                    value={quantity}
                    onChange={(event) =>
                      onQuantityChange(item.id, Number(event.target.value))
                    }
                    className="ml-1 w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-right text-xs text-zinc-100"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-20 items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950/50 px-3 text-center text-sm text-zinc-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function TradeInventorySearch({
  title,
  subtitle,
  ownerId,
  state,
  setState,
  selectedIds,
  onSelect,
}: {
  title: string;
  subtitle: string;
  ownerId: string;
  state: SearchState;
  setState: (
    next: SearchState | ((current: SearchState) => SearchState),
  ) => void;
  selectedIds: string[];
  onSelect: (item: TradeBuilderItem) => void;
}) {
  useEffect(() => {
    const query = state.query.trim();
    if (!ownerId || query.length < 2) {
      setState((current) => ({
        ...current,
        loading: false,
        error: "",
        items: [],
      }));
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const params = new URLSearchParams({ ownerId, q: query });
        const response = await fetch(`/api/trades/inventory-search?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed.");
        const payload = (await response.json()) as {
          items?: TradeBuilderItem[];
        };
        setState((current) =>
          current.query.trim() === query
            ? { ...current, loading: false, items: payload.items ?? [] }
            : current,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Search failed.",
        }));
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [ownerId, setState, state.query]);

  return (
    <details className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2 p-3 hover:bg-zinc-900/60">
        <div>
          <h3 className="font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
        <span className="text-xs text-zinc-500">
          {state.loading
            ? "Searching..."
            : state.query.trim().length < 2
              ? "Type 2+ characters"
              : `${state.items.length} results`}
        </span>
      </summary>
      <div className="border-t border-zinc-800 p-3">
        <label className={filterFieldClass}>
          Search cards
          <input
            value={state.query}
            onChange={(event) =>
              setState((current) => ({ ...current, query: event.target.value }))
            }
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Card, set, collector number"
          />
        </label>
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
          {state.error ? (
            <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
              {state.error}
            </p>
          ) : state.items.length ? (
            state.items.map((item) => {
              const selected = selectedIds.includes(item.id);
              const unavailable = item.available < 1;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-2 rounded border p-2 text-left transition-colors",
                    selected
                      ? "border-sky-600 bg-sky-950/40"
                      : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900",
                    unavailable && "cursor-not-allowed opacity-45",
                  )}
                >
                  {item.imageUri ? (
                    <img
                      src={item.imageUri}
                      alt=""
                      className="h-14 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-14 w-10 rounded border border-zinc-800" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">
                      {item.cardName}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[formatItemMeta(item), item.locationName]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                    <span className="block truncate text-xs text-zinc-600">
                      {[item.typeLine, item.priceLabel]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                      {selected ? "Added" : item.available}
                    </span>
                    <span className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-500">
                      {colorIdentityLabel(item.colorIdentity)}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-500">
              {state.query.trim().length < 2
                ? "Start typing to search tradeable cards."
                : "No matching available cards."}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

export function TradeBuilder({
  createTradeAction,
  proposerPlayerId,
  proposerOwnerId,
  receiverPlayerId,
  counterTradeId,
  proposerName,
  receiverName,
  initialOfferedItem,
  initialRequestedItem,
}: TradeBuilderProps) {
  const [proposalState, submitProposal] = useActionState(
    createTradeAction,
    initialTradeProposalActionState,
  );
  const [offerSearch, setOfferSearch] = useState<SearchState>(emptySearchState);
  const [requestSearch, setRequestSearch] =
    useState<SearchState>(emptySearchState);
  const [offered, setOffered] = useState<TradeDraftLine[]>(
    initialOfferedItem ? [{ item: initialOfferedItem, quantity: 1 }] : [],
  );
  const [requested, setRequested] = useState<TradeDraftLine[]>(
    initialRequestedItem ? [{ item: initialRequestedItem, quantity: 1 }] : [],
  );
  useEffect(() => {
    const handlePairingAdd = (event: Event) => {
      const payload = (event as CustomEvent<TradePairingPayload>).detail;
      if (!payload?.item) return;
      addTradeLine(
        payload.side === "offered" ? setOffered : setRequested,
        payload.item,
      );
    };
    window.addEventListener(TRADE_PAIRING_ADD_EVENT, handlePairingAdd);
    return () =>
      window.removeEventListener(TRADE_PAIRING_ADD_EVENT, handlePairingAdd);
  }, []);
  const canSubmit = offered.length > 0 && requested.length > 0;
  const removeLine = (
    setter: Dispatch<SetStateAction<TradeDraftLine[]>>,
    inventoryItemId: string,
  ) =>
    setter((current) =>
      current.filter((line) => line.item.id !== inventoryItemId),
    );
  const changeQuantity = (
    setter: Dispatch<SetStateAction<TradeDraftLine[]>>,
    inventoryItemId: string,
    quantity: number,
  ) =>
    setter((current) =>
      current.map((line) =>
        line.item.id === inventoryItemId
          ? {
              ...line,
              quantity: Math.max(
                1,
                Math.min(
                  line.item.available,
                  Number.isFinite(quantity) ? Math.floor(quantity) : 1,
                ),
              ),
            }
          : line,
      ),
    );
  const disabledReason = useMemo(() => {
    if (!receiverPlayerId) return "Choose a trade partner first.";
    if (!offered.length || !requested.length)
      return "Choose at least one available card on each side before proposing.";
    return "";
  }, [offered, receiverPlayerId, requested]);

  return (
    <form
      action={submitProposal}
      className="space-y-3 rounded-xl border border-sky-900/70 bg-zinc-950/70 p-3 shadow-xl shadow-black/20"
    >
      <input type="hidden" name="receiverPlayerId" value={receiverPlayerId} />
      {counterTradeId ? (
        <input type="hidden" name="counterTradeId" value={counterTradeId} />
      ) : null}
      {proposerPlayerId ? (
        <input type="hidden" name="proposerPlayerId" value={proposerPlayerId} />
      ) : null}
      <input
        type="hidden"
        name="offeredLinesJson"
        value={JSON.stringify(
          offered.map((line) => ({
            inventoryItemId: line.item.id,
            quantity: line.quantity,
          })),
        )}
      />
      <input
        type="hidden"
        name="requestedLinesJson"
        value={JSON.stringify(
          requested.map((line) => ({
            inventoryItemId: line.item.id,
            quantity: line.quantity,
          })),
        )}
      />

      <div>
        {counterTradeId ? (
          <div className="mb-3 rounded-lg border border-amber-800 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
            Counter proposal: submitting this draft will decline and replace the
            original proposal.
          </div>
        ) : null}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-sky-100">Proposal draft</h2>
            <p className="text-xs text-zinc-400">
              Build a multi-card exchange with {receiverName}.
            </p>
          </div>
          <span className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
            {[
              `${offered.length} offered`,
              `${requested.length} requested`,
            ].join(" / ")}
          </span>
        </div>
        <div className="space-y-2">
          <TradeSlot
            title={`${proposerName} offers`}
            emptyLabel="Search your inventory and add one or more cards."
            lines={offered}
            side="offered"
            onAdd={(item) => addTradeLine(setOffered, item)}
            onRemove={(id) => removeLine(setOffered, id)}
            onQuantityChange={(id, quantity) =>
              changeQuantity(setOffered, id, quantity)
            }
          />
          <div className="flex items-center justify-center">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-400">
              for
            </span>
          </div>
          <TradeSlot
            title={`${receiverName} gives`}
            emptyLabel="Search their inventory and add one or more cards."
            lines={requested}
            side="requested"
            onAdd={(item) => addTradeLine(setRequested, item)}
            onRemove={(id) => removeLine(setRequested, id)}
            onQuantityChange={(id, quantity) =>
              changeQuantity(setRequested, id, quantity)
            }
          />
        </div>
      </div>

      <TradeValueSummary
        leftLabel={`${proposerName} offers`}
        rightLabel={`${receiverName} offers`}
        leftLines={offered.map(({ item, quantity }) => ({
          quantity,
          priceAmount: item.priceAmount,
        }))}
        rightLines={requested.map(({ item, quantity }) => ({
          quantity,
          priceAmount: item.priceAmount,
        }))}
      />

      <div className="grid gap-2">
        <TradeInventorySearch
          title={`Search ${proposerName}'s inventory`}
          subtitle="Add a card to the offer."
          ownerId={proposerOwnerId}
          state={offerSearch}
          setState={setOfferSearch}
          selectedIds={offered.map((line) => line.item.id)}
          onSelect={(item) => addTradeLine(setOffered, item)}
        />
        <TradeInventorySearch
          title={`Search ${receiverName}'s inventory`}
          subtitle="Add a card to the request."
          ownerId={receiverPlayerId}
          state={requestSearch}
          setState={setRequestSearch}
          selectedIds={requested.map((line) => line.item.id)}
          onSelect={(item) => addTradeLine(setRequested, item)}
        />
      </div>

      <details className="rounded-lg border border-zinc-800">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm text-zinc-300">
          Add message or notes
        </summary>
        <label
          className={cn(filterFieldClass, "block border-t border-zinc-800 p-3")}
        >
          Message / notes
          <textarea
            name="message"
            className={cn(filterTextareaClass, "mt-1 w-full")}
            placeholder="Add context, condition notes, or negotiation details."
          />
        </label>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          {offered.reduce((sum, line) => sum + line.quantity, 0)} cards offered
          {" · "}
          {requested.reduce((sum, line) => sum + line.quantity, 0)} requested
        </p>
        <SubmitButton
          pendingLabel="Proposing trade..."
          className={filterPrimaryButtonClass}
          disabled={!canSubmit}
        >
          Submit Proposal
        </SubmitButton>
      </div>
      {proposalState.status !== "idle" ? (
        <p
          role={proposalState.status === "error" ? "alert" : "status"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            proposalState.status === "error"
              ? "border-red-800 bg-red-950/35 text-red-100"
              : "border-emerald-800 bg-emerald-950/30 text-emerald-100",
          )}
        >
          {proposalState.message}
        </p>
      ) : null}
      {disabledReason ? (
        <p className="text-sm text-amber-300">{disabledReason}</p>
      ) : null}
    </form>
  );
}
