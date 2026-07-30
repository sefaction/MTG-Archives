"use client";

import { useMemo, useState } from "react";
import { getInventoryCardImagePair } from "@/lib/inventory-card-images";
import {
  createSampleHandState,
  drawSampleHandCard,
  isCastableSampleSpell,
  isLandCapableSampleCard,
  keepSampleHand,
  mulliganSampleHand,
  requiredMulliganBottomCount,
  summarizeSampleHand,
  type HandColor,
  type SimulatedDeckCard,
} from "@/lib/sample-hands";
import type { DeckSnapshotEntry } from "@/lib/deck-snapshot";
import { CardManaCost } from "./mtg/CardManaCost";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterPrimaryButtonClass,
} from "./filterStyles";

const colorLabels: Record<HandColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const colorClasses: Record<HandColor, string> = {
  W: "border-amber-100/40 bg-amber-50/10 text-amber-50",
  U: "border-sky-600 bg-sky-950/40 text-sky-100",
  B: "border-stone-500 bg-stone-950 text-stone-100",
  R: "border-red-700 bg-red-950/40 text-red-100",
  G: "border-emerald-700 bg-emerald-950/40 text-emerald-100",
  C: "border-zinc-600 bg-zinc-900 text-zinc-200",
};

function numberLabel(value: number | null) {
  return value == null ? "—" : value.toFixed(2).replace(/\.?0+$/, "");
}

function randomSeed() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cardManaCost(card: SimulatedDeckCard) {
  return {
    manaCost: card.entry.card?.manaCost,
    manaFaces: card.entry.card?.cardFaces.map((face) => ({
      name: face.name,
      manaCost: face.manaCost,
    })),
    layout: card.entry.card?.layout,
  };
}

function SampleHandCardImage({ card }: { card: SimulatedDeckCard }) {
  const [showBack, setShowBack] = useState(false);
  const images = getInventoryCardImagePair({
    layout: card.entry.card?.layout,
    imageUri: card.entry.card?.imageUri,
    imageSmall: card.entry.card?.imageUris.small,
    cardFaces: card.entry.card?.cardFaces,
  });
  const image = showBack && images.back ? images.back : images.front;

  return (
    <div className="space-y-1.5">
      {image ? (
        <img
          src={image}
          alt={`${card.entry.cardName}${showBack ? " back face" : ""}`}
          className="aspect-[488/680] w-full rounded-lg object-cover shadow-lg shadow-black/30"
          loading="lazy"
          decoding="async"
          width={488}
          height={680}
        />
      ) : (
        <div className="flex aspect-[488/680] items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control)] p-3 text-center text-xs text-[var(--app-muted)]">
          No card image
        </div>
      )}
      {images.back ? (
        <button
          type="button"
          className="w-full text-center text-xs text-[var(--app-link)] hover:text-[var(--app-link-hover)]"
          onClick={() => setShowBack((current) => !current)}
        >
          {showBack ? "Show front face" : "Show back face"}
        </button>
      ) : null}
    </div>
  );
}

function SampleHandCardView({
  card,
  selectable = false,
  selected = false,
  onToggle,
}: {
  card: SimulatedDeckCard;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const landCapable = isLandCapableSampleCard(card);
  const castableSpell = isCastableSampleSpell(card);
  return (
    <article
      className={cn(
        "app-card relative min-w-0 p-1.5",
        selected && "border-cyan-400 bg-cyan-950/30 ring-2 ring-cyan-400/60",
      )}
    >
      {selectable ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? "Remove" : "Select"} ${card.entry.cardName} for mulligan bottom`}
          onClick={onToggle}
          className={cn(
            "mb-1.5 w-full rounded border px-1.5 py-1 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--app-focus)]",
            selected
              ? "border-cyan-400 bg-cyan-900/60 text-cyan-50"
              : "border-[var(--app-border)] bg-[var(--app-control)] text-[var(--app-muted)] hover:border-[var(--app-border-strong)]",
          )}
        >
          {selected ? "Selected for bottom" : "Select for bottom"}
        </button>
      ) : null}
      <SampleHandCardImage card={card} />
      <div className="mt-1.5 min-w-0">
        <div className="flex min-h-5 items-start justify-between gap-1.5">
          <p className="truncate text-xs font-semibold text-[var(--app-text)]">
            {card.entry.cardName}
          </p>
          <CardManaCost card={cardManaCost(card)} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {landCapable ? (
            <span className="rounded-full border border-emerald-800 bg-emerald-950/30 px-1.5 py-px text-[9px] text-emerald-100">
              Land
            </span>
          ) : null}
          {castableSpell ? (
            <span className="rounded-full border border-amber-800 bg-amber-950/30 px-1.5 py-px text-[9px] text-amber-100">
              Spell
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function SampleHands({
  cards,
  initialSeed,
}: {
  cards: DeckSnapshotEntry[];
  initialSeed: string;
}) {
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [state, setState] = useState(() =>
    createSampleHandState(cards, initialSeed),
  );
  const [selectedForBottom, setSelectedForBottom] = useState<Set<string>>(
    new Set(),
  );
  const [message, setMessage] = useState("");
  const summary = useMemo(() => summarizeSampleHand(state), [state]);
  const requiredBottom = requiredMulliganBottomCount(state);
  const selectingForBottom = !state.kept && requiredBottom > 0;
  const selectedCount = selectedForBottom.size;

  function deal(seed: string) {
    const normalized = seed.trim() || randomSeed();
    setSeedInput(normalized);
    setState(createSampleHandState(cards, normalized));
    setSelectedForBottom(new Set());
    setMessage("");
  }

  function takeMulligan() {
    setState((current) => mulliganSampleHand(current));
    setSelectedForBottom(new Set());
    setMessage("");
  }

  function toggleBottomSelection(instanceId: string) {
    setSelectedForBottom((current) => {
      const next = new Set(current);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else if (next.size < requiredBottom) {
        next.add(instanceId);
      }
      return next;
    });
    setMessage("");
  }

  function keepCurrentHand() {
    try {
      setState((current) => keepSampleHand(current, selectedForBottom));
      setSelectedForBottom(new Set());
      setMessage("Hand kept. You can now draw individual cards.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to keep this hand.",
      );
    }
  }

  function drawNextCard() {
    try {
      const wasKept = state.kept;
      const keptState = wasKept
        ? state
        : keepSampleHand(state, selectedForBottom);
      const nextState = drawSampleHandCard(keptState);
      setState(nextState);
      setSelectedForBottom(new Set());
      setMessage(
        nextState === keptState
          ? "There are no cards left to draw."
          : wasKept
            ? "Drew the next card."
            : "Opening hand kept. Drew the first card.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to draw a card.",
      );
    }
  }

  const status = state.kept
    ? state.mulliganCount
      ? `Kept after ${state.mulliganCount} ${state.mulliganCount === 1 ? "mulligan" : "mulligans"}`
      : "Hand kept"
    : state.mulliganCount
      ? `Mulligan ${state.mulliganCount}: choose ${requiredBottom} ${requiredBottom === 1 ? "card" : "cards"} to put on the bottom`
      : "Opening seven";

  return (
    <div className="space-y-3">
      <section className="app-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-[var(--app-text)]">
              {status}
            </h2>
            <p className="text-xs text-[var(--app-muted)]">
              {state.library.length} cards remain in the library
              {state.bottomedInstanceIds.length
                ? ` · ${state.bottomedInstanceIds.length} on the bottom`
                : ""}
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!state.kept ? (
              <>
                <button
                  type="button"
                  onClick={takeMulligan}
                  disabled={summary.librarySize === 0}
                  className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
                >
                  Mulligan
                </button>
                <button
                  type="button"
                  onClick={keepCurrentHand}
                  disabled={
                    selectingForBottom && selectedCount !== requiredBottom
                  }
                  className={cn(
                    filterPrimaryButtonClass,
                    "px-2.5 py-1.5 text-xs",
                  )}
                >
                  {requiredBottom
                    ? `Keep and bottom ${requiredBottom}`
                    : "Keep hand"}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={drawNextCard}
              disabled={
                state.library.length === 0 ||
                (selectingForBottom && selectedCount !== requiredBottom)
              }
              className={cn(
                state.kept ? filterPrimaryButtonClass : filterButtonClass,
                "px-2.5 py-1.5 text-xs",
              )}
            >
              Draw card
            </button>
            <button
              type="button"
              onClick={() => deal(randomSeed())}
              className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
            >
              Draw another hand
            </button>
          </div>
        </div>

        {selectingForBottom ? (
          <p className="mt-2 rounded border border-cyan-900 bg-cyan-950/20 px-2.5 py-1.5 text-xs text-cyan-100">
            Select exactly {requiredBottom}{" "}
            {requiredBottom === 1 ? "card" : "cards"} below. Selected cards will
            be placed on the bottom in their current hand order.
          </p>
        ) : null}
        {summary.librarySize > 0 && summary.librarySize < 7 ? (
          <p className="mt-2 rounded border border-amber-900 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-100">
            This mainboard has only {summary.librarySize} cards, so the
            simulation deals every available card instead of seven.
          </p>
        ) : null}
        {summary.librarySize === 0 ? (
          <p className="mt-2 rounded border border-amber-900 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-100">
            This deck has no mainboard cards to shuffle. Add cards in the
            Builder to deal a sample hand.
          </p>
        ) : null}
        {message ? (
          <p
            className="mt-2 text-xs text-[var(--app-muted)]"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        <details className="mt-2 rounded border border-[var(--app-border)] bg-[var(--app-control)]">
          <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-[var(--app-link)]">
            Reproduce a hand with a seed
          </summary>
          <form
            className="flex flex-col gap-2 border-t border-[var(--app-border)] p-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              deal(seedInput);
            }}
          >
            <label className="min-w-0 flex-1 text-xs font-medium text-[var(--app-text)]">
              Simulation seed
              <input
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                className={cn(filterInputClass, "mt-1 w-full py-1 text-xs")}
              />
            </label>
            <button
              type="submit"
              className={cn(
                filterButtonClass,
                "self-end px-2.5 py-1.5 text-xs",
              )}
            >
              Deal seeded hand
            </button>
          </form>
        </details>
      </section>

      <section
        className="app-panel grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6"
        aria-label="Current hand summary"
      >
        {[
          [
            "Cards in hand",
            summary.handSize,
            state.kept ? "kept hand" : "seven-card draw",
          ],
          ["Land options", summary.landCapable, "includes land faces"],
          ["Spell options", summary.castableSpells, "includes spell faces"],
          [
            "Average spell mana value",
            numberLabel(summary.averageSpellManaValue),
            "land-only cards excluded",
          ],
          [
            "Expected lands",
            numberLabel(summary.expectedLandsInOpeningHand),
            `${summary.landCapableInLibrary} of ${summary.librarySize} cards`,
          ],
        ].map(([label, value, detail]) => (
          <div
            key={String(label)}
            className="min-w-0 border-b border-r border-[var(--app-border)] px-2.5 py-1.5 xl:border-b-0"
          >
            <p className="truncate text-[9px] uppercase tracking-wide text-[var(--app-muted)]">
              {label}
            </p>
            <div className="flex items-baseline gap-1.5">
              <p className="text-base font-semibold text-[var(--app-text)]">
                {value}
              </p>
              <p className="truncate text-[9px] text-[var(--app-muted)]">
                {detail}
              </p>
            </div>
          </div>
        ))}
        <div className="min-w-0 border-b border-[var(--app-border)] px-2.5 py-1.5 xl:border-b-0">
          <p className="text-[9px] uppercase tracking-wide text-[var(--app-muted)]">
            Hand colors
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.keys(colorLabels) as HandColor[])
              .filter((color) => summary.colorCounts[color] > 0)
              .map((color) => (
                <span
                  key={color}
                  title={colorLabels[color]}
                  className={cn(
                    "rounded-full border px-1.5 py-px text-[10px] font-semibold",
                    colorClasses[color],
                  )}
                >
                  {color} {summary.colorCounts[color]}
                </span>
              ))}
            {summary.handSize === 0 ? (
              <span className="text-xs text-[var(--app-muted)]">—</span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="app-panel min-w-0 p-3" aria-label="Sample hand cards">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-[var(--app-text)]">
              {state.kept ? "Current hand" : "Sample hand"}
            </h2>
            <p className="text-xs text-[var(--app-muted)]">
              Modal spell/land cards count in both summary categories.
            </p>
          </div>
          {selectingForBottom ? (
            <p className="text-xs font-medium text-cyan-100">
              Selected {selectedCount} of {requiredBottom}
            </p>
          ) : null}
        </div>
        {state.hand.length ? (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {state.hand.map((card) => (
              <SampleHandCardView
                key={card.instanceId}
                card={card}
                selectable={selectingForBottom}
                selected={selectedForBottom.has(card.instanceId)}
                onToggle={() => toggleBottomSelection(card.instanceId)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded border border-dashed border-[var(--app-border)] p-5 text-center text-xs text-[var(--app-muted)]">
            No cards are currently in hand.
          </div>
        )}
      </section>
    </div>
  );
}
