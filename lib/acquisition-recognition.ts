// OCR similarity is not calibrated confidence. Strong exact metadata can confirm
// a printing; it never establishes physical count, finish, condition or receipt.
export type RecognitionCard = {
  id: string;
  name: string;
  printedName?: string | null;
  faceNames?: string[];
  setCode: string;
  collectorNumber: string;
  lang?: string | null;
  digital?: boolean | null;
};
export type RecognitionText = {
  title: string[];
  footer: string[];
};
export type RecognitionProposal = {
  card: RecognitionCard;
  reasons: string[];
  nameDistance: number | null;
};
const nameKey = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
// Zero padding is typography. Suffixes/prefixes (including List set prefixes)
// retain identity; 123a must never silently become 123.
export function acquisitionCollectorKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, "");
}
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}
function names(card: RecognitionCard) {
  return [
    ...new Set(
      [
        card.name,
        card.printedName ?? "",
        ...card.name.split(" // "),
        ...(card.faceNames ?? []),
      ]
        .map(nameKey)
        .filter(Boolean),
    ),
  ];
}
export function createAcquisitionRecognitionIndex(cards: RecognitionCard[]) {
  const paper = cards.filter((card) => card.digital !== true);
  const bySetNumber = new Map<string, RecognitionCard[]>();
  const byName = new Map<string, RecognitionCard[]>();
  const sets = new Set(paper.map((card) => card.setCode.toUpperCase()));
  for (const card of paper) {
    const key = `${card.setCode.toLowerCase()}:${acquisitionCollectorKey(card.collectorNumber)}`;
    bySetNumber.set(key, [...(bySetNumber.get(key) ?? []), card]);
    for (const name of names(card))
      byName.set(name, [...(byName.get(name) ?? []), card]);
  }
  return { bySetNumber, byName, sets, cards: paper.length };
}
export function proposeAcquisitionPrintings(
  index: ReturnType<typeof createAcquisitionRecognitionIndex>,
  input: RecognitionText,
  limit = 12,
) {
  if (
    input.title.length > 100 ||
    input.footer.length > 100 ||
    [...input.title, ...input.footer].some((line) => line.length > 2000)
  )
    throw new Error("OCR evidence exceeds bounds");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid result limit");
  const footer = input.footer.join("\n").toUpperCase();
  const setCodes = new Set<string>();
  const languages = new Set<string>();
  // A set-like token alone is not enough: look for a printed language marker.
  for (const match of footer.matchAll(
    /\b([A-Z0-9]{2,6})[^A-Z0-9\n]{0,6}(EN|FR|DE|IT|ES|PT|JA|KO|RU|ZHS|ZHT)\b/g,
  )) {
    if (index.sets.has(match[1])) {
      setCodes.add(match[1].toLowerCase());
      languages.add(match[2].toLowerCase());
    }
  }
  const collectors = new Set<string>();
  for (const line of input.footer) {
    for (const match of line.matchAll(/\b(\d{1,5}[a-z]?)\s*\/\s*\d{2,5}\b/gi))
      collectors.add(acquisitionCollectorKey(match[1]));
    for (const match of line.matchAll(
      /(?:^|\n)\s*[CUMRLT]\s*(\d{1,5}[a-z]?)\b/gim,
    ))
      collectors.add(acquisitionCollectorKey(match[1]));
  }
  const titleKeys = input.title.map(nameKey).filter((s) => s.length >= 3);
  const exactNames = new Set<string>();
  const exactCards = new Map<string, RecognitionCard>();
  for (const [name, cards] of index.byName) {
    if (
      titleKeys.some(
        (line) =>
          line === name ||
          (name.length >= 5 &&
            line.includes(name) &&
            line.length - name.length <= 6),
      )
    ) {
      exactNames.add(name);
      for (const card of cards) exactCards.set(card.id, card);
    }
  }
  const proposals = new Map<string, RecognitionProposal>();
  let conflict = false;
  for (const set of setCodes)
    for (const number of collectors) {
      const printingCards = index.bySetNumber.get(`${set}:${number}`) ?? [];
      const languageCards = printingCards.filter(
        (card) => card.lang && languages.has(card.lang.toLowerCase()),
      );
      // An available matching language is not contradicted merely because the
      // catalog also contains other translations of the same set/number.
      for (const card of languageCards.length ? languageCards : printingCards) {
        const reasons = ["SET_AND_COLLECTOR_TEXT", "REVIEW_REQUIRED"];
        if (
          exactNames.size &&
          !names(card).some((name) => exactNames.has(name))
        ) {
          conflict = true;
          reasons.push("TITLE_CONTRADICTION");
        } else if (exactCards.has(card.id)) reasons.push("TITLE_TEXT_AGREES");
        else reasons.push("TITLE_UNCONFIRMED");
        if (names(card).some((name) => titleKeys.includes(name)))
          reasons.push("TITLE_EXACT");
        if (
          languages.size &&
          (!card.lang || !languages.has(card.lang.toLowerCase()))
        ) {
          conflict = true;
          reasons.push("LANGUAGE_CONTRADICTION");
        }
        proposals.set(card.id, { card, reasons, nameDistance: null });
      }
    }
  // Preserve conflicting title candidates for human resolution.
  for (const card of exactCards.values()) {
    if (languages.size && card.lang && !languages.has(card.lang.toLowerCase()))
      continue;
    if (!proposals.has(card.id))
      proposals.set(card.id, {
        card,
        reasons: collectors.has(acquisitionCollectorKey(card.collectorNumber))
          ? ["TITLE_AND_COLLECTOR_TEXT", "SET_UNCONFIRMED", "REVIEW_REQUIRED"]
          : ["TITLE_TEXT", "PRINTING_UNCONFIRMED", "REVIEW_REQUIRED"],
        nameDistance: 0,
      });
  }
  if (!proposals.size && titleKeys.length) {
    const ranked = [...index.byName.keys()]
      .map((name) => ({
        name,
        distance: Math.min(
          ...titleKeys.map(
            (line) => distance(name, line) / Math.max(name.length, line.length),
          ),
        ),
      }))
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
      .slice(0, 3);
    // Retrieval cutoff only; never a printing-confidence or acceptance threshold.
    for (const entry of ranked.filter((entry) => entry.distance <= 0.35))
      for (const card of index.byName.get(entry.name) ?? [])
        proposals.set(card.id, {
          card,
          reasons: ["SIMILAR_TITLE_ONLY", "REVIEW_REQUIRED"],
          nameDistance: entry.distance,
        });
  }
  const all = [...proposals.values()].sort(
    (a, b) =>
      Number(b.reasons.includes("SET_AND_COLLECTOR_TEXT")) -
        Number(a.reasons.includes("SET_AND_COLLECTOR_TEXT")) ||
      Number(b.reasons.includes("TITLE_AND_COLLECTOR_TEXT")) -
        Number(a.reasons.includes("TITLE_AND_COLLECTOR_TEXT")) ||
      (a.nameDistance ?? 0) - (b.nameDistance ?? 0) ||
      a.card.id.localeCompare(b.card.id),
  );
  const exactPrintings = all.filter((p) =>
    p.reasons.includes("SET_AND_COLLECTOR_TEXT"),
  );
  const strong =
    !conflict &&
    setCodes.size === 1 &&
    collectors.size === 1 &&
    languages.size === 1 &&
    exactPrintings.length === 1 &&
    exactPrintings[0].reasons.includes("TITLE_EXACT") &&
    [...exactNames].every((name) =>
      names(exactPrintings[0].card).includes(name),
    );
  if (strong) {
    exactPrintings[0].reasons = exactPrintings[0].reasons.filter(
      (r) => r !== "REVIEW_REQUIRED",
    );
    exactPrintings[0].reasons.push("STRONG_EXACT_PRINTING");
  }
  return {
    version: 2,
    status: conflict
      ? "CONFLICT"
      : strong
        ? "STRONG_MATCH"
        : all.length
          ? "REVIEW_REQUIRED"
          : "NO_MATCH",
    automaticAcceptance: strong,
    finish: "UNKNOWN",
    condition: "UNKNOWN",
    catalogCoverage: "NOT_ESTABLISHED",
    evidence: {
      setCodes: [...setCodes],
      collectors: [...collectors],
      languages: [...languages],
    },
    totalProposals: all.length,
    truncated: all.length > limit,
    proposals: all.slice(0, limit),
  };
}
