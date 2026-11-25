import { finishForFoilStatus, selectPreferredCardPrice } from "./price-history";

/** The visible unit price and price ordering must describe the same finish. */
export function selectInventoryCardPrice(prices: unknown, foilStatus?: string | null, preferredProvider?: string | null) {
  return selectPreferredCardPrice(undefined, prices, {
    finish: finishForFoilStatus(foilStatus), preferredProvider: preferredProvider || undefined, strictFinish: true,
  });
}
