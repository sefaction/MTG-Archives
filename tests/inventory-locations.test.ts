import assert from "node:assert/strict";
import test from "node:test";

import {
  getInventoryExactPrintings,
  getInventoryGroupedByCard,
  locationSummary,
  normalizeLocationName,
} from "../lib/inventory-locations";

function makeItem(overrides: any = {}) {
  return {
    id: overrides.id ?? "item-1",
    currentOwnerId: overrides.currentOwnerId ?? "owner-1",
    originalOpenerId: overrides.originalOpenerId ?? "owner-1",
    cardId: overrides.cardId ?? "card-sol-ring-cmm",
    foil: overrides.foil ?? false,
    foilStatus: overrides.foilStatus ?? "NONFOIL",
    condition: overrides.condition ?? "NM",
    language: overrides.language ?? "EN",
    quantity: overrides.quantity ?? 1,
    locationId: overrides.locationId ?? null,
    location: overrides.location ?? null,
    card: {
      id: overrides.cardId ?? "card-sol-ring-cmm",
      name: overrides.cardName ?? "Sol Ring",
      oracleId: overrides.oracleId ?? "oracle-sol-ring",
      setCode: overrides.setCode ?? "cmm",
      setName: overrides.setName ?? "Commander Masters",
      collectorNumber: overrides.collectorNumber ?? "001",
      rarity: overrides.rarity ?? "uncommon",
      imageUri: null,
      imageUris: null,
      typeLine: "Artifact",
    },
  };
}

test("normalizes location names for per-owner uniqueness without changing display labels", () => {
  assert.equal(normalizeLocationName("  Box-0001  "), "box-0001");
  assert.equal(normalizeLocationName("Trade   Binder"), "trade binder");
});

test("same exact printing in multiple locations shows one total and a location breakdown", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "box-row",
      quantity: 3,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
    makeItem({
      id: "shelf-row",
      quantity: 2,
      locationId: "loc-shelf",
      location: { id: "loc-shelf", name: "Shelf-0002", type: "Shelf" },
    }),
  ] as any[]);

  assert.equal(exactRows.length, 1);
  assert.equal(exactRows[0].quantity, 5);
  assert.deepEqual(
    exactRows[0].locationBreakdown.map(
      (entry: { name: string; quantity: number }) => [
        entry.name,
        entry.quantity,
      ],
    ),
    [
      ["Box-0001", 3],
      ["Shelf-0002", 2],
    ],
  );
  assert.equal(exactRows[0].sourceItemIds.length, 2);
});

test("different printings of the same oracle card group into one card-name total", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "cmm",
      cardId: "card-sol-ring-cmm",
      setCode: "cmm",
      collectorNumber: "001",
      quantity: 1,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
    makeItem({
      id: "ltc",
      cardId: "card-sol-ring-ltc",
      setCode: "ltc",
      collectorNumber: "310",
      quantity: 1,
      locationId: "loc-binder",
      location: { id: "loc-binder", name: "Binder-0003", type: "Binder" },
    }),
    makeItem({
      id: "who",
      cardId: "card-sol-ring-who",
      setCode: "who",
      collectorNumber: "250",
      quantity: 3,
      locationId: "loc-box",
      location: { id: "loc-box", name: "Box-0001", type: "Box" },
    }),
  ] as any[]);
  const grouped = getInventoryGroupedByCard(exactRows);

  assert.equal(exactRows.length, 3, "exact mode keeps printings separate");
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].cardName, "Sol Ring");
  assert.equal(grouped[0].quantity, 5);
  assert.equal(grouped[0].printingCount, 3);
  assert.equal(grouped[0].locationCount, 2);
});

test("grouping falls back to normalized card name when oracle id is missing", () => {
  const exactRows = getInventoryExactPrintings([
    makeItem({
      id: "a",
      cardId: "card-a",
      oracleId: null,
      cardName: "Lightning Bolt",
      setCode: "lea",
    }),
    makeItem({
      id: "b",
      cardId: "card-b",
      oracleId: null,
      cardName: " Lightning   Bolt ",
      setCode: "clu",
    }),
  ] as any[]);
  const grouped = getInventoryGroupedByCard(exactRows);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].quantity, 2);
});

test("location summary remains compact for many locations", () => {
  assert.equal(
    locationSummary([
      { name: "Box-0001", quantity: 1 },
      { name: "Box-0002", quantity: 2 },
      { name: "Binder-0003", quantity: 3 },
    ]),
    "6 copies in 3 locations",
  );
});
