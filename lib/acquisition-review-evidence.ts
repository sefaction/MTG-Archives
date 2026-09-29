import { z } from "zod";
import { printingSummarySchema } from "./acquisition-printing";
import {
  acquisitionReadingZonesSchema,
  legacyAcquisitionReadingZones,
} from "./acquisition-reading-zones";
import {
  visualNativeSchema,
  acquisitionVisualCandidates,
} from "./acquisition-visual";

const point = z.tuple([z.number().finite(), z.number().finite()]);
const words = z.array(z.string().max(2000)).max(100);
const observation = z.object({
  rotationDegrees: z.union([z.literal(0), z.literal(180)]),
  text: z.object({ title: words, footer: words }),
  lines: z
    .array(
      z.object({
        text: z.string().max(2000),
        score: z.number().finite(),
        polygon: z.array(point).min(3).max(8),
      }),
    )
    .max(100),
});
const schema = z.object({
  printing: printingSummarySchema.optional(),
  visual: visualNativeSchema.optional(),
  native: z.object({
    readingZones: acquisitionReadingZonesSchema.optional(),
    geometry: z.object({
      status: z.string().max(60),
      quad: z.array(point).length(4).optional(),
      method: z.enum(["contours", "full-frame", "declared-card-scan"]).optional(),
    }),
    orientations: z.array(observation).max(2),
  }),
  proposals: z.object({
    orientation: z
      .object({ status: z.string(), rotationDegrees: z.number().nullable() })
      .optional(),
    evidence: z.object({
      setCodes: words,
      collectors: words,
      languages: words,
    }),
  }),
});

// Only bounded, owner-authorized photo observations go to the review UI.
// Deliberately omit worker descriptors, model paths, digests and other internals.
export function acquisitionReviewEvidence(output: unknown) {
  const parsed = schema.safeParse(output);
  if (!parsed.success) return null;
  const { native, proposals, visual, printing } = parsed.data;
  return {
    geometry: native.geometry,
    observations: native.orientations,
    readingZones: native.readingZones ?? legacyAcquisitionReadingZones,
    rotation: proposals.orientation?.rotationDegrees ?? null,
    identifiers: proposals.evidence,
    printing: printing ?? null,
    imageMatches: visual
      ? {
          inputRegion: visual.inputRegion,
          referenceCount: visual.referenceCount,
          candidates: acquisitionVisualCandidates(visual).map(
            ({
              scryfallId,
              name,
              setCode,
              collectorNumber,
              rotationDegrees,
            }) => ({
              scryfallId,
              name,
              setCode,
              collectorNumber,
              rotationDegrees,
            }),
          ),
        }
      : null,
  };
}
export type AcquisitionReviewEvidence = ReturnType<
  typeof acquisitionReviewEvidence
>;

// Inverse perspective map: unit rectangle -> the worker's saved source quad.
// The preview reconstructs the saved transform, without another detection pass.
export function cropPoint(quad: number[][], u: number, v: number) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / det;
  const h = Math.abs(det) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / det;
  const d = g * u + h * v + 1;
  return [
    ((x1 - x0 + g * x1) * u + (x3 - x0 + h * x3) * v + x0) / d,
    ((y1 - y0 + g * y1) * u + (y3 - y0 + h * y3) * v + y0) / d,
  ];
}
