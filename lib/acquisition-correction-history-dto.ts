import { z } from "zod";

const printingSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(300),
  setCode: z.string().max(30), collectorNumber: z.string().max(100), lang: z.string().max(20).nullable().optional() }).strip();
const kinds: Record<string, string> = {
  FIRST_CHOICE_AGREEMENT: "Agreed with the first suggestion", OFFERED_ALTERNATIVE_SELECTED: "Selected another suggestion",
  SEARCHED_PRINTING_SELECTED: "Selected a printing found by search", NO_SUGGESTION_RESOLVED: "Saved a printing without suggestions",
  LABEL_REVISED: "Changed a saved printing", METADATA_ONLY: "Updated attributes of the same printing",
  RETURNED_TO_PENDING: "Returned the scan to pending", DISPLAY_IDENTITY_UNKNOWN: "Saved without a recorded suggestion",
  AUTOMATIC_SELECTION: "Automatic selection", LIBRARY_REMOVED: "Example removed",
};
const gaps: Record<string, string> = {
  SOURCE_ORIGINAL_UNAVAILABLE: "The source original was unavailable at the save.",
  DISPLAY_HISTORY_TRUNCATED: "Some earlier displays were not retained.",
  DISPLAY_IDENTITY_INVALID: "A display identity could not be validated.",
  DISPLAY_SOURCE_UNAVAILABLE: "Some displayed processing evidence was unavailable.",
  DISPLAY_SOURCE_CHANGED: "Some displayed processing evidence changed before the save.",
  DISPLAY_IDENTITY_UNKNOWN: "The displayed suggestions were not recorded.",
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bounded(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
function printing(value: unknown) {
  const parsed = printingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function decision(payload: Record<string, unknown>, key: "before" | "after", projections: unknown[]) {
  const value = payload[key];
  if (value === null) return { state: "PENDING" as const, printing: null, finish: null, condition: null, language: null };
  const raw = record(value), id = bounded(raw.cardId, 200);
  if (!id) return { state: "UNKNOWN" as const, printing: null, finish: null, condition: null, language: null };
  return { state: "SELECTED" as const, printing: projections.map(printing).find(card => card?.id === id) ?? null,
    finish: bounded(raw.finish, 30), condition: bounded(raw.condition, 30), language: bounded(raw.language, 20) };
}

// Browser projection is independent of the archived evidence schema. Never send
// raw payloads, actor/source IDs, signatures, filesystem context or job output.
export function correctionHistoryEntry(event: { id: string; candidateRevision: number; createdAt: Date;
  origin: string; classification: string; payload: unknown }) {
  const raw = record(event.payload), supported = raw.version === 1 && raw.removed !== true;
  const payload = supported ? raw : {};
  const projections = Array.isArray(payload.printingProjections) ? payload.printingProjections.slice(0, 12) : [];
  const suggested = payload.displayKnown === true ? printing(payload.firstDisplayedSuggestion) : null;
  const suggestionState = payload.displayKnown !== true ? "UNKNOWN" as const
    : payload.firstDisplayedSuggestion === null ? "NONE" as const : suggested ? "RECORDED" as const : "UNKNOWN" as const;
  const missing = Array.isArray(payload.missing) ? payload.missing.slice(0, 32) : [];
  const evidenceGaps = [...new Set(missing.map(flag => typeof flag === "string" && Object.hasOwn(gaps, flag)
    ? gaps[flag] : "Some evidence details are unavailable."))];
  if (!supported) evidenceGaps.unshift("This saved record uses an unavailable evidence format.");
  return {
    id: event.id, revision: event.candidateRevision, savedAt: event.createdAt.toISOString(),
    origin: event.origin === "HUMAN" ? "Human review" : event.origin === "AUTO" ? "Automatic selection" : "Review origin not recorded",
    kind: Object.hasOwn(kinds, event.classification) ? kinds[event.classification] : "Review kind not recorded",
    before: decision(payload, "before", projections), after: decision(payload, "after", projections),
    suggestion: { state: suggestionState, printing: suggested },
    evidenceGaps, verification: payload.independentVerification === "UNVERIFIED" ? "UNVERIFIED" as const : "UNKNOWN" as const,
  };
}
export type CorrectionHistoryEntry = ReturnType<typeof correctionHistoryEntry>;
