"use client";

import { useState, type ReactNode } from "react";
import {
  TRADE_PAIRING_ADD_EVENT,
  TRADE_PAIRING_MIME,
  encodeTradePairingPayload,
  parseTradePairingPayload,
  tradePairingSideMime,
  type TradePairingPayload,
  type TradePairingSide,
} from "@/lib/trade-pairing";
import type { TradeBuilderItem } from "@/components/TradeBuilder";
import { cn, filterPrimaryButtonClass } from "@/components/filterStyles";

function addToDraft(payload: TradePairingPayload) {
  window.dispatchEvent(
    new CustomEvent<TradePairingPayload>(TRADE_PAIRING_ADD_EVENT, {
      detail: payload,
    }),
  );
}

export function TradePairingCard({
  side,
  item,
  addLabel,
  children,
}: {
  side: TradePairingSide;
  item?: TradeBuilderItem | null;
  addLabel: string;
  children: ReactNode;
}) {
  const [pairing, setPairing] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const payload = item ? { side, item } : null;

  function addItem(nextPayload: TradePairingPayload) {
    addToDraft(nextPayload);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1200);
  }

  return (
    <article
      draggable={Boolean(payload)}
      onDragStart={(event) => {
        if (!payload) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          TRADE_PAIRING_MIME,
          encodeTradePairingPayload(payload),
        );
        event.dataTransfer.setData(tradePairingSideMime(side), "1");
      }}
      onDragOver={(event) => {
        if (!payload) return;
        const oppositeSide = side === "offered" ? "requested" : "offered";
        if (
          Array.from(event.dataTransfer.types).includes(
            tradePairingSideMime(oppositeSide),
          )
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setPairing(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPairing(false);
        }
      }}
      onDrop={(event) => {
        setPairing(false);
        if (!payload) return;
        const incoming = parseTradePairingPayload(
          event.dataTransfer.getData(TRADE_PAIRING_MIME),
        );
        if (!incoming || incoming.side === side) return;
        event.preventDefault();
        addItem(incoming);
        addItem(payload);
      }}
      className={cn(
        "relative rounded-lg border bg-zinc-950/70 p-2 transition-all",
        payload
          ? "cursor-grab border-zinc-800 active:cursor-grabbing"
          : "border-zinc-800",
        pairing &&
          "scale-[1.015] border-sky-500 bg-sky-950/35 shadow-lg shadow-sky-950/50",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
          {payload
            ? pairing
              ? "Drop to pair both cards"
              : "Drag to proposal or opposite card"
            : "No exact inventory copy"}
        </span>
        {payload ? (
          <span
            className="select-none text-sm text-zinc-600"
            aria-hidden="true"
          >
            ⠿
          </span>
        ) : null}
      </div>
      {children}
      {payload ? (
        <button
          type="button"
          onClick={() => addItem(payload)}
          className={cn(
            filterPrimaryButtonClass,
            "mt-2 w-full text-center text-xs",
            justAdded && "border-emerald-600 bg-emerald-950 text-emerald-100",
          )}
        >
          {justAdded ? "Added to proposal" : addLabel}
        </button>
      ) : null}
    </article>
  );
}
