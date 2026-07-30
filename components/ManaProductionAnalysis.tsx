"use client";

import { useMemo, useState } from "react";
import {
  analyzeManaProduction,
  type ManaProductionColor,
} from "@/lib/deck-analysis";
import type { DeckSnapshotEntry } from "@/lib/deck-snapshot";
import { ManaSymbol } from "./mtg/ManaSymbol";
import { cn } from "./filterStyles";

const colorPresentation: Record<
  ManaProductionColor,
  { label: string; bar: string; selected: string }
> = {
  W: {
    label: "White",
    bar: "bg-amber-100",
    selected: "border-amber-200 bg-amber-950/20",
  },
  U: {
    label: "Blue",
    bar: "bg-sky-400",
    selected: "border-sky-400 bg-sky-950/30",
  },
  B: {
    label: "Black",
    bar: "bg-stone-400",
    selected: "border-stone-400 bg-stone-900",
  },
  R: {
    label: "Red",
    bar: "bg-red-400",
    selected: "border-red-400 bg-red-950/30",
  },
  G: {
    label: "Green",
    bar: "bg-emerald-400",
    selected: "border-emerald-400 bg-emerald-950/30",
  },
  C: {
    label: "Colorless",
    bar: "bg-violet-400",
    selected: "border-violet-400 bg-violet-950/30",
  },
};

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function barWidth(value: number) {
  return `${Math.min(100, Math.max(0, value))}%`;
}

export function ManaProductionAnalysis({
  cards,
  includeCommanders,
}: {
  cards: DeckSnapshotEntry[];
  includeCommanders: boolean;
}) {
  const [selectedColor, setSelectedColor] =
    useState<ManaProductionColor | null>(null);
  const analysis = useMemo(
    () => analyzeManaProduction(cards, includeCommanders),
    [cards, includeCommanders],
  );
  const selected = analysis.colors.find(
    (color) => color.color === selectedColor,
  );
  const warnings = analysis.colors.filter((color) => color.warning);

  return (
    <section className="app-panel space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-100">
            Mana demand and land production
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">
            Compare colored symbols in spell costs with lands that can
            potentially produce each color. Select a color to inspect its
            contributing cards.
          </p>
        </div>
        <div className="flex gap-4 text-right text-xs text-stone-500">
          <span>
            <strong className="block text-base text-stone-100">
              {analysis.totalDemandSymbols}
            </strong>
            represented pips
          </span>
          <span>
            <strong className="block text-base text-stone-100">
              {analysis.landQuantity}
            </strong>
            land cards
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {analysis.colors.map((color) => {
          const presentation = colorPresentation[color.color];
          const isSelected = selectedColor === color.color;
          return (
            <button
              key={color.color}
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                setSelectedColor((current) =>
                  current === color.color ? null : color.color,
                )
              }
              className={cn(
                "rounded-md border border-[#2a332d] bg-[#0d1210] p-2.5 text-left transition hover:border-stone-500 focus:outline-none focus:ring-2 focus:ring-cyan-500",
                isSelected && presentation.selected,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium text-stone-100">
                  <ManaSymbol token={color.color} ariaHidden />
                  {presentation.label}
                </span>
                {color.warning ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                    Review
                  </span>
                ) : null}
              </div>
              <div className="mt-2 space-y-1.5">
                <DistributionBar
                  label="Demand"
                  value={color.demandPercent}
                  detail={`${color.fixedDemand} fixed${
                    color.flexibleDemand
                      ? ` + ${color.flexibleDemand} flexible`
                      : ""
                  }`}
                  barClass={presentation.bar}
                />
                <DistributionBar
                  label="Land sources"
                  value={color.sourcePercent}
                  detail={`${color.sourceCount} cards`}
                  barClass="bg-cyan-400"
                />
              </div>
            </button>
          );
        })}
      </div>

      {analysis.incomplete ? (
        <p className="rounded-md border border-amber-900 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          Land-production data is incomplete for{" "}
          {analysis.missingProductionQuantity}{" "}
          {analysis.missingProductionQuantity === 1 ? "card" : "cards"}. Refresh
          cached card metadata to include those lands before treating this
          comparison as complete.
        </p>
      ) : null}

      {analysis.snowDemand ? (
        <p className="rounded-md border border-sky-900 bg-sky-950/20 px-3 py-2 text-sm text-sky-100">
          This deck contains {analysis.snowDemand} explicit snow-mana{" "}
          {analysis.snowDemand === 1 ? "symbol" : "symbols"}. Snow payment is
          shown separately because Scryfall production colors do not establish
          whether a source is snow.
        </p>
      ) : null}

      {warnings.length ? (
        <div className="rounded-md border border-amber-900 bg-amber-950/10 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Conservative source warnings
          </p>
          <ul className="mt-1 space-y-1 text-sm text-amber-100">
            {warnings.map((color) => (
              <li key={color.color}>{color.warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-[#2a332d] bg-[#0d1210] p-3">
        {!selected ? (
          <p className="text-sm text-stone-400">
            Select a color above to reveal the spells demanding it and the lands
            capable of producing it.
          </p>
        ) : (
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-stone-100">
              <ManaSymbol token={selected.color} ariaHidden />
              {colorPresentation[selected.color].label} contributors
            </h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <ContributorList
                title="Demanding spells"
                empty="No included spells demand this color."
                cards={selected.spells}
              />
              <ContributorList
                title="Potential land sources"
                empty="No included lands are known to produce this color."
                cards={selected.lands}
              />
            </div>
          </div>
        )}
      </div>

      <details className="rounded-md border border-[#2a332d] bg-[#0d1210]">
        <summary className="cursor-pointer px-3 py-2 text-xs text-cyan-100">
          How this comparison works
        </summary>
        <p className="border-t border-[#2a332d] px-3 py-2 text-xs leading-5 text-stone-500">
          Hybrid, Phyrexian, two-brid, and alternate-face symbols are marked as
          flexible demand and appear under each possible color. Generic mana is
          excluded; explicit colorless mana is counted as C. Multicolor lands
          count as a potential source for every supported color, so percentages
          may not add to 100%. Mana rocks, creatures, Treasures, conditional
          usability, and tapped timing are not included.
        </p>
      </details>
    </section>
  );
}

function DistributionBar({
  label,
  value,
  detail,
  barClass,
}: {
  label: string;
  value: number;
  detail: string;
  barClass: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-stone-400">{label}</span>
        <span className="text-stone-200">
          {percent(value)}{" "}
          <span className="text-[10px] text-stone-500">{detail}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-800">
        <div
          className={cn("h-full rounded-full", barClass)}
          style={{ width: barWidth(value) }}
        />
      </div>
    </div>
  );
}

function ContributorList({
  title,
  empty,
  cards,
}: {
  title: string;
  empty: string;
  cards: Array<{
    id: string;
    cardName: string;
    quantity: number;
    detail: string;
  }>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </p>
      {cards.length ? (
        <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto pr-1">
          {cards
            .slice()
            .sort((left, right) => left.cardName.localeCompare(right.cardName))
            .map((card) => (
              <li
                key={card.id}
                className="flex items-start justify-between gap-3 rounded bg-black/15 px-2 py-1.5 text-sm"
              >
                <span className="font-medium text-stone-200">
                  {card.quantity}× {card.cardName}
                </span>
                <span className="max-w-[55%] text-right text-xs text-stone-500">
                  {card.detail}
                </span>
              </li>
            ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-stone-500">{empty}</p>
      )}
    </div>
  );
}
