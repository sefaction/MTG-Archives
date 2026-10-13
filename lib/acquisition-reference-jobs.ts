import { acquisitionHandoffQuery } from "./acquisition-handoff";
import { CATALOG_RESOLVER_VERSION, CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { PRINTING_STAGE } from "./acquisition-printing";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type AcquisitionProcessingJob } from "@prisma/client";
import { z } from "zod";
import { correctionHash } from "./acquisition-correction-policy";
import { acquisitionReferenceLineageInputSchema, acquisitionReferenceLineageKey,
  acquisitionReferenceParentsMatch, REFERENCE_REFINEMENT_STAGE,
  type AcquisitionReferenceLineageInput, type ReferenceParent } from "./acquisition-reference-lineage";
import { selectAcquisitionReferenceRegion } from "./acquisition-reference-region";
import { printingNativeSchema } from "./acquisition-printing";
import { nativeSchema, acquisitionRecognitionVersion } from "./acquisition-recognition-worker";
import { recognitionResponseSchema } from "./acquisition-recognition-dto";

type Tx = Prisma.TransactionClient;
type Context = Pick<AcquisitionProcessingJob, "runId" | "artifactId" | "candidateId" | "candidateRevision">;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const versionsSchema = z.object({ model: hash, catalog: hash, referenceModel: hash,
  primaryVersion: hash, catalogResolver: z.string().min(1).max(80) }).strict();
export type AcquisitionReferenceVersions = z.infer<typeof versionsSchema>;

// Fixed aliases shared by admission and publication. JSON is bound as TEXT:
// coordinates and the exact parent observations must survive PostgreSQL without
// the Prisma JSON object's finite-number rounding.
type ReferenceScope=Omit<AcquisitionReferenceLineageInput,"reference">;
function liveParents(context: Context, input: ReferenceScope,
  parents: [ReferenceParent, ReferenceParent, ReferenceParent]) {
  const predicates = parents.map((parent, index) => {
    const alias = Prisma.raw(["primary_job", "catalog_job", "printing_job"][index]);
    return Prisma.sql`${alias}.status='COMPLETE'
      AND ${alias}."runId"=r.id AND ${alias}."artifactId"=${context.artifactId}
      AND ${alias}."candidateId"=c.id AND ${alias}."candidateRevision"=c.revision
      AND ${alias}.input=${JSON.stringify(parent.input)}::jsonb
      AND ${alias}.output=${JSON.stringify(parent.output)}::jsonb
      AND ${alias}.stage=${parent.stage} AND ${alias}."versionKey"=${parent.versionKey}
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer
        WHERE newer."candidateId"=c.id AND newer."candidateRevision"=c.revision
          AND newer.stage=${alias}.stage
          AND (newer."createdAt",newer.id)>(${alias}."createdAt",${alias}.id))`;
  });
  return Prisma.sql`
    FROM "AcquisitionCandidate" c
    JOIN "AcquisitionRun" r ON r.id=c."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    JOIN "Player" p ON p.id=s."ownerPlayerId"
    JOIN "User" u ON u.id=s."createdByUserId"
    JOIN "AcquisitionPhoto" photo ON photo.id=${input.photoId} AND photo."runId"=r.id
    JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId" AND slot."runId"=r.id
    JOIN "AcquisitionProcessingJob" primary_job ON primary_job.id=${input.parents.recognitionJobId}
    JOIN "AcquisitionProcessingJob" catalog_job ON catalog_job.id=${input.parents.catalogJobId}
    JOIN "AcquisitionProcessingJob" printing_job ON printing_job.id=${input.parents.printingJobId}
    WHERE c.id=${context.candidateId} AND r.id=${context.runId}
      AND c.revision=${context.candidateRevision} AND c.revision=${input.candidateRevision}
      AND NOT c.excluded AND c.review IS NULL AND c."manualAnalysis" IS NULL
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL
      AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
      AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${input.digest}
      AND photo."inputKind"='CARD_SCAN' AND photo."slotId"=c."physicalId"
      AND photo.generation=${input.generation} AND slot.generation=photo.generation
      AND printing_job.output->'printingNative'->'sourceSize'=jsonb_build_array(photo.width,photo.height)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND ${Prisma.join(predicates, " AND ")}`;
}

async function lockSession(tx: Tx, runId: string) {
  const run = await tx.acquisitionRun.findUnique({ where: { id: runId }, select: { sessionId: true } });
  if (!run) return false;
  return (await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AcquisitionSession" WHERE id=${run.sessionId} FOR UPDATE`).length === 1;
}

async function readParents(tx: Tx, ids: [string, string, string]) {
  // Freeze the immutable observations through the subsequent admission/CAS.
  // Queue completion takes its session lock first, preserving lock order.
  await tx.$queryRaw`SELECT id FROM "AcquisitionProcessingJob"
    WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
  const rows = await tx.acquisitionProcessingJob.findMany({ where: { id: { in: ids } } });
  const parents = ids.map(id => rows.find(row => row.id === id));
  const [primary, catalog, printing] = parents;
  return primary && catalog && printing ? [primary, catalog, printing] as
    [ReferenceParent, ReferenceParent, ReferenceParent] : null;
}

function supportedParents(context: Context, input: AcquisitionReferenceLineageInput,
  parents: [ReferenceParent, ReferenceParent, ReferenceParent]) {
  // Authority below is checked in SQL at each write, never inferred from this
  // pure snapshot. It validates native provenance, hashes and supported outline.
  return acquisitionReferenceParentsMatch(input, parents, {
    ...context, currentModel: input.model, currentCatalog: input.catalog,
    currentReferenceModel: input.referenceModel, currentCatalogResolver: input.catalogResolver,
    photoId: input.photoId, photoDigest: input.digest, inputKind: "CARD_SCAN",
    latestRecognitionJobId: parents[0].id, latestCatalogJobId: parents[1].id,
    latestPrintingJobId: parents[2].id, photoGeneration: input.generation, slotGeneration: input.generation,
    photoReady: true, photoPurged: false, ownerActive: true, creatorActive: true,
    forcePasswordChange: false, excluded: false, committed: false, cancelled: false,
    trashed: false, deleted: false, manualAnalysis: null, review: null, phase: "CAPTURE_OPEN",
  });
}

// Native handlers recheck before and after pixels. Publication repeats this
// under the session/parent locks; this read-only snapshot grants no write lease.
export async function currentAcquisitionReferenceParents(db: PrismaClient,
  job: AcquisitionProcessingJob & { leaseToken: string }, expectedVersions: AcquisitionReferenceVersions) {
  const parsed=acquisitionReferenceLineageInputSchema.safeParse(job.input);
  const versions=versionsSchema.parse(expectedVersions);
  if(!parsed.success || Object.entries(versions).some(([key,value])=>
      parsed.data[key as keyof AcquisitionReferenceVersions]!==value))return null;
  const input=parsed.data,ids=[input.parents.recognitionJobId,input.parents.catalogJobId,input.parents.printingJobId];
  const rows=await db.acquisitionProcessingJob.findMany({where:{id:{in:ids}}});
  const [primary,catalog,printing]=ids.map(id=>rows.find(row=>row.id===id));
  if(!primary||!catalog||!printing)return null;
  const parents:[ReferenceParent,ReferenceParent,ReferenceParent]=[primary,catalog,printing];
  if(!supportedParents(job,input,parents))return null;
  const [live]=await db.$queryRaw<{id:string}[]>`SELECT c.id ${liveParents(job,input,parents)}
    AND EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" attempt
      WHERE attempt.id=${job.id} AND attempt.stage=${REFERENCE_REFINEMENT_STAGE}
        AND attempt.status='RUNNING' AND attempt."leaseToken"=${job.leaseToken}
        AND attempt."leaseExpiresAt">clock_timestamp() AND attempt."versionKey"=${input.lineageKey}
        AND attempt."runId"=r.id AND attempt."artifactId"=${job.artifactId}
        AND attempt."candidateId"=c.id AND attempt."candidateRevision"=c.revision
        AND attempt.input=${JSON.stringify(job.input)}::jsonb)`;
  return live ? parents : null;
}

function referenceIdentityMatches(input:ReferenceScope,parents:[ReferenceParent,ReferenceParent,ReferenceParent]){
  const [primary,catalog,printing]=parents;
  const source=primary.input as {photoId?:string;digest?:string;inputKind?:string;manualAnalysis?:unknown};
  const observed=primary.output as {photoId?:string;native?:{descriptor?:string;photoDigest?:string;geometry?:{referenceRegion?:unknown}}};
  const catInput=catalog.input as {recognitionJobId?:string;resolverVersion?:string;manualAnalysis?:unknown;referenceSource?:unknown};
  const catOutput=catalog.output as {photoId?:string;sourceRecognitionJobId?:string;versions?:{catalog?:string;resolver?:string}};
  const printInput=printing.input as {catalogJobId?:string;model?:string;manualAnalysis?:unknown;referenceSource?:unknown};
  const printOutput=printing.output as {photoId?:string;sourceCatalogJobId?:string;versions?:{catalog?:string;printing?:string;resolver?:string}};
  return primary.stage==="photo-recognition-v1"&&catalog.stage===CATALOG_RECONCILIATION_STAGE&&printing.stage===PRINTING_STAGE&&
    source.photoId===input.photoId&&source.digest===input.digest&&source.inputKind==="CARD_SCAN"&&source.manualAnalysis==null&&
    observed.photoId===input.photoId&&observed.native?.descriptor===input.model&&observed.native?.photoDigest===input.digest&&
    observed.native.geometry?.referenceRegion==null&&primary.versionKey===input.primaryVersion&&
    catInput.recognitionJobId===primary.id&&catInput.resolverVersion===input.catalogResolver&&catInput.manualAnalysis==null&&catInput.referenceSource==null&&
    catOutput.photoId===input.photoId&&catOutput.sourceRecognitionJobId===primary.id&&catOutput.versions?.catalog===input.catalog&&catOutput.versions.resolver===input.catalogResolver&&
    printInput.catalogJobId===catalog.id&&printInput.model===input.referenceModel&&printInput.manualAnalysis==null&&printInput.referenceSource==null&&
    printOutput.photoId===input.photoId&&printOutput.sourceCatalogJobId===catalog.id&&printOutput.versions?.catalog===input.catalog&&
    printOutput.versions.printing===input.referenceModel&&printOutput.versions.resolver===input.catalogResolver;
}

// Versioned admission is shared with the ordinary OCR dispatcher; the pipeline is
// qualified. Same-lineage attempts are durable across revisions and restart;
// FAILED/SUPERSEDED attempts also consume admission, rather than starting loops.
export async function admitAcquisitionReferenceRefinement(db: PrismaClient, printingJobId: string,
  expectedVersions: AcquisitionReferenceVersions): Promise<number> {
  const versions = versionsSchema.parse(expectedVersions);
  return db.$transaction(async tx => {
    const printing = await tx.acquisitionProcessingJob.findUnique({ where: { id: printingJobId } });
    if (!printing || !await lockSession(tx, printing.runId)) return 0;
    const printingInput = z.object({ catalogJobId: z.string().uuid(), photoId: z.string().uuid(), digest: hash }).safeParse(printing.input);
    if (!printingInput.success) return 0;
    const catalog = await tx.acquisitionProcessingJob.findUnique({ where: { id: printingInput.data.catalogJobId } });
    const catalogInput = z.object({ recognitionJobId: z.string().uuid() }).safeParse(catalog?.input);
    if (!catalogInput.success) return 0;
    const parents = await readParents(tx, [catalogInput.data.recognitionJobId, printingInput.data.catalogJobId, printingJobId]);
    const photo = await tx.acquisitionPhoto.findUnique({ where: { id: printingInput.data.photoId } });
    if (!parents || !photo) return 0;
    const primary = z.object({ native: z.object({ geometry: z.object({ status: z.string(),
      method: z.string().optional(), framing: z.string().optional(),
      quad: z.array(z.array(z.number().finite())).optional() }) }) }).safeParse(parents[0].output);
    const observed = z.object({ printingNative: printingNativeSchema }).safeParse(parents[2].output);
    if (!primary.success || !observed.success) return 0;
    const reference = selectAcquisitionReferenceRegion({ inputKind: "CARD_SCAN",
      geometry: primary.data.native.geometry, printing: observed.data.printingNative });
    const lineage = { photoId: printingInput.data.photoId, digest: printingInput.data.digest,
      generation: photo.generation, ...versions };
    const base: ReferenceScope = { ...lineage, version: 1,
      candidateRevision: printing.candidateRevision, lineageKey: acquisitionReferenceLineageKey(lineage),
      parents: { recognitionJobId: parents[0].id, recognitionOutputHash: correctionHash(parents[0].output),
        catalogJobId: parents[1].id, catalogOutputHash: correctionHash(parents[1].output),
        printingJobId: parents[2].id, printingOutputHash: correctionHash(parents[2].output) },
    };
    if(!referenceIdentityMatches(base,parents))return 0;
    if(reference.status!=="PROPOSED"){
      await tx.$executeRaw`INSERT INTO "AcquisitionProcessingJob"
        (id,"runId","artifactId","candidateId","candidateRevision",stage,"versionKey",input,status,output,"updatedAt")
        SELECT ${randomUUID()},r.id,${printing.artifactId},c.id,c.revision,${REFERENCE_REFINEMENT_STAGE},
          ${base.lineageKey},${JSON.stringify(base)}::jsonb,'SUPERSEDED',
          ${JSON.stringify({referenceAdmission:{status:"SKIPPED",reason:reference.reason}})}::jsonb,clock_timestamp()
        ${liveParents(printing,base,parents)}
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" prior WHERE prior.stage=${REFERENCE_REFINEMENT_STAGE}
          AND prior.input->>'photoId'=photo.id AND prior."versionKey"=${base.lineageKey}) ON CONFLICT DO NOTHING`;
      return 0;
    }
    const input:AcquisitionReferenceLineageInput={...base,reference:{version:1,region:reference.region,
      references:reference.references,policy:reference.policy}};
    if (!supportedParents(printing, input, parents)) return 0;
    return tx.$executeRaw`
      INSERT INTO "AcquisitionProcessingJob" (id,"runId","artifactId","candidateId",
        "candidateRevision",stage,"versionKey",input,"updatedAt")
      SELECT ${randomUUID()},r.id,${printing.artifactId},c.id,c.revision,
        ${REFERENCE_REFINEMENT_STAGE},${input.lineageKey},${JSON.stringify(input)}::jsonb,clock_timestamp()
      ${liveParents(printing, input, parents)}
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" prior
        WHERE prior."runId"=r.id AND prior.stage=${REFERENCE_REFINEMENT_STAGE}
          AND prior.input->>'photoId'=photo.id AND prior."versionKey"=${input.lineageKey})
      ON CONFLICT DO NOTHING`;
  });
}

const outputSchema = z.object({ photoId: z.string().uuid(), manualAnalysis: z.null().optional(),
  referenceRefinement: acquisitionReferenceLineageInputSchema,
  versions: z.object({ model: hash, catalog: hash, index: hash }),
  native: nativeSchema.and(z.object({
    geometry: z.object({ status: z.literal("PROPOSED"), method: z.literal("reference-anchor-region-v1"),
      boundaryVerified: z.literal(false), referenceRegion: z.unknown(), manualRegion: z.never().optional() }).passthrough() })),
  proposals: recognitionResponseSchema.shape.result.unwrap().extend({
    automaticAcceptance: z.literal(false), finish: z.literal("UNKNOWN"), condition: z.literal("UNKNOWN") }),
});

// Called by completeAcquisitionJob inside its existing session transaction.
// An expired lease returns without changing the row. A live obsolete attempt
// is retired, preserving its input and original observations for audit/recovery.
export async function publishAcquisitionReferenceRefinement(tx: Tx,
  job: AcquisitionProcessingJob & { leaseToken: string }, output: Prisma.InputJsonObject) {
  const parsed = acquisitionReferenceLineageInputSchema.safeParse(job.input);
  const returned = outputSchema.safeParse(output);
  let completed = 0;
  if (parsed.success && returned.success && job.versionKey === parsed.data.lineageKey &&
      returned.data.photoId === parsed.data.photoId && returned.data.native.photoDigest === parsed.data.digest &&
      returned.data.native.descriptor === parsed.data.model &&
      returned.data.versions.model === parsed.data.model && returned.data.versions.catalog === parsed.data.catalog &&
      returned.data.versions.index === parsed.data.catalog &&
      correctionHash(output.referenceRefinement) === correctionHash(job.input) &&
      correctionHash(returned.data.native.geometry.referenceRegion) === correctionHash(parsed.data.reference.region)) {
    const input = parsed.data;
    const parents = await readParents(tx, [input.parents.recognitionJobId, input.parents.catalogJobId, input.parents.printingJobId]);
    if (parents && supportedParents(job, input, parents)) completed = await tx.$executeRaw`
      UPDATE "AcquisitionProcessingJob" j SET status='COMPLETE',output=${JSON.stringify(output)}::jsonb,
        "leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp()
      ${liveParents(job, input, parents)}
      AND j.id=${job.id} AND j.stage=${REFERENCE_REFINEMENT_STAGE} AND j.status='RUNNING'
      AND j."leaseToken"=${job.leaseToken} AND j."leaseExpiresAt">clock_timestamp()
      AND j."runId"=r.id AND j."artifactId"=${job.artifactId} AND j."candidateId"=c.id
      AND j."candidateRevision"=c.revision AND j."versionKey"=${input.lineageKey}
      AND j.input=${JSON.stringify(job.input)}::jsonb`;
  }
  if (completed) return "COMPLETE" as const;
  const retired = await tx.$executeRaw`UPDATE "AcquisitionProcessingJob" SET status='SUPERSEDED',
    "leaseToken"=NULL,"leaseExpiresAt"=NULL,"errorCode"='INPUT_CHANGED',"updatedAt"=clock_timestamp()
    WHERE id=${job.id} AND status='RUNNING' AND "leaseToken"=${job.leaseToken}
      AND "leaseExpiresAt">clock_timestamp()`;
  return retired ? "SUPERSEDED" as const : "STALE_LEASE" as const;
}

// Bounded, owner-shared admission from current completed original-frame printing
// evidence. Persisted skips prevent unchanged invalid scans hiding later inputs.
export async function enqueueReadyReferenceRefinement(db:PrismaClient,model:string,catalog:string){
  const primaryVersion=acquisitionRecognitionVersion(catalog,model);
  const ids=await db.$queryRaw<{id:string;input:Prisma.JsonValue}[]>(acquisitionHandoffQuery(REFERENCE_REFINEMENT_STAGE,Prisma.sql`
    SELECT j.id,j."runId",j."createdAt" FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
    JOIN "AcquisitionProcessingJob" cat ON cat.id=j.input->>'catalogJobId'
    JOIN "AcquisitionProcessingJob" primary_job ON primary_job.id=cat.input->>'recognitionJobId'
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    JOIN "Player" p ON p.id=s."ownerPlayerId"
    JOIN "User" u ON u.id=s."createdByUserId"
    JOIN "AcquisitionPhoto" photo ON photo.id=j.input->>'photoId' AND photo."runId"=r.id
    JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
    WHERE j.stage=${PRINTING_STAGE} AND j.status='COMPLETE' AND j."candidateRevision"=c.revision
      AND j.input->'referenceSource' IS NULL AND c.review IS NULL AND c."manualAnalysis" IS NULL AND NOT c.excluded
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
      AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=j.input->>'digest'
      AND photo."inputKind"='CARD_SCAN' AND photo."slotId"=c."physicalId" AND photo.generation=slot.generation
      AND primary_job.input->>'inputKind'='CARD_SCAN' AND primary_job.status='COMPLETE' AND cat.status='COMPLETE'
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer WHERE newer."candidateId"=c.id AND newer."candidateRevision"=c.revision
        AND ((newer.stage=j.stage AND (newer."createdAt",newer.id)>(j."createdAt",j.id))
          OR (newer.stage=cat.stage AND (newer."createdAt",newer.id)>(cat."createdAt",cat.id))
          OR (newer.stage=primary_job.stage AND (newer."createdAt",newer.id)>(primary_job."createdAt",primary_job.id))))
      AND primary_job.stage='photo-recognition-v1' AND primary_job.output->'native'->>'descriptor'=${model}
      AND primary_job."versionKey"=${primaryVersion} AND cat.output->'versions'->>'catalog'=${catalog}
      AND cat.input->>'resolverVersion'=${CATALOG_RESOLVER_VERSION}
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" prior WHERE prior.stage=${REFERENCE_REFINEMENT_STAGE}
        AND prior.input->>'photoId'=j.input->>'photoId' AND prior.input->>'model'=${model}
        AND prior.input->>'catalog'=${catalog} AND prior.input->>'referenceModel'=j.input->>'model'
        AND prior.input->>'primaryVersion'=${primaryVersion} AND prior.input->>'catalogResolver'=${CATALOG_RESOLVER_VERSION})`));
  let added=0;
  for(const {id} of ids){const job=await db.acquisitionProcessingJob.findUnique({where:{id},select:{input:true}});
    const referenceModel=z.object({model:hash}).safeParse(job?.input);
    if(referenceModel.success)added+=await admitAcquisitionReferenceRefinement(db,id,{model,catalog,primaryVersion,
      referenceModel:referenceModel.data.model,catalogResolver:CATALOG_RESOLVER_VERSION});}
  return added;
}
