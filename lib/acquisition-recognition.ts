import { acquisitionCollectorKey, acquisitionFooterIdentifiers } from "./acquisition-footer";
import { acquisitionNameKey } from "./acquisition-name";
export { acquisitionCollectorKey } from "./acquisition-footer";
export const ACQUISITION_TEXT_RESOLVER_VERSION = "metadata-unicode-name-evidence-v7";

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
const nameKey = acquisitionNameKey;
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
function printedOrigin(card: RecognitionCard) {
  return card.setCode.toLowerCase() === "plst"
    ? /^([a-z0-9]{2,6})-(.+)$/i.exec(card.collectorNumber) : null;
}
export function createAcquisitionRecognitionIndex(cards: RecognitionCard[]) {
  const paper = cards.filter((card) => card.digital !== true);
  const bySetNumber = new Map<string, RecognitionCard[]>();
  const byPrintedSetNumber = new Map<string, RecognitionCard[]>();
  const byName = new Map<string, RecognitionCard[]>();
  const sets = new Set(paper.map((card) => card.setCode.toUpperCase()));
  for (const card of paper) {
    const key = `${card.setCode.toLowerCase()}:${acquisitionCollectorKey(card.collectorNumber)}`;
    bySetNumber.set(key, [...(bySetNumber.get(key) ?? []), card]);
    // Stamped List reprints keep their source printing's footer. The catalog
    // expresses that source as a composite collector number (e.g. MOM-210).
    // Retrieve both identities; OCR alone cannot establish stamp presence.
    const origin = printedOrigin(card);
    const printedKey = origin
      ? `${origin[1].toLowerCase()}:${acquisitionCollectorKey(origin[2])}`
      : key;
    if (origin) sets.add(origin[1].toUpperCase());
    byPrintedSetNumber.set(printedKey, [
      ...(byPrintedSetNumber.get(printedKey) ?? []),
      card,
    ]);
    for (const name of names(card))
      byName.set(name, [...(byName.get(name) ?? []), card]);
  }
  return { bySetNumber, byPrintedSetNumber, byName, sets, cards: paper.length };
}
export function proposeAcquisitionPrintings(
  index: ReturnType<typeof createAcquisitionRecognitionIndex>,
  input: RecognitionText,
  limit = 12,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid result limit");
  return resolveAcquisitionPrintings(index, input, limit);
}
function resolveAcquisitionPrintings(
  index: ReturnType<typeof createAcquisitionRecognitionIndex>,
  input: RecognitionText,
  limit: number,
  allowFuzzy = true,
) {
  if (
    input.title.length > 100 ||
    input.footer.length > 100 ||
    [...input.title, ...input.footer].some((line) => line.length > 2000)
  )
    throw new Error("OCR evidence exceeds bounds");
  const footer = acquisitionFooterIdentifiers(input.footer);
  const setCodes = new Set<string>();
  const languages = new Set<string>();
  const languagesBySet = new Map<string, Set<string>>();
  // A set-like token alone is not enough: look for a printed language marker.
  for (const identifier of footer.identifiers) {
    if (index.sets.has(identifier.set.toUpperCase())) {
      setCodes.add(identifier.set);
      languages.add(identifier.language);
      const observed = languagesBySet.get(identifier.set) ?? new Set<string>();
      observed.add(identifier.language); languagesBySet.set(identifier.set, observed);
    }
  }
  const collectors = new Set(footer.collectors);
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
      const setLanguages = languagesBySet.get(set)!;
      const printingCards =
        index.byPrintedSetNumber.get(`${set}:${number}`) ?? [];
      const languageCards = printingCards.filter(
        (card) => card.lang && setLanguages.has(card.lang.toLowerCase()),
      );
      // An available matching language is not contradicted merely because the
      // catalog also contains other translations of the same set/number.
      for (const card of languageCards.length ? languageCards : printingCards) {
        const reasons = ["SET_AND_COLLECTOR_TEXT", "REVIEW_REQUIRED"];
        if (
          printingCards.some(
            (candidate) => candidate.setCode.toLowerCase() === "plst",
          )
        )
          reasons.push("STAMP_UNVERIFIED");
        if (
          exactNames.size &&
          !names(card).some((name) => exactNames.has(name))
        ) {
          conflict = true;
          reasons.push("TITLE_CONTRADICTION");
        } else if (exactCards.has(card.id)) reasons.push("TITLE_TEXT_AGREES");
        else reasons.push("TITLE_UNCONFIRMED");
        const strictTitles = names(card).filter((name) => titleKeys.includes(name));
        if (strictTitles.length)
          reasons.push("TITLE_EXACT");
        if (strictTitles.length && strictTitles.every((name) => !/^[a-z0-9]+$/.test(name)))
          reasons.push("NON_LATIN_TITLE_REVIEW_REQUIRED");
        if (
          !card.lang || !setLanguages.has(card.lang.toLowerCase())
        ) {
          conflict = true;
          reasons.push("LANGUAGE_CONTRADICTION");
        }
        proposals.set(card.id, { card, reasons, nameDistance: null });
      }
    }
  // Preserve conflicting title candidates for human resolution.
  for (const card of exactCards.values()) {
    // A title-only alternative may remain available, but another set's language
    // must not supply agreement for this card's actual printed footer identity.
    const printedSet = printedOrigin(card)?.[1].toLowerCase() ?? card.setCode.toLowerCase();
    const cardLanguages = languagesBySet.get(printedSet) ?? languages;
    if (cardLanguages.size && card.lang && !cardLanguages.has(card.lang.toLowerCase()))
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
  if (allowFuzzy && !proposals.size && titleKeys.length) {
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
  for (const proposal of all) {
    const card = proposal.card;
    const counterparts =
      index.byPrintedSetNumber.get(
        `${card.setCode.toLowerCase()}:${acquisitionCollectorKey(card.collectorNumber)}`,
      ) ?? [];
    if (
      (card.setCode.toLowerCase() === "plst" ||
        counterparts.some((c) => c.setCode.toLowerCase() === "plst")) &&
      !proposal.reasons.includes("STAMP_UNVERIFIED")
    )
      proposal.reasons.push("STAMP_UNVERIFIED");
  }
  const exactPrintings = all.filter((p) =>
    p.reasons.includes("SET_AND_COLLECTOR_TEXT"),
  );
  const strong =
    !conflict &&
    !footer.recoveredLayout &&
    setCodes.size === 1 &&
    collectors.size === 1 &&
    languages.size === 1 &&
    exactPrintings.length === 1 &&
    exactPrintings[0].reasons.includes("TITLE_EXACT") &&
    !exactPrintings[0].reasons.includes("NON_LATIN_TITLE_REVIEW_REQUIRED") &&
    !exactPrintings[0].reasons.includes("STAMP_UNVERIFIED") &&
    [...exactNames].every((name) =>
      names(exactPrintings[0].card).includes(name),
    );
  if (strong) {
    exactPrintings[0].reasons = exactPrintings[0].reasons.filter(
      (r) => r !== "REVIEW_REQUIRED",
    );
    exactPrintings[0].reasons.push("STRONG_EXACT_PRINTING");
  }
  if (footer.recoveredLayout) for (const proposal of all)
    proposal.reasons.push("RECOVERED_FOOTER_LAYOUT", "REVIEW_REQUIRED");
  return {
    version: 4,
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

export function proposeOrientedAcquisitionPrintings(
  index: ReturnType<typeof createAcquisitionRecognitionIndex>,
  orientations: { rotationDegrees: number; text: RecognitionText }[],
  limit = 12,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid result limit");
  if (
    orientations.length !== 0 &&
    (orientations.length !== 2 ||
      orientations[0].rotationDegrees !== 0 ||
      orientations[1].rotationDegrees !== 180)
  )
    throw new Error("Expected both portrait reading directions");
  // Resolve complete observations independently. Never take a title from one
  // orientation and a collector number from another to manufacture agreement.
  let observed = orientations.map((orientation) => ({
    rotationDegrees: orientation.rotationDegrees,
    result: resolveAcquisitionPrintings(index, orientation.text, Math.max(1, index.cards), false),
  }));
  const substantive = observed.filter(({ result }) =>
    result.proposals.some((p) => !p.reasons.includes("SIMILAR_TITLE_ONLY")),
  );
  // Avoid a full fuzzy catalog search for upside-down noise when either
  // direction already has exact name or printed-identifier evidence.
  if (!substantive.length)
    observed = orientations.map((orientation) => ({
      rotationDegrees: orientation.rotationDegrees,
      result: resolveAcquisitionPrintings(index, orientation.text, Math.max(1, index.cards)),
    }));
  const candidates = substantive.length ? substantive : observed.filter(
    ({ result }) => result.proposals.length > 0,
  );
  if (candidates.length === 1) {
    const { result, rotationDegrees } = candidates[0];
    return {
      ...result,
      orientation: { status: "SELECTED", rotationDegrees },
      truncated: result.totalProposals > limit,
      proposals: result.proposals.slice(0, limit),
    };
  }
  if (!candidates.length) {
    return {
      ...proposeAcquisitionPrintings(index, { title: [], footer: [] }, limit),
      orientation: { status: "UNRESOLVED", rotationDegrees: null },
    };
  }
  // Both directions have plausible evidence. Preserve both sets of candidates
  // for review, even if one direction alone could produce a strong match.
  const union = new Map<string, RecognitionProposal>();
  for (const { result } of candidates)
    for (const proposal of result.proposals) {
      const prior = union.get(proposal.card.id);
      union.set(proposal.card.id, {
        ...proposal,
        reasons: [...new Set([
          ...(prior?.reasons ?? []), ...proposal.reasons,
          "ORIENTATION_UNCERTAIN", "REVIEW_REQUIRED",
        ])].filter((reason) => reason !== "STRONG_EXACT_PRINTING"),
      });
    }
  const all = [...union.values()];
  return {
    ...candidates[0].result,
    status: candidates.some(({ result }) => result.status === "CONFLICT")
      ? "CONFLICT" : "REVIEW_REQUIRED",
    automaticAcceptance: false,
    orientation: { status: "UNRESOLVED", rotationDegrees: null },
    evidence: { setCodes: [], collectors: [], languages: [] },
    totalProposals: all.length,
    truncated: all.length > limit,
    proposals: all.slice(0, limit),
  };
}
