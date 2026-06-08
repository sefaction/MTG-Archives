import assert from "node:assert/strict";
import test from "node:test";
import { DeckSection } from "@prisma/client";
import {
  buildDeckGroups,
  compareDeckRows,
  manaValueBucket,
  ownershipStatus,
  typeGroup,
  type DeckViewRow,
} from "../lib/deck-view";

function row(
  input: Partial<DeckViewRow> & { id: string; cardName: string },
): DeckViewRow {
  return {
    id: input.id,
    cardName: input.cardName,
    section: input.section ?? DeckSection.MAINBOARD,
    quantity: input.quantity ?? 1,
    exactOwned: input.exactOwned ?? 0,
    otherOwned: input.otherOwned ?? 0,
    missing: input.missing ?? 1,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    card:
      input.card ??
      ({
        name: input.cardName,
        manaCost: null,
        typeLine: "Creature — Test",
        setCode: "tst",
        collectorNumber: input.id,
        rarity: "rare",
        prices: { usd: "1.00" },
        manaValue: 1,
        colorIdentity: ["G"],
      } as DeckViewRow["card"]),
  };
}

test("deck view type grouping uses practical builder categories", () => {
  assert.equal(
    typeGroup(
      row({ id: "cmd", cardName: "A", section: DeckSection.COMMANDER }),
    ),
    "Commander",
  );
  assert.equal(
    typeGroup(
      row({
        id: "land",
        cardName: "B",
        card: {
          name: "B",
          manaCost: null,
          typeLine: "Basic Land — Forest",
          setCode: "tst",
          collectorNumber: "2",
          rarity: "common",
          prices: {},
          manaValue: 0,
        },
      }),
    ),
    "Lands",
  );
  assert.equal(
    typeGroup(
      row({
        id: "instant",
        cardName: "C",
        card: {
          name: "C",
          manaCost: "{U}",
          typeLine: "Instant",
          setCode: "tst",
          collectorNumber: "3",
          rarity: "common",
          prices: {},
          manaValue: 1,
        },
      }),
    ),
    "Instants",
  );
});

test("deck view section, mana, and owned grouping work", () => {
  const rows = [
    row({
      id: "a",
      cardName: "Zero",
      card: {
        name: "Zero",
        manaCost: "{0}",
        typeLine: "Artifact",
        setCode: "tst",
        collectorNumber: "1",
        rarity: "rare",
        prices: {},
        manaValue: 0,
      },
    }),
    row({
      id: "b",
      cardName: "Seven",
      exactOwned: 1,
      missing: 0,
      card: {
        name: "Seven",
        manaCost: "{7}",
        typeLine: "Creature",
        setCode: "tst",
        collectorNumber: "2",
        rarity: "rare",
        prices: {},
        manaValue: 7,
      },
    }),
    row({ id: "c", cardName: "Board", section: DeckSection.SIDEBOARD }),
  ];
  assert.deepEqual(
    buildDeckGroups(rows, "section", "name").map((group) => group.label),
    ["MAINBOARD", "SIDEBOARD"],
  );
  assert.deepEqual(
    buildDeckGroups(rows, "mana", "name").map((group) => group.label),
    ["0", "1", "6+"],
  );
  assert.equal(manaValueBucket(rows[1]), "6+");
  assert.equal(ownershipStatus(rows[1]), "Owned exact");
});

test("deck sorting by name, mana value, price, and stable fallback is deterministic", () => {
  const rows = [
    row({
      id: "2",
      cardName: "Beta",
      card: {
        name: "Beta",
        manaCost: "{3}",
        typeLine: "Sorcery",
        setCode: "bbb",
        collectorNumber: "2",
        rarity: "rare",
        prices: { usd: "3.00" },
        manaValue: 3,
      },
    }),
    row({
      id: "1",
      cardName: "Alpha",
      card: {
        name: "Alpha",
        manaCost: "{1}",
        typeLine: "Sorcery",
        setCode: "aaa",
        collectorNumber: "1",
        rarity: "rare",
        prices: { usd: "1.00" },
        manaValue: 1,
      },
    }),
    row({
      id: "3",
      cardName: "Alpha",
      section: DeckSection.SIDEBOARD,
      card: {
        name: "Alpha",
        manaCost: "{1}",
        typeLine: "Sorcery",
        setCode: "aaa",
        collectorNumber: "3",
        rarity: "rare",
        prices: { usd: "1.00" },
        manaValue: 1,
      },
    }),
  ];
  assert.deepEqual(
    [...rows].sort((a, b) => compareDeckRows(a, b, "name")).map((r) => r.id),
    ["1", "3", "2"],
  );
  assert.deepEqual(
    [...rows].sort((a, b) => compareDeckRows(a, b, "mana")).map((r) => r.id),
    ["1", "3", "2"],
  );
  assert.deepEqual(
    [...rows].sort((a, b) => compareDeckRows(a, b, "price")).map((r) => r.id),
    ["1", "3", "2"],
  );
});
