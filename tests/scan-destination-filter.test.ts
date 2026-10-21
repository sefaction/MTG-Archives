import assert from "node:assert/strict";
import test from "node:test";
import { scanLocationHasRoom, scanParentRoom, scanSectionHasRoom } from "../lib/scan-destination-filter";
import { scannerCapacityDestinations } from "../lib/scanner-capacity";
import type { StorageLocation } from "../lib/storage-sections";

const location = (value: Partial<StorageLocation> = {}): StorageLocation => ({
  id: "box", name: "Box", capacity: 10, quantity: 8, pendingQuantity: 1,
  sections: [{ name: "A", capacity: 10, quantity: 1, pendingQuantity: 2 }], ...value,
});

test("any positive free space qualifies regardless of pending incoming quantity", () => {
  const box = location();
  assert.equal(scanParentRoom(box), 1);
  assert.equal(scanLocationHasRoom(box), true);
  assert.equal(scanSectionHasRoom(box, box.sections[0]), true);
  // Ten pending cards do not change visibility; Start retains its own admission rule.
  assert.equal([box].filter(scanLocationHasRoom).length, 1);
});

test("full, over-capacity, zero and unknown capacities are excluded", () => {
  for (const capacity of [0, 8, 9]) assert.equal(scanLocationHasRoom(location({ capacity })), false);
  assert.equal(scanLocationHasRoom(location({ capacity: null, sections: [] })), false);
  assert.equal(scanSectionHasRoom(location(), { name: "unknown", quantity: 0, capacity: null }), false);
  for (const quantity of [10, 11]) {
    assert.equal(scanSectionHasRoom(location({ capacity: null }), { name: "A", quantity, capacity: 10 }), false);
  }
});

test("section-configured vaults qualify without inventing an overall capacity", () => {
  const vault = location({ capacity: null, sections: [
    { name: "Full", capacity: 85, quantity: 85 },
    { name: "Free", capacity: 85, quantity: 84 },
    { name: "Unknown", capacity: null, quantity: 0 },
  ] });
  assert.equal(scanParentRoom(vault), null);
  assert.equal(scanLocationHasRoom(vault), true);
  assert.deepEqual(vault.sections.filter(section => scanSectionHasRoom(vault, section)).map(section => section.name), ["Free"]);
  assert.equal(scanLocationHasRoom({ ...vault, sections: vault.sections.filter(section => section.name !== "Free") }), false);
});

test("parent occupancy includes held cards in other sections and unsectioned batches", () => {
  const box = location({ capacity: 5, quantity: 1, pendingQuantity: 4 });
  assert.equal(scanSectionHasRoom(box, box.sections[0]), false);
  assert.equal(scanLocationHasRoom(box), false);
  const unheld = location({ capacity: 5, quantity: 1, pendingQuantity: 3 });
  assert.equal(scanSectionHasRoom(unheld, unheld.sections[0]), true);
  assert.equal(scanParentRoom(unheld), 1);
  assert.equal(scanSectionHasRoom(unheld, { name: "held", capacity: 2, quantity: 1, pendingQuantity: 1 }), false);
});

test("advisory list uses existing reservation max minus receipts once, scoped to supplied locations", async () => {
  const original = location({ capacity: 10, quantity: 1, pendingQuantity: undefined });
  let query: any;
  const db = { acquisitionSession: { findMany: async (value: unknown) => {
    query = value;
    return [
      { locationId: "box", section: " A ", scannerReserved: 5, run: { id: "run-a", _count: { candidates: 3, slots: 4 } } },
      { locationId: "box", section: "Pending custom", scannerReserved: null, run: { id: "run-b", _count: { candidates: 2, slots: 3 } } },
    ];
  } }, acquisitionCandidate: { groupBy: async (value: any) => {
    assert.deepEqual(value.where, { runId: { in: ["run-a", "run-b"] }, receipt: { isNot: null } });
    return [{ runId: "run-a", _count: { _all: 1 } }, { runId: "run-b", _count: { _all: 1 } }];
  } } } as unknown as Parameters<typeof scannerCapacityDestinations>[0];
  const [snapshot] = await scannerCapacityDestinations(db, [original]);
  assert.deepEqual(query.where.locationId, { in: ["box"] });
  assert.equal(query.where.OR.length, 2); // Retain unresolved transfers, even trashed ones.
  assert.equal(snapshot.pendingQuantity, 6);
  assert.equal(snapshot.sections[0].pendingQuantity, 4);
  assert.deepEqual(snapshot.sections.map(section => section.name), original.sections.map(section => section.name));
  assert.equal(query.select.run.select.candidates, undefined); // Group counts, no historical receipt rows.
  assert.equal(scanParentRoom(snapshot), 3);
  assert.equal(original.pendingQuantity, undefined);
  assert.equal(original.sections[0].pendingQuantity, 2);
  assert.deepEqual(await scannerCapacityDestinations(db, []), []);
});
