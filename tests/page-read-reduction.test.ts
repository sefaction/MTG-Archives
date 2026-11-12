import assert from "node:assert/strict";
import test from "node:test";
import { TradeStatus } from "@prisma/client";
import { prepareInventoryPageGroups } from "../lib/inventory-page-groups";
import { groupInventoryPageGroupsByCardName } from "../lib/inventory-locations";
import {
  compareInventoryGroups,
  INVENTORY_SORT_FIELDS,
} from "../lib/inventory-sort";
import { inventorySortMetadataSelect } from "../lib/inventory-sort-metadata";
import { parseInventoryFilters } from "../lib/inventory-filters";
import { listPageInfo } from "../lib/list-browse";
import {
  activeTradeStatuses,
  terminalTradeStatuses,
  tradeStatusTotal,
  tradeVisibilityWhere,
  tradeViewWhere,
  readTradeHistory,
} from "../lib/trade-browse";

const groups = Array.from({ length: 200 }, (_, i) => ({
  cardId: String(i),
  currentOwnerId: "owner-" + (i % 4),
  foilStatus: i % 2 ? "FOIL" : "NONFOIL",
  condition: i % 3 ? "NM" : "LP",
  language: "EN",
  locationName: "Box " + (i % 7),
  locationSummary: "Box " + (i % 7),
  _sum: { quantity: (i % 9) + 1 },
  _count: { _all: (i % 3) + 1 },
}));
const cards = new Map(
  groups.map((g, i) => [
    g.cardId,
    {
      id: g.cardId,
      oracleId: "oracle-" + Math.floor(i / 2),
      name:
        ["Card 10", "Card 2", "Ángel", "Angel"][i % 4] +
        " " +
        Math.floor(i / 2),
      setCode: "s" + (i % 3),
      collectorNumber: i % 2 ? "10a" : "2",
      typeLine: i % 2 ? "Creature — Human" : "Artifact",
      rarity: i % 3 ? "common" : "rare",
      releasedAt: new Date(2026, i % 12, 1),
      manaValue: i % 6,
      manaCost: "{" + (i % 6) + "}",
      prices: { usd: String(i / 10) },
      colorIdentity: i % 2 ? ["U"] : [],
      colors: i % 2 ? ["U"] : [],
    },
  ]),
);
function before(
  mode: "exact" | "grouped",
  field: string,
  direction: "asc" | "desc",
  map = cards,
) {
  const compare = (a: (typeof groups)[number], b: (typeof groups)[number]) =>
    compareInventoryGroups(a, b, map, field, direction);
  const ordered = [...groups].sort(compare);
  const filteredGroups =
    mode === "grouped"
      ? groupInventoryPageGroupsByCardName(ordered, map)
      : groups;
  return { filteredGroups, sortedGroups: [...filteredGroups].sort(compare) };
}
test("all Inventory sort directions preserve complete groups, representatives, totals and input data", () => {
  const unchanged = JSON.stringify({ groups, cards: [...cards] });
  for (const field of INVENTORY_SORT_FIELDS)
    for (const direction of ["asc", "desc"] as const)
      for (const mode of ["exact", "grouped"] as const) {
        const expected = before(mode, field, direction),
          actual = prepareInventoryPageGroups(
            groups,
            cards,
            mode,
            field,
            direction,
          );
        assert.deepEqual(actual, expected, `${mode}/${field}/${direction}`);
        for (const page of [1, 2, 8])
          assert.deepEqual(
            actual.sortedGroups.slice((page - 1) * 25, page * 25),
            expected.sortedGroups.slice((page - 1) * 25, page * 25),
          );
      }
  assert.equal(JSON.stringify({ groups, cards: [...cards] }), unchanged);
});
test("exact preparation removes half the metadata comparisons while preserving collated order", () => {
  let reads = 0;
  const measured = new Map(cards);
  const original = measured.get.bind(measured);
  measured.get = (key) => {
    reads++;
    return original(key);
  };
  const expected = before("exact", "cardName", "asc", measured);
  const previous = reads;
  reads = 0;
  const actual = prepareInventoryPageGroups(
    groups,
    measured,
    "exact",
    "cardName",
    "asc",
  );
  assert.deepEqual(actual, expected);
  assert.ok(previous > 0);
  assert.equal(reads * 2, previous);
});
test("name-only API metadata omits unused JSON and keeps the full projection for post-filters", () => {
  assert.deepEqual(
    inventorySortMetadataSelect("cardName", parseInventoryFilters({})),
    { id: true, oracleId: true, name: true },
  );
  for (const filters of [
    { colors: "U" },
    { colorIdentity: "U" },
    { keyword: "flying" },
    { priceMin: "1" },
    { priceMax: "5" },
  ]) {
    const projection = inventorySortMetadataSelect(
      "cardName",
      parseInventoryFilters(filters),
    );
    assert.equal(projection.colors, true);
    assert.equal(projection.cardFaces, true);
    assert.equal(projection.prices, true);
  }
});
test("trade reads retain the authorization scope across every tab, filter and counter source", () => {
  const privateScope = tradeVisibilityWhere(false, "player-a");
  assert.deepEqual(privateScope, {
    OR: [{ proposerPlayerId: "player-a" }, { receiverPlayerId: "player-a" }],
  });
  assert.deepEqual(tradeVisibilityWhere(false, null), { id: { in: [] } });
  assert.deepEqual(tradeVisibilityWhere(true, null), {});
  for (const view of [
    undefined,
    "desk",
    "wishlist",
    "active",
    "history",
    "invalid",
  ]) {
    const where = tradeViewWhere(privateScope, {
      view,
      historyQ: "needle",
      historyStatus: "COMPLETED",
      counterTradeId: "another-owners-trade",
    });
    assert.deepEqual(where.AND && (where.AND as object[])[0], privateScope);
  }
  assert.deepEqual(tradeViewWhere(privateScope, { view: "wishlist" }), {
    AND: [privateScope, { id: { in: [] } }],
  });
  assert.deepEqual(tradeViewWhere(privateScope, { view: "active" }), {
    AND: [privateScope, { status: { in: activeTradeStatuses } }],
  });
  assert.deepEqual(
    tradeViewWhere(privateScope, { counterTradeId: "counter" }),
    { AND: [privateScope, { id: "counter" }] },
  );
  assert.deepEqual(
    readTradeHistory({
      historyStatus: "PROPOSED",
      page: "0",
      pageSize: "999",
      historyQ: "  name  ",
    }),
    { status: undefined, query: "name", page: 1, pageSize: 25 },
  );
  assert.equal(
    tradeStatusTotal(
      [
        { status: TradeStatus.COMPLETED, _count: { _all: 42 } },
        { status: TradeStatus.PROPOSED, _count: { _all: 3 } },
      ],
      terminalTradeStatuses,
    ),
    42,
  );
});
test("database paging clamps counts without allocating complete history rows", () => {
  assert.deepEqual(listPageInfo(120, 2, 25), {
    page: 2,
    pageSize: 25,
    totalPages: 5,
    total: 120,
    from: 26,
    to: 50,
  });
  assert.equal(listPageInfo(120, 999, 25).page, 5);
  assert.equal(listPageInfo(0, 999, 25).from, 0);
});
