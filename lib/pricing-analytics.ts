export type PricingScope = "collection" | "location" | "card";
export type PricingRange = "7" | "30" | "90" | "all";

export type PricingAnalyticsOptions = {
  accessScope?: unknown;
  scope?: PricingScope;
  locationId?: string;
  cardId?: string;
  provider?: string;
  finish?: string;
  priceType?: string;
  currency?: string;
  range?: PricingRange;
};

export function money(value: number, currency = "USD") {
  const prefix = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${prefix}${value.toFixed(2)}`;
}

export async function getPricingFilterOptions() {
  return {
    providers: ["scryfall"],
    finishes: ["normal", "foil", "etched"],
    priceTypes: ["retail"],
    currencies: ["USD"],
  };
}

export async function getPricingAnalytics(options: PricingAnalyticsOptions = {}) {
  const currency = (options.currency || "USD").toUpperCase();
  const range = options.range || "30";
  const scope = options.scope || "collection";

  return {
    scope,
    provider: "scryfall",
    priceType: "retail",
    currency,
    range,
    currentValue: 0,
    startValue: 0,
    valueChange: 0,
    percentChange: null,
    missingPrices: 0,
    totalCards: 0,
    uniqueCards: 0,
    topGainers: [],
    topLosers: [],
    locationRows: [],
    cardHistory: [],
    cardLabel: null,
  };
}
