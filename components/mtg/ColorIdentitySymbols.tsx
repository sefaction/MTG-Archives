import { parseColorIdentity } from "@/lib/mtg/symbols";
import { ManaSymbol } from "./ManaSymbol";

export function ColorIdentitySymbols({
  value,
}: {
  value?: string | string[] | null;
}) {
  const tokens = parseColorIdentity(value);
  const hasValue = Array.isArray(value)
    ? value.length > 0
    : Boolean(value?.trim());
  if (!hasValue) return <span className="text-zinc-500">-</span>;
  if (!tokens.length)
    return <span>{Array.isArray(value) ? value.join(",") : value}</span>;
  return (
    <span
      className="mtg-symbol-group flex-wrap gap-0.5"
      aria-label={`Color identity: ${tokens.map((token) => token.symbol).join(", ")}`}
      title={tokens.map((token) => token.symbol).join("")}
    >
      {tokens.map((token) => (
        <ManaSymbol key={token.symbol} token={token} ariaHidden />
      ))}
    </span>
  );
}

export { ColorIdentitySymbols as ColorIdentityIcons };
