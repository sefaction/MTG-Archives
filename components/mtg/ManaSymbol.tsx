import { getManaFontClassName, type ManaToken } from "@/lib/mtg/symbols";

type ManaSymbolProps = {
  token: ManaToken | string;
  className?: string;
  ariaHidden?: boolean;
};

function tokenParts(symbol: string) {
  return symbol.split("/").filter(Boolean);
}

export function ManaSymbol({
  token,
  className = "",
  ariaHidden = false,
}: ManaSymbolProps) {
  const symbol = typeof token === "string" ? token : token.symbol;
  const label = typeof token === "string" ? symbol : token.label;
  const manaClassName =
    typeof token === "string"
      ? getManaFontClassName(token)
      : token.manaClassName;

  if (!manaClassName) {
    return (
      <span
        className={`mtg-mana-symbol mtg-mana-symbol-fallback rounded border border-zinc-600 bg-zinc-800 px-1 text-[0.68rem] font-semibold text-zinc-100 ${className}`}
        title={label}
        aria-hidden={ariaHidden || undefined}
        aria-label={ariaHidden ? undefined : label}
        data-mana-fallback={symbol}
      >
        {tokenParts(symbol).join("/") || symbol}
      </span>
    );
  }

  return (
    <i
      className={`${manaClassName} mtg-mana-symbol text-[1em] ${className}`}
      title={label}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : label}
      data-mana-symbol={symbol}
    />
  );
}
