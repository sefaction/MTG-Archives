import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import {
  createSampleHandState,
  drawSampleHandCard,
  expandSampleHandDeck,
  isCastableSampleSpell,
  isLandCapableSampleCard,
  keepSampleHand,
  mulliganSampleHand,
  requiredMulliganBottomCount,
  shuffleSampleHandLibrary,
  summarizeSampleHand,
} from "../lib/sample-hands";
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
    typeLine: overrides.typeLine ?? "Creature — Test",
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

function numberedDeck(quantity = 12) {
  return Array.from({ length: quantity }, (_, index) =>
    entry(`card-${index + 1}`, {
      card: printing({
        id: `card-${index + 1}`,
        name: `Card ${index + 1}`,
        manaValue: index + 1,
      }),
    }),
  );
}

test("sample-hand expansion honors quantities, sections, and commanders", () => {
  const expanded = expandSampleHandDeck([
    entry("main", { quantity: 3 }),
    entry("commander", {
      quantity: 2,
      section: DeckSection.COMMANDER,
      isCommander: true,
    }),
    entry("flagged-commander", {
      section: DeckSection.MAINBOARD,
      isCommander: true,
    }),
    entry("side", { quantity: 4, section: DeckSection.SIDEBOARD }),
    entry("maybe", { quantity: 5, section: DeckSection.MAYBEBOARD }),
  ]);

  assert.deepEqual(
    expanded.library.map((card) => card.instanceId),
    ["main:1", "main:2", "main:3"],
  );
  assert.deepEqual(
    expanded.commandZone.map((card) => card.instanceId),
    ["commander:1", "commander:2", "flagged-commander:1"],
  );
});

test("Fisher-Yates shuffle and opening hands are deterministic by seed", () => {
  const expanded = expandSampleHandDeck(numberedDeck());
  const first = shuffleSampleHandLibrary(expanded.library, "repeatable-seed");
  const second = shuffleSampleHandLibrary(expanded.library, "repeatable-seed");
  const different = shuffleSampleHandLibrary(
    expanded.library,
    "different-seed",
  );

  assert.deepEqual(
    first.map((card) => card.instanceId),
    second.map((card) => card.instanceId),
  );
  assert.notDeepEqual(
    first.map((card) => card.instanceId),
    different.map((card) => card.instanceId),
  );
  assert.deepEqual(
    createSampleHandState(numberedDeck(), "repeatable-seed").hand.map(
      (card) => card.instanceId,
    ),
    first.slice(0, 7).map((card) => card.instanceId),
  );
});

test("drawing is available only after keeping a hand", () => {
  const opening = createSampleHandState(numberedDeck(9), "draw-seed");
  assert.equal(opening.hand.length, 7);
  assert.equal(opening.library.length, 2);
  assert.equal(drawSampleHandCard(opening), opening);

  const kept = keepSampleHand(opening, []);
  const drawn = drawSampleHandCard(kept);
  assert.equal(drawn.hand.length, 8);
  assert.equal(drawn.library.length, 1);
  assert.equal(drawn.hand.at(-1)?.instanceId, kept.library[0]?.instanceId);
});

test("London mulligans redraw seven and bottom exactly the required cards", () => {
  const opening = createSampleHandState(numberedDeck(12), "mulligan-seed");
  const firstMulligan = mulliganSampleHand(opening);
  assert.equal(firstMulligan.mulliganCount, 1);
  assert.equal(firstMulligan.hand.length, 7);
  assert.equal(requiredMulliganBottomCount(firstMulligan), 1);
  assert.throws(
    () => keepSampleHand(firstMulligan, []),
    /Choose exactly 1 card/,
  );

  const bottomed = firstMulligan.hand[2]!;
  const kept = keepSampleHand(firstMulligan, [bottomed.instanceId]);
  assert.equal(kept.kept, true);
  assert.equal(kept.hand.length, 6);
  assert.equal(kept.library.length, 6);
  assert.deepEqual(kept.bottomedInstanceIds, [bottomed.instanceId]);
  assert.equal(kept.library.at(-1)?.instanceId, bottomed.instanceId);

  const secondMulligan = mulliganSampleHand(
    mulliganSampleHand(
      createSampleHandState(numberedDeck(12), "two-mulligans"),
    ),
  );
  assert.equal(requiredMulliganBottomCount(secondMulligan), 2);
  assert.throws(
    () => keepSampleHand(secondMulligan, ["not-in-hand", "also-not-there"]),
    /Only cards in the current hand/,
  );
});

test("modal spell lands remain one card and count in both useful categories", () => {
  const modal = entry("modal", {
    card: printing({
      layout: "modal_dfc",
      manaValue: 3,
      typeLine: "Creature // Land",
      colors: ["G"],
      cardFaces: [
        {
          name: "Front",
          manaCost: "{2}{G}",
          typeLine: "Creature",
          imageUris: {},
        },
        {
          name: "Back",
          manaCost: null,
          typeLine: "Land",
          imageUris: {},
        },
      ],
    }),
  });
  const forest = entry("forest", {
    card: printing({
      manaCost: null,
      manaValue: 0,
      typeLine: "Basic Land — Forest",
      colors: [],
    }),
  });
  const spell = entry("spell", {
    card: printing({
      manaValue: 1,
      typeLine: "Instant",
      colors: ["U", "B"],
    }),
  });
  const state = createSampleHandState([modal, forest, spell], "summary");
  const modalCard = state.hand.find((card) => card.entry.id === modal.id)!;
  const forestCard = state.hand.find((card) => card.entry.id === forest.id)!;
  const summary = summarizeSampleHand(state);

  assert.equal(isLandCapableSampleCard(modalCard), true);
  assert.equal(isCastableSampleSpell(modalCard), true);
  assert.equal(isLandCapableSampleCard(forestCard), true);
  assert.equal(isCastableSampleSpell(forestCard), false);
  assert.equal(summary.handSize, 3);
  assert.equal(summary.landCapable, 2);
  assert.equal(summary.castableSpells, 2);
  assert.equal(summary.averageSpellManaValue, 2);
  assert.equal(summary.colorCounts.G, 1);
  assert.equal(summary.colorCounts.U, 1);
  assert.equal(summary.colorCounts.B, 1);
  assert.equal(summary.colorCounts.C, 1);
  assert.equal(summary.expectedLandsInOpeningHand, 2);
});

test("empty and undersized decks deal gracefully", () => {
  const empty = createSampleHandState([], "empty");
  assert.equal(empty.hand.length, 0);
  assert.equal(summarizeSampleHand(empty).expectedLandsInOpeningHand, 0);

  const small = createSampleHandState(numberedDeck(3), "small");
  assert.equal(small.hand.length, 3);
  assert.equal(small.library.length, 0);
  const mulligan = mulliganSampleHand(small);
  assert.equal(mulligan.hand.length, 3);
  assert.equal(requiredMulliganBottomCount(mulligan), 1);
});
