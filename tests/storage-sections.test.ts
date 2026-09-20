import assert from "node:assert/strict";
import test from "node:test";
import {
  storageSections,
  spaceLabel,
  projectedSectionQuantity,
} from "../lib/storage-sections";
import { planStorageMove } from "../lib/inventory-storage-move";

test("vault sections exist even before inventory; physical counts preserve arbitrary labels", () => {
  const sections = storageSections(" Vault ", [
    { name: "Sect 0", quantity: 68 },
    { name: "Sect 1", quantity: 90 },
    { name: "Custom", quantity: 17 },
  ]);
  assert.equal(sections.length, 7);
  assert.equal(
    spaceLabel(sections.find((s) => s.name === "Sect 0")!),
    "68 / 85 cards · 17 spaces left",
  );
  assert.match(
    spaceLabel(sections.find((s) => s.name === "Sect 1")!),
    /5 over capacity/,
  );
  assert.equal(sections.find((s) => s.name === "Sect 5")!.quantity, 0);
  assert.equal(sections.find((s) => s.name === "Custom")!.capacity, null);
  assert.deepEqual(storageSections("Binder", []), []);
  assert.equal(storageSections("Vault", []).length, 6);
});

test("capacity predictions do not double count same-section moves", () => {
  assert.equal(projectedSectionQuantity(68, 30, 20), 78);
  assert.equal(projectedSectionQuantity(85, 85, 85), 85);
  assert.equal(
    spaceLabel({ name: "Sect 0", quantity: 85, capacity: 85 }),
    "85 / 85 cards · full",
  );
});

test("copy-limited plans split the final stack, skip same-section cards, and conserve copies", () => {
  const rows = [
    {
      id: "same",
      quantity: 68,
      locationId: "vault",
      locationSection: "Sect 0",
    },
    { id: "a", quantity: 10, locationId: "box", locationSection: null },
    { id: "b", quantity: 100, locationId: "box", locationSection: null },
  ];
  const plan = planStorageMove(rows, "vault", "Sect 0", 17);
  assert.deepEqual(
    plan.map((p) => [p.row.id, p.quantity]),
    [
      ["a", 10],
      ["b", 7],
    ],
  );
  assert.equal(
    planStorageMove(rows, "vault", "Sect 0", 85).reduce(
      (s, p) => s + p.quantity,
      0,
    ),
    85,
  );
  for (const limit of [0, -1, 1.5, NaN, Infinity])
    assert.throws(
      () => planStorageMove(rows, "vault", null, limit),
      /positive whole/,
    );
});
