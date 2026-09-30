import type { AcquisitionDefaults, AcquisitionPrinting } from "./acquisition-review";

export function finishForPrinting(defaultFinish: AcquisitionDefaults["finish"], printing: AcquisitionPrinting | null):
  "NONFOIL" | "FOIL" | "ETCHED" | null {
  const fallback = defaultFinish === "UNKNOWN" ? null : defaultFinish;
  if (!printing || !Array.isArray(printing.finishes) || printing.finishes.length === 0) return fallback;
  const finishes = [...new Set(printing.finishes)];
  if (!finishes.every(finish => ["nonfoil", "foil", "etched"].includes(finish))) return null;
  if (fallback && finishes.includes(fallback.toLowerCase())) return fallback;
  if (finishes.length !== 1) return null;
  return finishes[0] === "nonfoil" ? "NONFOIL" : finishes[0] === "foil" ? "FOIL" : "ETCHED";
}
