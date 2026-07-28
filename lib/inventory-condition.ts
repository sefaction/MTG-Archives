const CONDITION_ALIASES: Record<string, string> = {
  NM: "NM",
  NEARMINT: "NM",
  LP: "LP",
  LIGHTLYPLAYED: "LP",
  SP: "LP",
  SLIGHTLYPLAYED: "LP",
  MP: "MP",
  MODERATELYPLAYED: "MP",
  HP: "HP",
  HEAVILYPLAYED: "HP",
  DMG: "DMG",
  DAMAGED: "DMG",
  POOR: "DMG",
};

const DATABASE_ALIASES: Record<string, string[]> = {
  NM: ["NM", "NEAR_MINT", "NEAR MINT", "NEARMINT"],
  LP: [
    "LP",
    "LIGHTLY_PLAYED",
    "LIGHTLY PLAYED",
    "LIGHTLYPLAYED",
    "SP",
    "SLIGHTLY_PLAYED",
    "SLIGHTLY PLAYED",
    "SLIGHTLYPLAYED",
  ],
  MP: ["MP", "MODERATELY_PLAYED", "MODERATELY PLAYED", "MODERATELYPLAYED"],
  HP: ["HP", "HEAVILY_PLAYED", "HEAVILY PLAYED", "HEAVILYPLAYED"],
  DMG: ["DMG", "DAMAGED", "POOR"],
};

function conditionToken(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeInventoryCondition(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "NM";
  return CONDITION_ALIASES[conditionToken(trimmed)] ?? trimmed.toUpperCase();
}

export function equivalentInventoryConditions(
  value: string | null | undefined,
) {
  const normalized = normalizeInventoryCondition(value);
  return DATABASE_ALIASES[normalized] ?? [normalized];
}
