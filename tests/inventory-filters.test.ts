import test from "node:test";
import assert from "node:assert/strict";
import { FoilStatus } from "@prisma/client";
import {
  buildInventoryWhereFromFilters,
  constrainInventoryWhereToPostFilters,
  inventoryCardMatchesPostFilters,
  matchesColors,
  parseInventoryFilters,
  removeInventoryFilterParams,
} from "../lib/inventory-filters";
import {
  extractTypeLineTokens,
  extractTypeLineTokensFromCard,
  suggestionScopeSearchParams,
} from "../lib/inventory-filter-suggestions";

test("inventory filter parser normalizes multi-select values", () => {
  const params = new URLSearchParams();
  params.append("rarity", "rare");
  params.append("rarity", "mythic,common");
  params.append("finish", "foil");
  params.append("finish", "etched");
  params.append("locationId", "box-1,box-2");
  params.append("locationType", "Binder");
  params.append("locationType", "Box");
  params.append("type", "creature");
  params.append("type", "artifact");
  params.append("typeTokens", "Legendary,Angel");

  const filters = parseInventoryFilters(params);

  assert.deepEqual(filters.rarities, ["rare", "mythic", "common"]);
  assert.deepEqual(filters.finishes, [FoilStatus.FOIL, FoilStatus.ETCHED]);
  assert.deepEqual(filters.locationIds, ["box-1", "box-2"]);
  assert.deepEqual(filters.locationTypes, ["Binder", "Box"]);
  assert.deepEqual(filters.types, ["creature", "artifact"]);
  assert.deepEqual(filters.typeTokens, ["Legendary", "Angel"]);
});

test("inventory location type filter applies to private inventory queries", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("locationType=Binder&locationType=Box"),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: true,
  });

  assert.deepEqual(where.AND[0], {
    OR: [
      { location: { type: { equals: "Binder", mode: "insensitive" } } },
      { location: { type: { equals: "Box", mode: "insensitive" } } },
    ],
  });
});

test("reserved Deck location type filters by system deck kind", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("locationType=Deck"),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: false,
    playerId: "player-1",
  });

  assert.deepEqual(where.AND[0], {
    OR: [{ location: { kind: "DECK" } }],
  });
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

test("inventory owner filters support multiple selected owners", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("ownerId=player-1&ownerId=player-2"),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: true,
  });

  assert.deepEqual(filters.ownerIds, ["player-1", "player-2"]);
  assert.deepEqual(where.currentOwnerId, { in: ["player-1", "player-2"] });
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

test("card color filtering is distinct from color identity", () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("colors=C&colorMode=exact"),
  );

  assert.deepEqual(filters.colors, ["C"]);
  assert.equal(filters.colorMode, "exact");
  assert.equal(
    inventoryCardMatchesPostFilters(
      { colors: [], colorIdentity: ["R"] },
      filters,
    ),
    true,
  );
  assert.equal(
    inventoryCardMatchesPostFilters(
      { colors: ["R"], colorIdentity: ["R"] },
      filters,
    ),
    false,
  );
});

test("card color filtering uses the front face when Scryfall omits top-level colors", () => {
  const whiteFilters = parseInventoryFilters(
    new URLSearchParams("colors=W&colorMode=exact"),
  );
  const colorlessFilters = parseInventoryFilters(
    new URLSearchParams("colors=C&colorMode=exact"),
  );
  const brigid = {
    colors: [],
    colorIdentity: ["G", "W"],
    cardFaces: [
      { name: "Brigid, Clachan's Heart", colors: ["W"] },
      { name: "Brigid, Doun's Mind", colors: ["G"] },
    ],
  };

  assert.equal(inventoryCardMatchesPostFilters(brigid, whiteFilters), true);
  assert.equal(
    inventoryCardMatchesPostFilters(brigid, colorlessFilters),
    false,
  );
});

test("card color filtering accepts serialized display-row colors", () => {
  const whiteFilters = parseInventoryFilters(
    new URLSearchParams("colors=W&colorMode=exact"),
  );
  const colorlessFilters = parseInventoryFilters(
    new URLSearchParams("colors=C&colorMode=exact"),
  );
  const monoWhiteCard = {
    colors: "W",
    colorIdentity: "W",
    cardFaces: [],
  };

  assert.equal(
    inventoryCardMatchesPostFilters(monoWhiteCard, whiteFilters),
    true,
  );
  assert.equal(
    inventoryCardMatchesPostFilters(monoWhiteCard, colorlessFilters),
    false,
  );
});

test("all-matching mutations constrain database candidates to post-filtered cards", async () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("colors=W&colorMode=exact&keyword=flying"),
  );
  const where = {
    quantity: { gt: 0 },
    locationId: "source-location",
  };
  let receivedArgs: any;
  const prisma = {
    inventoryItem: {
      findMany: async (args: any) => {
        receivedArgs = args;
        return [
          {
            cardId: "matching-white-card",
            card: { colors: ["W"], keywords: ["Flying"] },
          },
          {
            cardId: "nonmatching-blue-card",
            card: { colors: ["U"], keywords: ["Flying"] },
          },
          {
            cardId: "nonmatching-white-card",
            card: { colors: ["W"], keywords: ["Vigilance"] },
          },
        ];
      },
    },
  };

  const constrained = await constrainInventoryWhereToPostFilters(
    prisma,
    where,
    filters,
  );

  assert.equal(receivedArgs.where, where);
  assert.deepEqual(receivedArgs.distinct, ["cardId"]);
  assert.deepEqual(constrained, {
    ...where,
    cardId: { in: ["matching-white-card"] },
  });
});

test("all-matching mutations preserve database-only filters without extra lookup", async () => {
  const filters = parseInventoryFilters(
    new URLSearchParams("cardName=Angel&locationId=source-location"),
  );
  const where = buildInventoryWhereFromFilters(filters, {
    adminModeActive: false,
    playerId: "player-1",
  });
  const prisma = {
    inventoryItem: {
      findMany: async () => {
        throw new Error("post-filter lookup should not run");
      },
    },
  };

  assert.equal(
    await constrainInventoryWhereToPostFilters(prisma, where, filters),
    where,
  );
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

test("type-line suggestion helper extracts scoped autocomplete tokens", () => {
  assert.deepEqual(
    extractTypeLineTokens("Legendary Creature — Human Avatar Ally"),
    ["Legendary", "Creature", "Human", "Avatar", "Ally"],
  );
  assert.deepEqual(extractTypeLineTokens("Artifact Creature — Construct"), [
    "Artifact",
    "Creature",
    "Construct",
  ]);
  assert.deepEqual(extractTypeLineTokens("Instant — Lesson"), [
    "Instant",
    "Lesson",
  ]);
  assert.deepEqual(
    extractTypeLineTokensFromCard({
      typeLine: "Legendary Creature — Human Avatar Ally",
      cardFaces: [
        { type_line: "Creature — Avatar" },
        { type_line: "Legendary Enchantment — Shrine" },
      ],
    }),
    [
      "Legendary",
      "Creature",
      "Human",
      "Avatar",
      "Ally",
      "Enchantment",
      "Shrine",
    ],
  );
});

test("suggestion scope params keep owner and visibility scope without typed filters", () => {
  const scoped = suggestionScopeSearchParams(
    new URLSearchParams(
      "cardName=sol&typeTokens=Angel&set=tla&owner=public-slug&ownerId=player-1&locationId=box-1&visibility=public&page=3",
    ),
  );

  assert.equal(scoped.get("owner"), "public-slug");
  assert.equal(scoped.get("ownerId"), "player-1");
  assert.equal(scoped.get("locationId"), "box-1");
  assert.equal(scoped.get("visibility"), "public");
  assert.equal(scoped.get("cardName"), null);
  assert.equal(scoped.get("typeTokens"), null);
  assert.equal(scoped.get("set"), null);
  assert.equal(scoped.get("page"), null);
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

  assert.doesNotMatch(filterUi, /TYPE_SUGGESTIONS/);
  assert.match(filterUi, /suggestionsEndpoint/);
  assert.match(filterUi, /url\.searchParams\.set\("kind", kind\)/);
  assert.match(filterUi, /name="typeTokens"/);
  assert.match(filterUi, /onKeyDown/);
  assert.match(filterUi, /function AutocompleteInput/);
  assert.match(filterUi, /function TokenAutocompleteInput/);
  assert.match(filterUi, /function AutocompleteSuggestionList/);
  assert.match(filterUi, /function FilterChipBar/);
  assert.match(filterUi, /label="Type line"/);
  assert.match(filterUi, /label="Set"/);
  assert.match(filterUi, /aria-label={`Remove/);
  assert.doesNotMatch(filterUi, /Common card types/);
  assert.match(browserUi, /Display:/);
  assert.match(browserUi, /displayMode: next/);
});
