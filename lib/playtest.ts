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
export const MAX_PLAYTEST_CARDS = 1000;
export const MAX_PLAYTEST_HISTORY = 100;

export type PlaytestOpponent = {
  id: string;
  name: string;
  life: number;
  // Manual named sources allow tracking other players' commanders as well.
  damage: Record<string, number>;
};

export type PlaytestCard = {
  instanceId: string;
  copyNumber: number;
  entry: DeckSnapshotEntry;
  tapped: boolean;
  faceIndex: 0 | 1;
  counters: number;
  origin: "deck" | "token" | "copy";
  namedCounters: Record<string, number>;
  powerModifier: number;
  toughnessModifier: number;
  group: string;
  position: { x: number; y: number } | null;
};

export type PlaytestGameState = {
  seed: string;
  shuffleCount: number;
  turn: number;
  life: number;
  zones: Record<PlaytestZone, PlaytestCard[]>;
  commanderTax: Record<string, number>;
  opponents: PlaytestOpponent[];
  nextId: number;
  randomCount: number;
  randomResult: string;
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
  | {
      type: "MOVE_CARDS";
      cardIds: string[];
      to: PlaytestZone;
      position?: "top" | "bottom";
    }
  | { type: "POSITION_CARD"; cardId: string; x: number; y: number }
  | { type: "GROUP_CARD"; cardId: string; group: string }
  | { type: "NAMED_COUNTER"; cardId: string; name: string; delta: number }
  | { type: "MODIFY_PT"; cardId: string; power: number; toughness: number }
  | { type: "CREATE_TOKEN"; name: string }
  | { type: "COPY_CARD"; cardId: string }
  | { type: "REMOVE_TEMPORARY"; cardId: string }
  | { type: "SHUFFLE_SELECTED"; cardIds: string[] }
  | { type: "RANDOM"; sides: number }
  | { type: "ADD_OPPONENT"; name: string }
  | { type: "UPDATE_OPPONENT"; id: string; name?: string; life?: number }
  | { type: "REMOVE_OPPONENT"; id: string }
  | { type: "COMMANDER_DAMAGE"; id: string; source: string; delta: number }
  | { type: "RESTORE"; state: PlaytestGameState }
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
  return Number.isFinite(entry.quantity)
    ? Math.max(0, Math.floor(entry.quantity))
    : 0;
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
    origin: "deck",
    namedCounters: {},
    powerModifier: 0,
    toughnessModifier: 0,
    group: "",
    position: null,
  };
}

export function expandPlaytestDeck(entries: DeckSnapshotEntry[]) {
  const zones = emptyZones();
  let count = 0;

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
      if (++count > MAX_PLAYTEST_CARDS)
        throw new Error(
          `Playtest supports up to ${MAX_PLAYTEST_CARDS} runtime cards.`,
        );
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

export function searchPlaytestLibrary(cards: PlaytestCard[], search: string) {
  const query = search.trim().toLowerCase();
  return cards
    .filter(
      (card) => !query || card.entry.cardName.toLowerCase().includes(query),
    )
    .sort((a, b) => a.entry.cardName.localeCompare(b.entry.cardName))
    .slice(0, 50);
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
    opponents: [],
    nextId: 1,
    randomCount: 0,
    randomResult: "",
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
  if (!PLAYTEST_ZONES.includes(from) || !PLAYTEST_ZONES.includes(to))
    return state;
  if (from === to && to !== "library") return state;
  const card = state.zones[from].find(
    (candidate) => candidate.instanceId === cardId,
  );
  if (!card) return state;
  if (from === to) {
    const remaining = state.zones.library.filter(
      (item) => item.instanceId !== cardId,
    );
    return withZones(state, {
      library:
        position === "bottom" ? [...remaining, card] : [card, ...remaining],
    });
  }
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
    case "RESTORE":
      return action.state;
    case "MOVE_CARDS": {
      let next = state;
      // Reverse top insertion so the selected cards keep their supplied order.
      const ids = [...new Set(action.cardIds)];
      if (action.position !== "bottom") ids.reverse();
      for (const id of ids) {
        const from = PLAYTEST_ZONES.find((zone) =>
          next.zones[zone].some((card) => card.instanceId === id),
        );
        if (from) next = moveCard(next, id, from, action.to, action.position);
      }
      return next;
    }
    case "POSITION_CARD":
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y))
        return state;
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        position: {
          x: Math.max(0, Math.min(100, action.x)),
          y: Math.max(0, Math.min(100, action.y)),
        },
      }));
    case "GROUP_CARD":
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        group: action.group.slice(0, 60),
      }));
    case "NAMED_COUNTER": {
      const name = action.name.trim().slice(0, 40);
      if (
        !name ||
        Object.hasOwn(Object.prototype, name) ||
        name === "prototype" ||
        !Number.isFinite(action.delta)
      )
        return state;
      return updateCard(state, action.cardId, (card) => {
        if (
          !(name in card.namedCounters) &&
          Object.keys(card.namedCounters).length >= 12
        )
          return card;
        const namedCounters = {
          ...card.namedCounters,
          [name]: Math.max(
            0,
            Math.min(
              9999,
              (card.namedCounters[name] ?? 0) + Math.trunc(action.delta),
            ),
          ),
        };
        if (!namedCounters[name]) delete namedCounters[name];
        return { ...card, namedCounters };
      });
    }
    case "MODIFY_PT":
      if (!Number.isFinite(action.power) || !Number.isFinite(action.toughness))
        return state;
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        powerModifier: Math.max(
          -9999,
          Math.min(9999, card.powerModifier + Math.trunc(action.power)),
        ),
        toughnessModifier: Math.max(
          -9999,
          Math.min(9999, card.toughnessModifier + Math.trunc(action.toughness)),
        ),
      }));
    case "CREATE_TOKEN":
    case "COPY_CARD": {
      const all = Object.values(state.zones).flat();
      if (all.length >= MAX_PLAYTEST_CARDS || state.nextId >= 1_000_000)
        return state;
      const source =
        action.type === "COPY_CARD"
          ? all.find((card) => card.instanceId === action.cardId)
          : null;
      if (action.type === "COPY_CARD" && !source) return state;
      const name =
        action.type === "CREATE_TOKEN" ? action.name.trim().slice(0, 120) : "";
      if (action.type === "CREATE_TOKEN" && !name) return state;
      const id = `temporary:${state.nextId}`;
      const entry: DeckSnapshotEntry = source?.entry ?? {
        id,
        cardId: null,
        cardName: name,
        section: DeckSection.MAINBOARD,
        quantity: 1,
        isCommander: false,
        card: null,
      };
      const card = {
        ...runtimeCard(entry, 1),
        instanceId: id,
        origin: source ? ("copy" as const) : ("token" as const),
        faceIndex: source?.faceIndex ?? 0,
      };
      return {
        ...withZones(state, {
          battlefield: [...state.zones.battlefield, card],
        }),
        nextId: state.nextId + 1,
      };
    }
    case "REMOVE_TEMPORARY":
      return withZones(
        state,
        Object.fromEntries(
          PLAYTEST_ZONES.map((zone) => [
            zone,
            state.zones[zone].filter(
              (card) =>
                card.instanceId !== action.cardId || card.origin === "deck",
            ),
          ]),
        ),
      );
    case "SHUFFLE_SELECTED": {
      const moved = playtestReducer(state, {
        type: "MOVE_CARDS",
        cardIds: action.cardIds,
        to: "library",
      });
      return playtestReducer(moved, { type: "SHUFFLE_LIBRARY" });
    }
    case "RANDOM": {
      if (
        !Number.isInteger(action.sides) ||
        action.sides < 2 ||
        action.sides > 1000
      )
        return state;
      const randomCount = state.randomCount + 1;
      const result =
        1 +
        Math.floor(
          createSeededRandom(`${state.seed}:random:${randomCount}`)() *
            action.sides,
        );
      return {
        ...state,
        randomCount,
        randomResult:
          action.sides === 2
            ? result === 1
              ? "Heads"
              : "Tails"
            : `d${action.sides}: ${result}`,
      };
    }
    case "ADD_OPPONENT":
      if (
        state.opponents.length >= 7 ||
        !action.name.trim() ||
        state.nextId >= 1_000_000
      )
        return state;
      return {
        ...state,
        nextId: state.nextId + 1,
        opponents: [
          ...state.opponents,
          {
            id: `player:${state.nextId}`,
            name: action.name.trim().slice(0, 60),
            life: 40,
            damage: {},
          },
        ],
      };
    case "UPDATE_OPPONENT":
      return {
        ...state,
        opponents: state.opponents.map((opponent) =>
          opponent.id === action.id
            ? {
                ...opponent,
                name: action.name?.slice(0, 60) || opponent.name,
                life:
                  action.life !== undefined && Number.isFinite(action.life)
                    ? Math.max(-99999, Math.min(99999, Math.trunc(action.life)))
                    : opponent.life,
              }
            : opponent,
        ),
      };
    case "REMOVE_OPPONENT":
      return {
        ...state,
        opponents: state.opponents.filter(
          (opponent) => opponent.id !== action.id,
        ),
      };
    case "COMMANDER_DAMAGE": {
      const source = action.source.trim().slice(0, 60);
      if (
        !source ||
        Object.hasOwn(Object.prototype, source) ||
        source === "prototype" ||
        !Number.isFinite(action.delta)
      )
        return state;
      return {
        ...state,
        opponents: state.opponents.map((opponent) => {
          if (
            opponent.id !== action.id ||
            (!(source in opponent.damage) &&
              Object.keys(opponent.damage).length >= 16)
          )
            return opponent;
          const damage = {
            ...opponent.damage,
            [source]: Math.max(
              0,
              Math.min(
                9999,
                (opponent.damage[source] ?? 0) + Math.trunc(action.delta),
              ),
            ),
          };
          if (!damage[source]) delete damage[source];
          return { ...opponent, damage };
        }),
      };
    }
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
      if (!Number.isFinite(action.delta)) return state;
      return updateCard(state, action.cardId, (card) => ({
        ...card,
        counters: Math.max(
          0,
          Math.min(9999, card.counters + Math.trunc(action.delta)),
        ),
      }));
    case "ADJUST_LIFE":
      return Number.isFinite(action.delta)
        ? {
            ...state,
            life: Math.max(
              -99999,
              Math.min(99999, state.life + Math.trunc(action.delta)),
            ),
          }
        : state;
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
    past: [...history.past, history.present].slice(-MAX_PLAYTEST_HISTORY),
    present,
    future: [],
  };
}
