"use client";

import { useState } from "react";
import {
  formatSetLabel,
  getScryfallSetIconUrl,
  parseColorIdentity,
  parseManaCost,
  type ManaToken,
} from "@/lib/mtg/symbols";

const manaColorClasses: Record<string, string> = {
  W: "bg-amber-100 text-zinc-950 border-amber-200",
  U: "bg-sky-300 text-sky-950 border-sky-200",
  B: "bg-zinc-800 text-zinc-50 border-zinc-500",
  R: "bg-red-500 text-white border-red-300",
  G: "bg-emerald-500 text-white border-emerald-300",
  C: "bg-zinc-300 text-zinc-950 border-zinc-200",
  S: "bg-cyan-100 text-cyan-950 border-cyan-200",
};

const rarityClasses: Record<string, string> = {
  common: "opacity-80",
  uncommon: "opacity-90 invert-[0.72] sepia saturate-0",
  rare: "opacity-95 sepia saturate-150 hue-rotate-[350deg]",
  mythic: "opacity-95 sepia saturate-200 hue-rotate-[330deg]",
};

function symbolParts(symbol: string) {
  return symbol.split("/").filter(Boolean);
}

function manaClass(symbol: string) {
  const first = symbolParts(symbol)[0] ?? symbol;
  return manaColorClasses[first] ?? "bg-zinc-200 text-zinc-950 border-zinc-300";
}

function ManaTokenIcon({ token }: { token: ManaToken }) {
  const parts = symbolParts(token.symbol);
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 align-middle text-[0.68rem] font-bold leading-none shadow-sm ${manaClass(token.symbol)}`}
      title={token.label}
      aria-label={token.label}
    >
      {parts.length > 1 ? parts.join("/") : token.symbol}
    </span>
  );
}

export function ManaCost({ value }: { value?: string | null }) {
  const tokens = parseManaCost(value);
  if (!value?.trim()) return <span className="text-zinc-500">-</span>;
  if (!tokens.length) return <span>{value}</span>;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-0.5"
      aria-label={tokens.map((token) => token.label).join(", ")}
    >
      {tokens.map((token, index) => (
        <ManaTokenIcon key={`${token.raw}-${index}`} token={token} />
      ))}
    </span>
  );
}

export function ColorIdentityIcons({ value }: { value?: string | null }) {
  const tokens = parseColorIdentity(value);
  if (!value?.trim()) return <span className="text-zinc-500">-</span>;
  if (!tokens.length) return <span>{value}</span>;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-0.5"
      aria-label={`Color identity: ${tokens.map((token) => token.symbol).join(", ")}`}
    >
      {tokens.map((token) => (
        <ManaTokenIcon key={token.symbol} token={token} />
      ))}
    </span>
  );
}

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
