import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import type { DeckSnapshotEntry } from "../lib/deck-snapshot";
import {
  createPlaytestHistory,
  createPlaytestState,
  expandPlaytestDeck,
  MAX_PLAYTEST_HISTORY,
  playtestHistoryReducer,
  playtestReducer,
  searchPlaytestLibrary,
} from "../lib/playtest";
import {
  PLAYTEST_FILE_LIMIT,
  playtestStorageKey,
  restorePlaytest,
  serializePlaytest,
} from "../lib/playtest-storage";

const entries: DeckSnapshotEntry[] = [
  {
    id: "a",
    cardId: null,
    cardName: "Alpha",
    quantity: 70,
    section: DeckSection.MAINBOARD,
    isCommander: false,
    card: null,
  },
  {
    id: "b",
    cardId: null,
    cardName: "Last Match",
    quantity: 1,
    section: DeckSection.MAINBOARD,
    isCommander: false,
    card: null,
  },
  {
    id: "c",
    cardId: null,
    cardName: "Commander",
    quantity: 1,
    section: DeckSection.COMMANDER,
    isCommander: true,
    card: null,
  },
];

test("library search matches beyond position 50 before bounding rendered results", () => {
  const cards = expandPlaytestDeck(entries).library;
  assert.equal(cards[70]?.entry.cardName, "Last Match");
  assert.equal(searchPlaytestLibrary(cards, "last")[0]?.instanceId, "b:1");
  assert.equal(searchPlaytestLibrary(cards, "").length, 50);
  assert.equal(searchPlaytestLibrary(cards, "missing").length, 0);
});

test("bulk moves, scry ordering and shuffle-selected conserve exact deck instances", () => {
  let state = createPlaytestState(entries, "advanced");
  const ids = state.zones.library.slice(0, 3).map((card) => card.instanceId);
  state = playtestReducer(state, {
    type: "MOVE_CARDS",
    cardIds: ids,
    to: "hand",
  });
  assert.deepEqual(
    state.zones.hand.map((card) => card.instanceId),
    ids,
  );
  state = playtestReducer(state, {
    type: "MOVE_CARDS",
    cardIds: ids,
    to: "library",
    position: "bottom",
  });
  assert.deepEqual(
    state.zones.library.slice(-3).map((card) => card.instanceId),
    ids,
  );
  state = playtestReducer(state, {
    type: "MOVE_CARD",
    cardId: ids[0]!,
    from: "library",
    to: "library",
    position: "top",
  });
  assert.equal(state.zones.library[0]?.instanceId, ids[0]);
  state = playtestReducer(state, {
    type: "MOVE_CARDS",
    cardIds: ids,
    to: "graveyard",
  });
  state = playtestReducer(state, { type: "SHUFFLE_SELECTED", cardIds: ids });
  assert.equal(state.zones.graveyard.length, 0);
  assert.equal(state.zones.library.length, 71);
  assert.equal(
    new Set(
      Object.values(state.zones)
        .flat()
        .map((card) => card.instanceId),
    ).size,
    72,
  );
  assert.doesNotThrow(() =>
    restorePlaytest(serializePlaytest(state, entries), entries),
  );
});

test("temporary cards, annotations, positions and player panels compose through history", () => {
  let history = createPlaytestHistory(entries, "tools");
  history = playtestHistoryReducer(history, {
    type: "CREATE_TOKEN",
    name: "Soldier",
  });
  history = playtestHistoryReducer(history, {
    type: "COPY_CARD",
    cardId: "c:1",
  });
  const token = history.present.zones.battlefield[0]!;
  const copy = history.present.zones.battlefield[1]!;
  assert.equal(token.origin, "token");
  assert.equal(copy.origin, "copy");
  assert.equal(copy.entry.cardName, "Commander");
  history = playtestHistoryReducer(history, {
    type: "NAMED_COUNTER",
    cardId: token.instanceId,
    name: "loyalty",
    delta: 3,
  });
  history = playtestHistoryReducer(history, {
    type: "MODIFY_PT",
    cardId: token.instanceId,
    power: 2,
    toughness: -1,
  });
  history = playtestHistoryReducer(history, {
    type: "POSITION_CARD",
    cardId: token.instanceId,
    x: -5,
    y: 101,
  });
  history = playtestHistoryReducer(history, {
    type: "GROUP_CARD",
    cardId: token.instanceId,
    group: "My creatures",
  });
  assert.deepEqual(history.present.zones.battlefield[0]?.position, {
    x: 0,
    y: 100,
  });
  assert.equal(history.present.zones.battlefield[0]?.namedCounters.loyalty, 3);
  history = playtestHistoryReducer(history, {
    type: "ADD_OPPONENT",
    name: "Me",
  });
  const id = history.present.opponents[0]!.id;
  history = playtestHistoryReducer(history, {
    type: "UPDATE_OPPONENT",
    id,
    life: 19,
  });
  history = playtestHistoryReducer(history, {
    type: "COMMANDER_DAMAGE",
    id,
    source: "Other commander",
    delta: 21,
  });
  assert.equal(history.present.opponents[0]?.damage["Other commander"], 21);
  const saved = history.present;
  history = playtestHistoryReducer(history, {
    type: "REMOVE_TEMPORARY",
    cardId: token.instanceId,
  });
  assert.equal(history.present.zones.battlefield.length, 1);
  history = playtestHistoryReducer(history, { type: "UNDO" });
  assert.deepEqual(history.present, saved);
  assert.deepEqual(
    restorePlaytest(serializePlaytest(saved, entries), entries),
    saved,
  );
  assert.equal(
    playtestReducer(saved, { type: "REMOVE_TEMPORARY", cardId: "c:1" }).zones
      .commandZone.length,
    1,
  );
  assert.deepEqual(entries[0]?.quantity, 70);
});

test("random tools are deterministic and undoable; runtime and history are bounded", () => {
  const state = createPlaytestState(entries, "dice");
  const roll = playtestReducer(state, { type: "RANDOM", sides: 20 });
  assert.deepEqual(roll, playtestReducer(state, { type: "RANDOM", sides: 20 }));
  assert.match(roll.randomResult, /^d20: ([1-9]|1[0-9]|20)$/);
  assert.equal(playtestReducer(state, { type: "RANDOM", sides: NaN }), state);
  let history = createPlaytestHistory(entries, "history");
  for (let i = 0; i < 120; i++)
    history = playtestHistoryReducer(history, {
      type: "ADJUST_LIFE",
      delta: 1,
    });
  assert.equal(history.past.length, MAX_PLAYTEST_HISTORY);
  assert.throws(
    () => createPlaytestState([{ ...entries[0]!, quantity: 1001 }], "large"),
    /1000/,
  );
  const full = createPlaytestState(
    [{ ...entries[0]!, quantity: 1000 }],
    "full",
  );
  assert.equal(
    playtestReducer(full, { type: "CREATE_TOKEN", name: "extra" }),
    full,
  );
});

test("versioned files reject stale, missing, duplicated, oversized or injected state", () => {
  const state = createPlaytestState(entries, "files");
  const text = serializePlaytest(state, entries);
  const change = (edit: (data: any) => void) => {
    const data = JSON.parse(text);
    edit(data);
    return JSON.stringify(data);
  };
  assert.deepEqual(restorePlaytest(text, entries), state);
  assert.throws(
    () =>
      restorePlaytest(
        text,
        entries.map((entry) => ({ ...entry, quantity: entry.quantity + 1 })),
      ),
    /changed deck/,
  );
  assert.throws(() => restorePlaytest("{", entries), /JSON/);
  assert.throws(
    () => restorePlaytest(" ".repeat(PLAYTEST_FILE_LIMIT + 1), entries),
    /1 MB/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.version = 2;
        }),
        entries,
      ),
    /unsupported/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.state.zones.library.pop();
        }),
        entries,
      ),
    /missing deck cards/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.state.zones.hand.push(data.state.zones.library[0]);
        }),
        entries,
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.state.zones.library[0].entry = {
            imageUri: "https://untrusted.invalid",
          };
        }),
        entries,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.state.zones.library[0].position = { x: 101, y: 0 };
        }),
        entries,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      restorePlaytest(
        change((data) => {
          data.state.commanderTax = {};
        }),
        entries,
      ),
    /commander/,
  );
  assert.notEqual(
    playtestStorageKey("one", "deck"),
    playtestStorageKey("two", "deck"),
  );
  assert.notEqual(
    playtestStorageKey("a:b", "c"),
    playtestStorageKey("a", "b:c"),
  );
});
