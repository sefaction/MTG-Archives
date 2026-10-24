import { z } from "zod";
import type { AcquisitionReviewEvidence } from "./acquisition-review-evidence";
import type { AcquisitionCatalogStatus } from "./acquisition-catalog-status";
import { acquisitionManualRegionSchema, type AcquisitionManualRegion } from "./acquisition-manual-region";
import { correctionDisplayTokensSchema } from "./acquisition-correction-display";
import {acquisitionBatchLanguageSchema} from "./acquisition-batch-language";
export const acquisitionDefaultsSchema = z
  .object({
    finish: z.enum(["UNKNOWN", "NONFOIL", "FOIL", "ETCHED"]),
    condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).nullable(),
    language: acquisitionBatchLanguageSchema.nullable().optional(),
    openerPlayerId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
export type AcquisitionDefaults = z.infer<typeof acquisitionDefaultsSchema>;
export function preserveAcquisitionDefaultChoices(next:AcquisitionDefaults,previous:AcquisitionDefaults) {
  // Older clients edit only the fields they know. Explicit null still clears.
  const merged=next.language===undefined && previous.language!==undefined ? {...next,language:previous.language} : next;
  return next.openerPlayerId===undefined && previous.openerPlayerId!==undefined
    ? {...merged,openerPlayerId:previous.openerPlayerId} : merged;
}
export type AcquisitionOpenerChoice = {id: string; displayName: string};
export const acquisitionOpenerName = (id: string | null | undefined, choices: AcquisitionOpenerChoice[]) =>
  id ? choices.find(choice => choice.id === id)?.displayName ?? "Unavailable player" : "Unknown";
export const emptyAcquisitionDefaults: AcquisitionDefaults = {
  finish: "NONFOIL",
  condition: "NM",
};
export const acquisitionReviewDecisionSchema = z
  .object({
    cardId: z.string().min(1).max(200),
    language: z.string().trim().min(2).max(20),
    finish: z.enum(["NONFOIL", "FOIL", "ETCHED"]),
    condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
    openerPlayerId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
// Missing provenance on an older review means Unknown, independently of later
// batch changes. Only unreviewed cards start with the chosen batch default.
export function acquisitionReviewOpener(defaults: AcquisitionDefaults,
  review: {openerPlayerId?: string | null} | null,
  draft?: {openerPlayerId?: string | null}) {
  // An older draft did not edit this field. Preserve the loaded saved/default
  // attribution, while honoring a newer draft's deliberate known or Unknown.
  if (draft?.openerPlayerId !== undefined) return draft.openerPlayerId;
  return review ? review.openerPlayerId ?? null : defaults.openerPlayerId ?? null;
}
// Older clients cannot see this new field. Their unrelated edits must retain
// an already saved opener; an explicit null remains an intentional Unknown.
export function preserveAcquisitionReviewOpener(
  decision: z.infer<typeof acquisitionReviewDecisionSchema>, review: {openerPlayerId?: string | null} | null) {
  return decision.openerPlayerId === undefined && review?.openerPlayerId !== undefined
    ? {...decision, openerPlayerId: review.openerPlayerId} : decision;
}
export const acquisitionReviewRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("defaults"),
      revision: z.number().int().nonnegative(),
      defaults: acquisitionDefaultsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("accept"),
      photoId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      decision: acquisitionReviewDecisionSchema,
      evidenceTokens: correctionDisplayTokensSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("pending"),
      photoId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      evidenceTokens: correctionDisplayTokensSchema.optional(),
    })
    .strict(),
  z.object({action:z.literal("scanner-layout"),photoId:z.string().uuid(),revision:z.number().int().nonnegative(),
    requestKey:z.string().uuid(),reset:z.boolean()}).strict(),
  z.object({ action: z.literal("region"), photoId: z.string().uuid(),
    revision: z.number().int().nonnegative(), requestKey: z.string().uuid(),
    region: acquisitionManualRegionSchema.nullable(),
  }).strict(),
]);
export type AcquisitionPrinting = {
  id: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  lang: string | null;
  imageUri: string | null;
  finishes: unknown;
};
export function acquisitionPreferredPrinting(record:Pick<AcquisitionCardReview,"printing"|"review"|"defaults"|"suggestions">) {
  return record.printing ?? (!record.review && record.defaults.language
    ? record.suggestions.find(row=>row.printing.lang?.toLowerCase()===record.defaults.language)?.printing : null)
    ?? record.suggestions[0]?.printing ?? null;
}
export const acquisitionPrintingSelect = {
  id: true,
  name: true,
  setCode: true,
  collectorNumber: true,
  lang: true,
  imageUri: true,
  finishes: true,
} as const;
export type AcquisitionCardReview = {
  photoId: string;
  evidenceToken?: string;
  revision: number;
  position: number;
  defaults: AcquisitionDefaults;
  review:
    | (z.infer<typeof acquisitionReviewDecisionSchema> & {
        actorId: string;
        source?: "AUTO_STRONG_MATCH";
      })
    | null;
  printing: AcquisitionPrinting | null;
  suggestions: { printing: AcquisitionPrinting; reasons: string[] }[];
  recognitionStatus: string;
  visualStatus?: string;
  printingStatus?: string;
  catalog?: AcquisitionCatalogStatus | null;
  evidence: AcquisitionReviewEvidence;
  scannerLayout?: {saved:boolean;canSave:boolean;applied:boolean};
  manualRegion?: AcquisitionManualRegion | null;
  manualRegionRequestedRevision?: number;
};
