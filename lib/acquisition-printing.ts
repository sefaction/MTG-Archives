import { z } from "zod";
import type { RecognitionCard } from "./acquisition-recognition";
import type { TextProposals } from "./acquisition-visual";

export const PRINTING_STAGE = "photo-printing-evidence-v1";

const stampState = z.enum(["PRESENT", "ABSENT", "UNREADABLE"]);
const referenceState = z.enum(["PRESENT", "ABSENT", "UNKNOWN"]);
const relation = z.enum([
  "UNRESOLVED", "AGREES_WITH_STAMP_STATE", "CONTRADICTS_STAMP_STATE",
]);
const point = z.tuple([z.number().finite(), z.number().finite()]);
export const printingNativeSchema = z.object({
  version: z.literal("registered-printing-runtime-v1"),
  observedStamp: stampState,
  conflictingObservations: z.boolean(),
  automaticAcceptance: z.literal(false),
  candidates: z.array(z.object({
    scryfallId: z.string().uuid(),
    referenceId: z.string().min(38).max(100),
    referenceStampState: referenceState,
    relation,
    alignment: z.object({
      status: z.enum(["ALIGNED", "UNREADABLE"]),
      quad: z.array(point).length(4).optional(),
      stampVisible: z.boolean().optional(),
      footerVisible: z.boolean().optional(),
      sourceCardWidth: z.number().finite().nonnegative().optional(),
      reason: z.string().regex(/^[A-Z_]{1,80}$/).optional(),
      matches: z.number().int().nonnegative().max(10000).optional(),
      inliers: z.number().int().nonnegative().max(10000).optional(),
      supportFraction: z.number().finite().nonnegative().optional(),
      medianReprojectionPixels: z.number().finite().nonnegative().optional(),
    }),
    stamp: z.object({
      status: stampState,
      reason: z.string().regex(/^[A-Z_]{1,80}$/),
      version: z.string().max(80).optional(),
      template: z.object({score: z.number().finite().min(-1).max(1),
        templateIndex: z.number().int().nonnegative().optional(),
        box: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).nullable(),
      }).optional(),
      footerSharpness: z.number().finite().nonnegative().optional(),
      coreContrast: z.number().finite().nonnegative().optional(),
      localPrintingCorrelation: z.number().finite().min(-1).max(1).optional(),
      localOffset: point.optional(),
      referenceResidual: z.number().finite().nonnegative().optional(),
      referenceResidual95: z.number().finite().nonnegative().optional(),
    }),
    localRelation: relation.optional(),
    sharedObservationSources: z.array(z.string().min(38).max(100)).max(24).optional(),
  })).max(24),
}).superRefine((value, ctx) => {
  if (value.conflictingObservations && value.observedStamp !== "UNREADABLE")
    ctx.addIssue({code: z.ZodIssueCode.custom, message: "Conflicting stamp state must remain unreadable"});
  const seen = new Set<string>();
  if (value.observedStamp !== "UNREADABLE" && !value.candidates.some(c=>c.stamp.status === value.observedStamp))
    ctx.addIssue({code: z.ZodIssueCode.custom, message: "Stamp state requires a supporting observation"});
  for (const candidate of value.candidates) {
    if (seen.has(candidate.referenceId) || !candidate.referenceId.startsWith(`${candidate.scryfallId}:`))
      ctx.addIssue({code: z.ZodIssueCode.custom, message: "Printing identity differs or repeats"});
    seen.add(candidate.referenceId);
    if (value.conflictingObservations && candidate.relation !== "UNRESOLVED")
      ctx.addIssue({code: z.ZodIssueCode.custom, message: "Conflicting observations cannot resolve a printing"});
    if (candidate.referenceStampState === "UNKNOWN" && candidate.relation !== "UNRESOLVED")
      ctx.addIssue({code: z.ZodIssueCode.custom, message: "Unknown reference cannot resolve a printing"});
    if (candidate.relation !== "UNRESOLVED" &&
        (value.observedStamp === "UNREADABLE" ||
         ((candidate.relation === "AGREES_WITH_STAMP_STATE") !== (value.observedStamp === candidate.referenceStampState))))
      ctx.addIssue({code: z.ZodIssueCode.custom, message: "Printing relation differs from the observed stamp state"});
    if (candidate.relation !== "UNRESOLVED" &&
        (candidate.alignment.status !== "ALIGNED" || !candidate.alignment.stampVisible ||
         !candidate.alignment.footerVisible || (candidate.alignment.sourceCardWidth ?? 0) < 500))
      ctx.addIssue({code: z.ZodIssueCode.custom, message: "Resolved stamp requires visible supported alignment"});
  }
});
export type PrintingObservation = z.infer<typeof printingNativeSchema>;

// A failed check does not establish absence. Keep contradicted suggestions
// available for correction, ordered after uncontradicted candidates.
export function applyAcquisitionPrintingEvidence(
  proposals: TextProposals,
  printing: PrintingObservation | undefined,
  cards: Map<string, RecognitionCard>,
): TextProposals {
  if (!printing) return proposals;
  const byCard = new Map<string, PrintingObservation["candidates"]>();
  for (const evidence of printing.candidates) {
    const card = cards.get(evidence.scryfallId);
    if (card) byCard.set(card.id, [...(byCard.get(card.id) ?? []), evidence]);
  }
  const updated = proposals.proposals.map((proposal) => {
    const evidence = byCard.get(proposal.card.id) ?? [];
    const reasons = proposal.reasons.filter(r => r !== "STRONG_EXACT_PRINTING");
    const states = new Set(evidence.map(e => e.relation));
    if (printing.conflictingObservations ||
        (states.has("AGREES_WITH_STAMP_STATE") && states.has("CONTRADICTS_STAMP_STATE")))
      reasons.push("STAMP_EVIDENCE_CONFLICT");
    else if (states.has("CONTRADICTS_STAMP_STATE")) reasons.push("STAMP_CONTRADICTION");
    else if (states.has("AGREES_WITH_STAMP_STATE"))
      reasons.push(printing.observedStamp === "PRESENT" ? "STAMP_PRESENT" : "STAMP_ABSENT");
    else reasons.push("STAMP_UNREADABLE");
    return {...proposal, reasons: [...new Set([...reasons, "REVIEW_REQUIRED"])]};
  });
  return {...proposals,
    status: printing.conflictingObservations ? "CONFLICT" : proposals.status,
    automaticAcceptance: false,
    proposals: [...updated.filter(p=>!p.reasons.includes("STAMP_CONTRADICTION")),
      ...updated.filter(p=>p.reasons.includes("STAMP_CONTRADICTION"))],
  };
}

export const printingSummarySchema = z.object({
  observedStamp: stampState,
  conflictingObservations: z.boolean(),
  candidates: z.array(z.object({
    cardId: z.string().nullable(),
    stamp: stampState,
    referenceStampState: referenceState,
    relation,
    reason: z.string().max(80),
  })).max(24),
});

export function acquisitionPrintingSummary(
  printing: PrintingObservation,
  cards: Map<string, RecognitionCard>,
) {
  return {
    observedStamp: printing.observedStamp,
    conflictingObservations: printing.conflictingObservations,
    candidates: printing.candidates.map(c=>({
      cardId: cards.get(c.scryfallId)?.id ?? null,
      stamp: c.stamp.status,
      referenceStampState: c.referenceStampState,
      relation: c.relation,
      reason: c.stamp.reason,
    })),
  };
}
