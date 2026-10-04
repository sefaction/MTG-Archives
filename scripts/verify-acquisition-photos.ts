import assert from "node:assert/strict";
import { verifyAcquisitionReview } from "./verify-acquisition-review";
import { verifyAcquisitionCatalogReconciliation } from "./verify-acquisition-catalog-reconciliation";
import {verifyAcquisitionPhotoIsolation} from "./verify-acquisition-photo-isolation";
import {verifyAcquisitionPhotoLocking} from "./verify-acquisition-photo-locking";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  beginAcquisitionPhoto,
  finalizeAcquisitionPhoto,
  getAcquisitionPhoto,
  createAcquisitionSession,
  executeAcquisitionCommand,
  reserveAcquisitionCaptureSlot,
  getAcquisitionProgress,
  type AcquisitionActor,
  type CreateAcquisitionInput,
} from "../lib/acquisition-store";
import {
  inspectAcquisitionPhoto,
  writeAcquisitionPhotoBytes,
  readAcquisitionPhotoBytes,
  canonicalizeAcquisitionPhoto,
} from "../lib/acquisition-files";
import {
  runAcquisitionJobsOnce,
  claimAcquisitionJobs,
  completeAcquisitionJob,
} from "../lib/acquisition-jobs";
import {
  enqueueReadyRecognition,
  loadAcquisitionRecognitionSnapshot,
  RECOGNITION_STAGE,
  acquisitionRecognitionVersion,
} from "../lib/acquisition-recognition-worker";
export async function verifyAcquisitionPhotos(
  db: PrismaClient,
  actor: AcquisitionActor,
  stranger: AcquisitionActor,
  base: CreateAcquisitionInput,
) {
  const parent = path.resolve(".local-data");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "acq-photo-db-")),
    old = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  try {
    const capture = await createAcquisitionSession(db, actor, {
      ...base,
      requestKey: randomUUID(),
      policy: { kind: "MANUAL", quantity: 2 },
      run: { ...base.run, providerId: "phone-photo-v1" },
    });
    const id = capture.session.id;
    await executeAcquisitionCommand(db, actor, id, {
      requestKey: "start",
      revision: 0,
      command: "START",
    });
    const first = (await reserveAcquisitionCaptureSlot(db, actor, id, "one"))
      .slot;
    const second = (await reserveAcquisitionCaptureSlot(db, actor, id, "two"))
      .slot;
    const bytes = await sharp({
      create: { width: 100, height: 140, channels: 3, background: "#778899" },
    })
      .jpeg()
      .toBuffer();
    const metadata = await inspectAcquisitionPhoto(bytes, "image/jpeg");
    const input = {
      slotId: first.id,
      uploadKey: randomUUID(),
      generation: 0,
      metadata,
      inputKind: "CARD_SCAN" as const,
    };
    const attempts = await Promise.all(
      [1, 2].map(() => beginAcquisitionPhoto(db, actor, id, input)),
    );
    assert.equal(attempts[0].id, attempts[1].id);
    assert.equal(attempts[0].inputKind, "CARD_SCAN");
    await assert.rejects(beginAcquisitionPhoto(db, actor, id, {...input,inputKind:"PHOTO"}),/identity conflict/);
    await assert.rejects(
      beginAcquisitionPhoto(db, actor, id, {
        ...input,
        metadata: { ...metadata, digest: "0".repeat(64) },
      }),
      /identity conflict/,
    );
    const photo = attempts[0];
    await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
    const fault = db.$extends({
      query: {
        acquisitionPhoto: {
          async update() {
            throw new Error("injected finalize failure");
          },
        },
      },
    }) as unknown as PrismaClient;
    await assert.rejects(
      finalizeAcquisitionPhoto(fault, actor, id, photo.id),
      /injected/,
    );
    assert.equal(
      (await getAcquisitionProgress(db, actor, id)).session.candidates.length,
      0,
    );
    assert.deepEqual(
      await readAcquisitionPhotoBytes(photo.id, "raw", photo.digest),
      bytes,
    );
    await finalizeAcquisitionPhoto(db, actor, id, photo.id);
    await finalizeAcquisitionPhoto(db, actor, id, photo.id);
    const scanJob=await db.acquisitionProcessingJob.findFirstOrThrow({where:{artifact:{sourceId:photo.id},stage:"photo-canonical-v1"}});
    assert.equal((scanJob.input as {inputKind:string}).inputKind,"CARD_SCAN");
    assert.equal(
      (await getAcquisitionProgress(db, actor, id)).photoPreparation.length,
      1,
    );
    await assert.rejects(
      getAcquisitionPhoto(db, stranger, id, photo.id),
      /unavailable/,
    );
    const another = await beginAcquisitionPhoto(db, actor, id, {
      ...input,
      slotId: second.id,
      uploadKey: randomUUID(),
    });
    await writeAcquisitionPhotoBytes(another.id, bytes, "raw", another.digest);
    await finalizeAcquisitionPhoto(db, actor, id, another.id);
    assert.equal(
      (await getAcquisitionProgress(db, actor, id)).session.candidates.length,
      2,
    );
    const handlers = {
      "photo-canonical-v1": async (job: any, signal: AbortSignal) =>
        canonicalizeAcquisitionPhoto(
          job.input.photoId,
          job.input.digest,
          signal,
        ),
    };
    await db.acquisitionProcessingJob.updateMany({
      where: { runId: photo.runId },
      data: { availableAt: new Date(0) },
    });
    for (let n = 0; n < 2; n++)
      assert.equal(
        (await runAcquisitionJobsOnce(db, handlers, "photo-fixture")).complete,
        1,
      );
    const catalog = await loadAcquisitionRecognitionSnapshot(db);
    assert.equal(
      (await loadAcquisitionRecognitionSnapshot(db)).digest,
      catalog.digest,
    );
    const model = "a".repeat(64);
    assert.equal(
      acquisitionRecognitionVersion(catalog.digest, model),
      acquisitionRecognitionVersion("c".repeat(64), model),
      "catalog refresh must not enqueue duplicate raw OCR",
    );
    const enqueued = await Promise.all([
      enqueueReadyRecognition(db, catalog.digest, model),
      enqueueReadyRecognition(db, catalog.digest, model),
    ]);
    assert.equal(
      enqueued.reduce((a, b) => a + b, 0),
      2,
    );
    assert.equal(await enqueueReadyRecognition(db, catalog.digest, model), 0);
    const claims = await claimAcquisitionJobs(db, {
      workerId: "recognition-fixture",
      stages: [RECOGNITION_STAGE],
      limit: 2,
    });
    assert.equal(claims.length, 2);
    const staleRecognition = claims.find(
      (j) => (j.input as any).photoId === photo.id,
    )!;
    const retake = await beginAcquisitionPhoto(db, actor, id, {
      ...input,
      generation: 1,
      uploadKey: randomUUID(),
    });
    const replaced = await beginAcquisitionPhoto(db, actor, id, {
      ...input,
      generation: 2,
      uploadKey: randomUUID(),
      replacePending: true,
    });
    await writeAcquisitionPhotoBytes(
      replaced.id,
      bytes,
      "raw",
      replaced.digest,
    );
    await assert.rejects(
      finalizeAcquisitionPhoto(db, actor, id, retake.id),
      /generation changed/,
    );
    const state = await getAcquisitionProgress(db, actor, id);
    await executeAcquisitionCommand(db, actor, id, {
      requestKey: "stop",
      revision: state.revision,
      command: "STOP",
    });
    await finalizeAcquisitionPhoto(db, actor, id, replaced.id);
    assert.equal(
      await completeAcquisitionJob(db, staleRecognition, {
        mockedNativeEvidence: true,
      }),
      "SUPERSEDED",
    );
    assert.equal(
      (await runAcquisitionJobsOnce(db, handlers, "retake-preparation"))
        .complete,
      1,
    );
    assert.equal(
      await enqueueReadyRecognition(db, catalog.digest, model),
      1,
      "retake creates recognition for its new artifact despite an older attempt",
    );
    assert.equal(await enqueueReadyRecognition(db, catalog.digest, model), 0);
    const final = await getAcquisitionProgress(db, actor, id);
    await verifyAcquisitionReview(
      db,
      actor,
      stranger,
      id,
      replaced.id,
      catalog.digest,
      model,
    );
    assert.equal(final.session.phase, "STOPPING");
    await verifyAcquisitionCatalogReconciliation(
      db,
      actor,
      id,
      another.id,
      claims.find(
        (j) => (j.input as { photoId: string }).photoId === another.id,
      )!,
    );
    assert.equal(final.reservedSlots, 2);
    assert.equal(final.session.candidates.length, 2);
    assert.equal(final.slots[0].generation, 3);
    assert.equal(
      (await getAcquisitionPhoto(db, actor, id, photo.id)).purgeAfter,
      null,
    );
    await verifyAcquisitionPhotoIsolation(db,actor,stranger,base,bytes);
    await verifyAcquisitionPhotoLocking(db,actor,base,bytes);
    console.log(
      "PASS: private bytes + transactional finalize recovery, duplicate bytes/separate cards, immediate worker, retake fencing and stop drain",
    );
  } finally {
    if (old === undefined) delete process.env.UPLOADS_DATA_PATH;
    else process.env.UPLOADS_DATA_PATH = old;
    if (
      !root.startsWith(parent + path.sep) ||
      !path.basename(root).startsWith("acq-photo-db-")
    )
      throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
}
