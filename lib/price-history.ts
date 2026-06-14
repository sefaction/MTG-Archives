import type { FoilStatus } from "@prisma/client";

export type SelectedPrice = {
  amount: number;
  provider: string;
  providerLabel: string;
  finish: string;
  priceType: string;
  currency: string;
  observedDate: Date;
  source: "scryfall";
};

function priceNumber(value: unknown) {
  if (value == null) return null;
  const n = Number(
    typeof value === "object" && "toString" in value ? value.toString() : value,
  );
  return Number.isFinite(n) ? n : null;
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

export function selectPreferredCardPrice(
  _snapshots: unknown,
  scryfallPrices: unknown,
  options: { finish?: string } = {},
) {
  return scryfallFallbackPrice(scryfallPrices, options.finish);
}

export function formatSelectedPrice(price: SelectedPrice | null) {
  if (!price) return "—";
  const prefix = price.currency === "USD" ? "$" : `${price.currency} `;
  return `${price.providerLabel} ${prefix}${price.amount.toFixed(2)}`;
}


export function formatPercentChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
