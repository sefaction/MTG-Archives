import { z } from "zod";
import { printingNativeSchema, type PrintingObservation } from "./acquisition-printing";
import { acquisitionManualRegionSchema, validateAcquisitionManualRegionFrame, type AcquisitionManualRegion } from "./acquisition-manual-region";

export const REFERENCE_REGION_POLICY = "scanner-rectangle-reference-region-v2";
export const acquisitionReferenceRegionSchema = z.object({
  version: z.literal(1),
  region: acquisitionManualRegionSchema,
  references: z.array(z.string().min(38).max(100)).min(1).max(24),
  policy: z.literal(REFERENCE_REGION_POLICY),
}).strict();
export type AcquisitionReferenceRegion = z.infer<typeof acquisitionReferenceRegionSchema>;
type Geometry = { status: string; method?: string; framing?: string; quad?: number[][] };
type Selection = { status: "REJECTED"; reason: string } | {
  status: "PROPOSED"; region: AcquisitionManualRegion; references: string[]; policy: typeof REFERENCE_REGION_POLICY;
};

// A document scanner permits rotation but does not introduce camera perspective.
// Apply this physical frame prior in source pixels, before reference agreement.
// The bounds allow small fitting error; they are not calibrated probabilities.
// Keep the same conditions in native reference_card_region.py.
export function scannerReferenceRectangle(quad: number[][]) {
  if (quad.length !== 4 || quad.some(p=>p.length!==2 || !p.every(Number.isFinite))) return false;
  const edges=quad.map(([x,y],i)=>[quad[(i+1)%4][0]-x,quad[(i+1)%4][1]-y]);
  const lengths=edges.map(([x,y])=>Math.hypot(x,y));
  if(lengths.some(n=>!Number.isFinite(n)||n<=0))return false;
  for(let i=0;i<4;i++){
    const [x,y]=edges[i],[a,b]=edges[(i+1)%4];
    if(Math.abs(x*a+y*b)/(lengths[i]*lengths[(i+1)%4])>.05)return false;
    const [c,d]=edges[(i+2)%4];
    if(Math.abs(x*d-y*c)/(lengths[i]*lengths[(i+2)%4])>.05)return false;
    if(Math.abs(lengths[i]-lengths[(i+2)%4])/Math.max(lengths[i],lengths[(i+2)%4])>.05)return false;
  }
  return true;
}

// Only observed native alignments supply an outline. No saved/expected card ID,
// proposal score or human selection enters this policy.
export function selectAcquisitionReferenceRegion(input: {
  inputKind: "PHOTO" | "CARD_SCAN"; geometry: Geometry; printing: PrintingObservation;
  manualAnalysis?: unknown; alreadyRefined?: boolean;
}): Selection {
  const reject = (reason: string): Selection => ({ status: "REJECTED", reason });
  if (input.inputKind !== "CARD_SCAN") return reject("SCANNER_ONLY");
  if (input.manualAnalysis != null) return reject("MANUAL_ANALYSIS_AUTHORITATIVE");
  if (input.alreadyRefined) return reject("ONE_PASS_ALREADY_USED");
  if (input.geometry.framing === "CLIPPED") return reject("PHYSICAL_CLIPPING");
  if (input.geometry.method === "reference-anchor-region-v1") return reject("ONE_PASS_ALREADY_USED");
  if (input.geometry.status !== "PROPOSED") return reject("DIRECT_GEOMETRY_UNAVAILABLE");
  const parsed = printingNativeSchema.safeParse(input.printing);
  if (!parsed.success) return reject("INVALID_REFERENCE_EVIDENCE");
  const printing = parsed.data, size = printing.sourceSize;
  if (!size || printing.conflictingObservations) return reject("REFERENCE_CONFLICT");
  const supported = printing.candidates.flatMap(candidate => {
    const a = candidate.alignment;
    if (a.status !== "ALIGNED" || !a.quad || !a.footerVisible ||
        (a.sourceCardWidth ?? 0) < 500 || (a.inliers ?? 0) < 16 ||
        (a.supportFraction ?? 0) < .25 || (a.medianReprojectionPixels ?? Infinity) > 3 ||
        !scannerReferenceRectangle(a.quad)) return [];
    try {
      const region = validateAcquisitionManualRegionFrame({ version: 1,
        quad: a.quad.map(([x, y]) => [x / (size[0] - 1), y / (size[1] - 1)]) }, ...size);
      return [{ region, referenceId: candidate.referenceId }];
    } catch { return []; }
  });
  if (!supported.length) return reject("NO_SUPPORTED_REFERENCE");
  const first = supported[0].region;
  if (supported.some(candidate => candidate.region.quad.some(([x, y], i) =>
      Math.hypot(x - first.quad[i][0], y - first.quad[i][1]) > .01)))
    return reject("AMBIGUOUS_REFERENCE_OUTLINES");
  // Compare sets of corners across all cyclic/reversed orders so quarter turns
  // cannot make an already framed scan look like a materially new outline.
  const observed = input.geometry.quad;
  if (observed?.length === 4 && observed.every(point => point.length === 2 && point.every(Number.isFinite))) {
    const normalized = observed.map(([x, y]) => [x / (size[0] - 1), y / (size[1] - 1)]);
    if (first.quad.every(([x, y]) => normalized.some(([a, b]) => Math.hypot(x - a, y - b) <= .01)))
      return reject("ALREADY_FRAMED");
  }
  // Edge measurements are authoritative even if a mismatched reference fits
  // a different inner rectangle. Refinement is for unresolved direct outlines.
  if (input.geometry.method && input.geometry.method !== "declared-card-scan")
    return reject("DIRECT_GEOMETRY_AUTHORITATIVE");
  return { status: "PROPOSED", region: first,
    references: supported.map(x => x.referenceId).sort(), policy: REFERENCE_REGION_POLICY };
}
