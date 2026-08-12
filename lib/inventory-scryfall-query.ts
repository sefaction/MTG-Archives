const MAX_QUERY_LENGTH = 1_000;

type QueryNode =
  | { kind: "term"; field: string; operator: string; value: string }
  | { kind: "and" | "or"; children: QueryNode[] }
  | { kind: "not"; child: QueryNode };

type CompiledQuery =
  { ok: true; matches: (card: any) => boolean } | { ok: false; error: string };

const compiledCache = new Map<string, CompiledQuery>();

const FIELD_ALIASES: Record<string, string> = {
  n: "name",
  o: "oracle",
  text: "oracle",
  fo: "fulloracle",
  t: "type",
  m: "mana",
  cmc: "mv",
  f: "format",
  c: "color",
  id: "identity",
  ci: "identity",
  e: "set",
  s: "set",
  r: "rarity",
  a: "artist",
  kw: "keyword",
  ft: "flavor",
  wm: "watermark",
  pow: "power",
  tou: "toughness",
  loy: "loyalty",
  def: "defense",
  cn: "number",
  lang: "language",
  st: "settype",
  game: "game",
};

const SUPPORTED_FIELDS = new Set([
  "name",
  "oracle",
  "fulloracle",
  "type",
  "mana",
  "mv",
  "color",
  "identity",
  "commander",
  "set",
  "setname",
  "settype",
  "rarity",
  "artist",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "number",
  "date",
  "year",
  "language",
  "keyword",
  "flavor",
  "watermark",
  "layout",
  "frame",
  "border",
  "stamp",
  "game",
  "produces",
  "devotion",
  "format",
  "in",
  "legal",
  "banned",
  "restricted",
  "is",
  "has",
  "usd",
  "eur",
  "tix",
  "unique",
  "order",
  "direction",
  "prefer",
  "include",
  "cheapest",
  "display",
]);

const DIRECTIVE_FIELDS = new Set([
  "unique",
  "order",
  "direction",
  "prefer",
  "include",
  "cheapest",
  "display",
]);

const SUPPORTED_IS_VALUES = new Set([
  "legendary",
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "land",
  "battle",
  "tribal",
  "kindred",
  "split",
  "flip",
  "transform",
  "meld",
  "modaldfc",
  "dfc",
  "mdfc",
  "tdfc",
  "adventure",
  "saga",
  "class",
  "spell",
  "permanent",
  "historic",
  "vanilla",
  "bear",
  "modal",
  "party",
  "outlaw",
  "commander",
  "companion",
  "partner",
  "reserved",
  "hybrid",
  "phyrexian",
  "foil",
  "nonfoil",
  "promo",
  "fullart",
  "textless",
  "reprint",
  "firstprint",
  "digital",
  "oversized",
  "hires",
  "highres",
  "spotlight",
  "booster",
]);

const SUPPORTED_HAS_VALUES = new Set([
  "watermark",
  "flavor",
  "artist",
  "securitystamp",
  "indicator",
  "phyrexianmana",
  "contentwarning",
  "arenaid",
  "illustration",
  "manacost",
  "oracletext",
]);

const COLOR_ALIASES: Record<string, string> = {
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
  azorius: "wu",
  dimir: "ub",
  rakdos: "br",
  gruul: "rg",
  selesnya: "gw",
  orzhov: "wb",
  izzet: "ur",
  golgari: "bg",
  boros: "rw",
  simic: "gu",
  bant: "wug",
  esper: "wub",
  grixis: "ubr",
  jund: "brg",
  naya: "rgw",
  abzan: "wbg",
  jeskai: "urw",
  sultai: "bgu",
  mardu: "rwb",
  temur: "gur",
};

function tokenize(query: string) {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaped = false;
  for (const character of query) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      token += character;
      escaped = true;
      continue;
    }
    if (quote) {
      token += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      token += character;
      continue;
    }
    if (character === "(" || character === ")") {
      if (token) tokens.push(token);
      tokens.push(character);
      token = "";
      continue;
    }
    if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += character;
  }
  if (quote) throw new Error("Close the quoted search value.");
  if (token) tokens.push(token);
  return tokens;
}

function unquote(value: string) {
  const first = value[0];
  if ((first === '"' || first === "'") && value.at(-1) === first)
    return value.slice(1, -1).replace(/\\([\\"'])/g, "$1");
  return value;
}

function parseQuery(query: string): QueryNode {
  const tokens = tokenize(query);
  let index = 0;

  function parseOr(): QueryNode {
    const children = [parseAnd()];
    while (tokens[index]?.toUpperCase() === "OR") {
      index += 1;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: "or", children };
  }

  function parseAnd(): QueryNode {
    const children: QueryNode[] = [];
    while (
      index < tokens.length &&
      tokens[index] !== ")" &&
      tokens[index].toUpperCase() !== "OR"
    ) {
      if (tokens[index].toUpperCase() === "AND") index += 1;
      else children.push(parseUnary());
    }
    if (!children.length) throw new Error("Expected a search argument.");
    return children.length === 1 ? children[0] : { kind: "and", children };
  }

  function parseUnary(): QueryNode {
    let raw = tokens[index];
    if (!raw) throw new Error("Expected a search argument.");
    if (raw === "-" || raw.toUpperCase() === "NOT") {
      index += 1;
      return { kind: "not", child: parseUnary() };
    }
    if (raw.startsWith("-") && raw.length > 1) {
      tokens[index] = raw.slice(1);
      return { kind: "not", child: parseUnary() };
    }
    if (raw === "(") {
      index += 1;
      const child = parseOr();
      if (tokens[index] !== ")")
        throw new Error("Close the parenthesized search group.");
      index += 1;
      return child;
    }
    if (raw === ")") throw new Error("Unexpected closing parenthesis.");
    index += 1;
    const match = raw.match(/^([a-z][a-z0-9_-]*)(!=|<=|>=|:|=|<|>)(.+)$/i);
    if (!match)
      return {
        kind: "term",
        field: "name",
        operator: ":",
        value: unquote(raw),
      };
    const field =
      FIELD_ALIASES[match[1].toLowerCase()] ?? match[1].toLowerCase();
    if (!SUPPORTED_FIELDS.has(field))
      throw new Error(
        `The local card database does not support “${match[1]}” yet.`,
      );
    const value = unquote(match[3]);
    const normalizedSpecialValue = value.toLowerCase().replace(/[-_]/g, "");
    if (field === "is" && !SUPPORTED_IS_VALUES.has(normalizedSpecialValue))
      throw new Error(
        `The local card database does not support “is:${value}” yet.`,
      );
    if (field === "has" && !SUPPORTED_HAS_VALUES.has(normalizedSpecialValue))
      throw new Error(
        `The local card database does not support “has:${value}” yet.`,
      );
    return {
      kind: "term",
      field,
      operator: match[2],
      value,
    };
  }

  if (!tokens.length) throw new Error("Enter at least one search argument.");
  const node = parseOr();
  if (index !== tokens.length)
    throw new Error(`Unexpected token “${tokens[index]}”.`);
  return node;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value === null || value === undefined) return [];
  if (typeof value === "object") return Object.values(value).flatMap(strings);
  return [String(value)];
}

function faceValues(card: any, key: string) {
  const raw = card?.rawScryfallJson ?? {};
  const faces = Array.isArray(card?.cardFaces)
    ? card.cardFaces
    : Array.isArray(raw?.card_faces)
      ? raw.card_faces
      : [];
  const snakeKey = key.replace(
    /[A-Z]/g,
    (letter) => `_${letter.toLowerCase()}`,
  );
  return faces.flatMap((face: any) => strings(face?.[key] ?? face?.[snakeKey]));
}

function textValues(card: any, field: string): string[] {
  const raw = card?.rawScryfallJson ?? {};
  if (field === "name")
    return [card?.name, card?.printedName, ...faceValues(card, "name")].flatMap(
      strings,
    );
  if (field === "oracle" || field === "fulloracle")
    return [
      card?.oracleText,
      card?.printedText,
      raw?.oracle_text,
      ...faceValues(card, "oracleText"),
    ].flatMap(strings);
  if (field === "type")
    return [
      card?.typeLine,
      card?.printedTypeLine,
      ...faceValues(card, "typeLine"),
    ].flatMap(strings);
  if (field === "mana")
    return [card?.manaCost, ...faceValues(card, "manaCost")].flatMap(strings);
  const mapping: Record<string, unknown> = {
    set: card?.setCode,
    setname: card?.setName,
    settype: card?.setType,
    rarity: card?.rarity,
    artist: card?.artist,
    power: card?.power,
    toughness: card?.toughness,
    loyalty: card?.loyalty,
    defense: card?.defense,
    number: card?.collectorNumber,
    language: card?.lang,
    keyword: card?.keywords ?? raw?.keywords,
    flavor: raw?.flavor_text,
    watermark: raw?.watermark,
    layout: card?.layout,
    frame: card?.frame,
    border: card?.borderColor,
    stamp: card?.securityStamp,
    game: card?.games,
    produces: card?.producedMana,
  };
  return strings(mapping[field]);
}

function compareText(values: string[], operator: string, wanted: string) {
  const needle = wanted.toLowerCase();
  const matches = values.some((value) => {
    const actual = value.toLowerCase();
    if (operator === ":") return actual.includes(needle);
    if (operator === "=" || operator === "!=") return actual === needle;
    const comparison = actual.localeCompare(needle);
    if (operator === ">") return comparison > 0;
    if (operator === ">=") return comparison >= 0;
    if (operator === "<") return comparison < 0;
    return comparison <= 0;
  });
  return operator === "!=" ? !matches : matches;
}

function compareNumber(actual: unknown, operator: string, rawWanted: string) {
  const left = Number(actual);
  const range = rawWanted.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if (range)
    return (
      Number.isFinite(left) &&
      left >= Number(range[1]) &&
      left <= Number(range[2])
    );
  const right = Number(rawWanted);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === ":" || operator === "=") return left === right;
  if (operator === "!=") return left !== right;
  if (operator === "<") return left < right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left >= right;
}

function normalizeMana(value: string) {
  const upper = value.toUpperCase().replace(/\s+/g, "");
  if (upper.includes("{")) return upper;
  return upper
    .split("")
    .map((symbol) => `{${symbol}}`)
    .join("");
}

function colorSet(value: unknown) {
  const input = Array.isArray(value) ? value.join("") : String(value ?? "");
  const raw = COLOR_ALIASES[input.toLowerCase()] ?? input;
  return new Set(raw.toUpperCase().match(/[WUBRG]/g) ?? []);
}

function compareColors(
  actualValue: unknown,
  operator: string,
  rawWanted: string,
) {
  const wantedText = rawWanted.toLowerCase();
  const actual = colorSet(actualValue);
  if (wantedText === "colorless" || wantedText === "c")
    return actual.size === 0;
  if (wantedText === "multicolor" || wantedText === "m") return actual.size > 1;
  if (wantedText === "monocolor") return actual.size === 1;
  const wanted = colorSet(rawWanted);
  const includes = [...wanted].every((color) => actual.has(color));
  const subset = [...actual].every((color) => wanted.has(color));
  if (operator === "=" || operator === "!=") {
    const exact = includes && subset;
    return operator === "!=" ? !exact : exact;
  }
  if (operator === "<" || operator === "<=")
    return subset && (operator === "<" ? actual.size < wanted.size : true);
  if (operator === ">" || operator === ">=")
    return includes && (operator === ">" ? actual.size > wanted.size : true);
  return includes;
}

function booleanFlag(card: any, rawFlag: string) {
  const flag = rawFlag.toLowerCase().replace(/[-_]/g, "");
  const direct: Record<string, unknown> = {
    foil: card?.foil,
    nonfoil: card?.nonfoil,
    reserved: card?.reserved,
    promo: card?.promo,
    reprint: card?.reprint,
    variation: card?.variation,
    digital: card?.digital,
    fullart: card?.fullArt,
    textless: card?.textless,
    booster: card?.booster,
    story: card?.storySpotlight,
    oversized: card?.oversized,
    highres: card?.highresImage,
    hires: card?.highresImage,
    spotlight: card?.storySpotlight,
    firstprint: card?.reprint === false,
  };
  if (flag in direct) return direct[flag] === true;
  const type = String(card?.typeLine ?? "").toLowerCase();
  if (flag === "permanent")
    return /artifact|battle|creature|enchantment|land|planeswalker/.test(type);
  if (flag === "spell") return !type.includes("land");
  if (flag === "historic") return /artifact|legendary|saga/.test(type);
  if (flag === "modal") return String(card?.oracleText ?? "").includes("•");
  if (flag === "legendary") return type.includes("legendary");
  if (
    [
      "creature",
      "instant",
      "sorcery",
      "artifact",
      "enchantment",
      "planeswalker",
      "land",
      "battle",
      "tribal",
      "kindred",
      "saga",
      "class",
    ].includes(flag)
  )
    return type.includes(flag === "tribal" ? "tribal" : flag);
  if (flag === "vanilla")
    return type.includes("creature") && !String(card?.oracleText ?? "").trim();
  if (flag === "bear")
    return (
      type.includes("creature") &&
      Number(card?.manaValue) === 2 &&
      String(card?.power) === "2" &&
      String(card?.toughness) === "2"
    );
  if (flag === "party") return /cleric|rogue|warrior|wizard/.test(type);
  if (flag === "outlaw")
    return /assassin|mercenary|pirate|rogue|warlock/.test(type);
  if (flag === "companion")
    return strings(card?.keywords).some(
      (keyword) => keyword.toLowerCase() === "companion",
    );
  if (flag === "partner")
    return strings(card?.keywords).some((keyword) =>
      keyword.toLowerCase().includes("partner"),
    );
  if (flag === "commander")
    return (
      (/legendary/.test(type) && /creature|vehicle/.test(type)) ||
      /can be your commander/i.test(String(card?.oracleText ?? ""))
    );
  if (flag === "hybrid")
    return /\{[^}]*\/[WUBRG][^}]*\}/i.test(String(card?.manaCost ?? ""));
  if (flag === "phyrexian") return /\/P\}/i.test(String(card?.manaCost ?? ""));
  if (flag === "dfc")
    return ["transform", "modal_dfc", "reversible_card"].includes(
      String(card?.layout ?? ""),
    );
  if (flag === "mdfc") return String(card?.layout ?? "") === "modal_dfc";
  if (flag === "tdfc") return String(card?.layout ?? "") === "transform";
  if (
    ["split", "transform", "modaldfc", "meld", "flip", "adventure"].includes(
      flag,
    )
  )
    return (
      String(card?.layout ?? "")
        .replace(/[-_]/g, "")
        .toLowerCase() === flag
    );
  return undefined;
}

function hasField(card: any, rawField: string) {
  const raw = card?.rawScryfallJson ?? {};
  const field = rawField.toLowerCase().replace(/[-_]/g, "");
  const values: Record<string, unknown> = {
    watermark: raw?.watermark,
    flavor: raw?.flavor_text,
    artist: card?.artist,
    securitystamp: card?.securityStamp,
    indicator: card?.colorIndicator,
    phyrexianmana: String(card?.manaCost ?? "").includes("/P}"),
    contentwarning: raw?.content_warning,
    arenaid: card?.arenaId ?? raw?.arena_id,
    illustration: card?.illustrationId ?? raw?.illustration_id,
    manacost: card?.manaCost ?? raw?.mana_cost,
    oracletext: card?.oracleText ?? raw?.oracle_text,
  };
  if (!(field in values)) return undefined;
  const value = values[field];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function matchTerm(card: any, term: Extract<QueryNode, { kind: "term" }>) {
  const { field, operator, value } = term;
  if (DIRECTIVE_FIELDS.has(field)) return true;
  if (field === "mana") {
    const wanted = normalizeMana(value);
    return compareText(textValues(card, field), operator, wanted);
  }
  if (field === "mv") return compareNumber(card?.manaValue, operator, value);
  if (
    ["power", "toughness", "loyalty", "defense"].includes(field) &&
    /^(?:!=|<=|>=|=|<|>|:)$/.test(operator)
  ) {
    const comparisonField =
      FIELD_ALIASES[value.toLowerCase()] ?? value.toLowerCase();
    if (
      ["mv", "power", "toughness", "loyalty", "defense"].includes(
        comparisonField,
      )
    ) {
      const comparisonValue =
        comparisonField === "mv" ? card?.manaValue : card?.[comparisonField];
      return compareNumber(card?.[field], operator, String(comparisonValue));
    }
    if (/^-?\d+(?:\.\d+)?$/.test(value))
      return compareNumber(card?.[field], operator, value);
  }
  if (field === "color") return compareColors(card?.colors, operator, value);
  if (field === "identity")
    return compareColors(card?.colorIdentity, operator, value);
  if (field === "commander") {
    const withinIdentity = compareColors(card?.colorIdentity, "<=", value);
    const legal = String(
      (card?.legalities ?? card?.rawScryfallJson?.legalities)?.commander ?? "",
    ).toLowerCase();
    return withinIdentity && ["legal", "restricted"].includes(legal);
  }
  if (field === "devotion") {
    const cost = textValues(card, "mana").join("").toUpperCase();
    const symbols = normalizeMana(value).match(/\{[^}]+\}/g) ?? [];
    return symbols.every((symbol) => cost.includes(symbol));
  }
  if (field === "year")
    return compareNumber(
      card?.releasedAt ? new Date(card.releasedAt).getUTCFullYear() : undefined,
      operator,
      value,
    );
  if (field === "date")
    return compareText(
      strings(
        card?.releasedAt
          ? new Date(card.releasedAt).toISOString().slice(0, 10)
          : undefined,
      ),
      operator,
      value,
    );
  if (["usd", "eur", "tix"].includes(field))
    return compareNumber(card?.prices?.[field], operator, value);
  if (["legal", "banned", "restricted", "format"].includes(field)) {
    const legalities = card?.legalities ?? card?.rawScryfallJson?.legalities;
    if (field === "format")
      return ["legal", "restricted"].includes(
        String(legalities?.[value.toLowerCase()] ?? "").toLowerCase(),
      );
    const status = field === "legal" ? ["legal", "restricted"] : [field];
    return status.includes(
      String(legalities?.[value.toLowerCase()] ?? "").toLowerCase(),
    );
  }
  if (field === "in") {
    const needle = value.toLowerCase();
    if (["paper", "arena", "mtgo"].includes(needle))
      return strings(card?.games ?? card?.rawScryfallJson?.games).some(
        (game) => game.toLowerCase() === needle,
      );
    if (["foil", "nonfoil", "etched"].includes(needle))
      return strings(card?.finishes ?? card?.rawScryfallJson?.finishes).some(
        (finish) => finish.toLowerCase() === needle,
      );
    return [card?.setCode, card?.setName, card?.setType]
      .flatMap(strings)
      .some((entry) => entry.toLowerCase().includes(needle));
  }
  if (field === "is") {
    const result = booleanFlag(card, value);
    return result ?? false;
  }
  if (field === "has") {
    const result = hasField(card, value);
    return result ?? false;
  }
  if (
    ["name", "oracle", "fulloracle", "type", "flavor"].includes(field) &&
    value.startsWith("/") &&
    value.endsWith("/")
  ) {
    try {
      const expression = new RegExp(value.slice(1, -1), "i");
      return textValues(card, field).some((text) => expression.test(text));
    } catch {
      return false;
    }
  }
  const normalizedValue =
    field === "rarity"
      ? ((
          { c: "common", u: "uncommon", r: "rare", m: "mythic" } as Record<
            string,
            string
          >
        )[value.toLowerCase()] ?? value)
      : value;
  if (
    [
      "set",
      "settype",
      "rarity",
      "language",
      "keyword",
      "layout",
      "frame",
      "border",
      "stamp",
      "game",
      "produces",
      "watermark",
    ].includes(field) &&
    operator === ":"
  )
    return compareText(textValues(card, field), "=", normalizedValue);
  return compareText(textValues(card, field), operator, normalizedValue);
}

function evaluate(card: any, node: QueryNode): boolean {
  if (node.kind === "term") return matchTerm(card, node);
  if (node.kind === "not") return !evaluate(card, node.child);
  if (node.kind === "and")
    return node.children.every((child) => evaluate(card, child));
  return node.children.some((child) => evaluate(card, child));
}

export function compileLocalScryfallQuery(
  rawQuery?: string | null,
): CompiledQuery {
  const query = rawQuery?.trim() ?? "";
  if (!query) return { ok: true, matches: () => true };
  if (query.length > MAX_QUERY_LENGTH)
    return {
      ok: false,
      error: `Scryfall arguments are limited to ${MAX_QUERY_LENGTH} characters.`,
    };
  const cached = compiledCache.get(query);
  if (cached) return cached;
  let result: CompiledQuery;
  try {
    const node = parseQuery(query);
    result = { ok: true, matches: (card) => evaluate(card, node) };
  } catch (error: any) {
    result = {
      ok: false,
      error: `Scryfall arguments could not be parsed locally: ${String(error?.message || error)}`,
    };
  }
  compiledCache.set(query, result);
  return result;
}

export function localScryfallQueryError(rawQuery?: string | null) {
  const compiled = compileLocalScryfallQuery(rawQuery);
  return compiled.ok ? undefined : compiled.error;
}

export function matchesLocalScryfallQuery(card: any, rawQuery?: string | null) {
  const compiled = compileLocalScryfallQuery(rawQuery);
  return compiled.ok ? compiled.matches(card) : false;
}

export async function constrainInventoryWhereToScryfallQuery(
  prisma: any,
  where: Record<string, unknown>,
  rawQuery?: string | null,
) {
  const compiled = compileLocalScryfallQuery(rawQuery);
  if (!rawQuery?.trim())
    return { where, error: undefined as string | undefined };
  if (!compiled.ok)
    return {
      where: { ...where, cardId: { in: [] } },
      error: compiled.error,
    };
  const candidates = (await prisma.inventoryItem.findMany({
    where,
    distinct: ["cardId"],
    select: { cardId: true, card: true },
  })) as Array<{ cardId: string; card: any }>;
  const matchingCardIds = candidates
    .filter((candidate) => compiled.matches(candidate.card))
    .map((candidate) => candidate.cardId);
  return {
    where: { ...where, cardId: { in: matchingCardIds } },
    error: undefined as string | undefined,
  };
}

export function __resetInventoryScryfallQueryCacheForTests() {
  compiledCache.clear();
}
