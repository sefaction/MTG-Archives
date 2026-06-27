export const DEFAULT_APP_THEME = "golgari";

export const APP_THEMES = [
  {
    id: "golgari",
    label: "Golgari Night",
    mode: "dark",
    description: "The current black and green archive look.",
  },
  {
    id: "azorius",
    label: "Azorius Ledger",
    mode: "light",
    description: "Clean parchment, blue accents, and high contrast tables.",
  },
  {
    id: "izzet",
    label: "Izzet Workshop",
    mode: "dark",
    description: "Deep navy surfaces with copper and electric blue highlights.",
  },
  {
    id: "selesnya",
    label: "Selesnya Grove",
    mode: "light",
    description: "Soft green, warm paper, and grounded collection panels.",
  },
  {
    id: "rakdos",
    label: "Rakdos Vault",
    mode: "dark",
    description: "Charcoal surfaces with red and brass action accents.",
  },
  {
    id: "lotus",
    label: "Lotus Study",
    mode: "light",
    description: "Muted ivory, violet, and teal for a brighter workspace.",
  },
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]["id"];

const APP_THEME_IDS = new Set<string>(APP_THEMES.map((theme) => theme.id));

export function normalizeAppTheme(value: unknown): AppThemeId {
  return typeof value === "string" && APP_THEME_IDS.has(value)
    ? (value as AppThemeId)
    : DEFAULT_APP_THEME;
}
