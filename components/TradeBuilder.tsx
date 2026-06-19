"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/feedback/SubmitButton";
import {
  cn,
  filterButtonClass,
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
};

type TradeBuilderProps = {
  createTradeAction: (formData: FormData) => Promise<void>;
  proposerPlayerId?: string;
  receiverPlayerId: string;
  offerItems: TradeBuilderItem[];
  requestItems: TradeBuilderItem[];
};

function formatItemMeta(item: TradeBuilderItem) {
  return `${item.setCode.toUpperCase()} #${item.collectorNumber} / ${item.foilStatus.toLowerCase()} / ${item.condition}`;
}

function itemMatches(item: TradeBuilderItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.cardName,
    item.setCode,
    item.collectorNumber,
    item.condition,
    item.foilStatus,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function TradeSlot({
  title,
  emptyLabel,
  item,
}: {
  title: string;
  emptyLabel: string;
  item?: TradeBuilderItem;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <span className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          1 card
        </span>
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

function TradeInventoryPane({
  title,
  subtitle,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  subtitle: string;
  items: TradeBuilderItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(
    () => items.filter((item) => itemMatches(item, query)).slice(0, 80),
    [items, query],
  );

  return (
    <section className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
        <span className="text-xs text-zinc-500">{items.length} cards</span>
      </div>
      <label className={cn(filterFieldClass, "mt-3")}>
        Search cards
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(filterInputClass, "mt-1 w-full")}
          placeholder="Card, set, collector number"
        />
      </label>
      <div className="mt-3 max-h-[28rem] space-y-1 overflow-y-auto pr-1">
        {filteredItems.length ? (
          filteredItems.map((item) => {
            const selected = item.id === selectedId;
            const unavailable = item.available < 1;
            return (
              <button
                key={item.id}
                type="button"
                disabled={unavailable}
                onClick={() => onSelect(item.id)}
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
                    {formatItemMeta(item)}
                  </span>
                </span>
                <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                  {item.available}
                </span>
              </button>
            );
          })
        ) : (
          <p className="rounded border border-zinc-800 p-3 text-sm text-zinc-500">
            No matching available cards.
          </p>
        )}
      </div>
    </section>
  );
}

export function TradeBuilder({
  createTradeAction,
  proposerPlayerId,
  receiverPlayerId,
  offerItems,
  requestItems,
}: TradeBuilderProps) {
  const firstOffer = offerItems.find((item) => item.available > 0)?.id ?? "";
  const firstRequest = requestItems.find((item) => item.available > 0)?.id ?? "";
  const [offeredId, setOfferedId] = useState(firstOffer);
  const [requestedId, setRequestedId] = useState(firstRequest);
  const offered = offerItems.find((item) => item.id === offeredId);
  const requested = requestItems.find((item) => item.id === requestedId);
  const canSubmit = Boolean(offered && requested);

  return (
    <form action={createTradeAction} className="space-y-4">
      <input type="hidden" name="receiverPlayerId" value={receiverPlayerId} />
      {proposerPlayerId ? (
        <input type="hidden" name="proposerPlayerId" value={proposerPlayerId} />
      ) : null}
      <input type="hidden" name="offeredInventoryItemId" value={offeredId} />
      <input type="hidden" name="requestedInventoryItemId" value={requestedId} />

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <TradeSlot
          title="You offer"
          emptyLabel="Select one card from your inventory."
          item={offered}
        />
        <div className="flex items-center justify-center py-2 lg:min-h-36">
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
            trade
          </span>
        </div>
        <TradeSlot
          title="You receive"
          emptyLabel="Select one card from their inventory."
          item={requested}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TradeInventoryPane
          title="Your inventory"
          subtitle="Pick the card you are offering."
          items={offerItems}
          selectedId={offeredId}
          onSelect={setOfferedId}
        />
        <TradeInventoryPane
          title="Their inventory"
          subtitle="Pick the card you want in return."
          items={requestItems}
          selectedId={requestedId}
          onSelect={setRequestedId}
        />
      </div>

      <label className={cn(filterFieldClass, "block")}>
        Message / notes
        <textarea name="message" className={cn(filterTextareaClass, "mt-1 w-full")} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          Current trade rule: one card for one card. The layout is ready for a
          future multi-card queue.
        </p>
        <SubmitButton
          pendingLabel="Proposing trade..."
          className={filterPrimaryButtonClass}
          disabled={!canSubmit}
        >
          Submit Proposal
        </SubmitButton>
      </div>
      {!canSubmit ? (
        <p className="text-sm text-amber-300">
          Choose one available card on each side before proposing a trade.
        </p>
      ) : null}
    </form>
  );
}
