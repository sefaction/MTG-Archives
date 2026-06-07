import { getManaFontClassName, type ManaToken } from "@/lib/mtg/symbols";

type ManaSymbolProps = {
  token: ManaToken | string;
  className?: string;
};

function tokenParts(symbol: string) {
  return symbol.split("/").filter(Boolean);
}

export function ManaSymbol({ token, className = "" }: ManaSymbolProps) {
  const symbol = typeof token === "string" ? token : token.symbol;
  const label = typeof token === "string" ? symbol : token.label;
  const manaClassName =
    typeof token === "string"
      ? getManaFontClassName(token)
      : token.manaClassName;

  if (!manaClassName) {
    return (
      <span
        className={`inline-flex min-h-5 min-w-5 items-center justify-center rounded border border-zinc-600 bg-zinc-800 px-1 align-middle text-[0.68rem] font-semibold leading-none text-zinc-100 ${className}`}
        title={label}
        aria-label={label}
        data-mana-fallback={symbol}
      >
        {tokenParts(symbol).join("/") || symbol}
      </span>
    );
  }

  return (
    <i
      className={`${manaClassName} align-middle text-[1.05em] leading-none ${className}`}
      title={label}
      aria-label={label}
      data-mana-symbol={symbol}
    />
  );
}
