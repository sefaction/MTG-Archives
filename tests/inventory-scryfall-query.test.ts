import assert from "node:assert/strict";
import test from "node:test";
import {
  compileLocalScryfallQuery,
  constrainInventoryWhereToScryfallQuery,
  matchesLocalScryfallQuery,
} from "../lib/inventory-scryfall-query";

const krasis = {
  id: "card-krasis",
  name: "Hydroid Krasis",
  manaCost: "{X}{G}{U}",
  manaValue: 2,
  typeLine: "Creature — Jellyfish Hydra Beast",
  oracleText:
    "When you cast this spell, you gain half X life and draw half X cards.",
  colors: ["G", "U"],
  colorIdentity: ["G", "U"],
  setCode: "rna",
  setName: "Ravnica Allegiance",
  setType: "expansion",
  rarity: "mythic",
  artist: "Jason Felix",
  power: "0",
  toughness: "0",
  lang: "en",
  keywords: ["Flying", "Trample"],
  games: ["paper", "arena", "mtgo"],
  producedMana: [],
  legalities: { commander: "legal", standard: "not_legal" },
  prices: { usd: "8.25" },
  releasedAt: new Date("2019-01-25T00:00:00.000Z"),
  layout: "normal",
  frame: "2015",
  borderColor: "black",
  foil: true,
  nonfoil: true,
};

const endlessOne = {
  ...krasis,
  id: "card-endless-one",
  name: "Endless One",
  manaCost: "{X}",
  manaValue: 0,
  typeLine: "Creature — Eldrazi",
  oracleText: "Endless One enters with X +1/+1 counters on it.",
  colors: [],
  colorIdentity: [],
  setCode: "bfz",
  rarity: "rare",
};

test("local Scryfall mana syntax distinguishes includes from exact", () => {
  assert.equal(matchesLocalScryfallQuery(krasis, "m:x"), true);
  assert.equal(matchesLocalScryfallQuery(krasis, "m=x"), false);
  assert.equal(matchesLocalScryfallQuery(endlessOne, "m=x"), true);
  assert.equal(matchesLocalScryfallQuery(krasis, "m:{x}{g}{u}"), true);
});

test("local Scryfall expressions support aliases, grouping, OR, and negation", () => {
  assert.equal(
    matchesLocalScryfallQuery(krasis, 't:creature (c:g OR c:r) -o:"can\'t"'),
    true,
  );
  assert.equal(
    matchesLocalScryfallQuery(krasis, "t:artifact OR t:land"),
    false,
  );
  assert.equal(matchesLocalScryfallQuery(krasis, "-t:creature"), false);
});

test("local Scryfall expressions evaluate stored numeric and printing metadata", () => {
  assert.equal(
    matchesLocalScryfallQuery(
      krasis,
      "mv>=2 mv<3 set:rna r:m year=2019 legal:commander usd<10",
    ),
    true,
  );
  assert.equal(matchesLocalScryfallQuery(krasis, "id=gu kw:flying"), true);
  assert.equal(matchesLocalScryfallQuery(krasis, "id=g"), false);
});

test("unsupported Scryfall fields produce an explicit local error", () => {
  const compiled = compileLocalScryfallQuery("otag:ramp");
  assert.equal(compiled.ok, false);
  if (!compiled.ok) assert.match(compiled.error, /does not support “otag”/);
});

test("invalid regex terms invalidate the complete query, including negation and unused branches", () => {
  for (const query of [
    "name:/[/",
    "-name:/[/",
    "NOT name:/[/",
    "n:/[/",
    "o:/[/",
    "fulloracle:/[/",
    "t:/+/",
    "ft:/[/",
    "/[/",
    'name:"/(/"',
    'name:"/[z-a]/"',
    "t:artifact OR name:/[/",
    "t:creature name:/[/",
    "-(t:artifact OR name:/[/)",
  ]) {
    const compiled = compileLocalScryfallQuery(query);
    assert.equal(compiled.ok, false, query);
    if (!compiled.ok) assert.match(compiled.error, /Invalid regular expression/);
    assert.equal(matchesLocalScryfallQuery(krasis, query), false, query);
    assert.equal(matchesLocalScryfallQuery(endlessOne, query), false, query);
  }
});

test("valid regex searches preserve aliases, quotes, face text, negation and cached matching", () => {
  const card = {
    ...krasis,
    rawScryfallJson: { flavor_text: "A boundless life." },
    cardFaces: [{ name: "Hidden Hydra", oracleText: "Draw a card." }],
  };
  // Trailing text keeps the existing ordinary-text behavior.
  assert.equal(matchesLocalScryfallQuery(card, "n:/^hydroid/i"), false);
  for (const query of [
    'n:"/^(hydroid|endless)/"',
    "o:/draw/",
    "fulloracle:/draw/",
    "t:/creature/",
    "ft:/boundless/",
    "/krasis$/",
    "name:/hidden/",
    "-name:/^endless/",
  ]) {
    const compiled = compileLocalScryfallQuery(query);
    assert.equal(compiled.ok, true, query);
    if (compiled.ok) {
      assert.equal(compiled.matches(card), true, query);
      assert.equal(compiled.matches(card), true, `${query} repeated`);
    }
  }
  assert.equal(matchesLocalScryfallQuery(card, 'name:"[literal"'), false);
  assert.equal(
    matchesLocalScryfallQuery({ name: "[literal" }, 'name:"[literal"'),
    true,
  );
  assert.equal(matchesLocalScryfallQuery(endlessOne, "name:/krasis$/"), false);
});

test("invalid regex inventory constraints fail closed before any database read", async () => {
  const prisma = {
    inventoryItem: {
      findMany: async () => {
        assert.fail("Invalid queries must not read candidates");
      },
    },
    $queryRaw: async () => {
      assert.fail("Invalid queries must not read metadata");
    },
  };
  const where = { quantity: { gt: 0 }, currentOwnerId: "owner-1" };
  for (const query of ["name:/[/", "-name:/[/", "t:artifact OR name:/[/"]) {
    const result = await constrainInventoryWhereToScryfallQuery(
      prisma, where, query,
    );
    assert.match(result.error!, /Invalid regular expression/);
    assert.deepEqual(result.where, { ...where, cardId: { in: [] } });
    assert.deepEqual(where, { quantity: { gt: 0 }, currentOwnerId: "owner-1" });
  }
});

test("inventory constraint filters only locally stored candidate cards", async () => {
  let receivedWhere: unknown;
  const prisma = {
    inventoryItem: {
      findMany: async (args: any) => {
        receivedWhere = args.where;
        assert.deepEqual(args.select, { cardId: true });
        return [
          { cardId: krasis.id },
          { cardId: endlessOne.id },
        ];
      },
    },
    $queryRaw: async (query: any) => {
      assert.deepEqual(query.values.slice(-2), [krasis.id, endlessOne.id]);
      return [krasis, endlessOne];
    },
  };
  const baseWhere = { quantity: { gt: 0 }, currentOwnerId: "owner-1" };
  const result = await constrainInventoryWhereToScryfallQuery(
    prisma,
    baseWhere,
    "t:creature m=x",
  );
  assert.deepEqual(receivedWhere, baseWhere);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.where.cardId, { in: [endlessOne.id] });
  assert.equal(result.where.currentOwnerId, "owner-1");
});
