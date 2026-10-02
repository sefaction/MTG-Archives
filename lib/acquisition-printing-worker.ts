import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CATALOG_RECONCILIATION_STAGE } from "./acquisition-catalog-status";
import { readAcquisitionPhotoBytes } from "./acquisition-files";
import { acquisitionHandoffQuery } from "./acquisition-handoff";
import { AcquisitionJobSupersededError, type ClaimedAcquisitionJob } from "./acquisition-jobs";
import type { AcquisitionNativeStream } from "./acquisition-native-stream";
import {
  PRINTING_STAGE, PRINTING_POLICY_VERSION, applyAcquisitionPrintingEvidence,
  acquisitionPrintingSummary,
} from "./acquisition-printing";
import type { TextProposals } from "./acquisition-visual";
import { checkedPrintingNative, printingReuseIdentity, reusablePrintingNative } from "./acquisition-printing-reuse";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.object({
  catalogJobId: z.string().uuid(), photoId: z.string().uuid(), digest,
  model: digest,
  policy: z.string().max(80).optional(),
});
const proposalsSchema = z.object({
  version: z.literal(4), status: z.string(), automaticAcceptance: z.boolean(),
  finish: z.literal("UNKNOWN"), condition: z.literal("UNKNOWN"),
  catalogCoverage: z.string(), totalProposals: z.number().int().nonnegative(),
  truncated: z.boolean(),
  orientation: z.object({status: z.string(), rotationDegrees: z.number().nullable()}),
  evidence: z.object({setCodes: z.array(z.string()), collectors: z.array(z.string()), languages: z.array(z.string())}),
  proposals: z.array(z.object({
    card: z.object({id: z.string(), name: z.string(), setCode: z.string(),
      collectorNumber: z.string(), lang: z.string().nullable().optional(), digital: z.boolean().nullable().optional()}),
    reasons: z.array(z.string()), nameDistance: z.number().nullable(),
  })).max(12),
});

export async function enqueueReadyPrinting(db: PrismaClient, model: string) {
  const rows = await db.$queryRaw<{id: string}[]>(acquisitionHandoffQuery(PRINTING_STAGE, Prisma.sql`
    SELECT j.id, j."runId", j."createdAt" FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    JOIN "Player" p ON p.id=s."ownerPlayerId"
    JOIN "User" u ON u.id=s."createdByUserId"
    WHERE j.stage=${CATALOG_RECONCILIATION_STAGE} AND j.status='COMPLETE'
      AND j."candidateRevision"=c.revision AND c.review IS NULL AND NOT c.excluded
      AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" newer
        WHERE newer.stage=j.stage AND newer."candidateId"=c.id AND newer."candidateRevision"=c.revision
          AND (newer."createdAt",newer.id)>(j."createdAt",j.id))
      AND NOT EXISTS (SELECT 1 FROM "AcquisitionProcessingJob" v
        WHERE v.stage=${PRINTING_STAGE} AND v."artifactId"=j."artifactId"
          AND v."candidateId"=c.id AND v."candidateRevision"=c.revision
          AND v.input->>'catalogJobId'=j.id AND v.input->>'model'=${model}
          AND v.input->>'policy'=${PRINTING_POLICY_VERSION})
  `));
  let added = 0;
  for (const {id} of rows) {
    const source = await db.acquisitionProcessingJob.findUnique({where: {id}});
    // Admission IDs are a snapshot; cancelled/removed runs can disappear here.
    if (!source) continue;
    const input = z.object({photoId: z.string().uuid(), digest}).parse(source.input);
    const versionKey = createHash("sha256").update(`${PRINTING_STAGE}:${model}:${PRINTING_POLICY_VERSION}:${source.id}`).digest("hex");
    const created = await db.acquisitionProcessingJob.createMany({skipDuplicates: true, data: [{
      runId: source.runId, artifactId: source.artifactId, candidateId: source.candidateId,
      candidateRevision: source.candidateRevision, stage: PRINTING_STAGE, versionKey,
      input: {...input, catalogJobId: source.id, model, policy: PRINTING_POLICY_VERSION},
    }]});
    added += created.count;
  }
  return added;
}

export async function observeAcquisitionPrinting(
  db: PrismaClient, job: ClaimedAcquisitionJob, signal: AbortSignal,
  model: string, nativeWorker: Pick<AcquisitionNativeStream, "request">,
): Promise<Prisma.InputJsonObject> {
  const input = inputSchema.parse(job.input);
  if (input.model !== model) throw new AcquisitionJobSupersededError("Printing reference version superseded");
  if (input.policy !== PRINTING_POLICY_VERSION)
    throw new AcquisitionJobSupersededError("Printing interpretation version superseded");
  const source = await db.acquisitionProcessingJob.findUniqueOrThrow({where: {id: input.catalogJobId}});
  if (source.status !== "COMPLETE" || source.stage !== CATALOG_RECONCILIATION_STAGE ||
      source.runId !== job.runId || source.artifactId !== job.artifactId ||
      source.candidateId !== job.candidateId || source.candidateRevision !== job.candidateRevision)
    throw new Error("Printing source changed");
  const sourceInput = z.object({photoId: z.string().uuid(), digest}).parse(source.input);
  if (sourceInput.photoId !== input.photoId || sourceInput.digest !== input.digest)
    throw new Error("Printing source photo changed");
  const run = await db.acquisitionRun.findUniqueOrThrow({where: {id: job.runId}, select: {session: {select: {ownerPlayerId: true}}}});
  async function requireCurrentSource() {
    const latest = await db.acquisitionProcessingJob.findFirst({where: {
      stage: CATALOG_RECONCILIATION_STAGE, candidateId: job.candidateId,
      candidateRevision: job.candidateRevision,
    }, orderBy: [{createdAt: "desc"}, {id: "desc"}], select: {id: true}});
    if (latest?.id !== source.id) throw new AcquisitionJobSupersededError("Printing catalog input superseded");
    const [live] = await db.$queryRaw<{id: string}[]>`
      SELECT j.id FROM "AcquisitionProcessingJob" j
      JOIN "AcquisitionCandidate" c ON c.id=j."candidateId"
      JOIN "AcquisitionRun" r ON r.id=j."runId"
      JOIN "AcquisitionSession" s ON s.id=r."sessionId"
      JOIN "Player" p ON p.id=s."ownerPlayerId"
      JOIN "User" u ON u.id=s."createdByUserId"
      JOIN "AcquisitionPhoto" photo ON photo.id=${input.photoId} AND photo."runId"=j."runId"
      JOIN "AcquisitionCaptureSlot" slot ON slot.id=photo."slotId"
      WHERE j.id=${job.id} AND j.status='RUNNING' AND j."leaseToken"=${job.leaseToken}
        AND j.stage=${PRINTING_STAGE} AND j."candidateRevision"=${job.candidateRevision}
        AND j."runId"=${job.runId} AND j."candidateId"=${job.candidateId} AND j."artifactId"=${job.artifactId}
        AND j.input=${JSON.stringify(job.input)}::jsonb
        AND j."leaseExpiresAt">clock_timestamp()
        AND c.revision=${job.candidateRevision} AND c.review IS NULL AND NOT c.excluded
        AND s.phase NOT IN ('DRAFT','CANCELLED') AND p.active AND u."isActive" AND NOT u."forcePasswordChange"
        AND s."ownerPlayerId"=${run.session.ownerPlayerId}
        AND photo.ready AND photo."purgedAt" IS NULL AND photo.digest=${input.digest}
        AND photo."slotId"=c."physicalId" AND photo.generation=slot.generation
        AND NOT EXISTS (SELECT 1 FROM "AcquisitionCommitMember" m WHERE m."candidateId"=c.id)`;
    if (!live || signal.aborted) throw new AcquisitionJobSupersededError("Printing input superseded");
  }
  // Reject obsolete work before loading or processing pixels, and again after
  // the native call. A newer catalog pair must not race old printing results.
  await requireCurrentSource();
  const observed = z.object({photoId: z.string().uuid(), proposals: proposalsSchema,
    versions: z.record(z.string()), native: z.object({photoDigest: digest}).passthrough(),
  }).passthrough().parse(source.output);
  const started = performance.now();
  const [photo, candidate] = await Promise.all([
    db.acquisitionPhoto.findUniqueOrThrow({where: {id: input.photoId}, include: {slot: true}}),
    db.acquisitionCandidate.findUniqueOrThrow({where: {id: job.candidateId}}),
  ]);
  if (!photo.ready || photo.purgedAt || photo.runId !== job.runId || photo.digest !== input.digest ||
      photo.slotId !== candidate.physicalId || photo.generation !== photo.slot.generation ||
      observed.photoId !== photo.id || observed.native.photoDigest !== photo.digest ||
      candidate.revision !== job.candidateRevision || candidate.review !== null || candidate.excluded)
    throw new Error("Printing photo input changed");
  const cards = await db.card.findMany({where: {id: {in: observed.proposals.proposals.map(p=>p.card.id)}},
    select: {id: true, scryfallId: true, name: true, setCode: true, collectorNumber: true, lang: true, digital: true}});
  const byScryfall = new Map(cards.flatMap(c=>c.scryfallId ? [[c.scryfallId, c] as const] : []));
  const ids = [...byScryfall.keys()];
  const bytes = await readAcquisitionPhotoBytes(photo.id, "raw", input.digest);
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Printing photo exceeds bound");
  signal.throwIfAborted();
  const reuse = printingReuseIdentity({version: 1, ownerPlayerId: run.session.ownerPlayerId,
    photoDigest: input.digest, descriptor: model, policy: PRINTING_POLICY_VERSION, scryfallIds: ids});
  // Completed jobs are the durable observation store. The exact-key partial
  // index bounds lookup; no original bytes or duplicate evidence cache is saved.
  const [previous] = await db.$queryRaw<{id: string; output: Prisma.JsonValue}[]>`
    SELECT j.id, j.output FROM "AcquisitionProcessingJob" j
    JOIN "AcquisitionRun" r ON r.id=j."runId"
    JOIN "AcquisitionSession" s ON s.id=r."sessionId"
    WHERE j.stage='photo-printing-evidence-v1' AND j.status='COMPLETE'
      AND j.output->'printingReuse'->>'key'=${reuse.key}
      AND s."ownerPlayerId"=${reuse.ownerPlayerId}
    ORDER BY j."createdAt" DESC, j.id DESC LIMIT 1`;
  let native = previous ? reusablePrintingNative(previous.output, reuse) : null;
  const reused = native !== null;
  const metadata = Buffer.from(JSON.stringify({scryfallIds: ids}));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  if (!native) native = checkedPrintingNative(
    await nativeWorker.request(Buffer.concat([length, metadata, bytes]), signal), reuse);
  signal.throwIfAborted();
  await requireCurrentSource();
  const proposals = applyAcquisitionPrintingEvidence(observed.proposals as TextProposals, native, byScryfall);
  return {
    ...observed, sourceCatalogJobId: source.id, proposals,
    printingNative: native, printing: acquisitionPrintingSummary(native, byScryfall),
    printingReuse: reuse,
    printingExecution: {reused, milliseconds: Math.round(performance.now() - started),
      inferenceRequests: reused ? 0 : 1, ...(reused ? {observationJobId: previous.id} : {})},
    versions: {...observed.versions, printing: model, printingPolicy: PRINTING_POLICY_VERSION},
  } as unknown as Prisma.InputJsonObject;
}
