import { z } from "zod";
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
  status: z.enum([
    "WAITING",
    "PENDING",
    "RUNNING",
    "FAILED",
    "COMPLETE",
    "SUPERSEDED",
  ]),
  result: proposalSchema.nullable(),
});
export type RecognitionResponse = z.infer<typeof recognitionResponseSchema>;
export function acquisitionRecognitionDto(
  status: RecognitionResponse["status"],
  output: unknown,
): RecognitionResponse {
  const result = z.object({ proposals: proposalSchema }).safeParse(output);
  return {
    status,
    result:
      status === "COMPLETE" && result.success ? result.data.proposals : null,
  };
}
