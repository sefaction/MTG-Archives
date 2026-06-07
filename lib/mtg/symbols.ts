export type ManaToken = {
  raw: string;
  symbol: string;
  label: string;
  isKnown: boolean;
  manaClassName: string | null;
};

const colorSymbols = ["W", "U", "B", "R", "G"] as const;
const symbolClassNames = new Set<string>([
  ...colorSymbols.map((symbol) => symbol.toLowerCase()),
  "c",
  "x",
  "y",
  "z",
  "s",
  "tap",
  "untap",
  "tap-alt",
  "e",
  "energy",
  "p",
  "h",
  "1-2",
  "infinity",
  "100",
  "1000000",
]);

for (let value = 0; value <= 20; value += 1) {
  symbolClassNames.add(String(value));
}

for (const suffix of [
  "wu",
  "wb",
  "ub",
  "ur",
  "br",
  "bg",
  "rw",
  "rg",
  "gw",
  "gu",
  "wup",
  "wbp",
  "ubp",
  "urp",
  "brp",
  "bgp",
  "rwp",
  "rgp",
  "gwp",
  "gup",
]) {
  symbolClassNames.add(suffix);
}

const hybridPairClassNames: Record<string, string> = {
  "U/W": "wu",
  "W/U": "wu",
  "B/W": "wb",
  "W/B": "wb",
  "B/U": "ub",
  "U/B": "ub",
  "R/U": "ur",
  "U/R": "ur",
  "R/B": "br",
  "B/R": "br",
  "G/B": "bg",
  "B/G": "bg",
  "W/R": "rw",
  "R/W": "rw",
  "G/R": "rg",
  "R/G": "rg",
  "W/G": "gw",
  "G/W": "gw",
  "U/G": "gu",
  "G/U": "gu",
};

for (const left of colorSymbols) {
  symbolClassNames.add(`2${left}`.toLowerCase());
  symbolClassNames.add(`C${left}`.toLowerCase());
  symbolClassNames.add(`${left}P`.toLowerCase());
}

const manaSymbolLabels: Record<string, string> = {
  W: "white mana",
  U: "blue mana",
  B: "black mana",
  R: "red mana",
  G: "green mana",
  C: "colorless mana",
  X: "X mana",
  Y: "Y mana",
  Z: "Z mana",
  S: "snow mana",
  T: "tap",
  TAP: "tap",
  Q: "untap",
  UNTAP: "untap",
  E: "energy",
  "∞": "infinite mana",
  INFINITY: "infinite mana",
  "1/2": "one-half generic mana",
};

for (let value = 0; value <= 20; value += 1) {
  manaSymbolLabels[String(value)] = `${value} generic mana`;
}
manaSymbolLabels["100"] = "100 generic mana";
manaSymbolLabels["1000000"] = "1,000,000 generic mana";

function normalizeManaSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\\/g, "/");
}

function manaClassSuffix(symbol: string) {
  if (!symbol) return null;
  const normalized = normalizeManaSymbol(symbol);
  if (normalized === "T") return "tap";
  if (normalized === "Q") return "untap";
  if (normalized === "∞") return "infinity";
  if (normalized === "1/2") return "1-2";
  const parts = normalized.split("/");
  if (
    parts.length === 2 &&
    parts[1] === "P" &&
    /^[WUBRGC]$/.test(parts[0] ?? "")
  ) {
    return `${parts[0]}P`.toLowerCase();
  }
  if (
    parts.length === 2 &&
    parts[0] === "P" &&
    /^[WUBRGC]$/.test(parts[1] ?? "")
  ) {
    return `${parts[1]}P`.toLowerCase();
  }
  if (
    parts.length === 2 &&
    (parts[0] === "2" || parts[0] === "C") &&
    /^[WUBRG]$/.test(parts[1] ?? "")
  ) {
    return `${parts[0]}${parts[1]}`.toLowerCase();
  }
  if (
    parts.length === 2 &&
    (parts[1] === "2" || parts[1] === "C") &&
    /^[WUBRG]$/.test(parts[0] ?? "")
  ) {
    return `${parts[1]}${parts[0]}`.toLowerCase();
  }
  if (parts.length === 2)
    return (
      hybridPairClassNames[normalized] ??
      normalized.replace(/\//g, "").toLowerCase()
    );
  if (normalized.includes("/"))
    return normalized.replace(/\//g, "").toLowerCase();
  return normalized.toLowerCase();
}

export function getManaFontClassName(symbol: string) {
  const suffix = manaClassSuffix(symbol);
  if (!suffix || !symbolClassNames.has(suffix)) return null;
  return `ms ms-cost ms-shadow ms-${suffix}`;
}

function isKnownManaSymbol(symbol: string) {
  return Boolean(getManaFontClassName(symbol));
}

export function describeManaSymbol(symbol: string) {
  const normalized = normalizeManaSymbol(symbol);
  if (manaSymbolLabels[normalized]) return manaSymbolLabels[normalized];
  if (/^\d+$/.test(normalized)) return `${normalized} generic mana`;
  if (normalized.endsWith("/P")) {
    return `${normalized.slice(0, -2)} phyrexian mana`;
  }
  if (normalized.includes("/")) {
    return `${normalized.replace(/\//g, " or ")} mana`;
  }
  return `${normalized} mana`;
}

function tokenFromSymbol(raw: string, symbol: string): ManaToken | null {
  const normalized = normalizeManaSymbol(symbol);
  if (!normalized) return null;
  const manaClassName = getManaFontClassName(normalized);
  return {
    raw,
    symbol: normalized,
    label: describeManaSymbol(normalized),
    isKnown: isKnownManaSymbol(normalized),
    manaClassName,
  };
}

export function parseManaCost(input?: string | null): ManaToken[] {
  if (!input?.trim()) return [];
  const tokens: ManaToken[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const token = tokenFromSymbol(match[0], match[1] ?? "");
    if (token) tokens.push(token);
  }
  return tokens;
}

type ColorIdentityInput = string | string[] | null | undefined;

function parseColorIdentityValues(input: ColorIdentityInput) {
  if (Array.isArray(input)) return input.map(String);
  if (!input?.trim()) return [];
  const compact = input.trim();
  if (compact.startsWith("[") && compact.endsWith("]")) {
    try {
      const parsed = JSON.parse(compact);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Fall through to the text parser for malformed JSON-ish values.
    }
  }
  if (compact.includes("{"))
    return parseManaCost(compact).map((token) => token.symbol);
  return compact
    .split(/[\s,;/|]+/)
    .flatMap((part) =>
      /^[WUBRGC]+$/i.test(part) && part.length > 1 ? part.split("") : [part],
    );
}

export function parseColorIdentity(input?: ColorIdentityInput): ManaToken[] {
  const values = parseColorIdentityValues(input);
  return values
    .map(normalizeManaSymbol)
    .filter((symbol) => /^[WUBRGC]$/.test(symbol))
    .map((symbol) => tokenFromSymbol(symbol, symbol))
    .filter((token): token is ManaToken => Boolean(token));
}

export function getScryfallSetIconUrl(setCode?: string | null) {
  const normalized = setCode?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9_]+$/.test(normalized)) return null;
  return `https://svgs.scryfall.io/sets/${normalized}.svg`;
}

export function formatSetLabel(
  setCode?: string | null,
  setName?: string | null,
) {
  const code = setCode?.trim().toUpperCase() || "Unknown set";
  return setName?.trim() ? `${setName.trim()} (${code})` : code;
}
