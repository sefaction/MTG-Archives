import { z } from "zod";
import { acquisitionCollectorKey, type RecognitionCard } from "./acquisition-recognition";
import type { TextProposals } from "./acquisition-visual";

export const PRINTING_STAGE = "photo-printing-evidence-v1";
// The native detector and the catalog interpretation have independent versions.
export const PRINTING_POLICY_VERSION = "catalog-stamp-expectations-v1";

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

function printingFamily(card: RecognitionCard) {
  const origin = card.setCode.toLowerCase() === "plst"
    ? /^([a-z0-9]{2,6})-(.+)$/i.exec(card.collectorNumber) : null;
  return JSON.stringify([card.name.toLowerCase(), card.lang?.toLowerCase() ?? "",
    origin?.[1].toLowerCase() ?? card.setCode.toLowerCase(),
    acquisitionCollectorKey(origin?.[2] ?? card.collectorNumber)]);
}

const expectationSource = z.enum([
  "CATALOG_LIST_REPRINT", "CATALOG_SOURCE_PRINTING", "VERIFIED_REFERENCE", "UNKNOWN",
]);
type NativeCandidate = PrintingObservation["candidates"][number];

function visibleStampSupport(candidate: NativeCandidate) {
  return candidate.alignment.status === "ALIGNED" && candidate.alignment.stampVisible &&
    candidate.alignment.footerVisible && (candidate.alignment.sourceCardWidth ?? 0) >= 500;
}

function supportsObservedStamp(candidate: NativeCandidate, printing: PrintingObservation) {
  if (printing.conflictingObservations || printing.observedStamp === "UNREADABLE" ||
      !visibleStampSupport(candidate)) return false;
  if (candidate.stamp.status === printing.observedStamp) return true;
  const quad = candidate.alignment.quad;
  if (!quad) return false;
  // Match the native same-outline transfer rule. A stamp seen on an unrelated
  // alignment cannot establish the state of this candidate's physical corner.
  return (candidate.sharedObservationSources ?? []).some(id => {
    const source = printing.candidates.find(c => c.referenceId === id);
    if (!source || source === candidate || !visibleStampSupport(source) ||
        source.stamp.status !== printing.observedStamp || !source.alignment.quad) return false;
    const tolerance = .01 * Math.min(candidate.alignment.sourceCardWidth!, source.alignment.sourceCardWidth!);
    return quad.every(([x, y], i) => Math.hypot(x - source.alignment.quad![i][0],
      y - source.alignment.quad![i][1]) <= tolerance);
  });
}

function printingComparisons(printing: PrintingObservation, cards: Map<string, RecognitionCard>) {
  const isListReprint = (card: RecognitionCard) => card.digital !== true &&
    card.setCode.toLowerCase() === "plst" && /^([a-z0-9]{2,6})-(.+)$/i.test(card.collectorNumber);
  // Limit the source-printing inference to counterparts actually proposed to
  // this native check. Other sets and special treatments remain unqualified.
  const sourceFamilies = new Set(printing.candidates.flatMap(c => {
    const card = cards.get(c.scryfallId);
    return card && isListReprint(card) ? [printingFamily(card)] : [];
  }));
  return printing.candidates.map(candidate => {
    const card = cards.get(candidate.scryfallId);
    const expectation: {state: z.infer<typeof referenceState>; source: z.infer<typeof expectationSource>} =
      card && isListReprint(card) ? {state: "PRESENT", source: "CATALOG_LIST_REPRINT"}
      : card && card.digital !== true && card.setCode.toLowerCase() !== "plst" &&
        sourceFamilies.has(printingFamily(card)) ? {state: "ABSENT", source: "CATALOG_SOURCE_PRINTING"}
      : candidate.referenceStampState !== "UNKNOWN"
        ? {state: candidate.referenceStampState, source: "VERIFIED_REFERENCE"}
        : {state: "UNKNOWN", source: "UNKNOWN"};
    const printingRelation: z.infer<typeof relation> = expectation.state === "UNKNOWN" ||
      !supportsObservedStamp(candidate, printing) ? "UNRESOLVED"
      : printing.observedStamp === expectation.state ? "AGREES_WITH_STAMP_STATE" : "CONTRADICTS_STAMP_STATE";
    return {candidate, expectedStampState: expectation.state, expectationSource: expectation.source,
      relation: printingRelation};
  });
}

// A failed check does not establish absence. Keep contradicted suggestions
// available for correction, ordered after uncontradicted candidates.
export function applyAcquisitionPrintingEvidence(
  proposals: TextProposals,
  printing: PrintingObservation | undefined,
  cards: Map<string, RecognitionCard>,
): TextProposals {
  if (!printing) return proposals;
  const byCard = new Map<string, ReturnType<typeof printingComparisons>>();
  for (const evidence of printingComparisons(printing, cards)) {
    const card = cards.get(evidence.candidate.scryfallId);
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
  // Stamp evidence is not card identity. Compare it only among originals/List
  // counterparts that share name, language and printed set/collector. An
  // unrelated agreed stamp must never jump ahead of better identity evidence.
  if (!printing.conflictingObservations) {
    const families = new Map<string, number[]>();
    updated.forEach((p, i) => {
      const key = printingFamily(p.card);
      families.set(key, [...(families.get(key) ?? []), i]);
    });
    for (const indices of families.values()) {
      if (indices.some(i => updated[i].reasons.includes("STAMP_EVIDENCE_CONFLICT"))) continue;
      const rank = (p: typeof updated[number]) => p.reasons.includes("STAMP_CONTRADICTION") ? 2
        : p.reasons.includes("STAMP_PRESENT") || p.reasons.includes("STAMP_ABSENT") ? 0 : 1;
      const ordered = indices.map(i=>updated[i]).sort((a,b)=>rank(a)-rank(b));
      indices.forEach((i,n)=>{updated[i]=ordered[n];});
    }
  }
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
    expectedStampState: referenceState.optional(),
    expectationSource: expectationSource.optional(),
    referenceRelation: relation.optional(),
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
    candidates: printingComparisons(printing, cards).map(({candidate: c, ...comparison})=>({
      cardId: cards.get(c.scryfallId)?.id ?? null,
      stamp: c.stamp.status,
      referenceStampState: c.referenceStampState,
      ...comparison,
      referenceRelation: c.relation,
      reason: c.stamp.reason,
    })),
  };
}
