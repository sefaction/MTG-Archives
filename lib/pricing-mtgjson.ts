export type MtgjsonPriceSnapshotInput = {
  mtgjsonUuid: string;
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  observedDate: string;
  price: number;
  rawJson: Record<string, unknown>;
};

export type MtgjsonIdentifierMappingInput = {
  mtgjsonUuid: string;
  scryfallId: string;
};

export type MtgjsonPriceExtractOptions = {
  defaultCurrency?: string;
  maxCards?: number;
  targetMtgjsonUuids?: Iterable<string> | null;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const FINISHES = new Set(["normal", "foil", "etched"]);
const PRICE_TYPES = new Set([
  "retail",
  "buylist",
  "low",
  "mid",
  "high",
  "market",
  "average",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerFromPath(path: string[]) {
  const marketIndex = path.findIndex(
    (part) => part === "paper" || part === "mtgo" || part === "online",
  );
  if (marketIndex >= 0 && path[marketIndex + 1]) return path[marketIndex + 1];
  return (
    path.find((part) => !PRICE_TYPES.has(part) && !FINISHES.has(part)) ||
    "unknown"
  );
}

function finishFromPath(path: string[]) {
  return path.find((part) => FINISHES.has(part)) || "normal";
}

function priceTypeFromPath(path: string[]) {
  return path.find((part) => PRICE_TYPES.has(part)) || "retail";
}

function currencyFromPath(path: string[], fallback: string) {
  return path.find((part) => /^[A-Z]{3}$/.test(part)) || fallback.toUpperCase();
}

function walkPrices(
  mtgjsonUuid: string,
  node: unknown,
  path: string[],
  options: Required<MtgjsonPriceExtractOptions>,
  output: MtgjsonPriceSnapshotInput[],
  inheritedCurrency?: string,
  inheritedDeclaration?: { path: string[]; value: string },
) {
  if (!isRecord(node)) return;

  // MTGJSON declares currency beside buylist/retail, rather than in the path.
  // Keep it local to this branch so another provider cannot inherit it.
  const declared = typeof node.currency === "string" ? node.currency.trim() : "";
  const currency = /^[a-z]{3}$/i.test(declared)
    ? declared.toUpperCase()
    : inheritedCurrency;
  const declaration = /^[a-z]{3}$/i.test(declared)
    ? { path: [...path, "currency"], value: node.currency as string }
    : inheritedDeclaration;

  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...path, key];
    if (
      DATE_KEY.test(key) &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      const pricePath = path.map((part) => part.toLowerCase());
      const resolvedCurrency = currencyFromPath(path, currency || options.defaultCurrency);
      const explicitIndex = path.findIndex((part) => /^[A-Z]{3}$/.test(part));
      // Retain the input evidence, not just the currency computed from it.
      const currencyProvenance = {
        resolved: resolvedCurrency,
        resolution: explicitIndex >= 0 ? "path" : declaration ? "declaration" : "default",
        ...(declaration ? { declaration } : {}),
        ...(explicitIndex >= 0 ? { currencyPath: path.slice(0, explicitIndex + 1) } : {}),
        ...(explicitIndex < 0 && !declaration ? { defaultCurrency: options.defaultCurrency } : {}),
      };
      output.push({
        mtgjsonUuid,
        provider: providerFromPath(pricePath),
        finish: finishFromPath(pricePath),
        priceType: priceTypeFromPath(pricePath),
        currency: resolvedCurrency,
        observedDate: key,
        price: value,
        rawJson: { path, value, currencyProvenance },
      });
      continue;
    }
    walkPrices(mtgjsonUuid, value, nextPath, options, output, currency, declaration);
  }
}

export function extractMtgjsonPriceSnapshots(
  payload: unknown,
  options: MtgjsonPriceExtractOptions = {},
) {
  const opts: Required<MtgjsonPriceExtractOptions> = {
    defaultCurrency: options.defaultCurrency || "USD",
    maxCards: options.maxCards || 0,
    targetMtgjsonUuids: options.targetMtgjsonUuids || null,
  };
  const targetMtgjsonUuids = opts.targetMtgjsonUuids
    ? new Set(Array.from(opts.targetMtgjsonUuids))
    : null;
  const root =
    isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(root)) return [];

  const snapshots: MtgjsonPriceSnapshotInput[] = [];
  let cardsSeen = 0;
  for (const [mtgjsonUuid, cardPrices] of Object.entries(root)) {
    if (targetMtgjsonUuids && !targetMtgjsonUuids.has(mtgjsonUuid)) continue;
    if (opts.maxCards > 0 && cardsSeen >= opts.maxCards) break;
    cardsSeen += 1;
    walkPrices(mtgjsonUuid, cardPrices, [], opts, snapshots);
  }
  return snapshots;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractMtgjsonIdentifierMappings(payload: unknown) {
  const root =
    isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(root)) return [];

  const mappings: MtgjsonIdentifierMappingInput[] = [];
  const seenScryfallIds = new Set<string>();

  for (const [mtgjsonUuidKey, card] of Object.entries(root)) {
    if (!isRecord(card)) continue;
    const identifiers = isRecord(card.identifiers) ? card.identifiers : {};
    const mtgjsonUuid = firstString(card.uuid, mtgjsonUuidKey);
    const scryfallId = firstString(identifiers.scryfallId, card.scryfallId);
    if (!mtgjsonUuid || !scryfallId || seenScryfallIds.has(scryfallId))
      continue;
    seenScryfallIds.add(scryfallId);
    mappings.push({ mtgjsonUuid, scryfallId });
  }

  return mappings;
}
