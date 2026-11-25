import { compareInventorySortValues } from "./inventory-sort";
import { selectInventoryCardPrice } from "./inventory-price";

export const PUBLIC_WISHLIST_SORT_FIELDS = ["cardName", "quantity", "wishCategory", "printingPreference", "setCode", "collectorNumber", "rarity", "manaCost", "typeLine", "colorIdentity", "releasedAt", "preferredPriceLabel", "foilStatus"] as const;

/** An unrestricted finish is a starting catalog quote, not a nonfoil claim. */
export function publicWishlistPrice(prices: unknown, finish: string | null, provider?: string | null) {
  const known = ["NONFOIL", "FOIL", "ETCHED"].includes(finish?.toUpperCase() ?? "");
  const quotes = (known ? [finish!.toUpperCase()] : ["NONFOIL", "FOIL", "ETCHED"])
    .map(value => selectInventoryCardPrice(prices, value, provider)).filter(price => price !== null);
  quotes.sort((a, b) => compareInventorySortValues({ kind: "number", value: a.amount, currency: a.currency }, { kind: "number", value: b.amount, currency: b.currency }));
  return { quote: quotes[0] ?? null, from: !known };
}
