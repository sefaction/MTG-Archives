import {assertScannerLayoutInference,combineScannerLayoutReadings,assertScannerLayoutFooterSource} from "./acquisition-scanner-layout-reading";
import {scannerLayoutTemplateSchema,scannerLayoutAnchorsObserved,scannerLayoutInferenceSchema,parseScannerLayoutProfile} from "./acquisition-scanner-layout";
import { acquisitionManualAnalysisSchema, acquisitionManualRegionSchema, sameAcquisitionManualRegion } from "./acquisition-manual-region";
import { acquisitionAnalysisForPhoto, acquisitionAnalysisReadySql } from "./acquisition-analysis-scope";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { acquisitionImageInputKindSchema, acquisitionNativePhotoInput } from "./acquisition-image-input";
import {
  proposeOrientedAcquisitionPrintings,
  ACQUISITION_TEXT_RESOLVER_VERSION,
} from "./acquisition-recognition";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { runAcquisitionNativeProcess } from "./acquisition-native-process";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import type { ClaimedAcquisitionJob } from "./acquisition-jobs";
import { acquisitionReadingZonesSchema } from "./acquisition-reading-zones";
import { ACQUISITION_FOOTER_PARSER_VERSION } from "./acquisition-footer";
import { acquisitionPhotoTextSchema, needsAcquisitionPhotoText, readAcquisitionPhotoText,
  combineAcquisitionPhotoText } from "./acquisition-photo-text";
import { acquisitionHandoffQuery } from "./acquisition-handoff";
import {sourceFooterSchema} from './acquisition-source-footer';

export const RECOGNITION_STAGE = "photo-recognition-v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const textSchema = z.object({
  title: z.array(z.string().max(2000)).max(100),
  footer: z.array(z.string().max(2000)).max(100),
  footerSupplemental: z.array(z.string().max(2000)).max(100).optional(),
  footerSourceIdentifiers:z.array(z.string().max(2000)).max(100).optional(),
});
const linesSchema = z
  .array(
    z.object({
      text: z.string().max(2000),
      score: z.number().finite(),
      polygon: z.array(z.array(z.number().finite()).length(2)).max(8),
    }),
  )
  .max(100);
export const nativeObservationSchema = z.object({
        rotationDegrees: z.union([z.literal(0), z.literal(180)]),
        text: textSchema,
        lines: linesSchema,
        footerLines: linesSchema.optional(),
        identifierLines:linesSchema.optional(),
        identifierSource:sourceFooterSchema.optional(),
      });
export const nativeSchema = z.object({
  version: z.literal(1),
  descriptor: digest,
  descriptorDetails: z.record(z.unknown()),
  photoDigest: digest,
  text: textSchema,
  readingZones: acquisitionReadingZonesSchema.optional(),
  orientations: z
    .array(
      nativeObservationSchema,
    )
    .max(2),
  geometry: z.object({ status: z.string() }).passthrough(),
  lines: linesSchema,
  milliseconds: z.number().nonnegative().finite(),
  automaticAcceptance: z.literal(false),
  photoText: acquisitionPhotoTextSchema.optional(),
  scannerLayoutTemplate:scannerLayoutTemplateSchema.optional(),
  scannerLayout:z.object({inference:scannerLayoutInferenceSchema,orientations:z.array(nativeObservationSchema).max(2),
    readingStatus:z.enum(['COMPLETE','TIME_BUDGET','WORKER_ERROR']).optional(),
    anchorSearch:z.object({status:z.literal('COMPLETE'),boundaryVerified:z.literal(false),region:acquisitionManualRegionSchema,
      orientations:z.array(nativeObservationSchema).length(2)}).strict().optional()}).strict().optional(),
}).superRefine((value,ctx)=>{
  const layout=value.scannerLayout;
  if(layout){
    if(value.geometry.method!=='declared-card-scan'||value.geometry.framing==='CLIPPED'||value.geometry.status!=='PROPOSED')
      if(layout.inference.status==='PROPOSED')ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scanner layout cannot replace measured or clipped geometry'});
    if((layout.readingStatus==='COMPLETE')!==(layout.orientations.length===2)||
      (layout.inference.status!=='PROPOSED'&&(layout.readingStatus!==undefined||layout.orientations.length)))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scanner layout reading status differs from its observations'});
    if(layout.inference.status==='PROPOSED'&&(!layout.inference.observedAnchors.includes('COLLECTOR')||
      new Set(layout.inference.observedAnchors).size!==layout.inference.observedAnchors.length))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Scanner layout collector anchor required'});
    if(layout.inference.status==='PROPOSED'&&layout.inference.anchorSpace==='LAYOUT_SEARCH'&&
      (!layout.anchorSearch||!layout.inference.observedAnchors.includes('TITLE')))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Guided inference requires its corroborated current anchor search'});
    if(layout.anchorSearch&&(value.geometry.status!=='PROPOSED'||value.geometry.method!=='declared-card-scan'||value.geometry.framing==='CLIPPED'))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Guided search cannot replace direct or clipped geometry'});
    if(layout.anchorSearch&&layout.inference.status==='PROPOSED'&&layout.inference.anchorSpace!=='LAYOUT_SEARCH')
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Guided search and primary anchor spaces cannot be combined'});
    for(const [observation,sourceRegion] of [...layout.orientations.map(o=>[o,layout.inference.status==='PROPOSED'?layout.inference.region:null] as const),
      ...(layout.anchorSearch?.orientations.map(o=>[o,layout.anchorSearch!.region] as const)??[])]){
      if((observation.text.footerSourceIdentifiers?.length||observation.identifierLines?.length)&&
          (!sourceRegion||observation.identifierSource?.status!=='EXTRACTED'))
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier words require their actual source region'});
      if(observation.text.footerSourceIdentifiers?.length&&!observation.identifierLines?.length)
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier words require detected lines'});
      if(observation.identifierSource){
        if(observation.identifierSource.rotationDegrees!==observation.rotationDegrees)
          ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier direction differs'});
        try{
          if(!sourceRegion)throw Error('Inferred source geometry unavailable');
          assertScannerLayoutFooterSource(observation.identifierSource,sourceRegion,value.geometry.quad);
        }catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier source differs from its observed card frame'});}
      }
      for(const line of observation.identifierLines??[])
        if(line.polygon.length!==4||line.polygon.some(([x,y])=>x<24||x>630||y<1270||y>1396))
          ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred identifier line exceeds its actual region'});
      if(observation.text.footer.length+(observation.text.footerSupplemental?.length??0)+(observation.text.footerSourceIdentifiers?.length??0)>100)
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inferred combined footer exceeds bounds'});
    }
  }
  const template=value.scannerLayoutTemplate;
  if(template && (template.sourceDigest!==value.photoDigest||template.sourceMethod!==value.geometry.method||value.geometry.status!=="PROPOSED"||value.geometry.framing==="CLIPPED"))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:"Scanner layout requires its actual source observation"});
  if(template){
    if(!scannerLayoutAnchorsObserved(template,value.orientations))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:"Scanner layout anchors were not observed in its source reading"});
    const points=value.geometry.quad;
    if(!Array.isArray(points)||points.length!==4||points.some((p:unknown,i:number)=>!Array.isArray(p)||p.length!==2||p.some((v:unknown)=>typeof v!=="number"||!Number.isFinite(v))||Math.hypot(Number(p[0])-template.region.quad[i][0]*(template.frame.width-1),Number(p[1])-template.region.quad[i][1]*(template.frame.height-1))>1e-6))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:"Scanner layout differs from its observed source corners"});
  }
  for(const observation of value.orientations){
    if(observation.text.footerSourceIdentifiers?.length || observation.identifierLines?.length){
      if(observation.identifierSource?.status!=='EXTRACTED'||value.geometry.status!=='PROPOSED'||value.geometry.framing==='CLIPPED')
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier text requires an observed source region'});
    }
    if(observation.identifierSource?.status==='EXTRACTED'&&(value.geometry.status!=='PROPOSED'||
      !Array.isArray(value.geometry.quad)||value.geometry.quad.length!==4||value.geometry.framing==='CLIPPED'))
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier region requires proposed source geometry'});
    if(observation.text.footerSourceIdentifiers?.length&&!observation.identifierLines?.length)
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier words require detected source lines'});
    for(const line of observation.identifierLines??[]){
      if(line.polygon.length!==4||line.polygon.some(([x,y])=>x<24||x>630||y<1270||y>1396))
        ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier line exceeds its measured region'});
    }
    if(observation.identifierSource && observation.identifierSource.rotationDegrees!==observation.rotationDegrees)
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Identifier source direction differs'});
    if(observation.text.footer.length+(observation.text.footerSupplemental?.length??0)+(observation.text.footerSourceIdentifiers?.length??0)>100)
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'Combined footer exceeds bounds'});
  }
  if(value.text.footerSourceIdentifiers && JSON.stringify(value.text.footerSourceIdentifiers)!==JSON.stringify(value.orientations[0]?.text.footerSourceIdentifiers))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Primary identifier reading differs from its direction'});
});
export {loadAcquisitionRecognitionSnapshot,type RecognitionSnapshot} from "./acquisition-recognition-snapshot";
import type {RecognitionSnapshot} from "./acquisition-recognition-snapshot";
export function acquisitionRecognitionVersion(_catalog: string, model: string) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pipeline: RECOGNITION_STAGE,
        model,
        resolver: "metadata-card-orientation-catalog-v5",
      }),
    )
    .digest("hex");
}
// A generation change can leave older attempts queued behind their replacement.
// Require a strictly newer, identical-input current-version attempt. Attempt
// order protects newer work, and a live lease keeps its authority.
export async function retireReplacedRecognition(
  db: PrismaClient,
  versionKey: string,
  now = new Date(),
) {
  digest.parse(versionKey);
  return db.$executeRaw`
    UPDATE "AcquisitionProcessingJob" old SET status='SUPERSEDED',
      "leaseToken"=NULL, "leaseExpiresAt"=NULL,
      "errorCode"='GENERATION_REPLACED', "updatedAt"=${now}
    WHERE old.stage=${RECOGNITION_STAGE} AND old."versionKey"<>${versionKey}
      AND (old.status='PENDING' OR (old.status='RUNNING' AND old."leaseExpiresAt"<=${now}))
      AND EXISTS (
        SELECT 1 FROM "AcquisitionProcessingJob" current
        WHERE current.stage=old.stage AND current."versionKey"=${versionKey}
          AND current."runId"=old."runId" AND current."artifactId"=old."artifactId"
          AND current."candidateId"=old."candidateId"
          AND current."candidateRevision"=old."candidateRevision"
          AND current."createdAt">old."createdAt"
          AND current.status IN ('PENDING','RUNNING','COMPLETE','FAILED')
          AND current.input->>'photoId'=old.input->>'photoId'
          AND current.input->>'digest'=old.input->>'digest'
      )`;
}

export async function enqueueReadyRecognition(
  db: PrismaClient,
  catalog: string,
  model: string,
) {
  const versionKey = acquisitionRecognitionVersion(catalog, model);
  // A durable handoff can be retried after canonical-worker or OCR-worker exit.
  // Existing attempts for this exact version are not silently retried forever.
  const eligible = await db.$queryRaw<{ id: string }[]>(acquisitionHandoffQuery(RECOGNITION_STAGE, Prisma.sql`
    SELECT j.id, j."runId", j."createdAt" FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id = j."candidateId"
    JOIN "AcquisitionRun" r ON r.id = j."runId"
    JOIN "AcquisitionSession" s ON s.id = r."sessionId"
    JOIN "Player" p ON p.id = s."ownerPlayerId"
    JOIN "User" u ON u.id = s."createdByUserId"
    WHERE j.stage = 'photo-canonical-v1' AND j.status = 'COMPLETE'
      AND ${acquisitionAnalysisReadySql()}
      AND s.phase NOT IN ('DRAFT', 'CANCELLED') AND s."cancelledAt" IS NULL AND s."trashedAt" IS NULL AND s."deletedAt" IS NULL
      AND p.active = true AND u."isActive" = true AND u."forcePasswordChange" = false
      AND NOT EXISTS (
        SELECT 1 FROM "AcquisitionProcessingJob" other
        WHERE other."artifactId" = j."artifactId" AND other."candidateId" = c.id
          AND other."candidateRevision" = c.revision
          AND other.stage = ${RECOGNITION_STAGE} AND other."versionKey" = ${versionKey}
      )
  `));
  const ready = await db.acquisitionProcessingJob.findMany({
    where: { id: { in: eligible.map((j) => j.id) } },
    orderBy: { createdAt: "asc" },
    take: 32,
    include: { candidate: true, artifact: true },
  });
  let added = 0;
  for (const job of ready) {
    if (job.candidate.excluded) continue;
    const input = z
      .object({ photoId: z.string().uuid(), digest })
      .parse(job.input);
    const photo = await db.acquisitionPhoto.findUnique({
      where: { id: input.photoId },
      include: { slot: true },
    });
    if (
      !photo ||
      !photo.ready ||
      photo.purgedAt ||
      photo.digest !== input.digest ||
      photo.generation !== photo.slot.generation
    ) {
      await db.acquisitionProcessingJob.updateMany({
        where: { id: job.id, status: "COMPLETE" },
        data: { status: "SUPERSEDED", errorCode: "INPUT_CHANGED" },
      });
      continue;
    }
    const manualAnalysis = acquisitionAnalysisForPhoto(job.candidate, photo);
    if (job.candidate.review !== null && manualAnalysis?.candidateRevision !== job.candidate.revision) continue;
    const result = await db.acquisitionProcessingJob.createMany({
      skipDuplicates: true,
      data: [
        {
          runId: job.runId,
          artifactId: job.artifactId,
          candidateId: job.candidateId,
          candidateRevision: job.candidate.revision,
          stage: RECOGNITION_STAGE,
          versionKey,
          input: {
            version: 1,
            ...input,
            inputKind: photo.inputKind,
            manualAnalysis,
            scannerLayoutProfile:photo.scannerLayoutProfile,
            versions: {
              pipeline: RECOGNITION_STAGE,
              runtime: "paddle-cpu-subprocess-v1",
              model,
              catalog,
              index: catalog,
              execution: "CPU",
            },
          },
        },
      ],
    });
    added += result.count;
  }
  await retireReplacedRecognition(db, versionKey);
  return added;
}
export async function recognizeAcquisitionPhoto(
  job: ClaimedAcquisitionJob,
  signal: AbortSignal,
  snapshot: RecognitionSnapshot,
  model: string,
  nativeWorker?: AcquisitionNativeStream,
) {
  const input = z
    .object({
      photoId: z.string().uuid(),
      digest,
      inputKind: acquisitionImageInputKindSchema.default("PHOTO"),
      versions: z.object({ catalog: digest, model: digest }),
      scannerLayoutProfile:z.string().max(950).nullable().optional(),
      manualAnalysis: acquisitionManualAnalysisSchema.nullable().optional(),
    })
    .parse(job.input);
  // Catalog-only changes are handled by reconciliation of saved OCR. The raw
  // job identity depends on its photo/revision/model, not metadata refreshes.
  if (input.versions.model !== model)
    throw new Error(
      "Processing version unavailable; restart with its catalog/model",
    );
  const bytes = await readAcquisitionPhotoBytes(
    input.photoId,
    "raw",
    input.digest,
  );
  const nativeStarted = Date.now();
  const requestNative = (frame: Buffer, attemptSignal: AbortSignal, progress?: (value: unknown) => void) => nativeWorker
    ? nativeWorker.request(frame, attemptSignal, progress)
    : runAcquisitionNativeProcess("python", ["/app/tools/acquisition-runtime/recognize.py"], frame, attemptSignal);
  const native = nativeSchema.parse(
    await requestNative(acquisitionNativePhotoInput(bytes, input.inputKind, undefined, input.manualAnalysis?.region ?? undefined, !input.manualAnalysis?.region ? input.scannerLayoutProfile ?? undefined : undefined), signal),
  );
  if (
    native.photoDigest !== input.digest ||
    native.descriptor !== model ||
    signal.aborted
  )
    throw new Error("Processing input changed");
  if (!sameAcquisitionManualRegion(native.geometry.manualRegion, input.manualAnalysis?.region))
    throw new Error("Recognition region changed");
  if(native.scannerLayout){
    const profile=parseScannerLayoutProfile(input.scannerLayoutProfile);
    if(!profile||input.inputKind!=='CARD_SCAN'||input.manualAnalysis?.region)throw new Error('Scanner layout input changed');
    assertScannerLayoutInference(profile,native);
  }
  let proposals = proposeOrientedAcquisitionPrintings(
    snapshot.index,
    native.orientations,
  );
  if(native.scannerLayout?.readingStatus==="COMPLETE")proposals=combineScannerLayoutReadings(snapshot.index,native);
  if (!input.manualAnalysis?.region && needsAcquisitionPhotoText(proposals)) {
    native.photoText = await readAcquisitionPhotoText(requestNative, bytes, input.inputKind,
      { photoDigest: input.digest, descriptor: model }, signal,
      Math.min(32000, 35000 - (Date.now() - nativeStarted)));
    proposals = combineAcquisitionPhotoText(snapshot.index, proposals, native.photoText);
  }
  if (input.manualAnalysis?.region) {
    proposals.automaticAcceptance = false;
    if (proposals.status === "STRONG_MATCH") proposals.status = "REVIEW_REQUIRED";
  }
  if(native.scannerLayout?.readingStatus==="COMPLETE")proposals=combineScannerLayoutReadings(snapshot.index,native);
  signal.throwIfAborted();
  return {
    version: 1,
    photoId: input.photoId,
    versions: {
      ...input.versions,
      catalog: snapshot.digest,
      index: snapshot.digest,
      footerParser: ACQUISITION_FOOTER_PARSER_VERSION,
      textResolver: ACQUISITION_TEXT_RESOLVER_VERSION,
    },
    execution: "CPU",
    manualAnalysis: input.manualAnalysis ?? null,
    native,
    proposals,
    catalog: { status: "CHECKING", printingCoverage: "UNRESOLVED" },
  } as unknown as Prisma.InputJsonObject;
}
