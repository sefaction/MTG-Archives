const WUBRG = new Set(["W", "U", "B", "R", "G"]);

function colorArray(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/[\[\]"']/g, "").split(/[,\s]+/)
      : [];
  return Array.from(
    new Set(
      values
        .map((color) => String(color).toUpperCase())
        .filter((color) => WUBRG.has(color)),
    ),
  );
}

/**
 * Scryfall omits top-level colors for cards whose faces have separate
 * characteristics. Inventory color browsing follows the physical front face,
 * which is also the face represented by the card's collector-number color
 * grouping.
 */
export function effectiveCardColors(card: {
  colors?: unknown;
  cardFaces?: unknown;
  card_faces?: unknown;
}) {
  const topLevelColors = colorArray(card.colors);
  if (topLevelColors.length) return topLevelColors;

  const faces = Array.isArray(card.cardFaces)
    ? card.cardFaces
    : Array.isArray(card.card_faces)
      ? card.card_faces
      : [];
  const frontFace = faces[0];
  if (!frontFace || typeof frontFace !== "object") return topLevelColors;

  const face = frontFace as {
    colors?: unknown;
    colorIndicator?: unknown;
    color_indicator?: unknown;
  };
  const faceColors = colorArray(face.colors);
  if (faceColors.length) return faceColors;
  return colorArray(face.colorIndicator ?? face.color_indicator);
}
