import { z } from "zod";
import { acquisitionDefaultsSchema } from "./acquisition-review";

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
  defaults: acquisitionDefaultsSchema.optional(),
  continuous: z.literal(true).optional(),
  continueFrom: z.string().uuid().optional(),
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
// Server-written upload guidance shares the existing diagnostic JSON column;
// helper preflight reports cannot submit these codes or arbitrary text.
export const scannerUploadProblemSchema = z.object({
  code: z.literal("PHOTO_STORAGE_LIMIT"), scope: z.enum(["OWNER", "BATCH"]),
  limitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observedAt: z.string().datetime(),
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
  feederEmpty: z.boolean(), transportEmpty: z.literal(true),
  eachImageIsOneCardFront: z.literal(true), noJamOrDouble: z.literal(true),
  remainingCards: z.number().int().min(0).max(500).optional(),
  remainingWhollyInHopper: z.literal(true).optional(),
}).strict();
export const scannerRefillSchema = z.object({
  runId: z.string().uuid(), requestKey: z.string().uuid(), loadedCount: z.number().int().min(1).max(500).nullable(),
  operatorLoadedSimplexFronts: z.literal(true),
}).strict();
/** A completed empty-feeder attempt can be inspected after the operator reloads.
 * Accounted cards wholly in the hopper are safe to keep for an explicit refill;
 * clear transport and the other physical observations remain mandatory. */
export function scannerRefillObservationIsSafe(value: unknown, runId: string): boolean {
  const parsed = scannerReconcileSchema.safeParse(value);
  if (!parsed.success || parsed.data.runId !== runId) return false;
  const observation = parsed.data;
  return observation.feederEmpty
    ? (observation.remainingCards ?? 0) === 0
    : observation.remainingWhollyInHopper === true && (observation.remainingCards ?? 0) > 0;
}
export function scannerRefillReconciliationIsSafe(value: unknown, runId: string, imageCount: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.mode === "SCANNER_IMAGE_COUNT")
    return receipt.basis === "QUALIFIED_COUNTED_FRONT_IMAGES" && receipt.imageCount === imageCount;
  return scannerRefillObservationIsSafe(receipt.observation, runId);
}
export const scannerRetentionSchema = z.object({
  version: z.literal(1), runId: z.string().uuid(), epoch: z.string().uuid(),
  artifacts: z.array(z.object({ artifactId: z.string().uuid(), photoId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.artifacts.map(a => a.artifactId)).size !== value.artifacts.length)
    ctx.addIssue({ code: "custom", message: "Duplicate scanner artifact" });
});
