export type ManaToken = {
  raw: string;
  symbol: string;
  label: string;
  isKnown: boolean;
};

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
  Q: "untap",
};

for (let value = 0; value <= 20; value += 1) {
  manaSymbolLabels[String(value)] = `${value} generic mana`;
}

function normalizeManaSymbol(value: string) {
  return value.trim().toUpperCase().replace(/\\/g, "/");
}

function isKnownManaSymbol(symbol: string) {
  if (manaSymbolLabels[symbol]) return true;
  if (/^\d+$/.test(symbol)) return true;
  if (/^[WUBRGCXYZS]\/P$/.test(symbol)) return true;
  if (/^[WUBRGCXYZS]\/2$/.test(symbol)) return true;
  if (/^[WUBRGCXYZS]\/[WUBRGCXYZS]$/.test(symbol)) return true;
  if (/^P\/[WUBRGCXYZS]$/.test(symbol)) return true;
  return false;
}

export function describeManaSymbol(symbol: string) {
  const normalized = normalizeManaSymbol(symbol);
  if (manaSymbolLabels[normalized]) return manaSymbolLabels[normalized];
  if (/^\d+$/.test(normalized)) return `${normalized} generic mana`;
  if (normalized.endsWith("/P")) {
    return `${normalized.slice(0, -2)} phyrexian mana`;
  }
  if (normalized.includes("/"))
    return `${normalized.replace(/\//g, " or ")} mana`;
  return `${normalized} mana`;
}

export function parseManaCost(input?: string | null): ManaToken[] {
  if (!input?.trim()) return [];
  const tokens: ManaToken[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const symbol = normalizeManaSymbol(match[1] ?? "");
    if (!symbol) continue;
    tokens.push({
      raw: match[0],
      symbol,
      label: describeManaSymbol(symbol),
      isKnown: isKnownManaSymbol(symbol),
    });
  }
  return tokens;
}

export function parseColorIdentity(input?: string | null): ManaToken[] {
  if (!input?.trim()) return [];
  const compact = input.trim();
  const values = compact.includes("{")
    ? parseManaCost(compact).map((token) => token.symbol)
    : compact
        .split(/[\s,;/|]+/)
        .flatMap((part) =>
          /^[WUBRGC]+$/i.test(part) && part.length > 1
            ? part.split("")
            : [part],
        )
        .map(normalizeManaSymbol);
  return values
    .filter((symbol) => /^[WUBRGC]$/.test(symbol))
    .map((symbol) => ({
      raw: symbol,
      symbol,
      label: describeManaSymbol(symbol),
      isKnown: true,
    }));
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
