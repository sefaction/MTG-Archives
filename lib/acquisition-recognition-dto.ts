import { z } from "zod";
import { catalogStatusSchema } from "./acquisition-catalog-status";
const processingStatus = z.enum(["WAITING", "PENDING", "RUNNING", "FAILED", "COMPLETE", "SUPERSEDED"]);
const proposalSchema = z.object({
  status: z.enum(["CONFLICT", "REVIEW_REQUIRED", "NO_MATCH", "STRONG_MATCH"]),
  automaticAcceptance: z.boolean(),
  totalProposals: z.number().int().nonnegative(),
  truncated: z.boolean(),
  proposals: z
    .array(
      z.object({
        card: z.object({
          id: z.string(),
          name: z.string(),
          setCode: z.string(),
          collectorNumber: z.string(),
          lang: z.string().nullable().optional(),
        }),
        reasons: z.array(z.string()),
        nameDistance: z.number().nullable(),
      }),
    )
    .max(12),
});
export const recognitionResponseSchema = z.object({
  printingStatus: processingStatus.optional(),
  visualStatus: z
    .enum(["WAITING", "PENDING", "RUNNING", "FAILED", "COMPLETE", "SUPERSEDED"])
    .optional(),
  status: z.enum([
    "WAITING",
    "PENDING",
    "RUNNING",
    "FAILED",
    "COMPLETE",
    "SUPERSEDED",
  ]),
  result: proposalSchema.nullable(),
  catalog: catalogStatusSchema.nullable().optional(),
});
export type RecognitionResponse = z.infer<typeof recognitionResponseSchema>;
export function acquisitionRecognitionDto(
  status: RecognitionResponse["status"],
  output: unknown,
  visualStatus?: RecognitionResponse["status"],
  printingStatus?: RecognitionResponse["status"],
): RecognitionResponse {
  const result = z.object({ proposals: proposalSchema }).safeParse(output);
  const parsed = z.object({ catalog: catalogStatusSchema }).safeParse(output);
  let catalog: RecognitionResponse["catalog"] = parsed.success
    ? parsed.data.catalog
    : null;
  if (visualStatus === "FAILED") {
    // A failed comparison is explicit, even if OCR has not returned yet.
    catalog = {status: "INCOMPLETE", printingCoverage: "UNRESOLVED"};
  }
  if (
    result.success &&
    (catalog?.status !== "RESOLVED" ||
      (visualStatus && visualStatus !== "COMPLETE") ||
      (printingStatus && printingStatus !== "COMPLETE"))
  ) {
    result.data.proposals.automaticAcceptance = false;
    if (result.data.proposals.status === "STRONG_MATCH")
      result.data.proposals.status = "REVIEW_REQUIRED";
  }
  return {
    status,
    ...(visualStatus ? { visualStatus } : {}),
    ...(printingStatus ? { printingStatus } : {}),
    catalog,
    result:
      status === "COMPLETE" && result.success ? result.data.proposals : null,
  };
}
