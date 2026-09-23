import { money } from "./pricing-analytics";

export type PricingView = "collection" | "market" | "data";
export function cleanPricingView(value?: string): PricingView {
  return value === "market" || value === "data" ? value : "collection";
}
export function pricingWorkspaceHref(
  params: Record<string, string | undefined>,
  view: PricingView,
) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value && key !== "view") next.set(key, value);
  if (view !== "collection") next.set("view", view);
  return next.size ? `/pricing?${next}` : "/pricing";
}

/** Current collection estimates are USD only; never silently convert currencies. */
export function usdCopyValue(
  price: { amount: number; currency: string } | null,
  quantity: number,
) {
  const usable =
    price && price.currency === "USD" && Number.isFinite(price.amount);
  return {
    value: usable ? price.amount * quantity : 0,
    missing: usable ? 0 : quantity,
  };
}
export function collectionValueLabel(
  value: number,
  quantity: number,
  missing: number,
) {
  return quantity > 0 && missing >= quantity
    ? "Unavailable"
    : money(value, "USD");
}
