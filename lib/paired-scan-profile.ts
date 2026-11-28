import { z } from "zod";
export const scanProfileSchema = z.enum(["STANDARD", "TOKEN", "ART"]);
export type ScanProfile = z.infer<typeof scanProfileSchema>;
export const pairedProfileSchema = z.enum(["TOKEN", "ART"]);
export const scanSideSchema = z.enum(["FRONT", "BACK"]);
export type ScanSide = z.infer<typeof scanSideSchema>;
export const artStampSchema = z.enum([
  "UNSTAMPED",
  "GOLD_SIGNATURE",
  "GOLD_PLANESWALKER",
  "OTHER_STAMP",
]);
export type ArtStamp = z.infer<typeof artStampSchema>;
export const scanProfileLabels = {
  STANDARD: "Ordinary cards",
  TOKEN: "Double-sided tokens",
  ART: "Art cards",
} as const;
export function isPairedProfile(value: string): value is "TOKEN" | "ART" {
  return value === "TOKEN" || value === "ART";
}

export const pairedSheetSchema = z
  .object({
    version: z.literal(1),
    documentNumber: z.number().int().nonnegative().max(2147483647),
    paperCount: z.number().int().positive().max(2147483647),
  })
  .strict();
export const pairedEvidenceSchema = pairedSheetSchema
  .extend({
    kind: z.literal("SCANNER_SHEET"),
    runId: z.string().uuid(),
    executionId: z.string().uuid(),
  })
  .strict();

export const capturedScanSideSchema = z.enum(["FRONT", "BACK", "UNKNOWN"]);
export const unpairedEvidenceSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("UNPAIRED_IMAGE"),
    runId: z.string().uuid(),
    executionId: z.string().uuid(),
    artifactId: z.string().uuid(),
  })
  .strict();

export const operatorPairEvidenceSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("OPERATOR_PAIR"),
    operatorUserId: z.string().min(1).max(200),
    requestKey: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
    confirmedAt: z.string().datetime(),
    sources: z
      .array(
        z
          .object({
            photoId: z.string().uuid(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            side: scanSideSchema,
            captureSlotId: z.string().uuid(),
            captureGeneration: z.number().int().nonnegative(),
            metadataHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .length(2),
  })
  .strict();
