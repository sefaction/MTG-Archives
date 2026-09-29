import { z } from "zod";
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
export const acquisitionPhotoNameKey = (value: string) => value.normalize("NFKD")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

export function needsAcquisitionPhotoText(proposals: Proposals) {
  // Catalog-supported short names (e.g. Fog) keep the original fast path.
  return !proposals.proposals.some(p => p.reasons.some(reason =>
    ["TITLE_EXACT", "TITLE_TEXT_AGREES", "TITLE_TEXT", "TITLE_AND_COLLECTOR_TEXT"].includes(reason)));
}

export async function readAcquisitionPhotoText(
  request: (input: Buffer, signal: AbortSignal) => Promise<unknown>,
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
  try {
    const output = z.object({
      photoDigest: z.string(), descriptor: z.string(),
      recognitionTask: z.literal("WHOLE_PHOTO_TEXT"), photoText: acquisitionPhotoTextSchema,
    }).parse(await request(acquisitionNativePhotoInput(bytes, inputKind, "WHOLE_PHOTO_TEXT"),
      AbortSignal.any([signal, deadline])));
    signal.throwIfAborted();
    if (output.photoDigest !== expected.photoDigest || output.descriptor !== expected.descriptor)
      throw new Error("Whole-photo input changed");
    return output.photoText;
  } catch {
    signal.throwIfAborted();
    return unavailable(deadline.aborted ? "TIME_BUDGET" : "WORKER_ERROR");
  }
}

export function combineAcquisitionPhotoText(index: Index, base: Proposals, raw?: AcquisitionPhotoText,
  imageIds: string[] = []): Proposals {
  if (!raw) return base;
  const photoText = acquisitionPhotoTextSchema.parse(raw);
  const hints = new Map<string, RecognitionProposal>();
  for (const reading of photoText.readings) for (const text of reading.text) {
    const key = acquisitionPhotoNameKey(text);
    if (key.length < 3) continue;
    // Exact whole-line name retrieval only. Body substrings/fuzzy matches never
    // become a located title, and these lines supply no footer identifiers.
    for (const card of index.byName.get(key) ?? []) hints.set(card.id, {
      card, nameDistance: 0,
      reasons: [UNLOCALIZED_NAME_HINT, "PRINTING_UNCONFIRMED", "REVIEW_REQUIRED"],
    });
  }
  if (!hints.size) return base;
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
  const order = [...base.proposals.filter(p => p.reasons.includes("SET_AND_COLLECTOR_TEXT")).map(p => p.card.id),
    ...hinted, ...base.proposals.map(p => p.card.id)];
  const proposals = [...new Set(order)].map(id => all.get(id)!);
  return { ...base, status: base.status === "CONFLICT" ? "CONFLICT" : "REVIEW_REQUIRED",
    automaticAcceptance: false, totalProposals: Math.max(base.totalProposals, proposals.length),
    truncated: base.truncated || proposals.length > 12, proposals: proposals.slice(0, 12) };
}
