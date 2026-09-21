import assert from "node:assert/strict";
import test from "node:test";
import {
  readStorageLayout,
  validateStorageLayout,
  remainingStorageSpace,
} from "../lib/storage-layout";
import { storageSections } from "../lib/storage-sections";
import { browseLocations, locationBrowseHref } from "../lib/location-browser";

test("legacy vault defaults survive null layouts; explicit overrides replace only defaults", () => {
  assert.equal(readStorageLayout(null, "Vault").sections.length, 6);
  const layout = validateStorageLayout({
    capacity: 200,
    sections: [
      { name: "Front", capacity: 50 },
      { name: "Back", capacity: null },
    ],
  });
  const sections = storageSections(
    "Vault",
    [
      { name: "Sect 0", quantity: 68 },
      { name: "Front", quantity: 10 },
      { name: "", quantity: 2 },
    ],
    layout,
  );
  assert.equal(sections.find((s) => s.name === "Sect 0")?.capacity, null);
  assert.equal(sections.find((s) => s.name === "Front")?.capacity, 50);
  assert.equal(sections.find((s) => s.name === "Back")?.quantity, 0);
  assert.equal(
    sections.reduce((sum, s) => sum + s.quantity, 0),
    80,
  );
  assert.equal(
    storageSections("Vault", [], { capacity: null, sections: [] }).length,
    0,
  );
});

test("capacity validation rejects malformed, fractional, huge, duplicate and blank settings", () => {
  for (const capacity of [
    -1,
    0,
    1.5,
    Infinity,
    NaN,
    2147483648,
    "85",
    undefined,
  ])
    assert.throws(() => validateStorageLayout({ capacity, sections: [] }));
  for (const names of [[""], ["A", "a"], [" x ", "x"], ["a".repeat(101)]])
    assert.throws(() =>
      validateStorageLayout({
        capacity: null,
        sections: names.map((name) => ({ name, capacity: null })),
      }),
    );
  assert.throws(() =>
    validateStorageLayout({
      capacity: null,
      sections: Array.from({ length: 101 }, (_, i) => ({
        name: String(i),
        capacity: null,
      })),
    }),
  );
  assert.deepEqual(
    validateStorageLayout({
      capacity: null,
      sections: [{ name: " Front ", capacity: 85 }],
    }).sections[0],
    { name: "Front", capacity: 85 },
  );
});

test("remaining space counts physical copies, clamps overflow and respects both capacities", () => {
  const layout = {
    capacity: 100,
    sections: [
      { name: "A", capacity: 85 },
      { name: "B", capacity: 85 },
    ],
  };
  const sections = storageSections(
    "Box",
    [{ name: "A", quantity: 90 }],
    layout,
  );
  assert.equal(remainingStorageSpace(layout, 95, sections), 5);
  assert.equal(remainingStorageSpace(layout, 105, sections), 0);
  assert.equal(
    remainingStorageSpace({ ...layout, capacity: null }, 95, sections),
    85,
  );
  assert.equal(
    remainingStorageSpace({ capacity: 100, sections: [] }, 15, []),
    85,
  );
  assert.equal(
    remainingStorageSpace({ capacity: null, sections: [] }, 15, []),
    null,
  );
});

test("browse filters compose with full-path search, branch, type, space and status before pagination", () => {
  const rows = [
    {
      id: "a",
      name: "A",
      path: "A",
      type: "Box",
      active: true,
      quantity: 5,
      remainingSpace: 95,
    },
    {
      id: "b",
      name: "B",
      path: "A / B",
      parentLocationId: "a",
      type: "Binder",
      active: false,
      quantity: 0,
      remainingSpace: null,
    },
    {
      id: "c",
      name: "C",
      path: "C",
      type: "Box",
      active: true,
      quantity: 100,
      remainingSpace: 0,
    },
  ];
  assert.deepEqual(
    browseLocations(rows, { space: "available" }).items.map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(
    browseLocations(rows, {
      space: "full",
      type: "Box",
      status: "active",
    }).items.map((x) => x.id),
    ["c"],
  );
  assert.deepEqual(
    browseLocations(rows, {
      q: "A /",
      parent: "a",
      space: "unknown",
      status: "inactive",
    }).items.map((x) => x.id),
    ["b"],
  );
  assert.equal(browseLocations(rows, { space: "empty" }).items[0].id, "b");
  assert.equal(
    browseLocations(rows, { parent: "foreign", space: "available" }).total,
    0,
  );
  const url = new URL(
    locationBrowseHref(
      { space: "available", type: "Box", status: "active" },
      { page: "2" },
    ),
    "http://localhost",
  );
  assert.equal(url.searchParams.get("space"), "available");
  assert.equal(url.searchParams.get("type"), "Box");
  assert.equal(url.searchParams.get("status"), "active");
});
