import assert from "node:assert/strict";
import test from "node:test";
import { compareInventoryGroups, inventorySortValue } from "../lib/inventory-sort";
import { getInventoryExactPrintings, getInventoryGroupedByCard, orderInventoryItemsByPageGroups, rollupInventoryPrintingGroups } from "../lib/inventory-locations";
import { prepareInventoryPageGroups, inventoryPageScopeWhere } from "../lib/inventory-page-groups";
import { inventoryCardMatchesPostFilters, parseInventoryFilters, constrainInventoryWhereToPostFilters } from "../lib/inventory-filters";
import { inventoryRowFacts } from "../lib/inventory-row-facts";
import { selectInventoryCardPrice } from "../lib/inventory-price";

const prices = { usd: "1", usd_foil: "9", usd_etched: "4", mtgjson: { tcgplayer: {
  normal: { retail: { USD: { amount: 3 } } }, foil: { retail: { USD: { amount: 30 } } }, etched: { retail: { USD: { amount: 7 } } },
} } };
const card = { id: "a", name: "Aurora", oracleId: "oracle", prices };
function lot(id: string, finish: string, cardId = "a", created = 1) {
  return { id, cardId, foilStatus: finish, quantity: 1, condition: "NM", language: "EN", currentOwnerId: "owner", sourceType: "MANUAL", currentOwner: { displayName: "Owner" }, card: { ...card, id: cardId }, location: null, createdAt: new Date(created) } as any;
}
const groups = ["NONFOIL", "FOIL", "ETCHED"].map(foilStatus => ({ cardId: "a", foilStatus, _sum: { quantity: 1 }, _count: { _all: 1 } }));
test("printing rollups and card groups retain all three finishes and their source IDs", () => {
  assert.equal(rollupInventoryPrintingGroups(groups).length, 3);
  const rows = getInventoryExactPrintings([lot("n1", "NONFOIL"), lot("n2", "NONFOIL"), lot("f", "FOIL"), lot("e", "ETCHED")], true);
  assert.equal(rows.length, 3); assert.deepEqual(rows.find(row => row.foilStatus === "NONFOIL")!.sourceItemIds, ["n1", "n2"]);
  const named = getInventoryGroupedByCard(rows); assert.equal(named.length, 3);
  assert.equal(new Set(named.map(row => row.id)).size, 3); assert.equal(named.reduce((n, row) => n + row.quantity, 0), 4);
});
test("both price aliases use the displayed finish and preferred source", () => {
  const cards = new Map<string, any>([["a", card]]);
  for (const field of ["priceUsd", "preferredPriceLabel"]) {
    const sorted = [...groups].sort((a,b) => compareInventoryGroups(a,b,cards,field,"desc","tcgplayer"));
    assert.deepEqual(sorted.map(row => row.foilStatus), ["FOIL", "ETCHED", "NONFOIL"]);
    assert.equal(inventorySortValue(groups[1], card, field, "tcgplayer").value, 30);
  }
});
test("missing and blank finish prices stay unknown, while zero remains a real price", () => {
  assert.equal(selectInventoryCardPrice({ usd: "100", usd_foil: null }, "FOIL"), null);
  assert.equal(selectInventoryCardPrice({ usd: "" }, "NONFOIL"), null);
  assert.equal(selectInventoryCardPrice({ usd: "0" }, "NONFOIL")!.amount, 0);
  assert.equal(selectInventoryCardPrice({ usd_foil: "5", mtgjson: { tcgplayer: { normal: { retail: { USD: { amount: 100 } } } } } }, "FOIL", "tcgplayer")!.amount, 5);
});
test("unit prices sort numerically with nulls last in both directions", () => {
  const cards = new Map<string, any>([ ["zero", { prices: { usd: "0" } }], ["low", { prices: { usd: "2" } }], ["high", { prices: { usd: "10" } }], ["missing", { prices: {} }] ]);
  const data = [...cards.keys()].map(cardId => ({ cardId, foilStatus: "NONFOIL", quantity: cardId === "low" ? 1000 : 1 }));
  for (const direction of ["asc", "desc"] as const) assert.deepEqual([...data].sort((a,b) => compareInventoryGroups(a,b,cards,"preferredPriceLabel",direction)).map(row => row.cardId), direction === "asc" ? ["zero", "low", "high", "missing"] : ["high", "low", "zero", "missing"]);
});
test("different currencies are ordered separately without pretending to convert them", () => {
  const cards = new Map<string, any>([ ["usd", { prices: { usd: "50" } }], ["eur", { prices: { mtgjson: { cardmarket: { normal: { retail: { EUR: { amount: 1 } } } } } } }] ]);
  for (const dir of ["asc", "desc"] as const) assert.deepEqual([...cards.keys()].map(cardId => ({ cardId })).sort((a,b) => compareInventoryGroups(a,b,cards,"preferredPriceLabel",dir,"cardmarket")).map(row => row.cardId), ["usd", "eur"]);
});
test("hydration retains the sorted representative within each card/finish group", () => {
  const cards = new Map<string, any>([["a", card], ["b", { ...card, id: "b", prices: { usd: "2" } }]]);
  const printingGroups = [{ ...groups[0], cardId: "a" }, { ...groups[0], cardId: "b" }, groups[1]];
  const page = prepareInventoryPageGroups(printingGroups, cards, "grouped", "preferredPriceLabel", "asc");
  assert.equal(page.sortedGroups.length, 2);
  const hydrated = orderInventoryItemsByPageGroups([lot("new-expensive", "NONFOIL", "b", 99), lot("old-cheap", "NONFOIL", "a", 1), lot("foil", "FOIL")], page.sortedGroups, "grouped");
  assert.equal(getInventoryGroupedByCard(getInventoryExactPrintings(hydrated))[0].representative.cardId, "a");
  assert.deepEqual(inventoryPageScopeWhere(page.sortedGroups.slice(1), "grouped"), { OR: [{ cardId: "a", foilStatus: "FOIL" }] });
});
test("USD filters and all-matching scope evaluate each finish separately", async () => {
  const filters = parseInventoryFilters({ priceMin: "5" });
  assert.equal(inventoryCardMatchesPostFilters(card, filters, "NONFOIL"), false);
  assert.equal(inventoryCardMatchesPostFilters(card, filters, "FOIL"), true);
  const db = { inventoryItem: { findMany: async () => groups.map(group => ({ cardId: "a", foilStatus: group.foilStatus, card })) } };
  const where = { currentOwnerId: "owner", OR: [{ locationId: null }, { locationId: "box" }] };
  assert.deepEqual(await constrainInventoryWhereToPostFilters(db, where, filters), { AND: [where, { OR: [{ cardId: "a", foilStatus: "FOIL" }] }] });
});
test("row labels describe mixed owners, sources and visibility honestly", () => {
  const rows = [lot("a", "NONFOIL"), { ...lot("b", "NONFOIL"), currentOwnerId: "other", currentOwner: { displayName: "Other" }, sourceType: "ACQUISITION", location: { visibility: "PUBLIC" } }];
  const facts = inventoryRowFacts(rows, { owner: "PRIVATE", other: "PRIVATE" });
  assert.equal(facts.currentOwner, "Multiple owners"); assert.equal(facts.sourceTypeLabel, "Mixed"); assert.equal(facts.effectiveVisibility, "MIXED");
});
