import { z } from "zod";

export const SCANNER_CAPTURE_PROVIDER = "windows-scanner-simplex-v1";
export function scannerCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(scannerCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([k,v])=>`${JSON.stringify(k)}:${scannerCanonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const scannerSettingsSchema = z.object({
  dpi: z.union([z.literal(300), z.literal(600)]),
  widthInches: z.number().min(2.5).max(4),
  heightInches: z.number().min(3.5).max(6),
  horizontalPlacement: z.enum(["Start", "Center", "End"]),
  duplex: z.literal(false), color: z.literal("RGB"),
  autoCrop: z.literal(false), deskew: z.literal(false), removeBlank: z.literal(false),
}).strict();
export const scannerBatchSchema = z.object({
  requestKey: z.string().uuid(), agentId: z.string().uuid(),
  deviceId: z.string().min(1).max(256),
  locationId: z.string().min(1).max(200), section: z.string().max(100),
  quantity: z.number().int().min(1).max(5000).nullable(),
  loadedCount: z.number().int().min(1).max(500).nullable(),
  settings: scannerSettingsSchema,
  operatorLoadedSimplexFronts: z.literal(true),
}).strict();
export const scannerRunClaimSchema = z.object({
  version: z.literal(1), runId: z.string().uuid(), epoch: z.string().uuid(),
  executionId: z.string().uuid(),
}).strict();
export const scannerPreflightCodeSchema = z.enum([
  "SCANNER_UNAVAILABLE", "SCANNER_BUSY", "LOW_DISK_SPACE", "STORAGE_UNAVAILABLE",
  "FEEDER_UNAVAILABLE", "DRIVER_ERROR",
]);
export const scannerPreflightReportSchema = z.object({
  version: z.literal(1), runId: z.string().uuid(), epoch: z.string().uuid(),
  code: scannerPreflightCodeSchema,
}).strict();
export const scannerPreflightProblemSchema = z.object({
  code: scannerPreflightCodeSchema, observedAt: z.string().datetime(),
}).strict();
export const scannerTransferSchema = scannerRunClaimSchema.extend({
  artifactId: z.string().uuid(), sequence: z.number().int().min(1).max(5000),
  timestamp: z.string().datetime({ offset: true }),
  side: z.literal("UNKNOWN"), physicalBoundary: z.literal("UNKNOWN"),
}).strict();
export const scannerRunOutcomeSchema = z.object({
  outcome: z.enum(["COMPLETED", "SOURCE_EXHAUSTED", "DRAINED_AFTER_UNSUPPORTED_STOP", "ERROR", "INTERRUPTED"]),
  imageCount: z.number().int().min(0).max(5000),
  elapsedMs: z.number().int().min(0).max(86400000),
  knownPhysicalItems: z.null(), sourceExhausted: z.enum(["UNKNOWN", "REPORTED_EMPTY"]),
  nativeError: z.object({ type: z.string().max(200), nativeStatus: z.number().int() }).strict().nullable(),
}).strict();
export const scannerRunFinishSchema = scannerRunClaimSchema.extend({ outcome: scannerRunOutcomeSchema }).strict();
export const scannerReconcileSchema = z.object({
  runId: z.string().uuid(), cardsEmitted: z.number().int().min(0).max(5000),
  feederEmpty: z.literal(true), transportEmpty: z.literal(true),
  eachImageIsOneCardFront: z.literal(true), noJamOrDouble: z.literal(true),
}).strict();
export const scannerRetentionSchema = z.object({
  version: z.literal(1), runId: z.string().uuid(), epoch: z.string().uuid(),
  artifacts: z.array(z.object({ artifactId: z.string().uuid(), photoId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.artifacts.map(a => a.artifactId)).size !== value.artifacts.length)
    ctx.addIssue({ code: "custom", message: "Duplicate scanner artifact" });
});
