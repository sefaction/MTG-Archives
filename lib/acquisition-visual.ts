import { z } from "zod";
import type {
  RecognitionCard,
  RecognitionProposal,
} from "./acquisition-recognition";
import { proposeOrientedAcquisitionPrintings } from "./acquisition-recognition";

export const VISUAL_STAGE = "photo-visual-retrieval-v1";
const visualCandidateSchema = z.object({
  scryfallId: z.string().uuid(),
  referenceId: z.string().max(100),
  name: z.string().min(1).max(500),
  setCode: z.string().min(1).max(20),
  collectorNumber: z.string().min(1).max(50),
  distance: z.number().finite().min(-0.01).max(2.01),
  rotationDegrees: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});
export const visualNativeSchema = z.object({
  version: z.literal(1),
  descriptor: z.string().regex(/^[a-f0-9]{64}$/),
  photoDigest: z.string().regex(/^[a-f0-9]{64}$/),
  referenceCount: z.number().int().positive(),
  unavailableCount: z.number().int().nonnegative(),
  geometry: z.object({ status: z.string() }).passthrough(),
  inputRegion: z.enum(["CARD", "WHOLE_PHOTO"]),
  candidates: z.array(visualCandidateSchema).max(12),
  geometricCandidates: z
    .array(
      visualCandidateSchema.extend({ inliers: z.number().int().nonnegative() }),
    )
    .max(12)
    .optional(),
  milliseconds: z.number().nonnegative().finite(),
  automaticAcceptance: z.literal(false),
});
export type VisualObservation = z.infer<typeof visualNativeSchema>;
export type TextProposals = ReturnType<
  typeof proposeOrientedAcquisitionPrintings
>;

// Preserve both actual retrieval orders. SIFT is not allowed to erase a useful
// nearest-image result, and duplicate printings retain both evidence methods.
export function acquisitionVisualCandidates<
  T extends { scryfallId: string },
>(visual: { candidates: T[]; geometricCandidates?: T[] }) {
  const result = new Map<string, T & { methods: string[] }>();
  for (
    let i = 0;
    i <
    Math.max(visual.candidates.length, visual.geometricCandidates?.length ?? 0);
    i++
  ) {
    for (const [candidate, method] of [
      [visual.geometricCandidates?.[i], "SIFT_CANDIDATE"],
      [visual.candidates[i], "VISUAL_MATCH"],
    ] as const) {
      if (!candidate) continue;
      const prior = result.get(candidate.scryfallId);
      result.set(candidate.scryfallId, {
        ...candidate,
        methods: [...new Set([...(prior?.methods ?? []), method])],
      });
    }
  }
  return [...result.values()];
}

// Image similarity is retrieval evidence, never printing certainty. Preserve
// explicit identifier matches, combine exact-name agreement, then interleave
// the remaining independent retrieval orders so either method can rescue blur.
export function combineAcquisitionCandidates(
  text: TextProposals,
  visual: {
    candidates: { scryfallId: string }[];
    geometricCandidates?: { scryfallId: string }[];
  },
  cards: Map<string, RecognitionCard>,
  limit = 12,
): TextProposals {
  const union = new Map<string, RecognitionProposal>();
  for (const proposal of text.proposals)
    union.set(proposal.card.id, {
      ...proposal,
      reasons: [...proposal.reasons],
    });
  const imageOrder: string[] = [];
  let missing = 0;
  for (const candidate of acquisitionVisualCandidates(visual)) {
    const card = cards.get(candidate.scryfallId);
    if (!card || card.digital === true) {
      missing++;
      continue;
    }
    imageOrder.push(card.id);
    const prior = union.get(card.id);
    union.set(card.id, {
      card,
      nameDistance: prior?.nameDistance ?? null,
      reasons: [
        ...new Set([
          ...(prior?.reasons ?? []),
          ...candidate.methods,
          "REVIEW_REQUIRED",
        ]),
      ],
    });
  }
  const selected = new Set<string>();
  const all: RecognitionProposal[] = [];
  const append = (id: string) => {
    const proposal = union.get(id);
    if (!proposal || selected.has(id)) return;
    selected.add(id);
    all.push({
      ...proposal,
      reasons: [
        ...new Set([
          ...proposal.reasons.filter((r) => r !== "STRONG_EXACT_PRINTING"),
          "PRINTING_VERIFICATION_REQUIRED",
          "REVIEW_REQUIRED",
        ]),
      ],
    });
  };
  const contradicted = (p: RecognitionProposal) => p.reasons.some(r => r.endsWith("_CONTRADICTION"));
  for (const p of text.proposals)
    if (p.reasons.includes("SET_AND_COLLECTOR_TEXT") && p.reasons.includes("TITLE_EXACT") && !contradicted(p)) append(p.card.id);
  for (const p of text.proposals)
    if (p.reasons.includes("SET_AND_COLLECTOR_TEXT") && !contradicted(p)) append(p.card.id);
  // Basic lands can share both name and collector number across many sets.
  // Within that equally supported partial-identifier group, prefer independent
  // image agreement over arbitrary local Card ID order. Unrelated images still
  // cannot outrank observed identifiers, and this does not establish certainty.
  const imageRank = new Map<string, number>();
  imageOrder.forEach((id, rank)=>{if (!imageRank.has(id)) imageRank.set(id, rank);});
  const partialIdentifiers = text.proposals.filter(p=>
    p.reasons.includes("TITLE_AND_COLLECTOR_TEXT") && !contradicted(p));
  partialIdentifiers.sort((a,b)=>(imageRank.get(a.card.id) ?? Number.MAX_SAFE_INTEGER) -
    (imageRank.get(b.card.id) ?? Number.MAX_SAFE_INTEGER));
  for (const p of partialIdentifiers) append(p.card.id);
  // A partial/misread title can contradict a real set/collector match. Keep
  // those identifier candidates in the bounded review list, then demote them
  // within that list; weak image alternatives must not erase the evidence.
  for (const p of text.proposals)
    if (p.reasons.includes("SET_AND_COLLECTOR_TEXT") && contradicted(p)) append(p.card.id);
  for (const id of imageOrder)
    if (union.get(id)?.reasons.includes("TITLE_EXACT")) append(id);
  for (let i = 0; i < Math.max(imageOrder.length, text.proposals.length); i++) {
    if (imageOrder[i]) append(imageOrder[i]);
    if (text.proposals[i]) append(text.proposals[i].card.id);
  }
  return {
    ...text,
    status:
      text.status === "CONFLICT"
        ? "CONFLICT"
        : all.length
          ? "REVIEW_REQUIRED"
          : "NO_MATCH",
    automaticAcceptance: false,
    totalProposals: Math.max(all.length + missing, text.totalProposals),
    truncated: all.length > limit || missing > 0 || text.truncated,
    proposals: [...all.slice(0, limit).filter(p=>!contradicted(p)), ...all.slice(0, limit).filter(contradicted)],
  };
}
