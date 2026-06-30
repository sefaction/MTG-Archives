export const DEFAULT_PLAYER_COLOR = "#64748b";

export function normalizePlayerColor(
  value: FormDataEntryValue | string | null | undefined,
) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color)
    ? color.toLowerCase()
    : DEFAULT_PLAYER_COLOR;
}
