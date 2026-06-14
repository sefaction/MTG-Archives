import type { FoilStatus } from "@prisma/client";

export type PriceSnapshotLike = {
  provider: string;
  finish: string;
  priceType: string;
  currency: string;
  price: unknown;
  observedDate: Date | string;
};

export type SelectedPrice = {
  amount: number;
  provider: string;
  providerLabel: string;
  finish: string;
  priceType: string;
  currency: string;
  observedDate: Date;
  source: "mtgjson" | "scryfall";
};

export const PRICE_PROVIDER_OPTIONS = [
  { value: "tcgplayer", label: "TCGplayer" },
  { value: "cardkingdom", label: "Card Kingdom" },
  { value: "cardmarket", label: "Cardmarket" },
  { value: "cardsphere", label: "Cardsphere" },
  { value: "scryfall", label: "Scryfall fallback" },
];

export const DEFAULT_PRICE_PROVIDER_PRIORITY = [
  process.env.MTGJSON_PRICE_PROVIDER_DEFAULT || "tcgplayer",
  "tcgplayer",
  "cardkingdom",
  "cardmarket",
  "cardsphere",
  "cardhoarder",
];

export function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    tcgplayer: "TCGplayer",
    cardkingdom: "Card Kingdom",
    cardmarket: "Cardmarket",
    cardsphere: "Cardsphere",
    cardhoarder: "Cardhoarder",
    scryfall: "Scryfall",
  };
  return labels[provider] || provider;
}

export function finishForFoilStatus(status?: FoilStatus | string | null) {
  if (status === "FOIL") return "foil";
  if (status === "ETCHED") return "etched";
  return "normal";
}

function priceNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(
    typeof value === "object" && "toString" in value ? value.toString() : value,
  );
  return Number.isFinite(n) ? n : null;
}

export function selectLatestMtgjsonPrice(
  snapshots: PriceSnapshotLike[] | undefined | null,
  options: {
    preferredProvider?: string;
    finish?: string;
    currency?: string;
  } = {},
): SelectedPrice | null {
  if (!snapshots?.length) return null;
  const currency = (
    options.currency ||
    process.env.MTGJSON_PRICE_CURRENCY_DEFAULT ||
    "USD"
  ).toUpperCase();
  const finish = options.finish || "normal";
  const providerPriority = Array.from(
    new Set(
      [options.preferredProvider, ...DEFAULT_PRICE_PROVIDER_PRIORITY].filter(
        Boolean,
      ),
    ),
  ) as string[];
  const candidates = snapshots
    .map((snapshot) => ({
      ...snapshot,
      amount: priceNumber(snapshot.price),
      observed: new Date(snapshot.observedDate),
    }))
    .filter(
      (snapshot) =>
        snapshot.amount !== null &&
        snapshot.currency.toUpperCase() === currency &&
        snapshot.priceType === "retail",
    );
  const finishCandidates = candidates.filter(
    (snapshot) => snapshot.finish === finish,
  );
  const pool = finishCandidates.length ? finishCandidates : candidates;
  pool.sort((a, b) => {
    const providerRank =
      providerPriority.indexOf(a.provider) -
      providerPriority.indexOf(b.provider);
    const normalizedRank =
      (providerPriority.includes(a.provider)
        ? providerPriority.indexOf(a.provider)
        : 999) -
      (providerPriority.includes(b.provider)
        ? providerPriority.indexOf(b.provider)
        : 999);
    if (normalizedRank) return normalizedRank;
    return b.observed.getTime() - a.observed.getTime();
  });
  const selected = pool[0];
  if (!selected || selected.amount === null) return null;
  return {
    amount: selected.amount,
    provider: selected.provider,
    providerLabel: providerLabel(selected.provider),
    finish: selected.finish,
    priceType: selected.priceType,
    currency: selected.currency.toUpperCase(),
    observedDate: selected.observed,
    source: "mtgjson",
  };
}

export function scryfallFallbackPrice(
  prices: unknown,
  finish = "normal",
): SelectedPrice | null {
  const values = (prices ?? {}) as Record<string, string | null | undefined>;
  const key =
    finish === "foil" ? "usd_foil" : finish === "etched" ? "usd_etched" : "usd";
  const amount = priceNumber(
    values[key] ?? values.usd ?? values.usd_foil ?? values.usd_etched,
  );
  if (amount === null) return null;
  return {
    amount,
    provider: "scryfall",
    providerLabel: "Scryfall",
    finish,
    priceType: "retail",
    currency: "USD",
    observedDate: new Date(0),
    source: "scryfall",
  };
}

export function selectPreferredCardPrice(
  snapshots: PriceSnapshotLike[] | undefined | null,
  scryfallPrices: unknown,
  options: {
    preferredProvider?: string;
    finish?: string;
    currency?: string;
  } = {},
) {
  if (options.preferredProvider === "scryfall") {
    return scryfallFallbackPrice(scryfallPrices, options.finish);
  }
  return (
    selectLatestMtgjsonPrice(snapshots, options) ||
    scryfallFallbackPrice(scryfallPrices, options.finish)
  );
}

export function formatSelectedPrice(price: SelectedPrice | null) {
  if (!price) return "—";
  const prefix = price.currency === "USD" ? "$" : `${price.currency} `;
  return `${price.providerLabel} ${prefix}${price.amount.toFixed(2)}`;
}

export function priceChangePercent(
  snapshots: PriceSnapshotLike[],
  days: number,
  options: { provider?: string; finish?: string; currency?: string } = {},
) {
  const currency = (options.currency || "USD").toUpperCase();
  const finish = options.finish || "normal";
  const provider = options.provider;
  const sorted = snapshots
    .map((snapshot) => ({
      ...snapshot,
      amount: priceNumber(snapshot.price),
      observed: new Date(snapshot.observedDate),
    }))
    .filter(
      (snapshot) =>
        snapshot.amount !== null &&
        snapshot.currency.toUpperCase() === currency &&
        snapshot.finish === finish &&
        snapshot.priceType === "retail" &&
        (!provider || snapshot.provider === provider),
    )
    .sort((a, b) => b.observed.getTime() - a.observed.getTime());
  const latest = sorted[0];
  if (!latest || latest.amount === null) return null;
  const cutoff = latest.observed.getTime() - days * 24 * 60 * 60 * 1000;
  const baseline =
    sorted.find((snapshot) => snapshot.observed.getTime() <= cutoff) ??
    sorted[sorted.length - 1];
  if (!baseline || baseline.amount === null || baseline.amount === 0)
    return null;
  return ((latest.amount - baseline.amount) / baseline.amount) * 100;
}

export function formatPercentChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function inventoryValueByProvider(
  items: Array<{
    quantity: number;
    card: { prices?: unknown; priceSnapshots?: PriceSnapshotLike[] | null };
    foilStatus?: FoilStatus | string | null;
  }>,
  options: { preferredProvider?: string } = {},
) {
  return items.reduce((total, item) => {
    const price = selectPreferredCardPrice(
      item.card.priceSnapshots,
      item.card.prices,
      {
        finish: finishForFoilStatus(item.foilStatus),
        preferredProvider: options.preferredProvider,
      },
    );
    return total + (price?.amount ?? 0) * item.quantity;
  }, 0);
}

export function latestPricesByProvider(snapshots: PriceSnapshotLike[] = []) {
  const latest = new Map<
    string,
    PriceSnapshotLike & { amount: number; observed: Date }
  >();
  for (const snapshot of snapshots) {
    if (snapshot.priceType !== "retail") continue;
    const amount = priceNumber(snapshot.price);
    if (amount === null) continue;
    const observed = new Date(snapshot.observedDate);
    const key = `${snapshot.provider}|${snapshot.finish}|${snapshot.currency}`;
    const previous = latest.get(key);
    if (!previous || observed > previous.observed) {
      latest.set(key, { ...snapshot, amount, observed });
    }
  }
  return Array.from(latest.values()).sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.finish.localeCompare(b.finish) ||
      a.currency.localeCompare(b.currency),
  );
}

export function collectionValueHistory(
  items: Array<{
    quantity: number;
    card: { priceSnapshots?: PriceSnapshotLike[] | null; prices?: unknown };
    foilStatus?: FoilStatus | string | null;
  }>,
  options: { provider?: string; days?: number; currency?: string } = {},
) {
  const provider =
    options.provider ||
    process.env.MTGJSON_PRICE_PROVIDER_DEFAULT ||
    "tcgplayer";
  const currency = (
    options.currency ||
    process.env.MTGJSON_PRICE_CURRENCY_DEFAULT ||
    "USD"
  ).toUpperCase();
  const days = options.days ?? 30;
  const byDate = new Map<string, number>();
  for (const item of items) {
    const finish = finishForFoilStatus(item.foilStatus);
    for (const snapshot of item.card.priceSnapshots || []) {
      if (
        snapshot.provider !== provider ||
        snapshot.finish !== finish ||
        snapshot.priceType !== "retail" ||
        snapshot.currency.toUpperCase() !== currency
      )
        continue;
      const amount = priceNumber(snapshot.price);
      if (amount === null) continue;
      const date = new Date(snapshot.observedDate).toISOString().slice(0, 10);
      byDate.set(date, (byDate.get(date) || 0) + amount * item.quantity);
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, days)
    .map(([date, value]) => ({ date, value }));
}
