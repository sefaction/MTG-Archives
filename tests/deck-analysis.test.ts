import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import {
  analyzeManaCurve,
  hasCastableNonlandFace,
  isLandOnlyDeckEntry,
  isPermanentDeckEntry,
} from "../lib/deck-analysis";
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

test("mana curve weights quantities and separates permanents from spells", () => {
  const cards = [
    entry("forest", {
      cardName: "Forest",
      quantity: 36,
      card: printing({
        id: "forest",
        name: "Forest",
        manaCost: null,
        manaValue: 0,
        typeLine: "Basic Land — Forest",
        colors: [],
      }),
    }),
    entry("creature", { quantity: 2, card: printing({ manaValue: 3 }) }),
    entry("instant", {
      card: printing({
        manaCost: "{1}{U}",
        manaValue: 2,
        typeLine: "Instant",
      }),
    }),
    entry("commander", {
      section: DeckSection.COMMANDER,
      isCommander: true,
      card: printing({ manaValue: 4, typeLine: "Legendary Creature" }),
    }),
  ];

  const analysis = analyzeManaCurve(cards);
  assert.equal(analysis.includedQuantity, 40);
  assert.equal(analysis.countedQuantity, 40);
  assert.equal(analysis.landQuantity, 36);
  assert.equal(analysis.spellQuantity, 4);
  assert.equal(analysis.totalManaValue, 12);
  assert.equal(analysis.averageWithLands, 0.3);
  assert.equal(analysis.averageWithoutLands, 3);
  assert.equal(analysis.medianManaValue, 3);
  assert.equal(analysis.buckets[2]?.spellQuantity, 1);
  assert.equal(analysis.buckets[3]?.permanentQuantity, 2);
  assert.equal(analysis.buckets[4]?.permanentQuantity, 1);
});

test("commander toggle and section rules exclude sideboard and maybeboard", () => {
  const cards = [
    entry("main", { card: printing({ manaValue: 2 }) }),
    entry("commander", {
      section: DeckSection.COMMANDER,
      isCommander: true,
      card: printing({ manaValue: 5 }),
    }),
    entry("side", {
      quantity: 4,
      section: DeckSection.SIDEBOARD,
      card: printing({ manaValue: 8 }),
    }),
    entry("maybe", {
      quantity: 4,
      section: DeckSection.MAYBEBOARD,
      card: printing({ manaValue: 9 }),
    }),
  ];

  assert.equal(analyzeManaCurve(cards).includedQuantity, 2);
  const withoutCommander = analyzeManaCurve(cards, false);
  assert.equal(withoutCommander.includedQuantity, 1);
  assert.equal(withoutCommander.totalManaValue, 2);
  assert.equal(withoutCommander.buckets.length, 3);
});

test("face-aware classification treats modal spell lands as castable spells", () => {
  const modalCreature = entry("modal-creature", {
    card: printing({
      layout: "modal_dfc",
      manaValue: 3,
      typeLine: "Creature // Land",
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
  const modalSorcery = entry("modal-sorcery", {
    card: printing({
      layout: "modal_dfc",
      manaValue: 2,
      typeLine: "Sorcery // Land",
      cardFaces: [
        {
          name: "Front",
          manaCost: "{1}{B}",
          typeLine: "Sorcery",
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
  const land = entry("land", {
    card: printing({ manaValue: 0, typeLine: "Artifact Land" }),
  });

  assert.equal(hasCastableNonlandFace(modalCreature), true);
  assert.equal(isPermanentDeckEntry(modalCreature), true);
  assert.equal(isLandOnlyDeckEntry(modalCreature), false);
  assert.equal(hasCastableNonlandFace(modalSorcery), true);
  assert.equal(isPermanentDeckEntry(modalSorcery), false);
  assert.equal(isLandOnlyDeckEntry(land), true);

  const analysis = analyzeManaCurve([modalCreature, modalSorcery, land]);
  assert.equal(analysis.spellQuantity, 2);
  assert.equal(analysis.landQuantity, 1);
  assert.equal(analysis.buckets[2]?.spellQuantity, 1);
  assert.equal(analysis.buckets[3]?.permanentQuantity, 1);
});

test("missing or invalid printing metadata is reported instead of skewing stats", () => {
  const analysis = analyzeManaCurve([
    entry("known", { quantity: 2, card: printing({ manaValue: 1 }) }),
    entry("missing", { quantity: 3, card: null }),
    entry("invalid", {
      quantity: 4,
      card: printing({ manaValue: null }),
    }),
  ]);

  assert.equal(analysis.includedQuantity, 9);
  assert.equal(analysis.countedQuantity, 2);
  assert.equal(analysis.unresolvedQuantity, 7);
  assert.equal(analysis.averageWithoutLands, 1);
});

test("very high mana values use one bounded overflow bucket", () => {
  const analysis = analyzeManaCurve([
    entry("twelve", { card: printing({ manaValue: 12 }) }),
    entry("fifteen", { quantity: 2, card: printing({ manaValue: 15 }) }),
  ]);
  const overflow = analysis.buckets.at(-1);
  assert.equal(analysis.buckets.length, 13);
  assert.equal(overflow?.label, "12+");
  assert.equal(overflow?.totalQuantity, 3);
});
