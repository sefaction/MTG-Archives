import {
  finishForFoilStatus,
  formatSelectedPrice,
  selectPreferredCardPrice,
} from "@/lib/price-history";

export type TradeValueLine = {
  quantity?: number | null;
  priceAmount?: number | null;
};

export type TradeSideValue = {
  knownValue: number;
  totalCards: number;
  pricedCards: number;
  unpricedCards: number;
  complete: boolean;
};

export type TradeValueComparison = {
  left: TradeSideValue;
  right: TradeSideValue;
  difference: number;
  absoluteDifference: number;
  complete: boolean;
};

export function selectTradeCardPrice(
  prices: unknown,
  foilStatus?: string | null,
  preferredProvider?: string | null,
) {
  const selected = selectPreferredCardPrice(undefined, prices, {
    finish: finishForFoilStatus(foilStatus),
    preferredProvider: preferredProvider || undefined,
  });
  return {
    amount: selected?.amount ?? null,
    label: selected ? formatSelectedPrice(selected) : "",
    provider: selected?.providerLabel ?? "",
  };
}

export function calculateTradeSideValue(
  lines: TradeValueLine[],
): TradeSideValue {
  return lines.reduce<TradeSideValue>(
    (summary, line) => {
      const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
      summary.totalCards += quantity;
      if (
        typeof line.priceAmount === "number" &&
        Number.isFinite(line.priceAmount)
      ) {
        summary.knownValue += line.priceAmount * quantity;
        summary.pricedCards += quantity;
      } else {
        summary.unpricedCards += quantity;
        summary.complete = false;
      }
      return summary;
    },
    {
      knownValue: 0,
      totalCards: 0,
      pricedCards: 0,
      unpricedCards: 0,
      complete: true,
    },
  );
}

export function compareTradeValues(
  leftLines: TradeValueLine[],
  rightLines: TradeValueLine[],
): TradeValueComparison {
  const left = calculateTradeSideValue(leftLines);
  const right = calculateTradeSideValue(rightLines);
  const difference = right.knownValue - left.knownValue;
  return {
    left,
    right,
    difference,
    absoluteDifference: Math.abs(difference),
    complete: left.complete && right.complete,
  };
}

export function formatTradeMoney(value: number) {
  return `$${value.toFixed(2)}`;
}
