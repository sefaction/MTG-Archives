import {Prisma} from "@prisma/client";
import {CATALOG_RECONCILIATION_STAGE} from "./acquisition-catalog-status";
import {VISUAL_STAGE} from "./acquisition-visual";
import {PRINTING_STAGE} from "./acquisition-printing";
import type {AcquisitionManualAnalysis} from "./acquisition-manual-region";
import type {AcquisitionProblemJob} from "./acquisition-review-problems";

/** Called only after the session's live actor/owner authorization. Match the
 * card-review newest16 bound, but project only small classification fields. */
export async function readAcquisitionProblemJobs(tx: Prisma.TransactionClient, runId: string,
  photos: readonly {id: string; manualAnalysis: AcquisitionManualAnalysis | null}[]) {
  const result = new Map<string, AcquisitionProblemJob[]>();
  if (!photos.length) return result;
  const rows = await tx.$queryRaw<{photoId: string; jobs: AcquisitionProblemJob[]}[]>`
    SELECT p.id AS "photoId", COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j."createdAt" DESC,j.id DESC)
      FILTER (WHERE j.id IS NOT NULL),'[]'::jsonb) AS jobs
    FROM jsonb_to_recordset(${JSON.stringify(photos)}::jsonb) selected(id text,"manualAnalysis" jsonb)
    JOIN "AcquisitionPhoto" p ON p.id=selected.id AND p."runId"=${runId}
    JOIN "AcquisitionCaptureSlot" slot ON slot.id=p."slotId" AND slot."runId"=p."runId"
      AND slot.generation=p.generation
    LEFT JOIN LATERAL (
      SELECT work.id,work.stage,work.status,work."createdAt",
        jsonb_build_object('catalogJobId',left(work.input->>'catalogJobId',200)) AS input,
        jsonb_build_object('sourceCatalogJobId',left(work.output->>'sourceCatalogJobId',200),
          'referenceAdmission',jsonb_build_object('status',left(work.output#>>'{referenceAdmission,status}',40))) AS output,
        left(work.output#>>'{proposals,status}',40) AS "resultStatus",
        CASE WHEN jsonb_typeof(work.output#>'{proposals,proposals}')='array' THEN
          CASE WHEN jsonb_array_length(work.output#>'{proposals,proposals}')<=12 THEN
            CASE WHEN jsonb_typeof(work.output#>'{proposals,automaticAcceptance}')='boolean'
            AND jsonb_typeof(work.output#>'{proposals,truncated}')='boolean'
            AND CASE WHEN jsonb_typeof(work.output#>'{proposals,totalProposals}')='number' THEN
              (work.output#>>'{proposals,totalProposals}')::numeric>=0
              AND trunc((work.output#>>'{proposals,totalProposals}')::numeric)=(work.output#>>'{proposals,totalProposals}')::numeric
              ELSE false END
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(work.output#>'{proposals,proposals}') entry
              WHERE NOT (
                COALESCE(jsonb_typeof(entry#>'{card,id}')='string',false)
                AND COALESCE(jsonb_typeof(entry#>'{card,name}')='string',false)
                AND COALESCE(jsonb_typeof(entry#>'{card,setCode}')='string',false)
                AND COALESCE(jsonb_typeof(entry#>'{card,collectorNumber}')='string',false)
                AND (entry#>'{card,lang}' IS NULL OR jsonb_typeof(entry#>'{card,lang}') IN ('string','null'))
                AND COALESCE(jsonb_typeof(entry->'nameDistance') IN ('number','null'),false)
                AND CASE WHEN jsonb_typeof(entry->'reasons')='array' THEN NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(entry->'reasons') reason WHERE jsonb_typeof(reason)<>'string'
                ) ELSE false END
              )
            )
            THEN jsonb_array_length(work.output#>'{proposals,proposals}') END END END AS "proposalCount",
        CASE WHEN jsonb_typeof(work.output#>'{proposals,proposals}')='array' THEN
          CASE WHEN jsonb_array_length(work.output#>'{proposals,proposals}')<=12 THEN
          ARRAY(SELECT left(proposed.value->'card'->>'id',200)
            FROM jsonb_array_elements(work.output#>'{proposals,proposals}') AS proposed(value) LIMIT 13)
          END END AS "proposalIds",
        left(work.output#>>'{catalog,status}',40) AS "catalogStatus",
        CASE WHEN jsonb_typeof(COALESCE(work.output->'observedLanguages',work.output#>'{proposals,evidence,languages}'))='array' THEN
          CASE WHEN jsonb_array_length(COALESCE(work.output->'observedLanguages',work.output#>'{proposals,evidence,languages}'))<=11 THEN
            ARRAY(SELECT lower(language.value#>>'{}')
              FROM jsonb_array_elements(COALESCE(work.output->'observedLanguages',work.output#>'{proposals,evidence,languages}')) language(value)
              WHERE jsonb_typeof(language.value)='string'
                AND lower(language.value#>>'{}')~'^(en|fr|de|it|es|pt|ja|ko|ru|zhs|zht)$' LIMIT 11)
          END END AS "observedLanguages",
        left(work.output#>>'{native,geometry,status}',60) AS "geometryStatus",
        left(work.output#>>'{native,geometry,framing}',40) AS framing
      FROM "AcquisitionProcessingJob" work
      JOIN "AcquisitionArtifact" artifact ON artifact.id=work."artifactId" AND artifact."runId"=work."runId"
      JOIN "AcquisitionCandidate" checked ON checked.id=work."candidateId" AND checked."runId"=work."runId"
        AND checked."physicalId"=p."slotId"
      WHERE work."runId"=p."runId" AND artifact."sourceId"=p.id
        AND work.input->>'photoId'=p.id AND work.input->>'digest'=p.digest
        AND COALESCE(work.input->'manualAnalysis','null'::jsonb)=COALESCE(selected."manualAnalysis",'null'::jsonb)
        AND work.stage IN ('photo-recognition-v1','photo-reference-refinement-v1',
          ${CATALOG_RECONCILIATION_STAGE},${VISUAL_STAGE},${PRINTING_STAGE})
        AND NOT (work.stage='photo-reference-refinement-v1' AND work.status='SUPERSEDED')
      ORDER BY work."createdAt" DESC,work.id DESC LIMIT 16
    ) j ON true
    WHERE p.ready AND p."purgedAt" IS NULL
    GROUP BY p.id`;
  for (const row of rows) result.set(row.photoId, row.jobs);
  return result;
}
