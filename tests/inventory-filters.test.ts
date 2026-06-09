import test from "node:test";
import assert from "node:assert/strict";
import { FoilStatus } from "@prisma/client";
import {
  buildInventoryWhereFromFilters,
  matchesColors,
  parseInventoryFilters,
  removeInventoryFilterParams,
} from "../lib/inventory-filters";

test("inventory filter parser normalizes multi-select values", () => {
  const params = new URLSearchParams();
  params.append("rarity", "rare");
  params.append("rarity", "mythic,common");
  params.append("finish", "foil");
  params.append("finish", "etched");
  params.append("locationId", "box-1,box-2");
  params.append("type", "creature");
  params.append("type", "artifact");
  params.append("typeTokens", "Legendary,Angel");

  const filters = parseInventoryFilters(params);

  assert.deepEqual(filters.rarities, ["rare", "mythic", "common"]);
  assert.deepEqual(filters.finishes, [FoilStatus.FOIL, FoilStatus.ETCHED]);
  assert.deepEqual(filters.locationIds, ["box-1", "box-2"]);
  assert.deepEqual(filters.types, ["creature", "artifact"]);
  assert.deepEqual(filters.typeTokens, ["Legendary", "Angel"]);
});

test("inventory filter parser supports mana value and price operators", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("mvOp=lte&mv=3&priceMin=1.25&priceMax=4.5"),
  );

  assert.equal(filters.mvOp, "lte");
  assert.equal(filters.mv, 3);
  assert.equal(filters.priceMin, 1.25);
  assert.equal(filters.priceMax, 4.5);

  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: false,
    playerId: "player-1",
  });
  assert.deepEqual(where.card.manaValue, { lte: 3 });
  assert.equal(where.currentOwnerId, "player-1");
});

test("type token filters require all selected type tokens", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("typeTokens=Legendary,Angel"),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: true,
  });

  assert.deepEqual(where.AND[0], {
    AND: [
      { card: { typeLine: { contains: "Legendary", mode: "insensitive" } } },
      { card: { typeLine: { contains: "Angel", mode: "insensitive" } } },
    ],
  });
});

test("inventory color identity modes match Scryfall-style set comparisons", () => {
  assert.equal(matchesColors(["W", "U"], ["W"], "include"), true);
  assert.equal(matchesColors(["W", "U"], ["W"], "exact"), false);
  assert.equal(matchesColors(["W"], ["W", "U"], "atMost"), true);
  assert.equal(matchesColors(["W", "U"], ["W"], "atLeast"), true);
  assert.equal(matchesColors(["B"], ["W", "U"], "any"), false);
  assert.equal(matchesColors([], ["C"], "exact"), true);
});

test("clear filters removes structured inventory query params", () => {
  const params = new URLSearchParams(
    "cardName=sol&rarity=rare,mythic&finish=foil&page=3&sort=cardName&displayMode=grouped",
  );
  removeInventoryFilterParams(params);

  assert.equal(params.get("cardName"), null);
  assert.equal(params.get("rarity"), null);
  assert.equal(params.get("finish"), null);
  assert.equal(params.get("page"), null);
  assert.equal(params.get("sort"), "cardName");
  assert.equal(params.get("displayMode"), "grouped");
});

test("advanced search UI uses token autocomplete and keeps display mode outside filters", async () => {
  const [filterUi, browserUi] = await Promise.all([
    import("node:fs/promises").then((fs) =>
      fs.readFile("components/InventoryAdvancedSearch.tsx", "utf8"),
    ),
    import("node:fs/promises").then((fs) =>
      fs.readFile("components/InventoryBrowser.tsx", "utf8"),
    ),
  ]);

  assert.match(filterUi, /TYPE_SUGGESTIONS/);
  assert.match(filterUi, /name="typeTokens"/);
  assert.match(filterUi, /onKeyDown/);
  assert.match(filterUi, /inventory-card-name-options/);
  assert.doesNotMatch(filterUi, /Common card types/);
  assert.match(browserUi, /Display:/);
  assert.match(browserUi, /displayMode: next/);
});
