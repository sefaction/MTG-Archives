import { parseManaCost } from "@/lib/mtg/symbols";
import { ManaSymbol } from "./ManaSymbol";

export function ManaCost({ value }: { value?: string | null }) {
  const tokens = parseManaCost(value);
  if (!value?.trim()) return <span className="text-zinc-500">-</span>;
  if (!tokens.length) return <span>{value}</span>;
  return (
    <span
      className="mtg-symbol-group flex-wrap gap-0.5"
      aria-label={tokens.map((token) => token.label).join(", ")}
      title={value}
    >
      {tokens.map((token, index) => (
        <ManaSymbol key={`${token.raw}-${index}`} token={token} ariaHidden />
      ))}
    </span>
  );
}
