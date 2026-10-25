import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot,
  beginAcquisitionPhoto, finalizeAcquisitionPhoto, getAcquisitionPhoto,
  getAcquisitionProgress, type AcquisitionActor, type CreateAcquisitionInput } from "../lib/acquisition-store";
import { photoDigest, readAcquisitionPhotoBytes, inspectAcquisitionPhoto,
  writeAcquisitionPhotoBytes, canonicalizeAcquisitionPhoto } from "../lib/acquisition-files";
import { manageAcquisitionBatch } from "../lib/acquisition-batch-lifecycle";

// Existing disposable acquisition runner owns the database fixture. Only auth
// and the selected filesystem failure are adapted; route/store/SQL remain real.
function loadActual(relative: string, replace: (name: string) => unknown) {
  const filename = path.resolve(relative), realRequire = createRequire(filename);
  const loaded = new (Module as any)(filename);
  loaded.filename = filename;
  loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  loaded.require = (name: string) => replace(name) ?? realRequire(name);
  loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

export async function verifyAcquisitionStorageBoundaries(db: PrismaClient, actor: AcquisitionActor, base: CreateAcquisitionInput) {
  const parent = path.resolve(".local-data");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "acq-storage-boundaries-"));
  const prior = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = root;
  const bytes = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#345678" } }).png().toBuffer();
  const inventoryBefore = await db.inventoryItem.findMany({ where: { currentOwnerId: base.ownerPlayerId }, orderBy: { id: "asc" } });
  try {
    for (const boundary of ["free-space", "partial-write", "publication", "directory-sync"] as const) {
      let injected = 0;
      let directoryFailureEnabled = true;
      const fault = () => { injected++; return Object.assign(new Error("owned filesystem fault; never expose this detail"),
        { code: boundary === "partial-write" ? "ENOSPC" : "EIO" }); };
      const directory = path.join(root, "acquisition-v1");
      const adaptedFs = {
        ...fs,
        statfs: async (...args: Parameters<typeof fs.statfs>) => {
          const disk = await fs.statfs(...args);
          if (boundary === "free-space" && !injected) { injected++; return { ...disk, bavail: 0 }; }
          return disk;
        },
        link: async (...args: Parameters<typeof fs.link>) => {
          if (boundary === "publication" && !injected) throw fault();
          return fs.link(...args);
        },
        open: async (...args: Parameters<typeof fs.open>) => {
          const handle = await fs.open(...args);
          return new Proxy(handle, { get(target, key) {
            if (key === "writeFile" && String(args[0]).endsWith(".part")) return async (data: Uint8Array) => {
              if (boundary === "partial-write" && !injected) {
                await target.writeFile(data.subarray(0, Math.max(1, Math.floor(data.length / 2))));
                throw fault();
              }
              return target.writeFile(data);
            };
            if (key === "sync" && String(args[0]) === directory) return async () => {
              if (boundary === "directory-sync" && directoryFailureEnabled) throw fault();
              return target.sync();
            };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          } });
        },
      };
      const files = loadActual("lib/acquisition-files.ts", name => name === "node:fs/promises" ? adaptedFs : undefined);
      const api = loadActual("lib/acquisition-api.ts", name => name === "./auth" ? {
        getCurrentUser: () => { throw new Error("fixture must use explicit actor"); },
        isAdminModeEnabled: () => false,
      } : undefined);
      const route = loadActual("app/api/acquisition/[sessionId]/photos/route.ts", name => {
        if (name === "@/lib/prisma") return { prisma: db };
        if (name === "@/lib/acquisition-api") return { ...api, acquisitionActor: async () => actor };
        if (name === "@/lib/acquisition-files") return files;
        if (name.startsWith("@/")) return createRequire(path.resolve("package.json"))(path.resolve(name.slice(2)));
      });
      const capture = await createAcquisitionSession(db, actor, { ...base, requestKey: randomUUID(),
        policy: { kind: "MANUAL", quantity: 1 }, run: { ...base.run, providerId: "phone-photo-v1" } });
      const sessionId = capture.session.id;
      await executeAcquisitionCommand(db, actor, sessionId, { requestKey: "start", revision: 0, command: "START" });
      const { slot } = await reserveAcquisitionCaptureSlot(db, actor, sessionId, "one");
      const key = randomUUID();
      const post = () => route.POST(new Request(`http://localhost/api/acquisition/${sessionId}/photos?slot=${slot.id}&key=${key}&generation=0`,
        { method: "POST", headers: { "content-type": "image/png" }, body: bytes }), { params: Promise.resolve({ sessionId }) });
      const failed = await post();
      assert.equal(failed.status, 409);
      const failure = await failed.json();
      assert.equal(failure.ready, undefined);
      assert.equal(failure.retryable, undefined);
      assert.doesNotMatch(JSON.stringify(failure), /owned filesystem fault|ENOSPC|EIO/);
      assert.equal(injected, 1, `${boundary} must actually fire`);
      const own = { run: { sessionId } };
      const [pending] = await db.acquisitionPhoto.findMany({ where: own });
      assert.ok(pending);
      assert.equal(await db.acquisitionPhoto.count({ where: own }), 1);
      assert.equal(pending.ready, false);
      assert.equal(pending.readyAt, null);
      assert.equal(await db.acquisitionArtifact.count({ where: own }), 0);
      assert.equal(await db.acquisitionCandidate.count({ where: own }), 0);
      assert.equal(await db.acquisitionProcessingJob.count({ where: own }), 0);
      const names = await fs.readdir(directory);
      assert.equal(names.some(name => name.startsWith(pending.id) && name.endsWith(".part")), false);
      if (boundary === "directory-sync") assert.deepEqual(await readAcquisitionPhotoBytes(pending.id, "raw", photoDigest(bytes)), bytes);
      else await assert.rejects(fs.lstat(path.join(directory, `${pending.id}.original`)), { code: "ENOENT" });
      if (boundary === "directory-sync") {
        const repeated = await post();
        assert.equal(repeated.status, 409, "Existing complete bytes cannot bypass persistent directory failure");
        assert.deepEqual(await repeated.json(), failure);
        assert.equal(injected, 2, "Same-identity retry must actually retry directory sync");
        assert.deepEqual(await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: pending.id } }), pending);
        assert.equal(await db.acquisitionPhoto.count({ where: own }), 1);
        for (const model of [db.acquisitionArtifact, db.acquisitionCandidate, db.acquisitionProcessingJob])
          assert.equal(await (model as any).count({ where: own }), 0);
        assert.deepEqual(await readAcquisitionPhotoBytes(pending.id, "raw", photoDigest(bytes)), bytes);
        assert.equal((await fs.readdir(directory)).some(name => name.startsWith(pending.id) && name.endsWith(".part")), false);
        directoryFailureEnabled = false;
      }
      const recovered = await post();
      assert.equal(recovered.status, 200);
      const ack = await recovered.json();
      assert.deepEqual(ack, { id: pending.id, digest: photoDigest(bytes), ready: true });
      const ready = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: pending.id } });
      assert.equal(ready.uploadKey, key);
      assert.equal(ready.slotId, slot.id);
      assert.equal(ready.ready, true);
      assert.equal(await db.acquisitionPhoto.count({ where: own }), 1);
      for (const model of [db.acquisitionArtifact, db.acquisitionCandidate, db.acquisitionProcessingJob]) {
        assert.equal(await (model as any).count({ where: own }), 1);
      }
      assert.deepEqual(await readAcquisitionPhotoBytes(ack.id, "raw", ack.digest), bytes);
      assert.deepEqual(await (await post()).json(), ack);
      assert.equal(injected, boundary === "directory-sync" ? 2 : 1);
      assert.equal(await db.acquisitionProcessingJob.count({ where: own }), 1);
      console.log(`PASS: actual upload ${boundary} failure leaves non-READY state and no partial file; same-identity retry/ACK replay saves one photo/candidate/job`);
      if (boundary === "directory-sync") console.log("PASS: persistent directory failure refuses the same upload twice with unchanged pending row; successful sync then creates one photo/candidate/job and effect-free ACK replay");
      const progress = await getAcquisitionProgress(db, actor, sessionId);
      await executeAcquisitionCommand(db, actor, sessionId, { requestKey: "fixture-finished", revision: progress.revision, command: "CANCEL" });
    }
    // Existing controls cover database marking failure after both unlinks. This
    // adds an actual partial unlink: original gone, preview still present.
    async function prepared() {
      const capture = await createAcquisitionSession(db, actor, { ...base, requestKey: randomUUID(),
        policy: { kind: "MANUAL", quantity: 1 }, run: { ...base.run, providerId: "phone-photo-v1" } });
      const sessionId = capture.session.id;
      await executeAcquisitionCommand(db, actor, sessionId, { requestKey: "start", revision: 0, command: "START" });
      const { slot } = await reserveAcquisitionCaptureSlot(db, actor, sessionId, "one");
      const photo = await beginAcquisitionPhoto(db, actor, sessionId, { slotId: slot.id, uploadKey: randomUUID(),
        generation: 0, metadata: await inspectAcquisitionPhoto(bytes, "image/png") });
      await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
      await finalizeAcquisitionPhoto(db, actor, sessionId, photo.id);
      const preview = await canonicalizeAcquisitionPhoto(photo.id, photo.digest, new AbortController().signal);
      return { sessionId, photo, preview };
    }
    const expired = await prepared(), active = await prepared();
    const activePreview = await readAcquisitionPhotoBytes(active.photo.id, "preview", active.preview.previewDigest);
    const expiredPreview = await readAcquisitionPhotoBytes(expired.photo.id, "preview", expired.preview.previewDigest);
    const now = new Date();
    await manageAcquisitionBatch(db, actor, expired.sessionId, "trash", new Date(now.getTime() - 8 * 86400000));
    assert.equal(await db.correctionRetentionPin.count({ where: { sessionId: expired.sessionId, releasedAt: null } }), 0);
    const evidence = () => Promise.all([
      db.acquisitionArtifact.findMany({ where: { runId: expired.photo.runId }, orderBy: { id: "asc" } }),
      db.acquisitionCandidate.findMany({ where: { runId: expired.photo.runId }, orderBy: { id: "asc" } }),
      db.acquisitionProcessingJob.findMany({ where: { runId: expired.photo.runId }, orderBy: { id: "asc" } }),
      db.acquisitionCommit.findMany({ where: { runId: expired.photo.runId }, orderBy: { id: "asc" } }),
    ]);
    const immutable = await evidence();
    let failedUnlinks = 0, successfulPreviewUnlinks = 0;
    const files = loadActual("lib/acquisition-files.ts", name => name === "node:fs/promises" ? { ...fs,
      unlink: async (file: Parameters<typeof fs.unlink>[0]) => {
        if (String(file) === path.join(root, "acquisition-v1", `${expired.photo.id}.preview.jpg`)) {
          if (!failedUnlinks) { failedUnlinks++; throw Object.assign(new Error("owned preview unlink fault"), { code: "EACCES" }); }
          await fs.unlink(file); successfulPreviewUnlinks++; return;
        }
        return fs.unlink(file);
      },
    } : undefined);
    const retention = loadActual("lib/acquisition-photo-retention.ts", name => name === "./acquisition-files" ? files : undefined);
    const interrupted = await retention.purgeTrashedAcquisitionPhotos(db, now);
    assert.equal(interrupted.failed, 1);
    assert.equal(failedUnlinks, 1);
    assert.equal(successfulPreviewUnlinks, 0);
    assert.equal((await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: expired.photo.id } })).purgedAt, null);
    assert.ok((await db.acquisitionSession.findUniqueOrThrow({ where: { id: expired.sessionId } })).deletedAt);
    await assert.rejects(readAcquisitionPhotoBytes(expired.photo.id, "raw"), { code: "ENOENT" });
    assert.deepEqual(await readAcquisitionPhotoBytes(expired.photo.id, "preview", expired.preview.previewDigest), expiredPreview);
    await assert.rejects(getAcquisitionPhoto(db, actor, expired.sessionId, expired.photo.id));
    await assert.rejects(manageAcquisitionBatch(db, actor, expired.sessionId, "restore", now), /expired/);
    assert.deepEqual(await evidence(), immutable);
    const retried = await retention.purgeTrashedAcquisitionPhotos(db, now);
    assert.equal(retried.failed, 0);
    assert.ok(retried.purged >= 1);
    assert.equal(successfulPreviewUnlinks, 1);
    const purged = await db.acquisitionPhoto.findUniqueOrThrow({ where: { id: expired.photo.id } });
    assert.deepEqual(purged.purgedAt, now);
    await assert.rejects(readAcquisitionPhotoBytes(expired.photo.id, "preview"), { code: "ENOENT" });
    await retention.purgeTrashedAcquisitionPhotos(db, now);
    assert.equal(successfulPreviewUnlinks, 1);
    assert.deepEqual(await evidence(), immutable);
    assert.deepEqual(await readAcquisitionPhotoBytes(active.photo.id, "raw", active.photo.digest), bytes);
    assert.deepEqual(await readAcquisitionPhotoBytes(active.photo.id, "preview", active.preview.previewDigest), activePreview);
    assert.equal((await getAcquisitionPhoto(db, actor, active.sessionId, active.photo.id)).purgedAt, null);
    await manageAcquisitionBatch(db, actor, active.sessionId, "cancel");
    console.log("PASS: real original-unlinked/preview-retained purge failure preserves expiry and canonical evidence; retry/replay removes only expired bytes, active equal-byte neighbor and Inventory conserved");
    assert.deepEqual(await db.inventoryItem.findMany({ where: { currentOwnerId: base.ownerPlayerId }, orderBy: { id: "asc" } }), inventoryBefore);
  } finally {
    if (prior === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = prior;
    if (path.dirname(root) !== parent || !path.basename(root).startsWith("acq-storage-boundaries-")) throw new Error("Unsafe storage fixture cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
}
