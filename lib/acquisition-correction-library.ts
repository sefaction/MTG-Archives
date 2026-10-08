import { randomBytes, randomInt } from "node:crypto";
import { Prisma, type AcquisitionPhoto, type AcquisitionProcessingJob } from "@prisma/client";
import { z } from "zod";
import { acquisitionRecognitionDto } from "./acquisition-recognition-dto";
import { acquisitionPrintingSelect } from "./acquisition-review";
import { isAdminUser } from "./auth-policy";
import { correctionCanonical, correctionHash, correctionJobSnapshot, correctionLibraryDefaultBytes,
  correctionRequiresOriginal, classifyCorrection, signCorrectionDisplay, readCorrectionDisplay,
  CORRECTION_EVIDENCE_LIMIT, CORRECTION_LIBRARY_VERSION, type CorrectionDisplayTokens } from "./acquisition-correction-policy";
import type { AcquisitionActor } from "./acquisition-store";
type Tx = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(correctionCanonical(value)) as Prisma.InputJsonObject;

// Shared order: acquisition session (when relevant), library owner, blob.
// Copy finalization/GC never acquire an acquisition session after owner locks.
export async function lockCorrectionOwner(tx: Tx, ownerPlayerId: string) {
  z.string().min(1).max(200).parse(ownerPlayerId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerPlayerId},715))`;
}
export async function ensureCorrectionAccount(tx: Tx, ownerPlayerId: string) {
  await lockCorrectionOwner(tx, ownerPlayerId);
  return tx.correctionLibraryAccount.upsert({ where: { ownerPlayerId }, update: {}, create: {
    ownerPlayerId, displayKey: randomBytes(32).toString("hex"), limitBytes: correctionLibraryDefaultBytes(),
  } });
}
export async function authorizeCorrectionLibrary(tx: Tx, actor: AcquisitionActor, ownerPlayerId: string,
  action: string, exampleId?: string) {
  const user = await tx.user.findUnique({ where: { id: actor.userId }, include: { player: true } });
  if (!user?.isActive || user.forcePasswordChange || !(user.playerId === ownerPlayerId && user.player?.active ||
    actor.adminMode && isAdminUser(user, user.player))) throw new Error("Capture correction library unavailable");
  if (user.playerId !== ownerPlayerId) {
    await ensureCorrectionAccount(tx, ownerPlayerId);
    await tx.correctionLibraryAccess.create({ data: { ownerPlayerId, actorId: actor.userId, action, exampleId } });
  }
}
// Called once inside original upload admission, before any recognition exists.
export async function selectCorrectionControl(tx: Tx, ownerPlayerId: string, roll = () => randomInt(10000)) {
  const account = await ensureCorrectionAccount(tx, ownerPlayerId);
  const eligible = account.selectedControls < account.sampleCap;
  const selected = eligible && roll() < account.sampleBasisPoints;
  if (selected) await tx.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: { selectedControls: { increment: 1 } } });
  return { correctionControl: selected, correctionCohortId: account.cohortId,
    correctionSamplingBasisPoints: account.sampleBasisPoints, correctionSamplingEligible: eligible };
}

export async function correctionDisplayToken(tx: Tx, ownerPlayerId: string, actor: AcquisitionActor,
  photo: AcquisitionPhoto, candidate: { id: string; revision: number }, jobs: AcquisitionProcessingJob[],
  suggestions: Array<{ id: string; name: string; setCode: string; collectorNumber: string; lang: string | null;
    imageUri: string | null; finishes: unknown }>, status: string) {
  const account = await ensureCorrectionAccount(tx, ownerPlayerId);
  await authorizeCorrectionLibrary(tx, actor, ownerPlayerId, "ACQUISITION_DISPLAY");
  try {
    return signCorrectionDisplay({ version: 1, ownerPlayerId, actorId: actor.userId, photoId: photo.id, digest: photo.digest,
      generation: photo.generation, candidateId: candidate.id, revision: candidate.revision,
      jobs: jobs.map(job => ({ id: job.id, outputHash: job.output === null ? null : correctionHash(job.output) })),
      suggestions: suggestions.map(card => ({ ...card, imageUri: null })), status }, account.displayKey);
  } catch { return undefined; } // Missing display attribution never hides a valid review.
}

async function saveEvidence(tx: Tx, ownerPlayerId: string, sourcePhotoId: string, payload: unknown) {
  const encoded = correctionCanonical(payload);
  if (Buffer.byteLength(encoded) > CORRECTION_EVIDENCE_LIMIT) throw new Error("Capture correction evidence exceeds bounds");
  const bundleHash = correctionHash(payload);
  const existing = await tx.correctionEvidence.findUnique({ where: { ownerPlayerId_bundleHash: { ownerPlayerId, bundleHash } } });
  if (existing) return existing.id;
  const record = await tx.correctionEvidence.create({ data: { ownerPlayerId, sourcePhotoId, bundleHash,
    payload: json(payload), bytes: Buffer.byteLength(encoded) } });
  await tx.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: { evidenceBytes: { increment: record.bytes } } });
  return record.id;
}

export async function ensureCorrectionExample(tx: Tx, ownerPlayerId: string, sessionId: string,
  photo: AcquisitionPhoto, candidateId: string) {
  await ensureCorrectionAccount(tx, ownerPlayerId);
  const tombstone = await tx.correctionDeletionTombstone.findUnique({ where: { ownerPlayerId_sourcePhotoId: { ownerPlayerId, sourcePhotoId: photo.id } } });
  if (tombstone) return null;
  const previous = await tx.correctionExample.findUnique({ where: { ownerPlayerId_sourcePhotoId: { ownerPlayerId, sourcePhotoId: photo.id } } });
  if (previous) return previous.deletedAt ? null : previous;
  if (!photo.ready || photo.purgedAt) throw new Error("Capture correction original unavailable");
  let blob = await tx.correctionBlob.findUnique({ where: { ownerPlayerId_digest: { ownerPlayerId, digest: photo.digest } } });
  if (blob && (blob.bytes !== photo.bytes || blob.mediaType !== photo.mediaType)) throw new Error("Capture correction original identity changed");
  if (!blob) blob = await tx.correctionBlob.create({ data: { ownerPlayerId, digest: photo.digest, bytes: photo.bytes, mediaType: photo.mediaType } });
  else if (blob.state === "DELETED") blob = await tx.correctionBlob.update({ where: { id: blob.id }, data: {
    state: "PENDING", reserved: false, preservedAt: null, deleteClaimedAt: null,
  } });
  const example = await tx.correctionExample.create({ data: { ownerPlayerId, sourcePhotoId: photo.id,
    sourceCandidateId: candidateId, sourceSessionId: sessionId, sourceGeneration: photo.generation,
    physicalCopyGroup: photo.slotId, blobId: blob.id, normalControl: photo.correctionControl,
    cohortId: photo.correctionControl ? photo.correctionCohortId : null,
    sourceMetadata: json({ version: 1, digest: photo.digest, bytes: photo.bytes, mediaType: photo.mediaType,
      width: photo.width, height: photo.height, inputKind: photo.inputKind, generation: photo.generation,
      firstMachineEvidence: photo.firstMachineEvidence, policy: CORRECTION_LIBRARY_VERSION,
      sampleBasisPoints: photo.correctionSamplingBasisPoints, samplingEligible: photo.correctionSamplingEligible }),
  } });
  const metadataBytes = Buffer.byteLength(correctionCanonical({ sourceMetadata: example.sourceMetadata, label: null }));
  await tx.correctionExample.update({ where: { id: example.id }, data: { metadataBytes } });
  await tx.correctionLibraryAccount.update({ where: { ownerPlayerId }, data: { evidenceBytes: { increment: metadataBytes } } });
  if (blob.state !== "PRESERVED") {
    await tx.correctionRetentionPin.upsert({ where: { blobId_photoId: { blobId: blob.id, photoId: photo.id } },
      create: { blobId: blob.id, ownerPlayerId, photoId: photo.id, sessionId }, update: { releasedAt: null } });
    await tx.correctionCaptureOutbox.upsert({ where: { blobId: blob.id }, create: { blobId: blob.id }, update: {} });
    // Additional physical memberships must not revoke a live copy's lease.
    if (blob.state !== "DELETING") await tx.correctionCaptureOutbox.updateMany({ where: { blobId: blob.id,
      status: { not: "RUNNING" } }, data: { status: "PENDING", availableAt: new Date(), errorCode: null } });
  }
  await tx.correctionReviewEvent.updateMany({ where: { ownerPlayerId, sourcePhotoId: photo.id, exampleId: null }, data: { exampleId: example.id } });
  return example;
}

async function photoJobs(tx: Tx, photo: AcquisitionPhoto, candidateId: string) {
  return tx.acquisitionProcessingJob.findMany({ where: { runId: photo.runId, candidateId,
    artifact: { sourceId: photo.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 32 });
}
async function retainJobEvidence(tx: Tx, ownerPlayerId: string, photoId: string, jobs: AcquisitionProcessingJob[]) {
  const ids: string[] = [];
  for (const job of jobs) ids.push(await saveEvidence(tx, ownerPlayerId, photoId,
    { version: 1, role: "SOURCE_JOB", sourcePhotoId: photoId, job: correctionJobSnapshot(job) }));
  return ids;
}
// Atomic with each review save, after the ordinary source/revision/owner fences.
// Callers supply no machine scores or labels: these are resolved from saved jobs.
export async function captureCorrectionReview(tx: Tx, input: { ownerPlayerId: string; sessionId: string;
  candidateId: string; revision: number; actorId: string; origin: "HUMAN" | "AUTO";
  photo: AcquisitionPhoto | null; before: unknown; after: unknown; tokens?: CorrectionDisplayTokens }) {
  const account = await ensureCorrectionAccount(tx, input.ownerPlayerId);
  const eventKey = { ownerPlayerId: input.ownerPlayerId, sourceCandidateId: input.candidateId, candidateRevision: input.revision };
  if (await tx.correctionReviewEvent.findUnique({ where: { ownerPlayerId_sourceCandidateId_candidateRevision: eventKey } })) return;
  const beforeId = (input.before as { cardId?: string } | null)?.cardId ?? null;
  const afterId = (input.after as { cardId?: string } | null)?.cardId ?? null;
  const photo = input.photo;
  const tombstone = photo && await tx.correctionDeletionTombstone.findUnique({ where: {
    ownerPlayerId_sourcePhotoId: { ownerPlayerId: input.ownerPlayerId, sourcePhotoId: photo.id },
  } });
  const jobs = photo && !tombstone ? await photoJobs(tx, photo, input.candidateId) : [];
  const displayed = [] as Array<{ role: string; identity: NonNullable<ReturnType<typeof readCorrectionDisplay>>; jobs: AcquisitionProcessingJob[] }>;
  const flags: string[] = photo ? [] : ["SOURCE_ORIGINAL_UNAVAILABLE"];
  if (input.tokens?.truncated) flags.push("DISPLAY_HISTORY_TRUNCATED");
  for (const [role, token] of [
    ["INITIAL", input.tokens?.initial], ["EDIT", input.tokens?.edit], ["CURRENT", input.tokens?.current],
    ...(input.tokens?.displayed ?? []).map(token => ["DISPLAYED", token]),
  ]) {
    if (!token || !photo || tombstone) continue;
    const identity = readCorrectionDisplay(token, account.displayKey);
    if (!identity || identity.ownerPlayerId !== input.ownerPlayerId || identity.actorId !== input.actorId ||
      identity.photoId !== photo.id || identity.digest !== photo.digest || identity.generation !== photo.generation ||
      identity.candidateId !== input.candidateId || identity.revision > input.revision - 1) {
      flags.push("DISPLAY_IDENTITY_INVALID"); continue;
    }
    // Look up an older displayed generation explicitly; newest-first limits must
    // not silently substitute today's evidence for a restored browser draft.
    const sources = await tx.acquisitionProcessingJob.findMany({ where: { id: { in: identity.jobs.map(job => job.id) },
      runId: photo.runId, candidateId: input.candidateId, artifact: { sourceId: photo.id } } });
    const available: AcquisitionProcessingJob[] = [];
    for (const expected of identity.jobs) {
      const source = sources.find(source => source.id === expected.id);
      if (!source) { flags.push("DISPLAY_SOURCE_UNAVAILABLE"); continue; }
      if (expected.outputHash === null) {
        available.push({ ...source, output: null, status: "PENDING" });
      } else if (correctionHash(source.output) === expected.outputHash) available.push(source);
      else flags.push("DISPLAY_SOURCE_CHANGED");
    }
    // A pending job finishing later does not invalidate the signed proposal
    // order. Retain the signed identity and explicit gaps, never its later output
    // as though that output was already displayed.
    displayed.push({ role: role!, identity, jobs: available });
  }
  const baseline = displayed.find(bundle => bundle.role === "EDIT") ?? displayed.find(bundle => bundle.role === "CURRENT") ??
    displayed.find(bundle => bundle.role === "INITIAL") ?? displayed.at(-1);
  const classification = tombstone ? "LIBRARY_REMOVED" : classifyCorrection({ afterId, beforeId,
    offeredIds: baseline?.identity.suggestions.map(card => card.id) ?? [], displayKnown: !!baseline, origin: input.origin });
  if (!baseline && input.origin === "HUMAN") flags.push("DISPLAY_IDENTITY_UNKNOWN");
  let example = photo && !tombstone ? await tx.correctionExample.findUnique({ where: {
    ownerPlayerId_sourcePhotoId: { ownerPlayerId: input.ownerPlayerId, sourcePhotoId: photo.id },
  } }) : null;
  if (photo && !tombstone && (example || photo.correctionControl || correctionRequiresOriginal(classification)))
    example = await ensureCorrectionExample(tx, input.ownerPlayerId, input.sessionId, photo, input.candidateId);
  const cards = !tombstone ? await tx.card.findMany({ where: { id: { in: [beforeId, afterId].filter((id): id is string => !!id) } }, select: acquisitionPrintingSelect }) : [];
  const evidenceIds: string[] = [];
  if (photo && example) {
    const saveBundle = await saveEvidence(tx, input.ownerPlayerId, photo.id, { version: 1, role: "AT_SAVE",
      source: { photoId: photo.id, digest: photo.digest, generation: photo.generation, candidateId: input.candidateId },
      earliestMachine: photo.firstMachineEvidence ?? { missing: "EARLIEST_PUBLISH_IDENTITY_NOT_CAPTURED" },
      jobEvidenceIds: await retainJobEvidence(tx, input.ownerPlayerId, photo.id, jobs), missing: flags });
    evidenceIds.push(saveBundle);
    for (const bundle of displayed) evidenceIds.push(await saveEvidence(tx, input.ownerPlayerId, photo.id,
      { version: 1, role: bundle.role, identity: bundle.identity,
        jobEvidenceIds: await retainJobEvidence(tx, input.ownerPlayerId, photo.id, bundle.jobs) }));
    const label = input.after ? { decision: input.after, printing: cards.find(card => card.id === afterId) ?? null } : null;
    const metadataBytes = Buffer.byteLength(correctionCanonical({ sourceMetadata: example.sourceMetadata, label }));
    const previousBytes = await tx.correctionExample.findUniqueOrThrow({ where: { id: example.id }, select: { metadataBytes: true } });
    await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: input.ownerPlayerId },
      data: { evidenceBytes: { increment: metadataBytes - previousBytes.metadataBytes } } });
    await tx.correctionExample.update({ where: { id: example.id }, data: {
      label: label ? json(label) : Prisma.DbNull, metadataBytes,
      labelState: input.after ? "UNVERIFIED" : "WITHDRAWN", firstEvidenceId: example.firstEvidenceId ?? saveBundle,
    } });
  }
  const payload = tombstone ? { version: 1, removed: true } : { version: 1, policy: CORRECTION_LIBRARY_VERSION,
    before: input.before, after: input.after, printingProjections: cards, displayKnown: !!baseline,
    firstDisplayedSuggestion: baseline?.identity.suggestions[0] ?? null,
    offeredIds: baseline?.identity.suggestions.map(card => card.id) ?? [], missing: [...new Set(flags)],
    independentVerification: "UNVERIFIED", sourceGeneration: photo?.generation ?? null };
  const bytes = Buffer.byteLength(correctionCanonical(payload));
  await tx.correctionReviewEvent.create({ data: { ...eventKey, sourcePhotoId: photo?.id ?? null,
    exampleId: example?.id, actorId: input.actorId, origin: input.origin, classification, payload: json(payload),
    evidenceIds: [...new Set(evidenceIds)], bytes } });
  await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: input.ownerPlayerId }, data: { evidenceBytes: { increment: bytes } } });
}

// Called only after successful publication while the source session is locked.
// First publication is immutable; later analysis cannot rewrite its baseline.
export async function captureCorrectionPublication(tx: Tx, job: AcquisitionProcessingJob, output: Prisma.InputJsonObject) {
  const source = z.object({ photoId: z.string().uuid(), digest: z.string() }).safeParse(job.input);
  if (!source.success) return;
  const photo = await tx.acquisitionPhoto.findUnique({ where: { id: source.data.photoId }, include: { run: { include: { session: true } } } });
  if (!photo || photo.runId !== job.runId || photo.digest !== source.data.digest) return;
  const result = acquisitionRecognitionDto("COMPLETE", output).result;
  let earliest = photo.firstMachineEvidence;
  // A pre-library original has no trustworthy first-publication baseline.
  // Later reanalysis must not manufacture an "earliest" historical result.
  if (result && photo.correctionCohortId && photo.firstMachineEvidence === null) {
    const identity = json({ version: 1, jobId: job.id, stage: job.stage,
      outputHash: correctionHash(output), proposals: result.proposals, publishedAt: new Date().toISOString() });
    const changed = await tx.acquisitionPhoto.updateMany({ where: {
      id: photo.id, firstMachineEvidence: { equals: Prisma.DbNull },
    }, data: { firstMachineEvidence: identity } });
    if (changed.count) earliest = identity as Prisma.JsonObject;
  }
  const example = await tx.correctionExample.findUnique({ where: {
    ownerPlayerId_sourcePhotoId: { ownerPlayerId: photo.run.session.ownerPlayerId, sourcePhotoId: photo.id },
  } });
  if (!example || example.deletedAt) return;
  await ensureCorrectionAccount(tx, example.ownerPlayerId);
  if (earliest) await saveEvidence(tx, example.ownerPlayerId, photo.id,
    { version: 1, role: "EARLIEST_PUBLISHED", sourcePhotoId: photo.id, identity: earliest });
  const published = await tx.acquisitionProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
  await retainJobEvidence(tx, example.ownerPlayerId, photo.id, [published]);
}

export async function hasCorrectionRetentionPins(tx: Tx, sessionId: string) {
  return (await tx.correctionRetentionPin.count({ where: { sessionId, releasedAt: null } })) > 0;
}
