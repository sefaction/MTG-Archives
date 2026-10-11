import test from "node:test";
import assert from "node:assert/strict";
import { publicInventorySortMetadataSelect } from "../lib/public-collection";
import { inventoryCardMatchesPostFilters, parseInventoryFilters } from "../lib/inventory-filters";
import { compareInventoryGroups, INVENTORY_SORT_FIELDS } from "../lib/inventory-sort";
import { groupInventoryPageGroupsByCardName } from "../lib/inventory-locations";

const cards = [
  { id: "a", oracleId: "one", name: "Alpha", colors: ["W"], colorIdentity: ["W"], prices: { usd: "0.50" }, keywords: ["Flying"], cardFaces: [], setCode: "aaa", rarity: "rare", manaValue: 2, collectorNumber: "2", manaCost: "{1}{W}", typeLine: "Creature", releasedAt: new Date("2024-01-01") },
  { id: "b", oracleId: "one", name: "Alpha", colors: [], colorIdentity: ["U"], prices: { usd_foil: "2.00" }, keywords: ["Flash"], cardFaces: [{ colors: ["U"] }], setCode: "bbb", rarity: "common", manaValue: 0, collectorNumber: "10a", manaCost: "{U}", typeLine: "Artifact", releasedAt: null },
  { id: "c", oracleId: null, name: "Beta", colors: [], colorIdentity: [], prices: {}, keywords: [], cardFaces: [], setCode: "ccc", rarity: "mythic", manaValue: null, collectorNumber: "X", manaCost: "", typeLine: "Land", releasedAt: new Date("2023-01-01") },
];
const groups = cards.map((card, index) => ({ cardId: card.id, _sum: { quantity: index + 1 }, _count: { _all: 1 }, foilStatus: index === 1 ? "FOIL" : "NONFOIL", locationName: String(index), currentOwner: String(index) }));
function projectedCards(sort: string, params: string) {
  const select = publicInventorySortMetadataSelect(sort, parseInventoryFilters(new URLSearchParams(params)));
  return new Map(cards.map(card => [card.id, Object.fromEntries(Object.keys(select).map(key => [key, (card as any)[key]]))]));
}
function matchingGroups(sort: string, params: string, lean: boolean) {
  const filters = parseInventoryFilters(new URLSearchParams(params));
  const map = lean ? projectedCards(sort, params) : new Map(cards.map(card => [card.id, card]));
  return groups.filter(group => inventoryCardMatchesPostFilters(map.get(group.cardId), filters))
    .sort((a, b) => compareInventoryGroups(a, b, map, sort, "asc"));
}

test("name browsing omits metadata while preserving sorting and oracle/name grouping", () => {
  for (const params of ["", "cardName=Alpha", "set=aaa", "rarity=rare", "scryfallQuery=t%3Acreature"]) {
    const lean = projectedCards("cardName", params);
    assert.deepEqual(Object.keys(lean.get("a")!).sort(), ["id", "name", "oracleId"]);
    assert.deepEqual(matchingGroups("cardName", params, true), matchingGroups("cardName", params, false));
    assert.deepEqual(groupInventoryPageGroupsByCardName(groups, lean as any), groupInventoryPageGroupsByCardName(groups, new Map(cards.map(card => [card.id, card]))));
  }
});

test("metadata-dependent filters preserve matches, including face colors and zero price bounds", () => {
  for (const params of ["colors=U", "colors=W&colorMode=exact", "colorIdentity=U", "keyword=flying", "priceMin=0", "priceMax=0", "priceMin=1&priceMax=3", "colors=U&keyword=flash&priceMin=1"]) {
    assert.deepEqual(matchingGroups("cardName", params, true), matchingGroups("cardName", params, false), params);
  }
});

test("every other sort retains the complete legacy metadata and sort order in both directions", () => {
  for (const sort of INVENTORY_SORT_FIELDS.filter(value => value !== "cardName")) {
    const lean = projectedCards(sort, "");
    assert.ok(Object.hasOwn(lean.get("a")!, "cardFaces"), sort);
    for (const direction of ["asc", "desc"] as const) {
      const full = new Map(cards.map(card => [card.id, card]));
      assert.deepEqual([...groups].sort((a, b) => compareInventoryGroups(a, b, lean, sort, direction)), [...groups].sort((a, b) => compareInventoryGroups(a, b, full, sort, direction)), sort);
    }
  }
});
