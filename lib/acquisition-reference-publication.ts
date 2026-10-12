import { Prisma, type AcquisitionProcessingJob } from "@prisma/client";
import { z } from "zod";
import { correctionHash } from "./acquisition-correction-policy";
import { readAcquisitionReferenceSource, acquisitionReferenceSourceSchema } from "./acquisition-reference-source";
import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { PRINTING_STAGE } from "./acquisition-printing";
import { REFERENCE_REFINEMENT_STAGE } from "./acquisition-reference-lineage";
import { sameAcquisitionManualRegion } from "./acquisition-manual-region";

export async function publishAcquisitionReferenceDescendant(tx:Prisma.TransactionClient,
  job:AcquisitionProcessingJob&{leaseToken:string},output:Prisma.InputJsonObject) {
  const raw=job.input as {referenceSource?:unknown;recognitionJobId?:string;catalogJobId?:string;sourceOutputHash?:string};
  const identity=acquisitionReferenceSourceSchema.safeParse(raw.referenceSource);
  const root=identity.success?await readAcquisitionReferenceSource(tx,job,identity.data):null;
  const sourceId=job.stage===CATALOG_RECONCILIATION_STAGE?raw.recognitionJobId:raw.catalogJobId;
  const source=sourceId?await tx.acquisitionProcessingJob.findUnique({where:{id:sourceId}}):null;
  const returned=output as {referenceSource?:unknown;referenceRefinement?:unknown;photoId?:string;manualAnalysis?:unknown;
    native?:{photoDigest?:string;descriptor?:string;geometry?:{method?:string;referenceRegion?:unknown;boundaryVerified?:boolean}};
    proposals?:{status?:string;automaticAcceptance?:boolean;finish?:string;condition?:string}};
  const valid=Boolean(root&&source&&source.status==="COMPLETE"&&source.runId===job.runId&&source.artifactId===job.artifactId&&
    source.candidateId===job.candidateId&&source.candidateRevision===job.candidateRevision&&
    (job.stage===CATALOG_RECONCILIATION_STAGE?source.id===root.root.id&&source.stage===REFERENCE_REFINEMENT_STAGE:
      source.stage===CATALOG_RECONCILIATION_STAGE&&correctionHash(source.output)===raw.sourceOutputHash)&&
    correctionHash(returned.referenceSource)===correctionHash(identity.success?identity.data:null)&&
    correctionHash(returned.referenceRefinement)===correctionHash(root.input)&&returned.photoId===root.input.photoId&&
    returned.manualAnalysis==null&&returned.native?.photoDigest===root.input.digest&&returned.native?.descriptor===root.input.model&&
    returned.native?.geometry?.method==="reference-anchor-region-v1"&&returned.native.geometry.boundaryVerified===false&&
    sameAcquisitionManualRegion(returned.native.geometry.referenceRegion,root.input.reference.region)&&
    returned.proposals?.automaticAcceptance===false&&returned.proposals.status!=="STRONG_MATCH"&&
    returned.proposals.finish==="UNKNOWN"&&returned.proposals.condition==="UNKNOWN");
  if(root&&source&&valid){
    await tx.$queryRaw`SELECT id FROM "AcquisitionProcessingJob" WHERE id IN
      (${Prisma.join([source.id,root.root.id,root.primary.id])}) ORDER BY id FOR SHARE`;
    const count=await tx.$executeRaw`UPDATE "AcquisitionProcessingJob" j SET status='COMPLETE',
      output=${JSON.stringify(output)}::jsonb,"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp()
      FROM "AcquisitionCandidate" c
      JOIN "AcquisitionRun" r ON r.id=c."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "Player" p ON p.id=s."ownerPlayerId"
      JOIN "User" u ON u.id=s."createdByUserId"
      JOIN "AcquisitionPhoto" photo ON photo.id=${root.input.photoId} AND photo."runId"=r.id
      JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
      JOIN "AcquisitionProcessingJob" source ON source.id=${source.id}
      JOIN "AcquisitionProcessingJob" reference ON reference.id=${root.root.id}
      JOIN "AcquisitionProcessingJob" primary_job ON primary_job.id=${root.primary.id}
      WHERE j.id=${job.id} AND j.status='RUNNING' AND j."leaseToken"=${job.leaseToken}
        AND j."leaseExpiresAt">clock_timestamp() AND j.input=${JSON.stringify(job.input)}::jsonb
        AND j.stage=${job.stage} AND j."runId"=r.id AND j."artifactId"=${job.artifactId}
        AND j."candidateId"=c.id AND j."candidateRevision"=c.revision AND c.revision=${job.candidateRevision}
        AND NOT c.excluded AND c.review IS NULL AND c."manualAnalysis" IS NULL
        AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
        AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
        AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${root.input.digest}
        AND photo."inputKind"='CARD_SCAN' AND photo."slotId"=c."physicalId" AND photo.generation=${root.input.generation}
        AND slot.generation=photo.generation
        AND source.status='COMPLETE' AND source.input=${JSON.stringify(source.input)}::jsonb
        AND source.output=${JSON.stringify(source.output)}::jsonb
        AND reference.status='COMPLETE' AND reference.input=${JSON.stringify(root.root.input)}::jsonb
        AND reference.output=${JSON.stringify(root.root.output)}::jsonb
        AND primary_job.status='COMPLETE' AND primary_job.output=${JSON.stringify(root.primary.output)}::jsonb
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer WHERE newer."candidateId"=c.id
          AND newer."candidateRevision"=c.revision AND newer.stage='photo-recognition-v1'
          AND (newer."createdAt",newer.id)>(primary_job."createdAt",primary_job.id))
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer WHERE newer."candidateId"=c.id
          AND newer."candidateRevision"=c.revision AND newer.stage=${REFERENCE_REFINEMENT_STAGE}
          AND newer.output->'referenceAdmission'->>'status' IS DISTINCT FROM 'SKIPPED'
          AND (newer."createdAt",newer.id)>(reference."createdAt",reference.id))
        AND (${job.stage!==PRINTING_STAGE} OR NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer
          WHERE newer."candidateId"=c.id AND newer."candidateRevision"=c.revision AND newer.stage=${CATALOG_RECONCILIATION_STAGE}
            AND (newer."createdAt",newer.id)>(source."createdAt",source.id)))`;
    if(count)return "COMPLETE" as const;
  }
  const retired=await tx.$executeRaw`UPDATE "AcquisitionProcessingJob" SET status='SUPERSEDED',"leaseToken"=NULL,
    "leaseExpiresAt"=NULL,"errorCode"='INPUT_CHANGED',"updatedAt"=clock_timestamp()
    WHERE id=${job.id} AND status='RUNNING' AND "leaseToken"=${job.leaseToken} AND "leaseExpiresAt">clock_timestamp()`;
  return retired?"SUPERSEDED" as const:"STALE_LEASE" as const;
}
