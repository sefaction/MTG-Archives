import { z } from "zod";

const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
// Clockwise or counterclockwise corners in the EXIF-normalized original.
// Preserve the chosen boundary; never sort a crossing selection into validity.
export const acquisitionManualRegionSchema = z.object({
  version: z.literal(1), quad: z.tuple([point, point, point, point]),
}).strict().superRefine(({ quad }, context) => {
  const turns = quad.map((a, index) => {
    const b = quad[(index + 1) % 4], c = quad[(index + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  if (!(turns.every(turn => turn > 1e-10) || turns.every(turn => turn < -1e-10)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose four separate corners around the card boundary" });
});
export type AcquisitionManualRegion = z.infer<typeof acquisitionManualRegionSchema>;

export function sameAcquisitionManualRegion(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  const a = acquisitionManualRegionSchema.safeParse(left), b = acquisitionManualRegionSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

export const acquisitionManualAnalysisSchema = z.object({
  version: z.literal(1), requestKey: z.string().uuid(), photoId: z.string().uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/), generation: z.number().int().nonnegative(),
  candidateRevision: z.number().int().nonnegative(), region: acquisitionManualRegionSchema.nullable(),
}).strict();
export type AcquisitionManualAnalysis = z.infer<typeof acquisitionManualAnalysisSchema>;

export function sameAcquisitionManualAnalysis(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  const a = acquisitionManualAnalysisSchema.safeParse(left), b = acquisitionManualAnalysisSchema.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

export function validateAcquisitionManualRegionFrame(raw: unknown, width: number, height: number) {
  const region = acquisitionManualRegionSchema.parse(raw);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 36000000)
    throw new Error("Source image dimensions unavailable");
  const pixels = region.quad.map(([x, y]) => [x * (width - 1), y * (height - 1)]);
  const edges = pixels.map((a, index) => {
    const b = pixels[(index + 1) % 4];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const area = Math.abs(pixels.reduce((sum, a, index) => {
    const b = pixels[(index + 1) % 4];
    return sum + a[0] * b[1] - a[1] * b[0];
  }, 0)) / 2;
  if (Math.min(...edges) < 32 || area < 4096)
    throw new Error("Choose the complete card; this region is too small");
  return region;
}
