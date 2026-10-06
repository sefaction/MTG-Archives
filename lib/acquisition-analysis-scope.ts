import { Prisma } from "@prisma/client";
import { acquisitionManualAnalysisSchema, sameAcquisitionManualRegion, type AcquisitionManualAnalysis } from "./acquisition-manual-region";

// A repair is a separate analysis instruction, never a replacement human review.
export function acquisitionAnalysisForPhoto(candidate: {manualAnalysis: unknown}, photo: {
  id: string; digest: string; generation: number;
}): AcquisitionManualAnalysis | null {
  const parsed = acquisitionManualAnalysisSchema.safeParse(candidate.manualAnalysis);
  return parsed.success && parsed.data.photoId === photo.id && parsed.data.digest === photo.digest &&
    parsed.data.generation === photo.generation ? parsed.data : null;
}

// These predicates are deliberately fixed to the queue's c/j aliases. Source
// preparation is immutable and has no repair envelope; downstream jobs do.
const boundIntent = Prisma.sql`(c."manualAnalysis" IS NOT NULL
  AND c."manualAnalysis"->>'version'='1'
  AND c."manualAnalysis"->>'photoId'=j.input->>'photoId'
  AND c."manualAnalysis"->>'digest'=j.input->>'digest'
  AND EXISTS (SELECT 1 FROM "AcquisitionPhoto" scope_photo
    JOIN "AcquisitionCaptureSlot" scope_slot ON scope_slot.id=scope_photo."slotId"
    WHERE scope_photo.id=j.input->>'photoId' AND scope_photo."runId"=j."runId"
      AND scope_photo."slotId"=c."physicalId" AND scope_photo.digest=j.input->>'digest'
      AND scope_photo.ready AND scope_photo."purgedAt" IS NULL
      AND scope_photo.generation=scope_slot.generation
      AND c."manualAnalysis"->>'generation'=scope_photo.generation::text))`;

export function acquisitionAnalysisReadySql() {
  return Prisma.sql`(NOT c.excluded AND (c.review IS NULL OR
    (${boundIntent} AND c."manualAnalysis"->>'candidateRevision'=c.revision::text)))`;
}

export function acquisitionAnalysisJobSql() {
  return Prisma.sql`(${acquisitionAnalysisReadySql()} AND
    COALESCE(j.input->'manualAnalysis','null'::jsonb)=
      CASE WHEN ${boundIntent} THEN c."manualAnalysis" ELSE 'null'::jsonb END)`;
}

export function acquisitionAnalysisCandidateFence(rawInput: unknown): Prisma.AcquisitionCandidateWhereInput {
  const parsed = acquisitionManualAnalysisSchema.safeParse(
    (rawInput as {manualAnalysis?: unknown} | null)?.manualAnalysis);
  // Ordinary historical jobs still require an unreviewed candidate. Only an
  // exact, explicit repair instruction permits a reviewed candidate's attempt.
  return parsed.success ? {manualAnalysis: {equals: parsed.data}, OR: [
    {review: {equals: Prisma.DbNull}}, {revision: parsed.data.candidateRevision},
  ]} : {review: {equals: Prisma.DbNull}};
}

export function acquisitionAnalysisOutputMatches(input: unknown, output: Prisma.InputJsonObject, stage: string) {
  const raw = (input as {manualAnalysis?: unknown} | null)?.manualAnalysis;
  if (raw == null) return output.manualAnalysis == null;
  const intent = acquisitionManualAnalysisSchema.safeParse(raw);
  const returned = acquisitionManualAnalysisSchema.safeParse(output.manualAnalysis);
  if (!intent.success || !returned.success || JSON.stringify(intent.data) !== JSON.stringify(returned.data)) return false;
  const observation = (stage === "photo-visual-retrieval-v1" ? output.visual : output.native) as
    {geometry?: {manualRegion?: unknown}} | undefined;
  if (!sameAcquisitionManualRegion(observation?.geometry?.manualRegion, intent.data.region)) return false;
  if (stage === "photo-printing-evidence-v1" &&
      !sameAcquisitionManualRegion((output.printingNative as {manualRegion?: unknown} | undefined)?.manualRegion, intent.data.region)) return false;
  return true;
}
