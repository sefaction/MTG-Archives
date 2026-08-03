"use client";

import { useState, type ReactNode } from "react";
import { cn, filterButtonClass } from "@/components/filterStyles";

export type TradeCardSummary = {
  id: string;
  name: string;
  imageUri?: string;
  setCode?: string;
  collectorNumber?: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
  colorIdentity?: unknown;
  rarity?: string;
  condition?: string;
  foilStatus?: string;
  quantity?: number;
  ownerLabel?: string;
  roleLabel?: string;
  priceLabel?: string;
  priceAmount?: number | null;
  priceProvider?: string;
  notes?: string;
};

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | number;
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="text-zinc-100">{value}</div>
    </div>
  );
}

export function TradeCardPreview({
  card,
  compact = false,
  variant = "row",
  drawerActions,
}: {
  card: TradeCardSummary;
  compact?: boolean;
  variant?: "row" | "spoiler" | "text";
  drawerActions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const setLabel = [
    card.setCode ? card.setCode.toUpperCase() : "",
    card.collectorNumber ? `#${card.collectorNumber}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const treatment = [card.foilStatus, card.condition]
    .filter(Boolean)
    .join(" / ");

  return (
    <>
      {variant === "text" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block max-w-md text-left hover:text-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-700"
          aria-label={`Open details for ${card.name}`}
        >
          <span className="block truncate font-medium text-zinc-100">
            {card.name}
          </span>
          <span className="block truncate text-xs text-zinc-400">
            {[setLabel, treatment].filter(Boolean).join(" / ")}
          </span>
        </button>
      ) : variant === "spoiler" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group block w-full rounded border border-zinc-800 bg-zinc-950/60 p-2 text-left transition-colors hover:border-sky-700 hover:bg-zinc-900/80"
          aria-label={`Open details for ${card.name}`}
        >
          <span className="block overflow-hidden rounded">
            {card.imageUri ? (
              <img
                src={card.imageUri}
                alt=""
                className="aspect-[63/88] w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
            ) : (
              <span className="flex aspect-[63/88] w-full items-center justify-center rounded border border-zinc-800 text-xs text-zinc-500">
                No image
              </span>
            )}
          </span>
          <span className="mt-2 block truncate text-sm font-medium text-zinc-100">
            {card.name}
          </span>
          <span className="block truncate text-xs text-zinc-400">
            {[setLabel, treatment].filter(Boolean).join(" / ")}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "grid w-full grid-cols-[3.2rem_1fr] items-center gap-3 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-left transition-colors hover:border-sky-700 hover:bg-zinc-900/80",
            compact ? "grid-cols-[2.6rem_1fr]" : "",
          )}
          aria-label={`Open details for ${card.name}`}
        >
          {card.imageUri ? (
            <img
              src={card.imageUri}
              alt=""
              className={cn(
                "h-20 w-[3.2rem] rounded object-cover",
                compact && "h-14 w-[2.6rem]",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex h-20 w-[3.2rem] items-center justify-center rounded border border-zinc-800 text-xs text-zinc-500",
                compact && "h-14 w-[2.6rem]",
              )}
            >
              No image
            </div>
          )}
          <span className="min-w-0">
            {card.roleLabel ? (
              <span className="block text-xs uppercase text-zinc-500">
                {card.roleLabel}
              </span>
            ) : null}
            <span className="block truncate font-medium text-zinc-100">
              {card.name}
            </span>
            <span className="block truncate text-xs text-zinc-400">
              {[
                card.quantity ? `Qty ${card.quantity}` : "",
                setLabel,
                treatment,
                card.ownerLabel,
              ]
                .filter(Boolean)
                .join(" / ")}
            </span>
          </span>
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/55"
          onClick={() => setOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-sky-100">{card.name}</h2>
                <p className="text-sm text-zinc-400">
                  {[card.roleLabel, card.ownerLabel]
                    .filter(Boolean)
                    .join(" / ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(filterButtonClass, "px-3 py-1")}
              >
                Close
              </button>
            </div>

            {drawerActions ? (
              <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                {drawerActions}
              </section>
            ) : null}

            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
                {card.imageUri ? (
                  <img
                    src={card.imageUri}
                    alt={card.name}
                    className="w-full rounded"
                  />
                ) : (
                  <div className="flex aspect-[63/88] items-center justify-center text-sm text-zinc-500">
                    No image
                  </div>
                )}
              </div>
              <div className="space-y-4 text-sm">
                <section className="rounded border border-zinc-800 bg-zinc-950/70">
                  <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2 font-semibold">
                    Card
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-3">
                    <DetailRow label="Set" value={setLabel} />
                    <DetailRow label="Rarity" value={card.rarity} />
                    <DetailRow label="Mana cost" value={card.manaCost} />
                    <DetailRow label="Type" value={card.typeLine} />
                  </div>
                  {card.oracleText ? (
                    <div className="border-t border-zinc-800 p-3 leading-relaxed text-zinc-200">
                      {card.oracleText}
                    </div>
                  ) : null}
                </section>

                <section className="rounded border border-zinc-800 bg-zinc-950/70">
                  <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2 font-semibold">
                    Inventory
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-3">
                    <DetailRow label="Owner" value={card.ownerLabel} />
                    <DetailRow label="Quantity" value={card.quantity} />
                    <DetailRow label="Condition" value={card.condition} />
                    <DetailRow label="Finish" value={card.foilStatus} />
                    <DetailRow label="Price" value={card.priceLabel} />
                  </div>
                  {card.notes ? (
                    <div className="border-t border-zinc-800 p-3 text-zinc-300">
                      {card.notes}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
