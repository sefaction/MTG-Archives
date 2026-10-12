import { Prisma, type PrismaClient, type AcquisitionProcessingJob } from "@prisma/client";
import { z } from "zod";
import { correctionHash } from "./acquisition-correction-policy";
import { acquisitionReferenceLineageInputSchema, REFERENCE_REFINEMENT_STAGE } from "./acquisition-reference-lineage";
import { nativeSchema } from "./acquisition-recognition-worker";

export const acquisitionReferenceSourceSchema=z.object({referenceJobId:z.string().uuid(),
  referenceOutputHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type AcquisitionReferenceSource=z.infer<typeof acquisitionReferenceSourceSchema>;

// The first frame stays in its immutable job. Descendants retain its exact hash
// and resolve it again, without combining title/footer tokens across frames.
export async function readAcquisitionReferenceSource(db:PrismaClient|Prisma.TransactionClient,
  context:Pick<AcquisitionProcessingJob,"runId"|"artifactId"|"candidateId"|"candidateRevision">,
  identity:AcquisitionReferenceSource) {
  const root=await db.acquisitionProcessingJob.findUnique({where:{id:identity.referenceJobId}});
  const parsed=acquisitionReferenceLineageInputSchema.safeParse(root?.input);
  if(!root||!parsed.success||root.stage!==REFERENCE_REFINEMENT_STAGE||root.status!=="COMPLETE"||
      root.runId!==context.runId||root.artifactId!==context.artifactId||root.candidateId!==context.candidateId||
      root.candidateRevision!==context.candidateRevision||correctionHash(root.output)!==identity.referenceOutputHash||
      correctionHash((root.output as {referenceRefinement?:unknown})?.referenceRefinement)!==correctionHash(parsed.data))return null;
  const primary=await db.acquisitionProcessingJob.findUnique({where:{id:parsed.data.parents.recognitionJobId}});
  if(!primary||primary.stage!=="photo-recognition-v1"||primary.status!=="COMPLETE"||primary.runId!==root.runId||
      primary.artifactId!==root.artifactId||primary.candidateId!==root.candidateId||primary.candidateRevision!==root.candidateRevision||
      primary.versionKey!==parsed.data.primaryVersion||correctionHash(primary.output)!==parsed.data.parents.recognitionOutputHash)return null;
  const native=nativeSchema.safeParse((primary.output as {native?:unknown})?.native);
  if(!native.success||native.data.photoDigest!==parsed.data.digest||native.data.descriptor!==parsed.data.model)return null;
  return {root,primary,native:native.data,input:parsed.data};
}
