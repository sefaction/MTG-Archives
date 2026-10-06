import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const CORRECTION_LIBRARY_VERSION = "private-corrections-v1";
export const CORRECTION_LIBRARY_DEFAULT_BYTES = 64_000_000_000n;
export const CORRECTION_SAMPLE_BASIS_POINTS = 200;
export const CORRECTION_SAMPLE_CAP = 200;
export const CORRECTION_EVIDENCE_LIMIT = 512 * 1024;
export { correctionDisplayTokensSchema, type CorrectionDisplayTokens } from "./acquisition-correction-display";

export function correctionLibraryDefaultBytes(env: Record<string, string | undefined> = process.env) {
  const value = env.CORRECTION_LIBRARY_OWNER_LIMIT_GB;
  if (value === undefined) return CORRECTION_LIBRARY_DEFAULT_BYTES;
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new Error("Correction library limit must be whole decimal GB");
  return BigInt(value) * 1_000_000_000n;
}

// Arrays retain order; object key order cannot create false evidence generations.
export function correctionCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(correctionCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, entry]) => `${JSON.stringify(key)}:${correctionCanonical(entry)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export const correctionHash = (value: unknown) => createHash("sha256").update(correctionCanonical(value)).digest("hex");

const printing = z.object({ id: z.string().min(1).max(200), name: z.string().max(300),
  setCode: z.string().max(30), collectorNumber: z.string().max(100), lang: z.string().max(20).nullable(),
  imageUri: z.string().max(4096).nullable(), finishes: z.unknown() }).strip();
export const correctionPrintingProjection = (value: unknown) => {
  const parsed = printing.safeParse(value);
  return parsed.success ? parsed.data : null;
};
const displaySchema = z.object({ version: z.literal(1), ownerPlayerId: z.string().min(1).max(200),
  actorId: z.string().min(1).max(200), photoId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.number().int().nonnegative(), candidateId: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  jobs: z.array(z.object({ id: z.string().uuid(), outputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()).max(16),
  suggestions: z.array(printing).max(12), status: z.string().max(100),
}).strict();
export type CorrectionDisplay = z.infer<typeof displaySchema>;
export function signCorrectionDisplay(value: CorrectionDisplay, key: string) {
  const payload = Buffer.from(correctionCanonical(displaySchema.parse(value))).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  const result = `${payload}.${signature}`;
  if (result.length > 20000) throw new Error("Capture display identity exceeds bounds");
  return result;
}
export function readCorrectionDisplay(token: string, key: string): CorrectionDisplay | null {
  try {
    if (token.length > 20000) return null;
    const [payload, signature, extra] = token.split(".");
    if (extra !== undefined || !payload || !signature) return null;
    const expected = createHmac("sha256", key).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return displaySchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch { return null; }
}

// Saved worker data has a separate allowlist from public DTOs. Authentication,
// device pairing and filesystem context never enter library snapshots.
const secretKey = /token|secret|password|credential|cookie|pairing|environment|path/i;
function privateEvidenceValue(value: unknown, depth = 0): unknown {
  if (depth > 24) return null;
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => privateEvidenceValue(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key))
    .map(([key, item]) => [key, privateEvidenceValue(item, depth + 1)]));
  if (typeof value === "string") return value.slice(0, 8192);
  return value;
}
export function correctionJobSnapshot(job: { id: string; stage: string; versionKey: string;
  candidateRevision: number; input: unknown; output: unknown; status: string; createdAt: Date; updatedAt: Date }) {
  const inputKeys = ["version", "photoId", "digest", "inputKind", "versions", "manualAnalysis", "recognitionJobId",
    "visualJobId", "catalogJobId", "canonicalJobId", "referenceGeneration", "referenceManifestDigest", "candidates"];
  const outputKeys = ["version", "photoId", "native", "proposals", "catalog", "visual", "printing", "versions",
    "timing", "reuse", "visualReuse", "printingReuse", "sourceCatalogJobId", "manualAnalysis", "execution",
    "previewDigest", "width", "height", "bytes", "pipeline"];
  const pick = (value: unknown, keys: string[]) => value && typeof value === "object" && !Array.isArray(value)
    ? privateEvidenceValue(Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)))) : null;
  return { id: job.id, stage: job.stage, versionKey: job.versionKey, candidateRevision: job.candidateRevision,
    status: job.status, createdAt: job.createdAt.toISOString(), observedUpdatedAt: job.updatedAt.toISOString(),
    inputHash: correctionHash(job.input), outputHash: correctionHash(job.output),
    input: pick(job.input, inputKeys), output: pick(job.output, outputKeys),
    replayCoverage: "PARTIAL_SAVED_EVIDENCE", missing: ["ARCHIVED_CATALOG_INDEX_MODEL_GENERATION"] };
}

export function classifyCorrection(input: { afterId: string | null; beforeId: string | null;
  offeredIds: string[]; displayKnown: boolean; origin: "HUMAN" | "AUTO" }) {
  if (!input.afterId) return "RETURNED_TO_PENDING";
  if (input.origin === "AUTO") return "AUTOMATIC_SELECTION";
  if (input.beforeId === input.afterId) return "METADATA_ONLY";
  if (input.beforeId && input.beforeId !== input.afterId) return "LABEL_REVISED";
  if (!input.displayKnown) return "DISPLAY_IDENTITY_UNKNOWN";
  if (!input.offeredIds.length) return "NO_SUGGESTION_RESOLVED";
  if (input.afterId === input.offeredIds[0]) return input.beforeId === input.afterId ? "METADATA_ONLY" : "FIRST_CHOICE_AGREEMENT";
  return input.offeredIds.includes(input.afterId) ? "OFFERED_ALTERNATIVE_SELECTED" : "SEARCHED_PRINTING_SELECTED";
}
export function correctionRequiresOriginal(classification: string) {
  return ["LABEL_REVISED", "DISPLAY_IDENTITY_UNKNOWN", "NO_SUGGESTION_RESOLVED", "OFFERED_ALTERNATIVE_SELECTED",
    "SEARCHED_PRINTING_SELECTED"].includes(classification);
}
