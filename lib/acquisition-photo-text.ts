import { z } from "zod";
import { acquisitionLocatedTitleNames } from "./acquisition-recognition";
import { scannerSourceTextSchema, observedScannerIdentifiers, observedScannerCollectorAlternatives } from "./acquisition-scanner-source-text";
import { acquisitionNameKey, acquisitionExactNameKeyEligible } from "./acquisition-name";
import { acquisitionNativePhotoInput, type AcquisitionImageInputKind } from "./acquisition-image-input";
import type { createAcquisitionRecognitionIndex, proposeOrientedAcquisitionPrintings, RecognitionProposal } from "./acquisition-recognition";

export const acquisitionPhotoTextSchema = z.object({
  version: z.literal(1),
  scope: z.literal("WHOLE_PHOTO"),
  status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  reason: z.enum(["TIME_BUDGET", "WORKER_ERROR"]).optional(),
  readings: z.array(z.object({
    rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    text: z.array(z.string().max(200)).max(12),
    truncated: z.boolean(),
    scannerSource: scannerSourceTextSchema.optional(),
  })).max(4),
}).superRefine((value, context) => {
  if (new Set(value.readings.map(r => r.rotationDegrees)).size !== value.readings.length ||
      (value.status === "UNAVAILABLE" && value.readings.length))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid whole-photo readings" });
});
export type AcquisitionPhotoText = z.infer<typeof acquisitionPhotoTextSchema>;
type Proposals = ReturnType<typeof proposeOrientedAcquisitionPrintings>;
type Index = ReturnType<typeof createAcquisitionRecognitionIndex>;
export const UNLOCALIZED_NAME_HINT = "UNLOCALIZED_NAME_HINT";
export const acquisitionPhotoNameKey = acquisitionNameKey;

// Raw recognition admission changes independently of saved-text interpretation.
export const ACQUISITION_PHOTO_TEXT_POLICY_VERSION = "ambiguous-scanner-footer-v3";

// A title-supported scan can still lack the printing's collector. Preserve
// capped admission; uncapped admission requires multiple distinct printings of
// one supported identity. The positioned whole-photo read stays review-only.
export function needsAcquisitionScannerFooter(proposals: Proposals) {
  const supported = proposals.proposals.filter(p =>
    !p.reasons.some(r => r.endsWith("_CONTRADICTION")) &&
    p.reasons.some(r => ["TITLE_EXACT", "TITLE_TEXT_AGREES", "TITLE_TEXT", "TITLE_AND_COLLECTOR_TEXT"].includes(r)));
  const ambiguousIdentity = supported.length === proposals.proposals.length &&
    new Set(supported.map(p => p.card.id)).size > 1 &&
    new Set(supported.map(p => acquisitionPhotoNameKey(p.card.name))).size === 1;
  return proposals.status === "REVIEW_REQUIRED" &&
    !proposals.automaticAcceptance &&
    proposals.orientation.status === "SELECTED" &&
    proposals.evidence.collectors.length === 0 &&
    (proposals.truncated ? supported.length > 0 : ambiguousIdentity);
}

export function needsAcquisitionPhotoText(proposals: Proposals) {
  // Catalog-supported short names (e.g. Fog) keep the original fast path.
  return !proposals.proposals.some(p => p.reasons.some(reason =>
    ["TITLE_EXACT", "TITLE_TEXT_AGREES", "TITLE_TEXT", "TITLE_AND_COLLECTOR_TEXT"].includes(reason)));
}

export async function readAcquisitionPhotoText(
  request: (input: Buffer, signal: AbortSignal, progress?: (value: unknown) => void) => Promise<unknown>,
  bytes: Buffer,
  inputKind: AcquisitionImageInputKind,
  expected: { photoDigest: string; descriptor: string },
  signal: AbortSignal,
  budgetMs = 32000,
): Promise<AcquisitionPhotoText> {
  const unavailable = (reason: "TIME_BUDGET" | "WORKER_ERROR"): AcquisitionPhotoText =>
    ({ version: 1, scope: "WHOLE_PHOTO", status: "UNAVAILABLE", reason, readings: [] });
  signal.throwIfAborted();
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return unavailable("TIME_BUDGET");
  const deadline = AbortSignal.timeout(Math.min(32000, Math.floor(budgetMs)));
  const readings: AcquisitionPhotoText["readings"] = [];
  let tainted = false;
  const envelope = z.object({
    photoDigest: z.string(), descriptor: z.string(),
    recognitionTask: z.literal("WHOLE_PHOTO_TEXT"), photoText: acquisitionPhotoTextSchema,
  });
  const validateIdentity = (output: z.infer<typeof envelope>) => {
    if (output.photoDigest !== expected.photoDigest || output.descriptor !== expected.descriptor ||
        (inputKind !== "CARD_SCAN" && output.photoText.readings.some(r => r.scannerSource)))
      throw new Error("Whole-photo input changed");
  };
  try {
    const raw = await request(acquisitionNativePhotoInput(bytes, inputKind, "WHOLE_PHOTO_TEXT"),
      AbortSignal.any([signal, deadline]), value => {
        try {
          signal.throwIfAborted();
          const output = envelope.extend({progress: z.literal(true)}).parse(value);
          validateIdentity(output);
          if (output.photoText.status !== "PARTIAL" || output.photoText.reason ||
              output.photoText.readings.length !== 1 || readings.some(r =>
                r.rotationDegrees === output.photoText.readings[0].rotationDegrees))
            throw new Error("Whole-photo progress invalid");
          readings.push(output.photoText.readings[0]);
        } catch {
          tainted = true;
          throw new Error("Whole-photo progress invalid");
        }
      });
    signal.throwIfAborted();
    try {
      const output = envelope.parse(raw);
      validateIdentity(output);
      if (JSON.stringify(output.photoText.readings.slice(0, readings.length)) !== JSON.stringify(readings))
        throw new Error("Whole-photo progress changed");
      return output.photoText;
    } catch {
      tainted = true;
      throw new Error("Whole-photo final evidence invalid");
    }
  } catch {
    signal.throwIfAborted();
    const reason = deadline.aborted ? "TIME_BUDGET" : "WORKER_ERROR";
    // Only completed, identity-bound directions survive an internal timeout.
    // Outer cancellation or contradictory progress/final evidence never does.
    return readings.length && !tainted
      ? {version: 1, scope: "WHOLE_PHOTO", status: "PARTIAL", reason, readings}
      : unavailable(reason);
  }
}

export function combineAcquisitionPhotoText(index: Index, base: Proposals, raw?: AcquisitionPhotoText,
  imageIds: string[] = []): Proposals {
  if (!raw) return base;
  const photoText = acquisitionPhotoTextSchema.parse(raw);
  const hints = new Map<string, RecognitionProposal>();
  const supported = new Set<string>();
  const alternatives = new Set<string>();
  for (const reading of photoText.readings) for (const text of reading.text) {
    const key = acquisitionPhotoNameKey(text);
    if (!acquisitionExactNameKeyEligible(key)) continue;
    const identifiers = reading.text.slice(0, 2).includes(text)
      ? observedScannerIdentifiers(reading.scannerSource) : null;
    const matching = new Set(identifiers ? (index.byPrintedSetNumber.get(`${identifiers.set}:${identifiers.number}`) ?? [])
      .filter(c => (c.lang ?? "en").toLowerCase() === identifiers.language).map(c => c.id) : []);
    const recovered = new Set(reading.text.slice(0, 2).includes(text)
      ? observedScannerCollectorAlternatives(reading.scannerSource).flatMap(value =>
        (index.byPrintedSetNumber.get(`${value.set}:${value.number}`) ?? [])
          .filter(c => c.lang?.toLowerCase() === value.language).map(c => c.id)) : []);
    // Exact whole-line name retrieval only. Body substrings/fuzzy matches never
    // become a located title. A positioned footer only promotes a same-direction name.
    for (const card of index.byName.get(key) ?? []) {
      if (matching.has(card.id)) supported.add(card.id);
      if (recovered.has(card.id)) alternatives.add(card.id);
      hints.set(card.id, {
      card, nameDistance: 0,
      reasons: [UNLOCALIZED_NAME_HINT, "PRINTING_UNCONFIRMED", "REVIEW_REQUIRED",
        ...(supported.has(card.id) ? ["SCANNER_SOURCE_IDENTIFIERS"] : [])],
    });
    }
  }
  if (!hints.size) return base;
  for (const id of alternatives) hints.get(id)!.reasons.push("COLLECTOR_OCR_ALTERNATIVE");
  const all = new Map<string, RecognitionProposal>();
  for (const proposal of base.proposals) all.set(proposal.card.id, { ...proposal,
    reasons: proposal.reasons.filter(reason => reason !== "STRONG_EXACT_PRINTING") });
  for (const hint of hints.values()) {
    const prior = all.get(hint.card.id);
    all.set(hint.card.id, { ...hint, reasons: [...new Set([...(prior?.reasons ?? []), ...hint.reasons])]
      .filter(reason => reason !== "STRONG_EXACT_PRINTING") });
  }
  const rank = new Map(imageIds.map((id, i) => [id, i]));
  const hinted = [...hints.keys()].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
  const locatedNames = acquisitionLocatedTitleNames(base.proposals);
  // Preserve the supported full identity ahead of unrelated unlocated body/face
  // hints. Keep image ordering among its printing alternatives, including hints
  // that rescue a printing outside the base display cap; confer no new reasons.
  const located = [...all.values()].filter(p => locatedNames.has(acquisitionPhotoNameKey(p.card.name)) &&
    !p.reasons.some(r => r.endsWith("_CONTRADICTION"))).sort((a,b) =>
      (rank.get(a.card.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.card.id) ?? Number.MAX_SAFE_INTEGER));
  const order = [...base.proposals.filter(p => p.reasons.includes("SET_AND_COLLECTOR_TEXT")).map(p => p.card.id),
    ...hinted.filter(id => supported.has(id)), ...hinted.filter(id => alternatives.has(id)),
    ...located.map(p => p.card.id), ...hinted, ...base.proposals.map(p => p.card.id)];
  const proposals = [...new Set(order)].map(id => all.get(id)!);
  return { ...base, status: base.status === "CONFLICT" ? "CONFLICT" : "REVIEW_REQUIRED",
    automaticAcceptance: false, totalProposals: Math.max(base.totalProposals, proposals.length),
    truncated: base.truncated || proposals.length > 12, proposals: proposals.slice(0, 12) };
}
