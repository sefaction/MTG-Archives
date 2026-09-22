"use client";

import {
  useMemo,
  useReducer,
  useState,
  useEffect,
  createContext,
  useContext,
  type DragEvent,
  type ReactNode,
} from "react";
import type { DeckSnapshotEntry } from "@/lib/deck-snapshot";
import { getInventoryCardImagePair } from "@/lib/inventory-card-images";
import {
  PLAYTEST_ZONES,
  createPlaytestHistory,
  playtestHistoryReducer,
  searchPlaytestLibrary,
  type PlaytestCard,
  type PlaytestHistoryAction,
  type PlaytestZone,
} from "@/lib/playtest";
import {
  PLAYTEST_FILE_LIMIT,
  restorePlaytest,
  serializePlaytest,
} from "@/lib/playtest-storage";
import {
  PlaytestAdvancedControls,
  PlaytestCardEditor,
} from "./PlaytestAdvancedControls";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "./filterStyles";

const DRAG_TYPE = "application/x-mtg-archives-playtest-card";
const TableContext = createContext({
  selected: new Set<string>(),
  toggle: (_id: string) => {},
  edit: (_id: string) => {},
  layout: "grid",
  scale: 144,
});

const zoneLabels: Record<PlaytestZone, string> = {
  library: "Library",
  hand: "Hand",
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  commandZone: "Command zone",
  sideboard: "Sideboard",
};

function randomSeed() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function imagePair(card: PlaytestCard) {
  return getInventoryCardImagePair({
    layout: card.entry.card?.layout,
    imageUri: card.entry.card?.imageUri,
    imageSmall: card.entry.card?.imageUris.small,
    cardFaces: card.entry.card?.cardFaces,
  });
}

function displayedName(card: PlaytestCard) {
  return (
    card.entry.card?.cardFaces[card.faceIndex]?.name ?? card.entry.cardName
  );
}

function cardImage(card: PlaytestCard) {
  const images = imagePair(card);
  return card.faceIndex === 1 && images.back ? images.back : images.front;
}

function dispatchMessage(action: PlaytestHistoryAction) {
  switch (action.type) {
    case "DRAW":
      return `Drew ${action.count ?? 1} card${(action.count ?? 1) === 1 ? "" : "s"}.`;
    case "MILL":
      return `Milled ${action.count ?? 1} card${(action.count ?? 1) === 1 ? "" : "s"}.`;
    case "SHUFFLE_LIBRARY":
      return "Shuffled the library.";
    case "UNTAP_ALL_AND_ADVANCE":
      return "Started the next turn and untapped the battlefield.";
    case "RESTART":
      return "Restarted the playtest.";
    case "UNDO":
      return "Undid the previous action.";
    case "REDO":
      return "Redid the next action.";
    default:
      return "";
  }
}

function CardActions({
  card,
  zone,
  dispatch,
}: {
  card: PlaytestCard;
  zone: PlaytestZone;
  dispatch: (action: PlaytestHistoryAction) => void;
}) {
  const [destination, setDestination] = useState<PlaytestZone>(
    zone === "battlefield" ? "graveyard" : "battlefield",
  );

  return (
    <details className="relative">
      <summary
        role="button"
        aria-label={`Card actions for ${displayedName(card)}`}
        className="cursor-pointer rounded border border-[var(--app-border)] bg-[var(--app-control)] px-1.5 py-1 text-center text-[10px] text-[var(--app-link)]"
      >
        Actions
      </summary>
      <div className="relative z-30 mt-1 w-full space-y-1.5 rounded-md border border-[var(--app-border-strong)] bg-[var(--app-surface-2)] p-2 shadow-xl shadow-black/50">
        <label className="block text-[10px] text-[var(--app-muted)]">
          Move to
          <select
            value={destination}
            onChange={(event) =>
              setDestination(event.target.value as PlaytestZone)
            }
            className={cn(filterSelectClass, "mt-1 w-full py-1 text-xs")}
          >
            {PLAYTEST_ZONES.filter((candidate) => candidate !== zone).map(
              (candidate) => (
                <option key={candidate} value={candidate}>
                  {zoneLabels[candidate]}
                </option>
              ),
            )}
          </select>
        </label>
        <button
          type="button"
          className={cn(filterPrimaryButtonClass, "w-full px-2 py-1 text-xs")}
          onClick={() =>
            dispatch({
              type: "MOVE_CARD",
              cardId: card.instanceId,
              from: zone,
              to: destination,
            })
          }
        >
          Move card
        </button>
        {zone === "battlefield" ? (
          <>
            <button
              type="button"
              className={cn(filterButtonClass, "w-full px-2 py-1 text-xs")}
              onClick={() =>
                dispatch({
                  type: "SET_TAPPED",
                  cardId: card.instanceId,
                })
              }
            >
              {card.tapped ? "Untap" : "Tap"}
            </button>
            <div
              className="flex items-center justify-between gap-1"
              aria-label={`${displayedName(card)} counters`}
            >
              <button
                type="button"
                aria-label={`Remove counter from ${displayedName(card)}`}
                className={cn(filterButtonClass, "px-2 py-1 text-xs")}
                onClick={() =>
                  dispatch({
                    type: "ADJUST_COUNTER",
                    cardId: card.instanceId,
                    delta: -1,
                  })
                }
              >
                -
              </button>
              <span className="text-xs text-[var(--app-text)]">
                {card.counters} counters
              </span>
              <button
                type="button"
                aria-label={`Add counter to ${displayedName(card)}`}
                className={cn(filterButtonClass, "px-2 py-1 text-xs")}
                onClick={() =>
                  dispatch({
                    type: "ADJUST_COUNTER",
                    cardId: card.instanceId,
                    delta: 1,
                  })
                }
              >
                +
              </button>
            </div>
          </>
        ) : null}
        {imagePair(card).back ? (
          <button
            type="button"
            className={cn(filterButtonClass, "w-full px-2 py-1 text-xs")}
            onClick={() =>
              dispatch({
                type: "FLIP_CARD",
                cardId: card.instanceId,
                zone,
              })
            }
          >
            Flip card
          </button>
        ) : null}
      </div>
    </details>
  );
}

function PlaytestCardView({
  card,
  zone,
  dispatch,
  compact = false,
}: {
  card: PlaytestCard;
  zone: PlaytestZone;
  dispatch: (action: PlaytestHistoryAction) => void;
  compact?: boolean;
}) {
  const image = cardImage(card);
  const table = useContext(TableContext);
  return (
    <article
      tabIndex={
        zone === "battlefield" && table.layout === "free" ? 0 : undefined
      }
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          zone !== "battlefield" ||
          table.layout !== "free"
        )
          return;
        const delta = {
          ArrowLeft: [-5, 0],
          ArrowRight: [5, 0],
          ArrowUp: [0, -5],
          ArrowDown: [0, 5],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        dispatch({
          type: "POSITION_CARD",
          cardId: card.instanceId,
          x: (card.position?.x ?? 0) + delta[0]!,
          y: (card.position?.y ?? 0) + delta[1]!,
        });
      }}
      style={{ width: compact ? Math.min(128, table.scale) : table.scale }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ cardId: card.instanceId, from: zone }),
        );
      }}
      className={cn(
        "app-card relative min-w-0 p-1.5",
        compact ? "w-28" : "w-32 sm:w-36",
        table.selected.has(card.instanceId) && "ring-2 ring-cyan-400",
      )}
      aria-label={`${displayedName(card)} in ${zoneLabels[zone]}`}
    >
      <label className="mb-1 flex min-h-7 items-center gap-1 text-[10px]">
        <input
          type="checkbox"
          aria-label={`Select ${displayedName(card)}`}
          checked={table.selected.has(card.instanceId)}
          onChange={() => table.toggle(card.instanceId)}
        />{" "}
        Select
        {card.origin !== "deck" ? (
          <span className="ml-auto rounded bg-amber-950 px-1 text-amber-100">
            {card.origin}
          </span>
        ) : null}
      </label>
      <div
        className={cn(
          "relative mx-auto transition-transform duration-150",
          card.tapped && "rotate-90 scale-[0.72]",
        )}
      >
        {image ? (
          <img
            src={image}
            alt={displayedName(card)}
            className="aspect-[488/680] w-full rounded-md object-cover shadow-md shadow-black/30"
            draggable={false}
            loading="lazy"
            decoding="async"
            width={244}
            height={340}
          />
        ) : (
          <div className="flex aspect-[488/680] items-center justify-center rounded-md border border-[var(--app-border)] bg-[var(--app-control)] p-2 text-center text-[10px] text-[var(--app-muted)]">
            {displayedName(card)}
          </div>
        )}
        {card.counters > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full border border-cyan-300 bg-cyan-950 px-1.5 py-0.5 text-[10px] font-bold text-cyan-50">
            {card.counters}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[10px] font-medium text-[var(--app-text)]">
        {displayedName(card)}
      </p>
      {card.group ? (
        <p className="truncate text-[10px] text-cyan-200">{card.group}</p>
      ) : null}
      {card.powerModifier || card.toughnessModifier ? (
        <p className="text-[10px]">
          P/T modifier {card.powerModifier >= 0 ? "+" : ""}
          {card.powerModifier}/{card.toughnessModifier >= 0 ? "+" : ""}
          {card.toughnessModifier}
        </p>
      ) : null}
      {Object.entries(card.namedCounters).map(([name, value]) => (
        <p key={name} className="truncate text-[10px] text-amber-200">
          {name}: {value}
        </p>
      ))}
      <CardActions card={card} zone={zone} dispatch={dispatch} />
      <button
        type="button"
        className="mt-1 min-h-8 w-full text-xs text-[var(--app-link)]"
        onClick={() => table.edit(card.instanceId)}
      >
        Edit details
      </button>
    </article>
  );
}

function ZonePanel({
  zone,
  cards,
  dispatch,
  children,
  className,
  compact = false,
}: {
  zone: PlaytestZone;
  cards: PlaytestCard[];
  dispatch: (action: PlaytestHistoryAction) => void;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const table = useContext(TableContext);
  const free = zone === "battlefield" && table.layout === "free";
  const shownCards =
    zone === "battlefield" && table.layout === "grouped"
      ? [...cards].sort((a, b) => a.group.localeCompare(b.group))
      : cards;
  function acceptDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropCard(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    try {
      const data = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as {
        cardId?: string;
        from?: PlaytestZone;
      };
      if (
        data.cardId &&
        data.from &&
        PLAYTEST_ZONES.includes(data.from) &&
        (data.from !== zone || free)
      ) {
        dispatch({
          type: "MOVE_CARD",
          cardId: data.cardId,
          from: data.from,
          to: zone,
        });
        if (free) {
          const board = event.currentTarget.querySelector<HTMLElement>(
            "[data-battlefield-board]",
          );
          if (board) {
            const rect = board.getBoundingClientRect();
            dispatch({
              type: "POSITION_CARD",
              cardId: data.cardId,
              x:
                ((event.clientX - rect.left - table.scale / 2) /
                  (rect.width - table.scale)) *
                100,
              y: ((event.clientY - rect.top - 40) / (rect.height - 400)) * 100,
            });
          }
        }
      }
    } catch {
      // Ignore drag data from outside the sandbox.
    }
  }

  return (
    <section
      aria-label={zoneLabels[zone]}
      onDragOver={acceptDrop}
      onDrop={dropCard}
      className={cn(
        "app-panel min-w-0 p-2.5",
        zone === "battlefield" && "min-h-64",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--app-text)]">
          {zoneLabels[zone]}
        </h2>
        <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-control)] px-2 py-0.5 text-[10px] text-[var(--app-muted)]">
          {cards.length}
        </span>
      </div>
      {children}
      {cards.length ? (
        <div
          className={
            free
              ? "mt-2 max-w-full overflow-auto rounded border border-[var(--app-border)]"
              : undefined
          }
        >
          <div
            data-battlefield-board={free ? "true" : undefined}
            style={
              free
                ? { width: 960, height: 900, position: "relative" }
                : undefined
            }
            className={cn(
              "mt-2 flex min-w-0 flex-wrap items-start gap-2",
              zone === "hand" && "justify-center",
            )}
          >
            {shownCards.map((card, index) => (
              <div
                key={card.instanceId}
                style={
                  free
                    ? {
                        position: "absolute",
                        left: `${((card.position?.x ?? (index % 5) * 20) / 100) * (960 - table.scale)}px`,
                        top: `${((card.position?.y ?? Math.min(100, Math.floor(index / 5) * 25)) / 100) * 500}px`,
                      }
                    : undefined
                }
              >
                <PlaytestCardView
                  key={card.instanceId}
                  card={card}
                  zone={zone}
                  dispatch={dispatch}
                  compact={compact}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex min-h-20 items-center justify-center rounded border border-dashed border-[var(--app-border)] px-3 text-center text-xs text-[var(--app-muted)]">
          Drag a card here or use a card&apos;s Actions menu.
        </div>
      )}
    </section>
  );
}

export function PlaytestSandbox({
  cards,
  initialSeed,
  storageKey,
}: {
  cards: DeckSnapshotEntry[];
  initialSeed: string;
  storageKey: string;
}) {
  const [history, baseDispatch] = useReducer(
    playtestHistoryReducer,
    undefined,
    () => createPlaytestHistory(cards, initialSeed),
  );
  const [message, setMessage] = useState("");
  const [seedInput, setSeedInput] = useState(initialSeed);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const [editing, setEditing] = useState<string | null>(null);
  const [layout, setLayout] = useState("grid");
  const [scale, setScale] = useState(144);
  const [storageReady, setStorageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const state = history.present;

  useEffect(() => {
    // Read browser-only storage after hydration; cancel on navigation/unmount.
    const frame = requestAnimationFrame(() => {
      try {
        const text = localStorage.getItem(storageKey);
        if (text) {
          const restored = restorePlaytest(text, cards);
          baseDispatch({ type: "RESTORE", state: restored });
          setSeedInput(restored.seed);
          setStorageMessage("Restored this device's saved playtest.");
        }
        setSaving(true);
      } catch (error) {
        setStorageMessage(
          error instanceof Error
            ? error.message
            : "Device storage is unavailable.",
        );
        setSaving(false);
      }
      setStorageReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [cards, storageKey]);

  useEffect(() => {
    if (!storageReady || !saving) return;
    try {
      localStorage.setItem(storageKey, serializePlaytest(state, cards));
    } catch (error) {
      queueMicrotask(() => {
        setSaving(false);
        setStorageMessage(
          error instanceof Error
            ? error.message
            : "Unable to save on this device.",
        );
      });
    }
  }, [state, cards, storageKey, storageReady, saving]);

  function clearSession() {
    try {
      localStorage.removeItem(storageKey);
      setSaving(false);
      baseDispatch({ type: "RESTART", entries: cards, seed: initialSeed });
      setSelected(new Set());
      setStorageMessage(
        "Saved session cleared. Use Resume device saving to save again.",
      );
    } catch {
      setStorageMessage("Device storage could not be cleared.");
    }
  }

  function dispatch(action: PlaytestHistoryAction) {
    baseDispatch(action);
    setMessage(dispatchMessage(action));
  }

  const searchResults = useMemo(() => {
    return searchPlaytestLibrary(state.zones.library, search);
  }, [search, state.zones.library]);

  return (
    <TableContext.Provider
      value={{
        selected,
        toggle: (id) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        edit: setEditing,
        layout,
        scale,
      }}
    >
      <fieldset disabled={!storageReady} className="min-w-0 space-y-3">
        <section className="app-panel p-3" aria-label="Playtest controls">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-red-900 bg-red-950/30 px-3 py-1.5 text-center">
                <p className="text-[9px] uppercase tracking-wide text-red-200">
                  Life
                </p>
                <p className="text-xl font-bold text-red-50">{state.life}</p>
              </div>
              {[-5, -1, 1, 5].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  aria-label={`${delta > 0 ? "Gain" : "Lose"} ${Math.abs(delta)} life`}
                  className={cn(filterButtonClass, "px-2 py-1.5 text-xs")}
                  onClick={() => dispatch({ type: "ADJUST_LIFE", delta })}
                >
                  {delta > 0 ? "+" : ""}
                  {delta}
                </button>
              ))}
              <div className="ml-1 rounded-md border border-[var(--app-border)] bg-[var(--app-control)] px-3 py-1.5 text-center">
                <p className="text-[9px] uppercase tracking-wide text-[var(--app-muted)]">
                  Turn
                </p>
                <p className="text-xl font-bold text-[var(--app-text)]">
                  {state.turn}
                </p>
              </div>
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              aria-label="Frequent playtest actions"
            >
              <button
                type="button"
                onClick={() => dispatch({ type: "DRAW", count: 1 })}
                disabled={!state.zones.library.length}
                className={cn(
                  filterPrimaryButtonClass,
                  "px-2.5 py-1.5 text-xs",
                )}
              >
                Draw
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "DRAW", count: 7 })}
                disabled={!state.zones.library.length}
                className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Draw 7
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "MILL", count: 1 })}
                disabled={!state.zones.library.length}
                className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Mill
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "SHUFFLE_LIBRARY" })}
                disabled={state.zones.library.length < 2}
                className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Shuffle
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "UNTAP_ALL_AND_ADVANCE" })}
                className={cn(
                  filterPrimaryButtonClass,
                  "px-2.5 py-1.5 text-xs",
                )}
              >
                Next turn
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "UNDO" })}
                disabled={!history.past.length}
                className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "REDO" })}
                disabled={!history.future.length}
                className={cn(filterButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Redo
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2">
            <p className="text-xs text-[var(--app-muted)]" aria-live="polite">
              {message ||
                "Manual sandbox: no rules enforced; saved deck and inventory never change."}
            </p>
            <details className="relative">
              <summary
                role="button"
                className="cursor-pointer text-xs text-[var(--app-link)]"
              >
                Restart or reproduce
              </summary>
              <form
                className="absolute right-0 top-full z-40 mt-1 w-72 space-y-2 rounded-md border border-[var(--app-border-strong)] bg-[var(--app-surface-2)] p-3 shadow-xl shadow-black/50"
                onSubmit={(event) => {
                  event.preventDefault();
                  const seed = seedInput.trim() || randomSeed();
                  setSeedInput(seed);
                  dispatch({ type: "RESTART", entries: cards, seed });
                }}
              >
                <label className="block text-xs text-[var(--app-text)]">
                  Playtest seed
                  <input
                    value={seedInput}
                    maxLength={200}
                    onChange={(event) => setSeedInput(event.target.value)}
                    className={cn(filterInputClass, "mt-1 w-full text-xs")}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className={cn(
                      filterPrimaryButtonClass,
                      "flex-1 px-2 py-1.5 text-xs",
                    )}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className={cn(
                      filterButtonClass,
                      "flex-1 px-2 py-1.5 text-xs",
                    )}
                    onClick={() => {
                      const seed = randomSeed();
                      setSeedInput(seed);
                      dispatch({ type: "RESTART", entries: cards, seed });
                    }}
                  >
                    New shuffle
                  </button>
                </div>
              </form>
            </details>
          </div>
        </section>

        <section
          className="app-panel space-y-2 p-3"
          aria-label="Device session"
        >
          <p className="text-xs text-[var(--app-muted)]">
            {saving
              ? "Autosaving on this device only."
              : "Device saving paused."}{" "}
            Files and browser storage may reveal your deck on this device. Undo
            history is not saved.
          </p>
          <p role="status" className="text-xs">
            {storageMessage}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={filterButtonClass}
              onClick={() => {
                if (
                  window.confirm("Clear this saved playtest and start fresh?")
                )
                  clearSession();
              }}
            >
              Clear saved session
            </button>
            {!saving ? (
              <button
                type="button"
                className={filterButtonClass}
                onClick={() => {
                  if (
                    window.confirm(
                      "Replace any existing device save with the current playtest?",
                    )
                  ) {
                    setSaving(true);
                    setStorageMessage("Device saving resumed.");
                  }
                }}
              >
                Resume device saving
              </button>
            ) : null}
            <button
              type="button"
              className={filterButtonClass}
              onClick={() => {
                try {
                  const url = URL.createObjectURL(
                    new Blob([serializePlaytest(state, cards)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "playtest-v1.json";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                  setStorageMessage(
                    error instanceof Error ? error.message : "Export failed.",
                  );
                }
              }}
            >
              Export playtest
            </button>
            <label className="min-w-0 text-xs">
              Import playtest file
              <input
                aria-label="Import playtest file"
                type="file"
                accept=".json,application/json"
                className="mt-1 block w-full max-w-64"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > PLAYTEST_FILE_LIMIT)
                      throw new Error("Playtest file exceeds the 1 MB limit.");
                    const restored = restorePlaytest(await file.text(), cards);
                    dispatch({ type: "RESTORE", state: restored });
                    setSeedInput(restored.seed);
                    setSelected(new Set());
                    setStorageMessage(
                      "Imported validated playtest. Undo returns to your previous state.",
                    );
                  } catch (error) {
                    setStorageMessage(
                      error instanceof Error ? error.message : "Import failed.",
                    );
                  }
                }}
              />
            </label>
          </div>
        </section>
        <PlaytestAdvancedControls
          state={state}
          dispatch={dispatch}
          selected={selected}
          clearSelection={() => setSelected(new Set())}
          layout={layout}
          setLayout={setLayout}
          scale={scale}
          setScale={setScale}
        />
        {editing ? (
          <PlaytestCardEditor
            card={Object.values(state.zones)
              .flat()
              .find((card) => card.instanceId === editing)}
            dispatch={dispatch}
            close={() => setEditing(null)}
          />
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-3">
            <ZonePanel
              zone="battlefield"
              cards={state.zones.battlefield}
              dispatch={dispatch}
            />
            <ZonePanel
              zone="hand"
              cards={state.zones.hand}
              dispatch={dispatch}
            />
          </div>

          <aside className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <section
              className="app-panel min-w-0 p-2.5"
              aria-label="Library"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                try {
                  const data = JSON.parse(
                    event.dataTransfer.getData(DRAG_TYPE),
                  ) as { cardId?: string; from?: PlaytestZone };
                  if (
                    data.cardId &&
                    data.from &&
                    PLAYTEST_ZONES.includes(data.from) &&
                    data.from !== "library"
                  ) {
                    dispatch({
                      type: "MOVE_CARD",
                      cardId: data.cardId,
                      from: data.from,
                      to: "library",
                      position: "top",
                    });
                  }
                } catch {
                  // Ignore drag data from outside the sandbox.
                }
              }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--app-text)]">
                  Library
                </h2>
                <span className="text-xs text-[var(--app-muted)]">
                  {state.zones.library.length} cards
                </span>
              </div>
              <div className="mx-auto mt-3 flex aspect-[488/680] w-24 items-center justify-center rounded-lg border-2 border-cyan-950 bg-gradient-to-br from-cyan-950 to-stone-950 text-center text-xs text-cyan-100 shadow-lg shadow-black/40">
                {state.zones.library.length}
                <br />
                remaining
              </div>
              <details className="mt-3 rounded border border-[var(--app-border)] bg-[var(--app-control)]">
                <summary
                  role="button"
                  className="cursor-pointer px-2 py-1.5 text-xs text-[var(--app-link)]"
                >
                  Search library
                </summary>
                <div className="space-y-2 border-t border-[var(--app-border)] p-2">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Card name"
                    aria-label="Search library cards"
                    className={cn(filterInputClass, "w-full py-1 text-xs")}
                  />
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    <p className="text-[10px] text-[var(--app-muted)]">
                      Showing up to 50 matches from the entire library. Narrow
                      the search for more.
                    </p>
                    {searchResults.map((card) => (
                      <div
                        key={card.instanceId}
                        className="rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-1.5"
                      >
                        <p className="truncate text-xs text-[var(--app-text)]">
                          {card.entry.cardName}
                        </p>
                        <div className="mt-1 flex gap-1">
                          {(["hand", "battlefield", "graveyard"] as const).map(
                            (to) => (
                              <button
                                key={to}
                                type="button"
                                className={cn(
                                  filterButtonClass,
                                  "flex-1 px-1 py-0.5 text-[10px]",
                                )}
                                onClick={() =>
                                  dispatch({
                                    type: "SEARCH_LIBRARY",
                                    cardId: card.instanceId,
                                    to,
                                  })
                                }
                              >
                                {zoneLabels[to]}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
                    {!searchResults.length ? (
                      <p className="py-3 text-center text-xs text-[var(--app-muted)]">
                        No matching cards.
                      </p>
                    ) : null}
                  </div>
                </div>
              </details>
            </section>

            <ZonePanel
              zone="commandZone"
              cards={state.zones.commandZone}
              dispatch={dispatch}
              compact
            >
              {state.zones.commandZone.length ? (
                <div className="mt-2 space-y-1">
                  {state.zones.commandZone.map((card) => (
                    <div
                      key={card.instanceId}
                      className="flex items-center justify-between gap-2 rounded border border-[var(--app-border)] px-2 py-1"
                    >
                      <span className="truncate text-[10px] text-[var(--app-muted)]">
                        {card.entry.cardName}: tax{" "}
                        {state.commanderTax[card.instanceId] ?? 0}
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Decrease commander tax for ${card.entry.cardName}`}
                          className={cn(
                            filterButtonClass,
                            "px-1.5 py-0 text-xs",
                          )}
                          onClick={() =>
                            dispatch({
                              type: "ADJUST_COMMANDER_TAX",
                              cardId: card.instanceId,
                              delta: -2,
                            })
                          }
                        >
                          -2
                        </button>
                        <button
                          type="button"
                          aria-label={`Increase commander tax for ${card.entry.cardName}`}
                          className={cn(
                            filterButtonClass,
                            "px-1.5 py-0 text-xs",
                          )}
                          onClick={() =>
                            dispatch({
                              type: "ADJUST_COMMANDER_TAX",
                              cardId: card.instanceId,
                              delta: 2,
                            })
                          }
                        >
                          +2
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </ZonePanel>
          </aside>
        </div>

        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <ZonePanel
            zone="graveyard"
            cards={state.zones.graveyard}
            dispatch={dispatch}
            compact
          />
          <ZonePanel
            zone="exile"
            cards={state.zones.exile}
            dispatch={dispatch}
            compact
          />
          <ZonePanel
            zone="sideboard"
            cards={state.zones.sideboard}
            dispatch={dispatch}
            compact
          />
        </div>
      </fieldset>
    </TableContext.Provider>
  );
}
