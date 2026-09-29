import { z } from "zod";
import type { AcquisitionReviewEvidence } from "./acquisition-review-evidence";
import type { AcquisitionCatalogStatus } from "./acquisition-catalog-status";
export const acquisitionDefaultsSchema = z
  .object({
    finish: z.enum(["UNKNOWN", "NONFOIL", "FOIL", "ETCHED"]),
    condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).nullable(),
  })
  .strict();
export type AcquisitionDefaults = z.infer<typeof acquisitionDefaultsSchema>;
export const emptyAcquisitionDefaults: AcquisitionDefaults = {
  finish: "UNKNOWN",
  condition: null,
};
export const acquisitionReviewDecisionSchema = z
  .object({
    cardId: z.string().min(1).max(200),
    language: z.string().trim().min(2).max(20),
    finish: z.enum(["NONFOIL", "FOIL", "ETCHED"]),
    condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
  })
  .strict();
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
    })
    .strict(),
  z
    .object({
      action: z.literal("pending"),
      photoId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
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
  catalog?: AcquisitionCatalogStatus | null;
  evidence: AcquisitionReviewEvidence;
};
