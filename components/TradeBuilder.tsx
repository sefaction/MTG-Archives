"use client";

import { useEffect, useMemo, useState } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
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
  locationName?: string;
};

type SearchState = {
  query: string;
  loading: boolean;
  error: string;
  items: TradeBuilderItem[];
};

type TradeBuilderProps = {
  createTradeAction: (formData: FormData) => Promise<void>;
  proposerPlayerId?: string;
  proposerOwnerId: string;
  receiverPlayerId: string;
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

function TradeSlot({
  title,
  emptyLabel,
  item,
  onClear,
}: {
  title: string;
  emptyLabel: string;
  item?: TradeBuilderItem;
  onClear: () => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {item ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-zinc-400 underline hover:text-zinc-100"
          >
            Clear
          </button>
        ) : null}
      </div>
      {item ? (
        <div className="flex gap-3">
          {item.imageUri ? (
            <img
              src={item.imageUri}
              alt=""
              className="h-24 w-[4.3rem] rounded object-cover"
            />
          ) : (
            <div className="flex h-24 w-[4.3rem] items-center justify-center rounded border border-zinc-800 text-xs text-zinc-500">
              No image
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-100">
              {item.cardName}
            </p>
            <p className="mt-1 text-xs text-zinc-400">{formatItemMeta(item)}</p>
            <p className="mt-2 text-xs text-zinc-300">
              {item.available} available / {item.quantity} owned
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {[item.priceLabel, item.locationName].filter(Boolean).join(" / ")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950/50 px-3 text-center text-sm text-zinc-500">
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
  selectedId,
  onSelect,
}: {
  title: string;
  subtitle: string;
  ownerId: string;
  state: SearchState;
  setState: (
    next: SearchState | ((current: SearchState) => SearchState),
  ) => void;
  selectedId: string;
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
    <section className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
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
      </div>
      <label className={cn(filterFieldClass, "mt-3")}>
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
      <div className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
        {state.error ? (
          <p className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
            {state.error}
          </p>
        ) : state.items.length ? (
          state.items.map((item) => {
            const selected = item.id === selectedId;
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
                    {item.available}
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
    </section>
  );
}

export function TradeBuilder({
  createTradeAction,
  proposerPlayerId,
  proposerOwnerId,
  receiverPlayerId,
  proposerName,
  receiverName,
  initialOfferedItem,
  initialRequestedItem,
}: TradeBuilderProps) {
  const [offerSearch, setOfferSearch] = useState<SearchState>(emptySearchState);
  const [requestSearch, setRequestSearch] =
    useState<SearchState>(emptySearchState);
  const [offered, setOffered] = useState<TradeBuilderItem | null>(
    initialOfferedItem ?? null,
  );
  const [requested, setRequested] = useState<TradeBuilderItem | null>(
    initialRequestedItem ?? null,
  );
  const canSubmit = Boolean(offered && requested);
  const disabledReason = useMemo(() => {
    if (!receiverPlayerId) return "Choose a trade partner first.";
    if (!offered || !requested)
      return "Choose one available card on each side before proposing.";
    return "";
  }, [offered, receiverPlayerId, requested]);

  return (
    <form action={createTradeAction} className="space-y-4">
      <input type="hidden" name="receiverPlayerId" value={receiverPlayerId} />
      {proposerPlayerId ? (
        <input type="hidden" name="proposerPlayerId" value={proposerPlayerId} />
      ) : null}
      <input
        type="hidden"
        name="offeredInventoryItemId"
        value={offered?.id ?? ""}
      />
      <input
        type="hidden"
        name="requestedInventoryItemId"
        value={requested?.id ?? ""}
      />

      <div className="sticky top-2 z-10 rounded border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl shadow-black/20">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-zinc-100">Proposal draft</h3>
            <p className="text-xs text-zinc-400">
              {proposerName} offers one card for one card from {receiverName}.
            </p>
          </div>
          <span className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
            {[
              offered ? "Offer selected" : "Choose offer",
              requested ? "Request selected" : "Choose request",
            ].join(" / ")}
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
          <TradeSlot
            title={`${proposerName} offers`}
            emptyLabel="Search your inventory and select one card."
            item={offered ?? undefined}
            onClear={() => setOffered(null)}
          />
          <div className="flex items-center justify-center py-2 lg:min-h-36">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
              for
            </span>
          </div>
          <TradeSlot
            title={`${receiverName} gives`}
            emptyLabel="Search their inventory and select one card."
            item={requested ?? undefined}
            onClear={() => setRequested(null)}
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TradeInventorySearch
          title={`${proposerName}'s inventory`}
          subtitle="Search only when you need to add an offered card."
          ownerId={proposerOwnerId}
          state={offerSearch}
          setState={setOfferSearch}
          selectedId={offered?.id ?? ""}
          onSelect={setOffered}
        />
        <TradeInventorySearch
          title={`${receiverName}'s inventory`}
          subtitle="Search only when you need to request a card."
          ownerId={receiverPlayerId}
          state={requestSearch}
          setState={setRequestSearch}
          selectedId={requested?.id ?? ""}
          onSelect={setRequested}
        />
      </div>

      <label className={cn(filterFieldClass, "block")}>
        Message / notes
        <textarea
          name="message"
          className={cn(filterTextareaClass, "mt-1 w-full")}
          placeholder="Add context, condition notes, or negotiation details."
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          Current trade rule: one card for one card. This search-first layout is
          the base for upcoming multi-card negotiation and trade wishlists.
        </p>
        <SubmitButton
          pendingLabel="Proposing trade..."
          className={filterPrimaryButtonClass}
          disabled={!canSubmit}
        >
          Submit Proposal
        </SubmitButton>
      </div>
      {disabledReason ? (
        <p className="text-sm text-amber-300">{disabledReason}</p>
      ) : null}
    </form>
  );
}
