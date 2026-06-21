"use client";

import { useState } from "react";
import { formatSetLabel, getScryfallSetIconUrl } from "@/lib/mtg/symbols";
import { cn } from "../filterStyles";

export {
  ColorIdentityIcons,
  ColorIdentitySymbols,
} from "./ColorIdentitySymbols";
export { CardManaCost } from "./CardManaCost";
export { ManaCost } from "./ManaCost";
export { ManaSymbol } from "./ManaSymbol";

const rarityClasses: Record<string, string> = {
  common: "mtg-set-symbol-rarity-common",
  uncommon: "mtg-set-symbol-rarity-uncommon",
  rare: "mtg-set-symbol-rarity-rare",
  mythic: "mtg-set-symbol-rarity-mythic",
  bonus: "mtg-set-symbol-rarity-rare",
  special: "mtg-set-symbol-rarity-rare",
};

function getRarityClass(rarity?: string | null) {
  return (
    rarityClasses[(rarity ?? "").trim().toLowerCase()] ??
    "mtg-set-symbol-rarity-common"
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
  const [iconFailed, setIconFailed] = useState(false);
  const iconUrl = getScryfallSetIconUrl(setCode);
  const code = setCode?.trim().toUpperCase() || "-";
  const label = formatSetLabel(setCode, setName);
  const rarityClass = getRarityClass(rarity);
  return (
    <span className="mtg-set-symbol-group gap-1.5" title={label}>
      {iconUrl && !iconFailed ? (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "mtg-set-symbol mtg-set-symbol-mask",
              rarityClass,
              className,
            )}
            style={{
              maskImage: `url(${iconUrl})`,
              WebkitMaskImage: `url(${iconUrl})`,
            }}
          />
          <img
            src={iconUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="hidden"
            onError={() => setIconFailed(true)}
          />
        </>
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
