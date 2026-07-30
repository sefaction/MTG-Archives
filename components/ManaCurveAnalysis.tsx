"use client";

import { useMemo, useState } from "react";
import { DeckSection } from "@prisma/client";
import { analyzeManaCurve, type ManaCurveBucket } from "@/lib/deck-analysis";
import type { DeckSnapshotEntry } from "@/lib/deck-snapshot";
import { getInventoryCardImagePair } from "@/lib/inventory-card-images";
import { CardManaCost } from "./mtg/CardManaCost";
import { ManaProductionAnalysis } from "./ManaProductionAnalysis";
import { cn, filterFieldClass, filterSelectClass } from "./filterStyles";

type AnalysisCardView = "compact" | "table" | "grid" | "spoiler";

const cardViews: Array<{ value: AnalysisCardView; label: string }> = [
  { value: "compact", label: "Compact text" },
  { value: "table", label: "Detailed table" },
  { value: "grid", label: "Visual grid" },
  { value: "spoiler", label: "Visual spoiler" },
];

function numberLabel(value: number | null, digits = 2) {
  return value == null ? "—" : value.toFixed(digits).replace(/\.?0+$/, "");
}

export function ManaCurveAnalysis({
  cards,
  hasCommanders,
}: {
  cards: DeckSnapshotEntry[];
  hasCommanders: boolean;
}) {
  const [includeCommanders, setIncludeCommanders] = useState(true);
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [cardView, setCardView] = useState<AnalysisCardView>("compact");
  const analysis = useMemo(
    () => analyzeManaCurve(cards, includeCommanders),
    [cards, includeCommanders],
  );
  const selected = analysis.buckets.find(
    (bucket) => bucket.key === selectedBucket,
  );
  const maximum = Math.max(
    1,
    ...analysis.buckets.map((bucket) => bucket.totalQuantity),
  );
  const chartTicks = Array.from(
    new Set([0, Math.ceil(maximum / 2), maximum]),
  ).sort((left, right) => left - right);
  const chartWidth = Math.max(640, analysis.buckets.length * 58 + 96);
  const chartHeight = 220;
  const baseline = 170;
  const usableHeight = 120;
  const barWidth = 34;
  const gap = (chartWidth - 96) / analysis.buckets.length;

  function selectBucket(key: number) {
    setSelectedBucket((current) => (current === key ? null : key));
  }

  return (
    <div className="space-y-3">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {[
          [
            "Average mana value",
            numberLabel(analysis.averageWithLands),
            "with lands",
          ],
          [
            "Average mana value",
            numberLabel(analysis.averageWithoutLands),
            "without lands",
          ],
          [
            "Median mana value",
            numberLabel(analysis.medianManaValue),
            "nonland cards",
          ],
          [
            "Total mana value",
            numberLabel(analysis.totalManaValue, 0),
            `${analysis.spellQuantity} spells`,
          ],
          [
            "Analyzed cards",
            String(analysis.countedQuantity),
            `${analysis.landQuantity} lands`,
          ],
        ].map(([label, value, detail]) => (
          <div
            key={`${label}-${detail}`}
            className="rounded-md border border-[#2a332d] bg-[#101614] px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-wide text-stone-500">
              {label}
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <p className="text-lg font-semibold text-stone-50">{value}</p>
              <p className="text-[11px] text-stone-500">{detail}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.95fr)]">
        <section
          className="app-panel min-w-0 space-y-3 p-3"
          aria-label="Mana curve chart"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-100">
                Mana curve
              </h2>
              <p className="mt-1 text-sm text-stone-400">
                Select a bar to inspect the cards at that mana value.
              </p>
            </div>
            {hasCommanders ? (
              <label className="flex items-center gap-2 rounded-md border border-[#2a332d] bg-[#0d1210] px-3 py-2 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={includeCommanders}
                  onChange={(event) => {
                    setIncludeCommanders(event.target.checked);
                    setSelectedBucket(null);
                  }}
                  className="accent-cyan-500"
                />
                Include commander
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-stone-300">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-400" />
              Permanents
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-amber-300" />
              Nonpermanent spells
            </span>
            <span className="text-stone-500">Lands are omitted from bars.</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#252e29] bg-[#0a0e0c]">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="h-[220px] min-w-[640px] w-full"
              role="img"
              aria-labelledby="mana-curve-title mana-curve-description"
            >
              <title id="mana-curve-title">Deck mana curve</title>
              <desc id="mana-curve-description">
                Quantity of permanents and nonpermanent spells at each mana
                value. Each bar is keyboard selectable.
              </desc>
              {chartTicks.map((tick) => {
                const y = baseline - usableHeight * (tick / maximum);
                return (
                  <g key={tick}>
                    <line
                      x1="56"
                      y1={y}
                      x2={chartWidth - 24}
                      y2={y}
                      stroke="#26312b"
                      strokeWidth="1"
                    />
                    <text
                      x="48"
                      y={y + 4}
                      textAnchor="end"
                      fill="#8f9992"
                      fontSize="11"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}
              {analysis.buckets.map((bucket, index) => {
                const permanentHeight =
                  (bucket.permanentQuantity / maximum) * usableHeight;
                const spellHeight =
                  (bucket.spellQuantity / maximum) * usableHeight;
                const x = 72 + index * gap;
                const permanentY = baseline - permanentHeight;
                const spellY = permanentY - spellHeight;
                const isSelected = selectedBucket === bucket.key;
                return (
                  <g
                    key={bucket.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${bucket.label} mana: ${bucket.totalQuantity} cards`}
                    aria-pressed={isSelected}
                    onClick={() => selectBucket(bucket.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectBucket(bucket.key);
                      }
                    }}
                    className="cursor-pointer outline-none"
                  >
                    <rect
                      x={x - 5}
                      y={40}
                      width={barWidth + 10}
                      height={baseline - 40}
                      rx="4"
                      fill={isSelected ? "#113b3d" : "transparent"}
                      stroke={isSelected ? "#22d3ee" : "transparent"}
                      strokeWidth="2"
                    />
                    <rect
                      x={x}
                      y={permanentY}
                      width={barWidth}
                      height={permanentHeight}
                      rx="2"
                      fill="#34d399"
                    />
                    <rect
                      x={x}
                      y={spellY}
                      width={barWidth}
                      height={spellHeight}
                      rx="2"
                      fill="#fcd34d"
                    />
                    {bucket.totalQuantity ? (
                      <text
                        x={x + barWidth / 2}
                        y={Math.max(32, spellY - 7)}
                        textAnchor="middle"
                        fill="#e7ece9"
                        fontSize="12"
                        fontWeight="600"
                      >
                        {bucket.totalQuantity}
                      </text>
                    ) : null}
                    <text
                      x={x + barWidth / 2}
                      y={baseline + 24}
                      textAnchor="middle"
                      fill="#c0c8c2"
                      fontSize="12"
                    >
                      {bucket.label}
                    </text>
                  </g>
                );
              })}
              <text
                x={chartWidth / 2}
                y={210}
                textAnchor="middle"
                fill="#8f9992"
                fontSize="12"
              >
                Mana value
              </text>
            </svg>
          </div>

          <details className="rounded-md border border-[#2a332d] bg-[#0d1210]">
            <summary className="cursor-pointer px-3 py-2 text-sm text-cyan-100">
              Accessible curve table
            </summary>
            <div className="overflow-x-auto border-t border-[#2a332d]">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Mana value</th>
                    <th className="px-3 py-2">Permanents</th>
                    <th className="px-3 py-2">Spells</th>
                    <th className="px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.buckets.map((bucket) => (
                    <tr key={bucket.key} className="border-t border-[#252e29]">
                      <th className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => selectBucket(bucket.key)}
                          aria-pressed={selectedBucket === bucket.key}
                          className="text-cyan-200 underline-offset-4 hover:underline"
                        >
                          {bucket.label}
                        </button>
                      </th>
                      <td className="px-3 py-2">{bucket.permanentQuantity}</td>
                      <td className="px-3 py-2">{bucket.spellQuantity}</td>
                      <td className="px-3 py-2">{bucket.totalQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section
          className="app-panel min-w-0 p-3 xl:sticky xl:top-3"
          aria-label="Mana curve selection"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-stone-100">
              {selected
                ? `${selected.label} mana cards (${selected.totalQuantity})`
                : "Curve selection"}
            </h2>
            {selected?.cards.length ? (
              <label className={filterFieldClass}>
                Card view
                <select
                  value={cardView}
                  onChange={(event) =>
                    setCardView(event.target.value as AnalysisCardView)
                  }
                  className={cn(filterSelectClass, "ml-2")}
                >
                  {cardViews.map((view) => (
                    <option key={view.value} value={view.value}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {!selected ? (
            <p className="mt-2 text-sm text-stone-400">
              Select a chart bar or table row to see the cards behind it.
            </p>
          ) : selected.cards.length ? (
            <SelectedManaCurveCards
              bucket={selected}
              cards={cards}
              view={cardView}
            />
          ) : (
            <p className="mt-2 text-sm text-stone-400">
              No cards occupy this mana value.
            </p>
          )}
        </section>
      </div>

      <ManaProductionAnalysis
        cards={cards}
        includeCommanders={includeCommanders}
      />

      {analysis.unresolvedQuantity ? (
        <p className="rounded-md border border-amber-900 bg-amber-950/20 p-3 text-sm text-amber-100">
          {analysis.unresolvedQuantity} deck-list cards are missing resolved
          printing metadata and are not included in the statistics.
        </p>
      ) : null}
    </div>
  );
}

function selectedCardRows(bucket: ManaCurveBucket, cards: DeckSnapshotEntry[]) {
  return bucket.cards
    .slice()
    .sort((left, right) => left.cardName.localeCompare(right.cardName))
    .map((curveCard) => ({
      curveCard,
      source: cards.find((entry) => entry.id === curveCard.id),
    }));
}

function cardManaCost(entry?: DeckSnapshotEntry) {
  return {
    manaCost: entry?.card?.manaCost,
    manaFaces: entry?.card?.cardFaces.map((face) => ({
      name: face.name,
      manaCost: face.manaCost,
    })),
    layout: entry?.card?.layout,
  };
}

function AnalysisCardImage({
  entry,
  className,
}: {
  entry?: DeckSnapshotEntry;
  className?: string;
}) {
  const [showBack, setShowBack] = useState(false);
  const images = getInventoryCardImagePair({
    layout: entry?.card?.layout,
    imageUri: entry?.card?.imageUri,
    imageSmall: entry?.card?.imageUris.small,
    cardFaces: entry?.card?.cardFaces,
  });
  const image = showBack && images.back ? images.back : images.front;
  if (!image) {
    return (
      <div
        className={cn(
          "flex aspect-[488/680] items-center justify-center rounded-lg border border-[#2a332d] bg-[#0a0e0c] p-3 text-center text-xs text-stone-500",
          className,
        )}
      >
        No card image
      </div>
    );
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <img
        src={image}
        alt={`${entry?.cardName ?? "Card"}${showBack ? " back face" : ""}`}
        className="aspect-[488/680] w-full rounded-lg object-cover shadow-lg shadow-black/30"
        loading="lazy"
      />
      {images.back ? (
        <button
          type="button"
          className="w-full text-center text-xs text-cyan-300 hover:text-cyan-100"
          onClick={() => setShowBack((current) => !current)}
        >
          {showBack ? "Show front face" : "Show back face"}
        </button>
      ) : null}
    </div>
  );
}

function CardSectionLabel({ entry }: { entry?: DeckSnapshotEntry }) {
  if (entry?.section === DeckSection.COMMANDER) {
    return <span className="text-xs text-amber-200">Commander</span>;
  }
  return <span className="text-xs text-stone-500">Mainboard</span>;
}

function SelectedManaCurveCards({
  bucket,
  cards,
  view,
}: {
  bucket: ManaCurveBucket;
  cards: DeckSnapshotEntry[];
  view: AnalysisCardView;
}) {
  const rows = selectedCardRows(bucket, cards);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview =
    rows.find(({ curveCard }) => curveCard.id === previewId) ?? rows[0];

  if (view === "table") {
    return (
      <div className="mt-3 overflow-x-auto rounded-md border border-[#2a332d]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0d1210] text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Mana cost</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2">Printing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ curveCard, source }) => (
              <tr
                key={curveCard.id}
                className="border-t border-[#252e29] text-stone-300"
              >
                <td className="px-3 py-2">{curveCard.quantity}</td>
                <th className="px-3 py-2 font-medium text-stone-100">
                  {curveCard.cardName}
                </th>
                <td className="px-3 py-2">
                  <CardManaCost card={cardManaCost(source)} />
                </td>
                <td className="max-w-xs px-3 py-2 text-xs">
                  {curveCard.typeLine}
                </td>
                <td className="px-3 py-2">
                  <CardSectionLabel entry={source} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-stone-500">
                  {source?.card
                    ? `${source.card.setCode.toUpperCase()} #${source.card.collectorNumber}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === "grid") {
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-2">
        {rows.map(({ curveCard, source }) => (
          <article key={curveCard.id} className="app-card p-2">
            <AnalysisCardImage entry={source} />
            <p className="mt-2 font-medium text-cyan-100">
              {curveCard.quantity}× {curveCard.cardName}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <CardSectionLabel entry={source} />
              <CardManaCost card={cardManaCost(source)} />
            </div>
          </article>
        ))}
      </div>
    );
  }

  if (view === "spoiler") {
    return (
      <div className="mt-3 grid gap-2">
        {rows.map(({ curveCard, source }) => (
          <article
            key={curveCard.id}
            className="app-card grid grid-cols-[8rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <AnalysisCardImage entry={source} />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-cyan-100">
                {curveCard.quantity}× {curveCard.cardName}
              </p>
              <div className="mt-2">
                <CardManaCost card={cardManaCost(source)} showFaceNames />
              </div>
              <p className="mt-3 text-sm text-stone-300">
                {curveCard.typeLine}
              </p>
              <p className="mt-3 text-xs text-stone-500">
                {source?.card
                  ? `${source.card.setCode.toUpperCase()} #${source.card.collectorNumber}`
                  : "Printing unresolved"}
              </p>
              <div className="mt-2">
                <CardSectionLabel entry={source} />
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2 grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <div
        className="max-h-52 space-y-1 overflow-y-auto pr-1"
        aria-label="Compact curve cards"
      >
        {rows.map(({ curveCard, source }) => (
          <button
            key={curveCard.id}
            type="button"
            aria-label={`Preview ${curveCard.cardName}`}
            aria-pressed={preview?.curveCard.id === curveCard.id}
            onMouseEnter={() => setPreviewId(curveCard.id)}
            onFocus={() => setPreviewId(curveCard.id)}
            onClick={() => setPreviewId(curveCard.id)}
            className={cn(
              "flex w-full min-w-0 items-center justify-between gap-2 rounded border px-2 py-1 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-500",
              preview?.curveCard.id === curveCard.id
                ? "border-cyan-700 bg-cyan-950/30"
                : "border-[#2a332d] bg-[#0d1210] hover:border-stone-500",
            )}
          >
            <span className="min-w-0 truncate text-xs font-medium text-stone-100">
              {curveCard.quantity}× {curveCard.cardName}
            </span>
            <span className="shrink-0 text-xs">
              <CardManaCost card={cardManaCost(source)} />
            </span>
          </button>
        ))}
      </div>
      {preview ? (
        <aside
          className="rounded-md border border-[#2a332d] bg-[#0d1210] p-1.5"
          aria-label="Card preview"
        >
          <AnalysisCardImage entry={preview.source} />
          <p className="mt-1 truncate text-center text-[10px] text-stone-400">
            {preview.curveCard.cardName}
          </p>
        </aside>
      ) : null}
    </div>
  );
}
