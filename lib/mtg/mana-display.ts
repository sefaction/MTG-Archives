export type ManaFaceDisplayData = {
  name?: string;
  manaCost?: string | null;
};

export type ManaDisplayCard = {
  manaCost?: string | null;
  manaFaces?: ManaFaceDisplayData[] | null;
  cardFaces?: unknown;
  layout?: string | null;
};

export type ManaCostSeparator = "//" | "/" | "adventure" | "modal" | "split";

export type DisplayManaCost =
  | { kind: "single"; manaCost: string }
  | {
      kind: "faces";
      faces: Array<{ name?: string; manaCost: string }>;
      separator: ManaCostSeparator;
    }
  | { kind: "none" };

const splitLayouts = new Set(["split", "aftermath"]);
const adventureLayouts = new Set(["adventure", "prototype", "case"]);
const modalLayouts = new Set(["modal_dfc", "meld"]);

function cleanManaCost(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cleanName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeManaFaces(input: unknown): ManaFaceDisplayData[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((face): face is Record<string, unknown> =>
      Boolean(face && typeof face === "object"),
    )
    .map((face) => ({
      name: cleanName(face.name),
      manaCost: cleanManaCost(face.manaCost ?? face.mana_cost),
    }));
}

export function getManaCostSeparator(
  layout?: string | null,
): ManaCostSeparator {
  const normalized = layout?.trim().toLowerCase() ?? "";
  if (splitLayouts.has(normalized)) return "split";
  if (adventureLayouts.has(normalized)) return "adventure";
  if (modalLayouts.has(normalized)) return "modal";
  return "//";
}

function separatorText(separator: ManaCostSeparator) {
  return separator === "split" ||
    separator === "adventure" ||
    separator === "modal"
    ? "//"
    : separator;
}

export function getManaCostSeparatorText(separator: ManaCostSeparator) {
  return separatorText(separator);
}

export function getDisplayManaCosts(card: ManaDisplayCard): DisplayManaCost {
  const topLevelManaCost = cleanManaCost(card.manaCost);
  const faces = normalizeManaFaces(card.manaFaces ?? card.cardFaces);
  const facesWithCosts = faces
    .map((face) => ({
      name: face.name,
      manaCost: cleanManaCost(face.manaCost),
    }))
    .filter((face) => face.manaCost);

  if (facesWithCosts.length > 1) {
    return {
      kind: "faces",
      faces: facesWithCosts,
      separator: getManaCostSeparator(card.layout),
    };
  }

  if (topLevelManaCost) return { kind: "single", manaCost: topLevelManaCost };
  if (facesWithCosts.length === 1) {
    return { kind: "single", manaCost: facesWithCosts[0]!.manaCost };
  }
  return { kind: "none" };
}

export function getManaFacesForDto(input: unknown): ManaFaceDisplayData[] {
  return normalizeManaFaces(input).filter((face) =>
    cleanManaCost(face.manaCost),
  );
}
