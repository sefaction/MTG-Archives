import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {Prisma, type PrismaClient} from "@prisma/client";
import {acquisitionProgressDto} from "../lib/acquisition-api";
import {getAcquisitionProgress, type AcquisitionActor} from "../lib/acquisition-store";
import {readAcquisitionProblemJobs} from "../lib/acquisition-review-problem-store";

async function fingerprints(db: PrismaClient) {
  const tables = await db.$queryRaw<{tablename: string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, {rows: number; digest: string}> = {};
  for (const {tablename} of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const [row] = await db.$queryRawUnsafe<{rows: number; digest: string}[]>(`SELECT count(*)::int rows,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) digest FROM ${quoted} t`);
    result[tablename] = row;
  }
  return result;
}

/** Uses the existing disposable review verifier's exact owned photo before its
 * first human save. Synthetic outputs qualify classification, not recognition. */
export async function verifyAcquisitionReviewProblems(db: PrismaClient, actor: AcquisitionActor,
  stranger: AcquisitionActor, sessionId: string, photoId: string, cardId: string) {
  await getAcquisitionProgress(db, actor, sessionId);
  const baseline = await fingerprints(db);
  const photo = await db.acquisitionPhoto.findUniqueOrThrow({where: {id: photoId}});
  const candidate = await db.acquisitionCandidate.findFirstOrThrow({where: {runId: photo.runId, physicalId: photo.slotId}});
  const slot = await db.acquisitionCaptureSlot.findUniqueOrThrow({where: {id: photo.slotId}});
  const artifact = await db.acquisitionArtifact.findFirstOrThrow({where: {runId: photo.runId, sourceId: photo.id}});
  const card = await db.card.findUniqueOrThrow({where: {id: cardId}});
  assert.equal(candidate.review, null); assert.equal(candidate.manualAnalysis, null);
  const [nulls] = await db.$queryRaw<{plain: boolean}[]>`SELECT "manualAnalysis" IS NULL AS plain FROM "AcquisitionCandidate" WHERE id=${candidate.id}`;
  assert.equal(nulls.plain, true);
  const id = "review-problem-" + randomUUID(), secret = "private-observation-not-in-progress-".repeat(2000);
  const input = {photoId, digest: photo.digest, manualAnalysis: null};
  const proposal = {card: {id: card.id, name: card.name, setCode: card.setCode,
    collectorNumber: card.collectorNumber, lang: card.lang}, reasons: ["TITLE_TEXT"], nameDistance: 0};
  const output = (status: string, proposals: typeof proposal[], geometryStatus = "PROPOSED") => ({
    proposals: {status, automaticAcceptance: false, totalProposals: proposals.length, truncated: false, proposals},
    catalog: {status: "RESOLVED", printingCoverage: "CHECKED"},
    native: {geometry: {status: geometryStatus}, omittedPrivateObservation: secret},
  });
  let failed = false, primary: unknown;
  const enabledBefore = {ACQUISITION_VISUAL_ENABLED: process.env.ACQUISITION_VISUAL_ENABLED,
    ACQUISITION_PRINTING_ENABLED: process.env.ACQUISITION_PRINTING_ENABLED};
  const errors: unknown[] = [];
  try {
    process.env.ACQUISITION_VISUAL_ENABLED = "0"; process.env.ACQUISITION_PRINTING_ENABLED = "0";
    await db.acquisitionProcessingJob.create({data: {id, runId: photo.runId, candidateId: candidate.id,
      artifactId: artifact.id, candidateRevision: candidate.revision, stage: "photo-recognition-v1",
      versionKey: createHash("sha256").update(id).digest("hex"), status: "COMPLETE", input,
      output: output("CONFLICT", [proposal]), createdAt: new Date(Date.now() + 60000)}});
    const flags = async () => {
      const state = await getAcquisitionProgress(db, actor, sessionId);
      const dto = acquisitionProgressDto(state);
      assert(!JSON.stringify(dto).includes(secret.slice(0, 100)), "private observation must not reach progress");
      const selected = dto.slots.find(s => s.id === photo.slotId); assert(selected);
      assert(selected.reviewProblems.every(flag => ["conflict", "no-match", "unknown-finish", "quality", "overflow"].includes(flag)));
      assert.equal(selected.reviewProblems.includes("overflow"), selected.physicalReadiness.reasons.includes("OVERFLOW"));
      return selected.reviewProblems;
    };
    assert((await flags()).includes("conflict"));
    await db.acquisitionProcessingJob.update({where: {id}, data: {output: output("NO_MATCH", [])}});
    assert((await flags()).includes("no-match"));
    for (const name of ["ACQUISITION_VISUAL_ENABLED", "ACQUISITION_PRINTING_ENABLED"]) {
      process.env[name] = "1";
      assert(!(await flags()).includes("no-match"), "enabled stage awaiting admission is unfinished");
      process.env[name] = "0";
    }
    await db.acquisitionProcessingJob.update({where: {id}, data: {status: "RUNNING",
      leaseToken: "owned-problem-fixture", leaseExpiresAt: new Date(Date.now() + 60000)}});
    assert(!(await flags()).includes("no-match"));
    await db.acquisitionProcessingJob.update({where: {id}, data: {status: "COMPLETE", leaseToken: null, leaseExpiresAt: null, output: {
      ...output("NO_MATCH", []), proposals: {...output("NO_MATCH", []).proposals, totalProposals: -1}}}});
    assert(!(await flags()).includes("no-match"), "malformed result cannot become a no-match signal");
    await db.acquisitionProcessingJob.update({where: {id}, data: {output: output("REVIEW_REQUIRED", [proposal], "NEEDS_CROP")}});
    assert((await flags()).includes("quality"));
    const other = await db.acquisitionCandidate.findFirstOrThrow({where: {runId: photo.runId, id: {not: candidate.id}}});
    await db.acquisitionProcessingJob.update({where: {id}, data: {candidateId: other.id}});
    assert(!(await flags()).includes("quality"), "another physical candidate cannot supply this photo's problem");
    await db.acquisitionProcessingJob.update({where: {id}, data: {candidateId: candidate.id}});
    // Wrong immutable input and a newer physical generation cannot supply flags.
    await db.acquisitionProcessingJob.update({where: {id}, data: {input: {...input, digest: "0".repeat(64)}}});
    assert(!(await flags()).includes("quality"));
    await db.acquisitionProcessingJob.update({where: {id}, data: {input}});
    await db.acquisitionCaptureSlot.update({where: {id: slot.id}, data: {generation: slot.generation + 1}});
    assert(!(await flags()).includes("quality"));
    await db.acquisitionCaptureSlot.update({where: {id: slot.id}, data: {generation: slot.generation}});
    const manualAnalysis = {version: 1 as const, requestKey: randomUUID(), photoId, digest: photo.digest,
      generation: photo.generation, candidateRevision: candidate.revision, region: null};
    await db.acquisitionCandidate.update({where: {id: candidate.id}, data: {manualAnalysis}});
    assert(!(await flags()).includes("quality"), "old automatic evidence is not current repair evidence");
    await db.acquisitionProcessingJob.update({where: {id}, data: {input: {...input, manualAnalysis}}});
    assert((await flags()).includes("quality"));
    const projected = await db.$transaction(tx => readAcquisitionProblemJobs(tx, photo.runId, [{id: photoId, manualAnalysis}]));
    assert(!JSON.stringify([...projected]).includes(secret.slice(0, 100)));
    assert(Buffer.byteLength(JSON.stringify([...projected])) < Buffer.byteLength(secret) / 2, "projection omits large native observation");
    await assert.rejects(getAcquisitionProgress(db, stranger, sessionId), /unavailable/);
    assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({where: {id: photoId}}), photo);
    console.log("PASS: actual progress problem classification, compact private projection, malformed/pending/enabled-stage refusal, current physical candidate/photo/digest/manual-intent fencing and foreign-owner denial");
  } catch (error) { failed = true; primary = error; }
  try { await db.acquisitionProcessingJob.deleteMany({where: {id, runId: photo.runId}}); } catch (error) { errors.push(error); }
  try { await db.acquisitionCandidate.update({where: {id: candidate.id}, data: {manualAnalysis: Prisma.DbNull}}); } catch (error) { errors.push(error); }
  try { await db.acquisitionCaptureSlot.update({where: {id: slot.id}, data: {generation: slot.generation}}); } catch (error) { errors.push(error); }
  try {
    const after = await fingerprints(db);
    console.log(JSON.stringify({event: "review-problems-conservation", before: baseline, after}));
    assert.deepEqual(after, baseline, "classification fixture restores all original public rows");
    console.log(`PASS: review problem fixture restored all ${Object.keys(after).length} public-table fingerprints`);
  } catch (error) { errors.push(error); }
  for (const [name, value] of Object.entries(enabledBefore)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  if (failed || errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], "Review problem qualification failed");
}
