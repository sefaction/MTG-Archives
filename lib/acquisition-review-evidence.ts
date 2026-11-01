import {acquisitionManualRegionSchema} from './acquisition-manual-region';
import {scannerLayoutInferenceSchema} from "./acquisition-scanner-layout";
import { z } from "zod";
import {acquisitionObservedLanguageEvidence} from "./acquisition-batch-language";
import { printingSummarySchema } from "./acquisition-printing";
import { acquisitionPhotoTextSchema } from "./acquisition-photo-text";
import {sourceFooterSchema} from './acquisition-source-footer';
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
  text: z.object({ title: words, footer: words, footerSupplemental: words.optional(),footerSourceIdentifiers:words.optional() }),
  lines: z
    .array(
      z.object({
        text: z.string().max(2000),
        score: z.number().finite(),
        polygon: z.array(point).min(3).max(8),
      }),
    )
    .max(100),
  footerLines: z.array(z.object({text: z.string().max(2000), score: z.number().finite(),
    polygon: z.array(point).min(3).max(8)})).max(100).optional(),
  identifierLines:z.array(z.object({text:z.string().max(2000),score:z.number().finite(),polygon:z.array(point).length(4)})).max(100).optional(),
  identifierSource:sourceFooterSchema.optional(),
});
const primaryReading=observation.pick({rotationDegrees:true,text:true});
const schema = z.object({
  primaryScannerLayout:z.object({inference:scannerLayoutInferenceSchema,orientations:z.array(observation).max(2),
    readingStatus:z.enum(['COMPLETE','TIME_BUDGET','WORKER_ERROR']).optional(),
    anchorSearch:z.object({status:z.literal('COMPLETE'),boundaryVerified:z.literal(false),region:acquisitionManualRegionSchema,
      orientations:z.array(observation).length(2)}).optional()}).optional(),
  primaryReadings:z.array(primaryReading).max(2).optional(),
  printing: printingSummarySchema.optional(),
  visual: visualNativeSchema.optional(),
  native: z.object({
    scannerLayout:z.object({inference:scannerLayoutInferenceSchema,orientations:z.array(observation).max(2),
      readingStatus:z.enum(['COMPLETE','TIME_BUDGET','WORKER_ERROR']).optional(),
    anchorSearch:z.object({status:z.literal('COMPLETE'),boundaryVerified:z.literal(false),region:acquisitionManualRegionSchema,
      orientations:z.array(observation).length(2)}).optional()}).optional(),
    photoText: acquisitionPhotoTextSchema.optional(),
    readingZones: acquisitionReadingZonesSchema.optional(),
    geometry: z.object({
      status: z.string().max(60),
      quad: z.array(point).length(4).optional(),
      method: z.enum(["contours", "full-frame", "declared-card-scan", "scanner-background-trim", "scanner-card-edges", "scanner-white-card-edges", "manual-card-region-v1", "reference-anchor-region-v1"]).optional(),
      framing: z.enum(["ALIGNED", "CLIPPED"]).optional(),
      boundaryVerified:z.literal(false).optional(),
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
}).superRefine((value,ctx)=>{
  for(const layout of [value.native.scannerLayout,value.primaryScannerLayout]){
    for(const [o,hasRegion] of [...(layout?.orientations.map(o=>[o,layout.inference.status==='PROPOSED'] as const)??[]),
      ...(layout?.anchorSearch?.orientations.map(o=>[o,true] as const)??[])]){
      if((o.text.footerSourceIdentifiers?.length||o.identifierLines?.length)&&
        (!hasRegion||o.identifierSource?.status!=='EXTRACTED'||!o.identifierLines?.length))
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifiers lack their source observation'});
      if(o.identifierSource&&o.identifierSource.rotationDegrees!==o.rotationDegrees)
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier direction differs'});
      if(o.identifierLines?.some(line=>line.polygon.some(([x,y])=>x<24||x>630||y<1270||y>1396)))
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier lines exceed their source window'});
    }
  }
  for(const o of value.native.orientations){
    if(o.identifierSource && o.identifierSource.rotationDegrees!==o.rotationDegrees)
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier direction differs'});
    if(o.text.footerSourceIdentifiers?.length && (o.identifierSource?.status!=='EXTRACTED'||!o.identifierLines?.length))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier reading lacks source provenance'});
    if(o.identifierSource?.status==='EXTRACTED'&&(value.native.geometry.status!=='PROPOSED'||
      !value.native.geometry.quad||value.native.geometry.framing==='CLIPPED'))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier region lacks source geometry'});
  }
});

// Only bounded, owner-authorized photo observations go to the review UI.
// Deliberately omit worker descriptors, model paths, digests and other internals.
export function acquisitionReviewEvidence(output: unknown) {
  const parsed = schema.safeParse(output);
  if (!parsed.success) return null;
  const { native, proposals, visual, printing } = parsed.data;
  const layout=native.scannerLayout??parsed.data.primaryScannerLayout;
  return {
    scannerLayout: layout?.inference.status==='PROPOSED'
      ? {region:layout.inference.region,boundaryVerified:false as const,
        observations:layout.orientations,readingStatus:layout.readingStatus??null} : null,
    anchorSearch:layout?.anchorSearch ? {region:layout.anchorSearch.region,observations:layout.anchorSearch.orientations,boundaryVerified:false as const} : null,
    geometry: native.geometry,
    primaryObservations:parsed.data.primaryReadings??null,
    observations: native.orientations,
    photoText: native.photoText ?? null,
    readingZones: native.readingZones ?? legacyAcquisitionReadingZones,
    rotation: proposals.orientation?.rotationDegrees ?? null,
    identifiers: {...proposals.evidence,
      languages:acquisitionObservedLanguageEvidence({native})??proposals.evidence.languages},
    // A reference's public crop can lie inside an already clipped physical
    // scan. Its projected corners cannot override observed missing pixels.
    printing: printing && native.geometry.framing === "CLIPPED"
      ? {...printing, candidates: printing.candidates.map(candidate=>({...candidate, referenceBoundary: undefined}))}
      : printing ?? null,
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
