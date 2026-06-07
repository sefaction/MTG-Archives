"use client";

import { useState } from "react";
import { formatSetLabel, getScryfallSetIconUrl } from "@/lib/mtg/symbols";

export {
  ColorIdentityIcons,
  ColorIdentitySymbols,
} from "./ColorIdentitySymbols";
export { ManaCost } from "./ManaCost";
export { ManaSymbol } from "./ManaSymbol";

const rarityClasses: Record<string, string> = {
  common: "opacity-80",
  uncommon: "opacity-90 invert-[0.72] sepia saturate-0",
  rare: "opacity-95 sepia saturate-150 hue-rotate-[350deg]",
  mythic: "opacity-95 sepia saturate-200 hue-rotate-[330deg]",
};

export function SetSymbol({
  setCode,
  setName,
  rarity,
  showText = true,
}: {
  setCode?: string | null;
  setName?: string | null;
  rarity?: string | null;
  showText?: boolean;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const iconUrl = getScryfallSetIconUrl(setCode);
  const code = setCode?.trim().toUpperCase() || "-";
  const label = formatSetLabel(setCode, setName);
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle"
      title={label}
    >
      {iconUrl && !iconFailed ? (
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          width={18}
          height={18}
          className={`h-4 w-4 shrink-0 brightness-0 invert dark:brightness-0 dark:invert ${rarityClasses[(rarity ?? "").toLowerCase()] ?? ""}`}
          onError={() => setIconFailed(true)}
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
}: {
  setCode?: string | null;
  setName?: string | null;
  rarity?: string | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <SetSymbol
        setCode={setCode}
        setName={setName}
        rarity={rarity}
        showText={false}
      />
      <span>{formatSetLabel(setCode, setName)}</span>
    </span>
  );
}
