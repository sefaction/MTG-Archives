import assert from "node:assert/strict";
import test from "node:test";
import {
  storageSections,
  spaceLabel,
  sectionRoom,
  projectedSectionQuantity,
} from "../lib/storage-sections";
import { planStorageMove } from "../lib/inventory-storage-move";
import { scannerCapacityDestination } from "../lib/scanner-capacity-display";

test("scanner picker preserves stock counts while held batches consume section and parent room", () => {
  const original = { id: "box", name: "Box", capacity: 7, quantity: 0, sections: [
    { name: "A", capacity: 2, quantity: 0 }, { name: "B", capacity: 3, quantity: 0 },
    { name: "C", capacity: 2, quantity: 0 }, { name: "__proto__", capacity: null, quantity: 0 },
  ] };
  const held = scannerCapacityDestination(original, [{ section: "A", quantity: 2 }, { section: "B", quantity: 3 }], 5);
  assert.equal(held.quantity, 0);
  assert.equal("pendingQuantity" in original.sections[0], false);
  assert.equal(spaceLabel(held.sections[0], 2), "0 / 2 cards · 2 held by batches · full");
  assert.deepEqual(held.sections.filter(section => (sectionRoom(section, 2) ?? 0) > 0).map(section => section.name), ["C", "__proto__"]);
  assert.equal(sectionRoom(held.sections[2], 0), 0); // A tighter full parent excludes every section.
  assert.equal(sectionRoom({ name: "B", quantity: 1, capacity: 10, pendingQuantity: 2 }, 1), 1);
  assert.equal(spaceLabel({ name: "A", quantity: 1, capacity: 2, pendingQuantity: 1 }), "1 / 2 cards · 1 held by batches · full");
  assert.equal(spaceLabel({ name: "A", quantity: 0, capacity: 2, pendingQuantity: 3 }), "0 / 2 cards · 3 held by batches · 1 over capacity");
  assert.equal(sectionRoom(original.sections[3]), null); // Ordinary unbounded storage is unchanged.
  const custom = scannerCapacityDestination(original, [{ section: "New section", quantity: 1 }, { section: null, quantity: 2 }], 3);
  assert.equal(spaceLabel(custom.sections.find(section => section.name === "New section")!, 4), "0 cards · 1 held by batches · 4 spaces left");
  assert.equal(custom.sections.length, original.sections.length + 1);
});

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

test("chosen amounts move independently from several stacks", () => {
  const rows = [
    { id: "a", quantity: 4, locationId: "box", locationSection: null },
    { id: "b", quantity: 5, locationId: "box", locationSection: null },
  ];
  assert.deepEqual(
    planStorageMove(rows, "vault", "Sect 0", undefined, { a: 2, b: 3 })
      .map(({ row, quantity }) => [row.id, quantity]),
    [["a", 2], ["b", 3]],
  );
  assert.throws(() => planStorageMove(rows, "vault", "Sect 0", undefined, { a: 5, b: 3 }), /invalid/);
});
