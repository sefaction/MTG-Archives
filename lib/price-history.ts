import type { FoilStatus } from "@prisma/client";

export type SelectedPrice = {
  amount: number;
  provider: string;
  providerLabel: string;
  finish: string;
  priceType: string;
  currency: string;
  observedDate: Date;
  source: "scryfall" | "mtgjson";
};

function priceNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(
    typeof value === "object" && "toString" in value ? value.toString() : value,
  );
  return Number.isFinite(n) ? n : null;
}

function providerLabel(provider: string) {
  if (provider === "scryfall") return "Scryfall";
  if (provider === "tcgplayer") return "TCGplayer";
  if (provider === "cardmarket") return "Cardmarket";
  if (provider === "cardhoarder") return "Cardhoarder";
  return provider;
}

export function finishForFoilStatus(status?: FoilStatus | string | null) {
  if (status === "FOIL") return "foil";
  if (status === "ETCHED") return "etched";
  return "normal";
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

function mtgjsonCurrentPrice(
  prices: unknown,
  preferredProvider: string,
  finish = "normal",
): SelectedPrice | null {
  const values = (prices ?? {}) as Record<string, any>;
  const mtgjson = values.mtgjson;
  if (!mtgjson || typeof mtgjson !== "object") return null;

  const providers = [
    preferredProvider,
    ...Object.keys(mtgjson).filter(
      (provider) => provider !== preferredProvider,
    ),
  ];

  for (const provider of providers) {
    const providerPrices = mtgjson[provider];
    if (!providerPrices || typeof providerPrices !== "object") continue;
    const finishPrices =
      providerPrices[finish] ||
      providerPrices.normal ||
      providerPrices.foil ||
      providerPrices.etched;
    if (!finishPrices || typeof finishPrices !== "object") continue;

    const priceType = finishPrices.retail
      ? "retail"
      : finishPrices.market
        ? "market"
        : "low";
    const priceTypePrices = finishPrices[priceType];
    if (!priceTypePrices || typeof priceTypePrices !== "object") continue;

    const currency = priceTypePrices.USD
      ? "USD"
      : Object.keys(priceTypePrices)[0];
    const current = priceTypePrices[currency];
    const amount =
      typeof current === "object"
        ? priceNumber(current?.amount)
        : priceNumber(current);
    if (amount === null) continue;

    return {
      amount,
      provider,
      providerLabel: providerLabel(provider),
      finish,
      priceType,
      currency: currency || "USD",
      observedDate: new Date(
        typeof current === "object" && current?.observedDate
          ? current.observedDate
          : 0,
      ),
      source: "mtgjson",
    };
  }
  return null;
}

export function selectPreferredCardPrice(
  _snapshots: unknown,
  cardPrices: unknown,
  options: { finish?: string; preferredProvider?: string } = {},
) {
  const preferredProvider = options.preferredProvider || "scryfall";
  if (preferredProvider !== "scryfall") {
    const selected = mtgjsonCurrentPrice(
      cardPrices,
      preferredProvider,
      options.finish,
    );
    if (selected) return selected;
  }
  return scryfallFallbackPrice(cardPrices, options.finish);
}

export function formatSelectedPrice(price: SelectedPrice | null) {
  if (!price) return "--";
  const prefix = price.currency === "USD" ? "$" : `${price.currency} `;
  return `${prefix}${price.amount.toFixed(2)}`;
}

export function formatPercentChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
