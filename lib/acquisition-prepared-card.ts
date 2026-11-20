import { z } from "zod";
import { acquisitionManualRegionSchema } from "./acquisition-manual-region";

export const PREPARED_CARD_POLICY = "shared-card-frame-v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const preparedCardSchema = z.object({
  version: z.literal(1), policy: z.literal(PREPARED_CARD_POLICY), photoDigest: digest,
  sourceWidth: z.number().int().min(2).max(36000000),
  sourceHeight: z.number().int().min(2).max(36000000),
  region: acquisitionManualRegionSchema,
  rotationDegrees: z.union([z.literal(0), z.literal(180)]),
  sourceMethod: z.string().min(1).max(60),
  boundary: z.enum(["OBSERVED", "INFERRED", "OPERATOR"]),
}).strict().refine(frame => frame.sourceWidth * frame.sourceHeight <= 36000000);
export type PreparedCard = z.infer<typeof preparedCardSchema>;
export function samePreparedCard(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  const a = preparedCardSchema.safeParse(left), b = preparedCardSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

// Direction comes from complete, independently resolved OCR observations, never
// an OCR score or a preferred catalogue label. Unsupported geometry stays absent.
export function prepareRecognitionCard(native: {
  photoDigest: string; geometry: Record<string, unknown>;
  scannerLayout?: {readingStatus?: string; inference: {status: string; region?: unknown; policy?: string}};
}, proposals: {orientation?: {status: string; rotationDegrees: number | null}; proposals?:{reasons:string[]}[]}): PreparedCard | undefined {
  const geometry = native.geometry;
  if (geometry.status !== "PROPOSED" || geometry.framing === "CLIPPED" ||
      proposals.orientation?.status !== "SELECTED" ||
      proposals.proposals?.[0]?.reasons.includes('UNLOCALIZED_NAME_HINT')) return;
  const frame = geometry.sourceFrame as {width?: number; height?: number} | undefined;
  if (!frame?.width || !frame.height) return;
  const layout = native.scannerLayout?.readingStatus === "COMPLETE" &&
    native.scannerLayout.inference.status === "PROPOSED" ? native.scannerLayout.inference : undefined;
  const region = layout?.region ?? {version: 1, quad: (geometry.quad as number[][] | undefined)?.map(
    ([x, y]) => [x / (frame.width! - 1), y / (frame.height! - 1)])};
  const sourceMethod = layout?.policy ?? String(geometry.method ?? "unknown");
  const parsed = preparedCardSchema.safeParse({version: 1, policy: PREPARED_CARD_POLICY,
    photoDigest: native.photoDigest, sourceWidth: frame.width, sourceHeight: frame.height,
    region, rotationDegrees: proposals.orientation.rotationDegrees, sourceMethod,
    boundary: sourceMethod === "manual-card-region-v1" ? "OPERATOR" :
      ["contours", "scanner-card-edges", "scanner-white-card-edges"].includes(sourceMethod) ? "OBSERVED" : "INFERRED"});
  return parsed.success ? parsed.data : undefined;
}

export function preparedCardFromOutput(output: unknown, photoDigest: string) {
  const record = z.object({photoId: z.string(), preparation: preparedCardSchema.optional()}).safeParse(output);
  if (!record.success || record.data.preparation?.photoDigest !== photoDigest) return undefined;
  return record.data.preparation;
}

// This is a provisional routing decision. It never confirms a card or bypasses
// registered printing checks, and ambiguous/contradictory readings search broadly.
export function exactRecognitionCandidate(output: unknown): string | undefined {
  const parsed = z.object({preparation: preparedCardSchema, proposals: z.object({
    status: z.string(), totalProposals: z.number().optional(),
    orientation: z.object({status: z.string()}),
    proposals: z.array(z.object({card: z.object({id: z.string()}), reasons: z.array(z.string())})),
  })}).safeParse(output);
  if (!parsed.success) return;
  const {proposals} = parsed.data;
  const provisional = proposals.status === 'REVIEW_REQUIRED' &&
    proposals.proposals[0]?.reasons.includes('PREPARED_INPUT_REVIEW_REQUIRED');
  if ((proposals.status !== "STRONG_MATCH" && !provisional) || proposals.orientation.status !== "SELECTED" ||
      proposals.proposals.length !== 1 || (proposals.totalProposals ?? 1) !== 1) return;
  const candidate = proposals.proposals[0], reasons = candidate.reasons;
  if (!reasons.includes("STRONG_EXACT_PRINTING") || !reasons.includes("SET_AND_COLLECTOR_TEXT") ||
      reasons.some(reason => /CONTRADICTION|CONFLICT|UNCERTAIN|FRAGMENT|UNLOCALIZED/.test(reason))) return;
  return candidate.card.id;
}

// Expanded reading regions/inferred boundaries are new evidence policies. They
// can route a provisional candidate, but cannot expand automatic acceptance in
// a legacy text-only installation that has no printing worker enabled.
export function applyPreparedInputPolicy<T extends {status:string;automaticAcceptance:boolean;
  proposals:{reasons:string[]}[]}>(proposals:T,native:{geometry:{method?:unknown};
    orientations:{readingZones?:{footer:{top:number}}}[]}):T {
  if(native.geometry.method!=='internal-layout-v1' &&
    !native.orientations.some(o=>o.readingZones && o.readingZones.footer.top<1270))return proposals;
  return {...proposals,automaticAcceptance:false,
    status:proposals.status==='STRONG_MATCH'?'REVIEW_REQUIRED':proposals.status,
    proposals:proposals.proposals.map(p=>({...p,reasons:[...new Set([...p.reasons,'PREPARED_INPUT_REVIEW_REQUIRED'])]}))};
}
