import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import {
  createPlaytestHistory,
  createPlaytestState,
  expandPlaytestDeck,
  playtestHistoryReducer,
  playtestReducer,
  shufflePlaytestCards,
} from "../lib/playtest";
import type {
  DeckSnapshotCardPrinting,
  DeckSnapshotEntry,
} from "../lib/deck-snapshot";

function printing(
  overrides: Partial<DeckSnapshotCardPrinting> = {},
): DeckSnapshotCardPrinting {
  return {
    id: overrides.id ?? "card",
    scryfallId: overrides.scryfallId ?? "scryfall-card",
    name: overrides.name ?? "Test Card",
    manaCost: "manaCost" in overrides ? (overrides.manaCost ?? null) : "{2}{G}",
    manaValue: "manaValue" in overrides ? (overrides.manaValue ?? null) : 3,
    typeLine: overrides.typeLine ?? "Creature â€” Test",
    colors: overrides.colors ?? ["G"],
    colorIdentity: overrides.colorIdentity ?? ["G"],
    producedMana:
      "producedMana" in overrides ? (overrides.producedMana ?? null) : [],
    layout: overrides.layout ?? "normal",
    imageUri: overrides.imageUri ?? null,
    imageUris: overrides.imageUris ?? {},
    cardFaces: overrides.cardFaces ?? [],
    setCode: overrides.setCode ?? "tst",
    collectorNumber: overrides.collectorNumber ?? "1",
  };
}

function entry(
  id: string,
  overrides: Partial<DeckSnapshotEntry> = {},
): DeckSnapshotEntry {
  return {
    id,
    cardId: overrides.cardId ?? id,
    cardName: overrides.cardName ?? `Card ${id}`,
    section: overrides.section ?? DeckSection.MAINBOARD,
    quantity: overrides.quantity ?? 1,
    isCommander: overrides.isCommander ?? false,
    card: overrides.card === undefined ? printing({ id }) : overrides.card,
  };
}

function deck() {
  return [
    entry("main-a", { quantity: 3 }),
    entry("main-b", { quantity: 2 }),
    entry("commander", {
      section: DeckSection.COMMANDER,
      isCommander: true,
      card: printing({
        id: "commander",
        layout: "transform",
        cardFaces: [
          {
            name: "Commander Front",
            manaCost: "{2}{G}",
            typeLine: "Legendary Creature",
            imageUris: {},
          },
          {
            name: "Commander Back",
            manaCost: null,
            typeLine: "Legendary Creature",
            imageUris: {},
          },
        ],
      }),
    }),
    entry("side", { quantity: 2, section: DeckSection.SIDEBOARD }),
    entry("maybe", { quantity: 4, section: DeckSection.MAYBEBOARD }),
  ];
}

test("playtest expansion creates distinct instances in the correct initial zones", () => {
  const entries = deck();
  const original = structuredClone(entries);
  const zones = expandPlaytestDeck(entries);

  assert.deepEqual(
    zones.library.map((card) => card.instanceId),
    ["main-a:1", "main-a:2", "main-a:3", "main-b:1", "main-b:2"],
  );
  assert.deepEqual(
    zones.commandZone.map((card) => card.instanceId),
    ["commander:1"],
  );
  assert.deepEqual(
    zones.sideboard.map((card) => card.instanceId),
    ["side:1", "side:2"],
  );
  assert.equal(
    Object.values(zones)
      .flat()
      .some((card) => card.entry.id === "maybe"),
    false,
  );
  assert.deepEqual(entries, original);
});

test("initial library and explicit shuffles are deterministic by seed", () => {
  const first = createPlaytestState(deck(), "repeatable");
  const second = createPlaytestState(deck(), "repeatable");
  const different = createPlaytestState(deck(), "different");
  assert.deepEqual(
    first.zones.library.map((card) => card.instanceId),
    second.zones.library.map((card) => card.instanceId),
  );
  assert.notDeepEqual(
    first.zones.library.map((card) => card.instanceId),
    different.zones.library.map((card) => card.instanceId),
  );
  assert.deepEqual(
    shufflePlaytestCards(first.zones.library, "again").map(
      (card) => card.instanceId,
    ),
    shufflePlaytestCards(first.zones.library, "again").map(
      (card) => card.instanceId,
    ),
  );
});

test("draw, mill, search, and manual movement transition cards between zones", () => {
  let state = createPlaytestState(deck(), "transitions");
  const first = state.zones.library[0]!;
  const second = state.zones.library[1]!;

  state = playtestReducer(state, { type: "DRAW", count: 1 });
  assert.equal(state.zones.hand[0]?.instanceId, first.instanceId);
  state = playtestReducer(state, { type: "MILL", count: 1 });
  assert.equal(state.zones.graveyard[0]?.instanceId, second.instanceId);

  const searched = state.zones.library[0]!;
  state = playtestReducer(state, {
    type: "SEARCH_LIBRARY",
    cardId: searched.instanceId,
    to: "exile",
  });
  assert.equal(state.zones.exile[0]?.instanceId, searched.instanceId);

  const route = [
    ["hand", "battlefield"],
    ["battlefield", "graveyard"],
    ["graveyard", "exile"],
    ["exile", "commandZone"],
    ["commandZone", "sideboard"],
    ["sideboard", "library"],
  ] as const;
  for (const [from, to] of route) {
    state = playtestReducer(state, {
      type: "MOVE_CARD",
      cardId: first.instanceId,
      from,
      to,
      position: to === "library" ? "bottom" : undefined,
    });
    assert.equal(
      state.zones[to].some((card) => card.instanceId === first.instanceId),
      true,
    );
  }
  assert.equal(state.zones.library.at(-1)?.instanceId, first.instanceId);
});

test("battlefield state, life, turn, counters, faces, and commander tax are manual", () => {
  let state = createPlaytestState(deck(), "tabletop");
  const commander = state.zones.commandZone[0]!;
  state = playtestReducer(state, {
    type: "MOVE_CARD",
    cardId: commander.instanceId,
    from: "commandZone",
    to: "battlefield",
  });
  state = playtestReducer(state, {
    type: "SET_TAPPED",
    cardId: commander.instanceId,
  });
  state = playtestReducer(state, {
    type: "ADJUST_COUNTER",
    cardId: commander.instanceId,
    delta: 3,
  });
  state = playtestReducer(state, {
    type: "ADJUST_COUNTER",
    cardId: commander.instanceId,
    delta: -1,
  });
  state = playtestReducer(state, {
    type: "FLIP_CARD",
    cardId: commander.instanceId,
    zone: "battlefield",
  });
  state = playtestReducer(state, { type: "ADJUST_LIFE", delta: -7 });
  state = playtestReducer(state, {
    type: "ADJUST_COMMANDER_TAX",
    cardId: commander.instanceId,
    delta: 2,
  });

  assert.equal(state.life, 33);
  assert.equal(state.commanderTax[commander.instanceId], 2);
  assert.equal(state.zones.battlefield[0]?.tapped, true);
  assert.equal(state.zones.battlefield[0]?.counters, 2);
  assert.equal(state.zones.battlefield[0]?.faceIndex, 1);

  state = playtestReducer(state, { type: "UNTAP_ALL_AND_ADVANCE" });
  assert.equal(state.turn, 2);
  assert.equal(state.zones.battlefield[0]?.tapped, false);
});

test("restart and immutable history support undo and redo for every action", () => {
  const entries = deck();
  let history = createPlaytestHistory(entries, "history");
  const originalOrder = history.present.zones.library.map(
    (card) => card.instanceId,
  );

  history = playtestHistoryReducer(history, { type: "DRAW", count: 2 });
  assert.equal(history.present.zones.hand.length, 2);
  history = playtestHistoryReducer(history, { type: "UNDO" });
  assert.equal(history.present.zones.hand.length, 0);
  assert.deepEqual(
    history.present.zones.library.map((card) => card.instanceId),
    originalOrder,
  );
  history = playtestHistoryReducer(history, { type: "REDO" });
  assert.equal(history.present.zones.hand.length, 2);

  history = playtestHistoryReducer(history, {
    type: "RESTART",
    entries,
    seed: "fresh",
  });
  assert.equal(history.present.turn, 1);
  assert.equal(history.present.life, 40);
  assert.equal(history.present.zones.hand.length, 0);
  assert.equal(history.present.seed, "fresh");
  history = playtestHistoryReducer(history, { type: "UNDO" });
  assert.equal(history.present.zones.hand.length, 2);
});
