import {
  compareTradeValues,
  formatTradeMoney,
  type TradeValueLine,
} from "@/lib/trade-value";
import { cn } from "@/components/filterStyles";

export function TradeValueSummary({
  leftLabel,
  rightLabel,
  leftLines,
  rightLines,
  compact = false,
}: {
  leftLabel: string;
  rightLabel: string;
  leftLines: TradeValueLine[];
  rightLines: TradeValueLine[];
  compact?: boolean;
}) {
  const comparison = compareTradeValues(leftLines, rightLines);
  const differenceLabel =
    comparison.absoluteDifference < 0.005
      ? "Even known value"
      : `${
          comparison.difference > 0 ? rightLabel : leftLabel
        } side +${formatTradeMoney(comparison.absoluteDifference)}`;
  const missingPrices =
    comparison.left.unpricedCards + comparison.right.unpricedCards;

  return (
    <section
      className={cn(
        "rounded-lg border border-zinc-800 bg-zinc-950/55",
        compact ? "p-2" : "p-3",
      )}
      aria-label="Trade value comparison"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        <ValueSide
          label={leftLabel}
          value={comparison.left.knownValue}
          pricedCards={comparison.left.pricedCards}
          totalCards={comparison.left.totalCards}
        />
        <div className="min-w-24 border-x border-zinc-800 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {comparison.complete ? "Value gap" : "Known-value gap"}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs font-medium",
              comparison.complete ? "text-sky-200" : "text-amber-200",
            )}
          >
            {differenceLabel}
          </p>
        </div>
        <ValueSide
          label={rightLabel}
          value={comparison.right.knownValue}
          pricedCards={comparison.right.pricedCards}
          totalCards={comparison.right.totalCards}
        />
      </div>
      {missingPrices ? (
        <p className="mt-2 text-center text-[11px] text-amber-300">
          Estimate incomplete: {missingPrices}{" "}
          {missingPrices === 1 ? "card has" : "cards have"} no price.
        </p>
      ) : null}
    </section>
  );
}

function ValueSide({
  label,
  value,
  pricedCards,
  totalCards,
}: {
  label: string;
  value: number;
  pricedCards: number;
  totalCards: number;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-zinc-500">{label}</p>
      <p className="text-base font-semibold tabular-nums text-zinc-100">
        {formatTradeMoney(value)}
      </p>
      <p className="text-[10px] text-zinc-600">
        {pricedCards}/{totalCards} cards priced
      </p>
    </div>
  );
}
