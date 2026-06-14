export type BasicLandCardLike =
  | {
      name?: string | null;
      typeLine?: string | null;
      cardFaces?: unknown;
    }
  | null
  | undefined;

function typeLineIsBasicLand(typeLine: string | null | undefined) {
  if (!typeLine) return false;
  return typeLine.split("//").some((faceTypeLine) => {
    const typeWords = faceTypeLine
      .split(/[—–-]/)[0]
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
      .split(" ")
      .filter(Boolean);
    const words = new Set(typeWords);
    return words.has("basic") && words.has("land");
  });
}

function faceTypeLines(cardFaces: unknown): Array<string | null | undefined> {
  if (!Array.isArray(cardFaces)) return [];
  return cardFaces.map((face) =>
    face && typeof face === "object" && "typeLine" in face
      ? (face as { typeLine?: string | null }).typeLine
      : face && typeof face === "object" && "type_line" in face
        ? (face as { type_line?: string | null }).type_line
        : null,
  );
}

export function isBasicLandCard(card: BasicLandCardLike): boolean {
  if (!card) return false;
  if (typeLineIsBasicLand(card.typeLine)) return true;
  return faceTypeLines(card.cardFaces).some(typeLineIsBasicLand);
}
