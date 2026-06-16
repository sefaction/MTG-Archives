import assert from "node:assert/strict";
import test from "node:test";
import { DeckFormat, DeckSection } from "@prisma/client";
import {
  buildDeckFolderOptions,
  calculateDeckColorIdentity,
  canMoveFolder,
} from "../lib/deck-folders";

test("folder options render nested paths and allow duplicate names under different parents", () => {
  const options = buildDeckFolderOptions([
    { id: "built", parentId: null, name: "Built" },
    { id: "cmdr", parentId: "built", name: "Commander" },
    { id: "box", parentId: null, name: "Box League 2026" },
    { id: "round", parentId: "box", name: "Commander" },
  ]);
  assert.deepEqual(
    options.map((option) => [option.id, option.depth, option.path]),
    [
      ["box", 0, "Box League 2026"],
      ["round", 1, "Box League 2026 / Commander"],
      ["built", 0, "Built"],
      ["cmdr", 1, "Built / Commander"],
    ],
  );
});

test("folder move validation blocks self and descendant circular parents", () => {
  const folders = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];
  assert.equal(canMoveFolder("a", "a", folders), false);
  assert.equal(canMoveFolder("a", "c", folders), false);
  assert.equal(canMoveFolder("b", null, folders), true);
  assert.equal(canMoveFolder("c", "a", folders), true);
});

test("deck color identity is WUBRG sorted and uses commander cards when present", () => {
  assert.equal(
    calculateDeckColorIdentity([
      { section: DeckSection.MAINBOARD, card: { colorIdentity: ["R"] } },
      { section: DeckSection.MAINBOARD, card: { colorIdentity: ["W", "B"] } },
      { section: DeckSection.MAINBOARD, card: { colorIdentity: ["U"] } },
    ]),
    "WUBR",
  );
  assert.equal(
    calculateDeckColorIdentity(
      [
        { section: DeckSection.COMMANDER, card: { colorIdentity: ["G"] } },
        { section: DeckSection.MAINBOARD, card: { colorIdentity: ["U"] } },
      ],
      DeckFormat.COMMANDER,
    ),
    "G",
  );
  assert.equal(
    calculateDeckColorIdentity([{ card: { colorIdentity: [] } }]),
    "",
  );
});
