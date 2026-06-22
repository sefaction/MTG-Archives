"use client";

import { formatSetLabel, getKeyruneSetClassName } from "@/lib/mtg/symbols";
import { cn } from "../filterStyles";

export {
  ColorIdentityIcons,
  ColorIdentitySymbols,
} from "./ColorIdentitySymbols";
export { CardManaCost } from "./CardManaCost";
export { ManaCost } from "./ManaCost";
export { ManaSymbol } from "./ManaSymbol";

const rarityClasses: Record<string, string> = {
  common: "mtg-set-symbol-common",
  uncommon: "ss-uncommon",
  rare: "ss-rare",
  mythic: "ss-mythic",
  mythic_rare: "ss-mythic",
  bonus: "ss-rare",
  special: "ss-rare",
};

function getRarityClass(rarity?: string | null) {
  return (
    rarityClasses[(rarity ?? "").trim().toLowerCase()] ??
    "mtg-set-symbol-common"
  );
}

export function SetSymbol({
  setCode,
  setName,
  rarity,
  showText = true,
  className,
}: {
  setCode?: string | null;
  setName?: string | null;
  rarity?: string | null;
  showText?: boolean;
  className?: string;
}) {
  const code = setCode?.trim().toUpperCase() || "-";
  const label = formatSetLabel(setCode, setName);
  const rarityClass = getRarityClass(rarity);
  const setClassName = getKeyruneSetClassName(setCode);
  return (
    <span className="mtg-set-symbol-group gap-1.5" title={label}>
      {setClassName ? (
        <i
          aria-hidden="true"
          className={cn(
            "ss mtg-set-symbol",
            setClassName,
            rarityClass,
            className,
          )}
        />
      ) : null}
      {showText ? (
        <span>{code}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

export function SetLabel({
  setCode,
  setName,
  rarity,
  symbolClassName,
}: {
  setCode?: string | null;
  setName?: string | null;
  rarity?: string | null;
  symbolClassName?: string;
}) {
  return (
    <span className="mtg-set-symbol-group flex-wrap gap-1.5">
      <SetSymbol
        setCode={setCode}
        setName={setName}
        rarity={rarity}
        showText={false}
        className={symbolClassName}
      />
      <span>{formatSetLabel(setCode, setName)}</span>
    </span>
  );
}
