import { DeckSection } from "@prisma/client";
import type { DeckSnapshotEntry } from "./deck-snapshot";
import { createSeededRandom } from "./sample-hands";

export const PLAYTEST_ZONES = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "commandZone",
  "sideboard",
] as const;

export type PlaytestZone = (typeof PLAYTEST_ZONES)[number];

export type PlaytestCard = {
  instanceId: string;
  copyNumber: number;
  entry: DeckSnapshotEntry;
  tapped: boolean;
  faceIndex: 0 | 1;
  counters: number;
};

export type PlaytestGameState = {
  seed: string;
  shuffleCount: number;
  turn: number;
  life: number;
  zones: Record<PlaytestZone, PlaytestCard[]>;
  commanderTax: Record<string, number>;
};

export type PlaytestAction =
  | {
      type: "MOVE_CARD";
      cardId: string;
      from: PlaytestZone;
      to: PlaytestZone;
      position?: "top" | "bottom";
    }
  | {
      type: "SEARCH_LIBRARY";
      cardId: string;
      to: Exclude<PlaytestZone, "library">;
    }
  | { type: "DRAW"; count?: number }
  | { type: "MILL"; count?: number }
  | { type: "SHUFFLE_LIBRARY"; seed?: string }
  | { type: "SET_TAPPED"; cardId: string; tapped?: boolean }
  | { type: "UNTAP_ALL_AND_ADVANCE" }
  | { type: "FLIP_CARD"; cardId: string; zone: PlaytestZone }
  | { type: "ADJUST_COUNTER"; cardId: string; delta: number }
  | { type: "ADJUST_LIFE"; delta: number }
  | { type: "ADJUST_COMMANDER_TAX"; cardId: string; delta: number }
  | { type: "RESTART"; entries: DeckSnapshotEntry[]; seed: string };

export type PlaytestHistoryAction =
  PlaytestAction | { type: "UNDO" } | { type: "REDO" };

export type PlaytestHistoryState = {
  past: PlaytestGameState[];
  present: PlaytestGameState;
  future: PlaytestGameState[];
};

function emptyZones(): Record<PlaytestZone, PlaytestCard[]> {
  return {
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    commandZone: [],
    sideboard: [],
  };
}

function normalizedQuantity(entry: DeckSnapshotEntry) {
  return Math.max(0, Math.floor(entry.quantity));
}

function runtimeCard(
  entry: DeckSnapshotEntry,
  copyNumber: number,
): PlaytestCard {
  return {
    instanceId: `${entry.id}:${copyNumber}`,
    copyNumber,
    entry,
    tapped: false,
    faceIndex: 0,
    counters: 0,
  };
}

export function expandPlaytestDeck(entries: DeckSnapshotEntry[]) {
  const zones = emptyZones();

  for (const entry of entries) {
    const isCommander =
      entry.section === DeckSection.COMMANDER || entry.isCommander;
    let zone: PlaytestZone | null = null;
    if (isCommander) zone = "commandZone";
    else if (entry.section === DeckSection.MAINBOARD) zone = "library";
    else if (entry.section === DeckSection.SIDEBOARD) zone = "sideboard";
    if (!zone) continue;

    for (
      let copyNumber = 1;
      copyNumber <= normalizedQuantity(entry);
      copyNumber += 1
    ) {
      zones[zone].push(runtimeCard(entry, copyNumber));
    }
  }

  return zones;
}

export function shufflePlaytestCards(cards: PlaytestCard[], seed: string) {
  const shuffled = cards.slice();
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

export function createPlaytestState(
  entries: DeckSnapshotEntry[],
  seed: string,
): PlaytestGameState {
  const zones = expandPlaytestDeck(entries);
  zones.library = shufflePlaytestCards(zones.library, seed);
  return {
    seed,
    shuffleCount: 0,
    turn: 1,
    life: 40,
    zones,
    commanderTax: Object.fromEntries(
      zones.commandZone.map((card) => [card.instanceId, 0]),
    ),
  };
}

export function createPlaytestHistory(
  entries: DeckSnapshotEntry[],
  seed: string,
): PlaytestHistoryState {
  return {
    past: [],
    present: createPlaytestState(entries, seed),
    future: [],
  };
}

function withZones(
  state: PlaytestGameState,
  zones: Partial<Record<PlaytestZone, PlaytestCard[]>>,
) {
  return { ...state, zones: { ...state.zones, ...zones } };
}

function moveCard(
  state: PlaytestGameState,
  cardId: string,
  from: PlaytestZone,
  to: PlaytestZone,
  position: "top" | "bottom" = "top",
) {
  if (from === to) return state;
  const card = state.zones[from].find(
    (candidate) => candidate.instanceId === cardId,
  );
  if (!card) return state;
  const moved = to === "battlefield" ? card : { ...card, tapped: false };
  const destination =
    to === "library" && position === "bottom"
      ? [...state.zones[to], moved]
      : [moved, ...state.zones[to]];
  return withZones(state, {
    [from]: state.zones[from].filter(
      (candidate) => candidate.instanceId !== cardId,
    ),
    [to]: destination,
  });
}

function moveLibraryCards(
  state: PlaytestGameState,
  count: number,
  to: "hand" | "graveyard",
) {
  const quantity = Math.min(
    Math.max(0, Math.floor(count)),
    state.zones.library.length,
  );
  if (!quantity) return state;
  const moved = state.zones.library.slice(0, quantity);
  return withZones(state, {
    library: state.zones.library.slice(quantity),
    [to]: [...state.zones[to], ...moved],
  });
}

function updateCard(
  state: PlaytestGameState,
  cardId: string,
  update: (card: PlaytestCard) => PlaytestCard,
) {
  for (const zone of PLAYTEST_ZONES) {
    const index = state.zones[zone].findIndex(
      (card) => card.instanceId === cardId,
    );
    if (index < 0) continue;
    const cards = state.zones[zone].slice();
    cards[index] = update(cards[index]!);
    return withZones(state, { [zone]: cards });
  }
  return state;
}

export function playtestReducer(
  state: PlaytestGameState,
  action: PlaytestAction,
): PlaytestGameState {
  switch (action.type) {
    case "MOVE_CARD":
      return moveCard(
        state,
        action.cardId,
        action.from,
        action.to,
        action.position,
      );
    case "SEARCH_LIBRARY":
      return moveCard(state, action.cardId, "library", action.to);
    case "DRAW":
      return moveLibraryCards(state, action.count ?? 1, "hand");
    case "MILL":
      return moveLibraryCards(state, action.count ?? 1, "graveyard");
    case "SHUFFLE_LIBRARY": {
      if (state.zones.library.length < 2) return state;
      const shuffleCount = state.shuffleCount + 1;
      const seed =
        action.seed?.trim() || `${state.seed}:shuffle:${shuffleCount}`;
      return {
        ...state,
        shuffleCount,
        zones: {
          ...state.zones,
          library: shufflePlaytestCards(state.zones.library, seed),
        },
      };
    }
    case "SET_TAPPED":
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        tapped: action.tapped ?? !card.tapped,
      }));
    case "UNTAP_ALL_AND_ADVANCE":
      return {
        ...state,
        turn: state.turn + 1,
        zones: {
          ...state.zones,
          battlefield: state.zones.battlefield.map((card) => ({
            ...card,
            tapped: false,
          })),
        },
      };
    case "FLIP_CARD":
      return withZones(state, {
        [action.zone]: state.zones[action.zone].map((card) =>
          card.instanceId === action.cardId
            ? { ...card, faceIndex: card.faceIndex === 0 ? 1 : 0 }
            : card,
        ),
      });
    case "ADJUST_COUNTER":
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        counters: Math.max(0, card.counters + action.delta),
      }));
    case "ADJUST_LIFE":
      return { ...state, life: state.life + action.delta };
    case "ADJUST_COMMANDER_TAX":
      if (!(action.cardId in state.commanderTax)) return state;
      return {
        ...state,
        commanderTax: {
          ...state.commanderTax,
          [action.cardId]: Math.max(
            0,
            state.commanderTax[action.cardId]! + action.delta,
          ),
        },
      };
    case "RESTART":
      return createPlaytestState(action.entries, action.seed);
  }
}

export function playtestHistoryReducer(
  history: PlaytestHistoryState,
  action: PlaytestHistoryAction,
): PlaytestHistoryState {
  if (action.type === "UNDO") {
    const previous = history.past.at(-1);
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };
  }
  if (action.type === "REDO") {
    const next = history.future[0];
    if (!next) return history;
    return {
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
    };
  }

  const present = playtestReducer(history.present, action);
  if (present === history.present) return history;
  return {
    past: [...history.past, history.present],
    present,
    future: [],
  };
}
