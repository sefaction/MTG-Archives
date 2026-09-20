"use client";

import { useEffect, useRef, useState } from "react";
import {
  PLAYTEST_ZONES,
  type PlaytestCard,
  type PlaytestGameState,
  type PlaytestHistoryAction,
  type PlaytestOpponent,
  type PlaytestZone,
} from "@/lib/playtest";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterSelectClass,
} from "./filterStyles";

type Dispatch = (action: PlaytestHistoryAction) => void;
const button = cn(filterButtonClass, "min-h-9 px-2 py-1 text-xs");
const input = cn(filterInputClass, "w-full min-w-0 text-sm");
const labels: Record<PlaytestZone, string> = {
  library: "Library",
  hand: "Hand",
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  commandZone: "Command zone",
  sideboard: "Sideboard",
};

function PlayerPanel({
  opponent,
  dispatch,
}: {
  opponent: PlaytestOpponent;
  dispatch: Dispatch;
}) {
  const [source, setSource] = useState("");
  return (
    <div className="app-card min-w-0 space-y-2 p-3">
      <label className="block text-xs">
        Player name
        <input
          className={input}
          maxLength={60}
          value={opponent.name}
          onChange={(event) =>
            dispatch({
              type: "UPDATE_OPPONENT",
              id: opponent.id,
              name: event.target.value,
            })
          }
        />
      </label>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs">
          Player life
          <input
            className={input}
            type="number"
            min={-99999}
            max={99999}
            value={opponent.life}
            onChange={(event) =>
              dispatch({
                type: "UPDATE_OPPONENT",
                id: opponent.id,
                life: Number(event.target.value),
              })
            }
          />
        </label>
        {[-1, 1].map((delta) => (
          <button
            key={delta}
            type="button"
            className={button}
            aria-label={`${delta < 0 ? "Lose" : "Gain"} life for ${opponent.name}`}
            onClick={() =>
              dispatch({
                type: "UPDATE_OPPONENT",
                id: opponent.id,
                life: opponent.life + delta,
              })
            }
          >
            {delta > 0 ? "+1" : "−1"}
          </button>
        ))}
      </div>
      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({
            type: "COMMANDER_DAMAGE",
            id: opponent.id,
            source,
            delta: 1,
          });
        }}
      >
        <label className="block text-xs">
          Commander damage source
          <input
            className={input}
            maxLength={60}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Commander name"
          />
        </label>
        <button type="submit" className={button} disabled={!source.trim()}>
          Add damage
        </button>
      </form>
      {Object.entries(opponent.damage).map(([name, value]) => (
        <div key={name} className="flex flex-wrap items-center gap-2 text-xs">
          <span className={value >= 21 ? "text-amber-200" : ""}>
            {name}: {value}
          </span>
          <button
            type="button"
            className={button}
            aria-label={`Remove damage from ${name}`}
            onClick={() =>
              dispatch({
                type: "COMMANDER_DAMAGE",
                id: opponent.id,
                source: name,
                delta: -1,
              })
            }
          >
            −1
          </button>
          <button
            type="button"
            className={button}
            aria-label={`Add damage from ${name}`}
            onClick={() =>
              dispatch({
                type: "COMMANDER_DAMAGE",
                id: opponent.id,
                source: name,
                delta: 1,
              })
            }
          >
            +1
          </button>
        </div>
      ))}
      <button
        type="button"
        className={button}
        onClick={() => dispatch({ type: "REMOVE_OPPONENT", id: opponent.id })}
      >
        Remove player panel
      </button>
    </div>
  );
}

export function PlaytestAdvancedControls({
  state,
  dispatch,
  selected,
  clearSelection,
  layout,
  setLayout,
  scale,
  setScale,
}: {
  state: PlaytestGameState;
  dispatch: Dispatch;
  selected: Set<string>;
  clearSelection: () => void;
  layout: string;
  setLayout: (value: string) => void;
  scale: number;
  setScale: (value: number) => void;
}) {
  const [token, setToken] = useState("");
  const [destination, setDestination] = useState<PlaytestZone>("battlefield");
  const [count, setCount] = useState(3);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [mode, setMode] = useState("Reveal top");
  const [sides, setSides] = useState(6);
  const [player, setPlayer] = useState("");
  const validSelected = Object.values(state.zones)
    .flat()
    .filter((card) => selected.has(card.instanceId))
    .map((card) => card.instanceId);
  const lookedAt = state.zones.library.filter((card) =>
    revealed.includes(card.instanceId),
  );
  return (
    <section
      className="app-panel space-y-3 p-3"
      aria-label="Advanced playtest tools"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          Battlefield layout
          <select
            value={layout}
            onChange={(event) => setLayout(event.target.value)}
            className={cn(filterSelectClass, "mt-1 block")}
          >
            <option value="grid">Grid</option>
            <option value="grouped">Group labels</option>
            <option value="free">Free positioning</option>
          </select>
        </label>
        <label className="text-xs">
          Card size
          <input
            aria-label="Card size"
            type="range"
            min={104}
            max={176}
            step={8}
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
            className="mt-1 block"
          />
        </label>
        <p className="max-w-md text-xs text-[var(--app-muted)]">
          Select cards for bulk moves. Free layout: drag, use a focused
          card&apos;s arrow keys, or Edit details → position. The tabletop
          scrolls on small screens.
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        aria-label="Selected card actions"
      >
        <span className="text-xs">{validSelected.length} selected</span>
        <select
          aria-label="Move selected cards to"
          className={filterSelectClass}
          value={destination}
          onChange={(event) =>
            setDestination(event.target.value as PlaytestZone)
          }
        >
          {PLAYTEST_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {labels[zone]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!validSelected.length}
          className={button}
          onClick={() => {
            dispatch({
              type: "MOVE_CARDS",
              cardIds: validSelected,
              to: destination,
            });
            clearSelection();
          }}
        >
          Move selected
        </button>
        <button
          type="button"
          disabled={!validSelected.length}
          className={button}
          onClick={() => {
            dispatch({ type: "SHUFFLE_SELECTED", cardIds: validSelected });
            clearSelection();
          }}
        >
          Shuffle selected into library
        </button>
        <button
          type="button"
          disabled={!validSelected.length}
          className={button}
          onClick={clearSelection}
        >
          Clear selection
        </button>
      </div>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-[var(--app-link)]">
          Tokens, library and random tools
        </summary>
        <div className="mt-2 grid min-w-0 gap-3 lg:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              dispatch({ type: "CREATE_TOKEN", name: token });
              setToken("");
            }}
          >
            <label className="block text-xs">
              Token name
              <input
                value={token}
                maxLength={120}
                onChange={(event) => setToken(event.target.value)}
                className={input}
                placeholder="e.g. 1/1 Soldier"
              />
            </label>
            <button
              type="submit"
              disabled={
                !token.trim() ||
                Object.values(state.zones).flat().length >= 1000
              }
              className={button}
            >
              Create token
            </button>
            <p className="text-xs text-[var(--app-muted)]">
              Tokens and copies are temporary. Remove them through Edit details;
              no inventory is created. Maximum 1,000 runtime cards.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                className={button}
                onClick={() => dispatch({ type: "RANDOM", sides: 2 })}
              >
                Flip coin
              </button>
              <label className="w-24 text-xs">
                Die sides
                <input
                  type="number"
                  min={3}
                  max={1000}
                  value={sides}
                  className={input}
                  onChange={(event) => setSides(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className={button}
                disabled={!Number.isInteger(sides) || sides < 3 || sides > 1000}
                onClick={() => dispatch({ type: "RANDOM", sides })}
              >
                Roll die
              </button>
            </div>
            <p role="status" className="text-sm">
              {state.randomResult}
            </p>
          </form>
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-24 text-xs">
                Top cards
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </label>
              {["Scry", "Surveil", "Reveal top"].map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={button}
                  disabled={
                    !state.zones.library.length ||
                    !Number.isInteger(count) ||
                    count < 1 ||
                    count > 50
                  }
                  onClick={() => {
                    setMode(tool);
                    setRevealed(
                      state.zones.library
                        .slice(0, count)
                        .map((card) => card.instanceId),
                    );
                  }}
                >
                  {tool}
                </button>
              ))}
            </div>
            {!!revealed.length && (
              <div
                className="max-h-80 space-y-2 overflow-y-auto rounded border border-[var(--app-border)] p-2"
                aria-label="Revealed library cards"
              >
                <p className="text-xs">
                  {mode}: original looked-at cards still in the library, in
                  current order (top first). No new cards are revealed by moving
                  these.
                </p>
                {lookedAt.map((card) => (
                  <div key={card.instanceId} className="space-y-1 text-xs">
                    <p>{card.entry.cardName}</p>
                    <div className="flex flex-wrap gap-1">
                      {(["top", "bottom"] as const).map((position) => (
                        <button
                          type="button"
                          key={position}
                          className={button}
                          onClick={() =>
                            dispatch({
                              type: "MOVE_CARD",
                              cardId: card.instanceId,
                              from: "library",
                              to: "library",
                              position,
                            })
                          }
                        >
                          Put {position}
                        </button>
                      ))}
                      {mode === "Surveil" && (
                        <button
                          type="button"
                          className={button}
                          onClick={() =>
                            dispatch({
                              type: "MOVE_CARD",
                              cardId: card.instanceId,
                              from: "library",
                              to: "graveyard",
                            })
                          }
                        >
                          Put in graveyard
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className={button}
                  onClick={() => setRevealed([])}
                >
                  Done looking
                </button>
              </div>
            )}
          </div>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-[var(--app-link)]">
          Players and commander damage ({state.opponents.length})
        </summary>
        <p className="my-2 text-xs text-[var(--app-muted)]">
          Manual opponent panels (up to 7). Add a Me panel if you want to track
          damage received. Damage does not automatically change life or declare
          a loss.
        </p>
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: "ADD_OPPONENT", name: player });
            setPlayer("");
          }}
        >
          <label className="text-xs">
            New player name
            <input
              value={player}
              maxLength={60}
              onChange={(event) => setPlayer(event.target.value)}
              className={input}
            />
          </label>
          <button
            type="submit"
            className={button}
            disabled={!player.trim() || state.opponents.length >= 7}
          >
            Add player panel
          </button>
        </form>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {state.opponents.map((opponent) => (
            <PlayerPanel
              key={opponent.id}
              opponent={opponent}
              dispatch={dispatch}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

export function PlaytestCardEditor({
  card,
  dispatch,
  close,
}: {
  card: PlaytestCard | undefined;
  dispatch: Dispatch;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [counter, setCounter] = useState("+1/+1");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!card) close();
  }, [card, close]);
  if (!card) return null;
  return (
    <dialog
      ref={dialog}
      onClose={close}
      className="app-panel m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-4 text-[var(--app-text)] backdrop:bg-black/70"
      aria-label={`Edit ${card.entry.cardName}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words font-semibold">
          {card.entry.cardName} · {card.origin}
        </h2>
        <button type="button" className={button} onClick={close}>
          Close
        </button>
      </div>
      <div className="space-y-3">
        <label className="block text-xs">
          Group label
          <input
            className={input}
            maxLength={60}
            value={card.group}
            onChange={(event) =>
              dispatch({
                type: "GROUP_CARD",
                cardId: card.instanceId,
                group: event.target.value,
              })
            }
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs">Free battlefield position</legend>
          {(["x", "y"] as const).map((axis) => (
            <label key={axis} className="block text-xs">
              {axis.toUpperCase()} position
              <input
                className="block w-full"
                type="range"
                min={0}
                max={100}
                value={card.position?.[axis] ?? 0}
                onChange={(event) =>
                  dispatch({
                    type: "POSITION_CARD",
                    cardId: card.instanceId,
                    x: card.position?.x ?? 0,
                    y: card.position?.y ?? 0,
                    [axis]: Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <label className="block text-xs">
            Named counter
            <input
              className={input}
              value={counter}
              maxLength={40}
              onChange={(event) => setCounter(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            {[-1, 1].map((delta) => (
              <button
                key={delta}
                type="button"
                className={button}
                disabled={!counter.trim()}
                onClick={() =>
                  dispatch({
                    type: "NAMED_COUNTER",
                    cardId: card.instanceId,
                    name: counter,
                    delta,
                  })
                }
              >
                {delta < 0 ? "Remove" : "Add"} named counter
              </button>
            ))}
          </div>
          {Object.entries(card.namedCounters).map(([name, value]) => (
            <p className="break-words text-xs" key={name}>
              {name}: {value}
            </p>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-xs">
            P/T modifier: {card.powerModifier}/{card.toughnessModifier} (manual;
            counters do not automatically affect it)
          </p>
          <div className="flex flex-wrap gap-2">
            {(["power", "toughness"] as const).flatMap((stat) =>
              [-1, 1].map((delta) => (
                <button
                  type="button"
                  key={`${stat}${delta}`}
                  className={button}
                  onClick={() =>
                    dispatch({
                      type: "MODIFY_PT",
                      cardId: card.instanceId,
                      power: stat === "power" ? delta : 0,
                      toughness: stat === "toughness" ? delta : 0,
                    })
                  }
                >
                  {stat} {delta > 0 ? "+1" : "−1"}
                </button>
              )),
            )}
          </div>
        </div>
        <button
          type="button"
          className={button}
          onClick={() =>
            dispatch({ type: "COPY_CARD", cardId: card.instanceId })
          }
        >
          Create temporary copy
        </button>
        {card.origin !== "deck" && (
          <button
            type="button"
            className={cn(button, "ml-2")}
            onClick={() => {
              dispatch({ type: "REMOVE_TEMPORARY", cardId: card.instanceId });
              close();
            }}
          >
            Remove temporary card
          </button>
        )}
      </div>
    </dialog>
  );
}
