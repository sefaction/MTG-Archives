import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { scannerCropCleanupSource } from "./ci/scanner-crop-cleanup-source";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";
import { createAcquisitionSession, executeAcquisitionCommand, reserveAcquisitionCaptureSlot, beginAcquisitionPhoto, finalizeAcquisitionPhoto } from "../lib/acquisition-store";
import { inspectAcquisitionPhoto, writeAcquisitionPhotoBytes, canonicalizeAcquisitionPhoto } from "../lib/acquisition-files";

// Only the existing disposable acquisition_* runner invokes this verification.
// Generated photos qualify teardown, not the unchanged optical browser workflow.
export async function verifyScannerCropCleanup(db: PrismaClient) {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/acquisition_"));
  const source = scannerCropCleanupSource();
  async function snapshot() {
    const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const result: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      const [row] = await db.$queryRawUnsafe<object[]>(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${tablename.replaceAll('"', '""')}" t`);
      result[tablename] = row;
    }
    return result;
  }
  const before = await snapshot();
  const parent = await mkdtemp(path.join(os.tmpdir(), "mtg-crop-cleanup-")), uploads = path.join(parent, "uploads");
  const priorUploads = process.env.UPLOADS_DATA_PATH;
  process.env.UPLOADS_DATA_PATH = uploads;
  const owner = `ui-scanner-${randomUUID()}`, peer = `ui-scanner-${randomUUID()}`;
  function database(sql: string) {
    return execFileSync(process.execPath, ["-e", "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{" + sql + "})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());"], { encoding: "utf8", timeout: 30000, windowsHide: true });
  }
  const cleanup = source.cleanup(database);
  async function files() {
    const result: Record<string, string> = {};
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        assert.equal(entry.isSymbolicLink(), false);
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else result[path.relative(uploads, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
      }
    }
    await walk(uploads); return result;
  }
  async function seed(tag: string) {
    await db.player.create({ data: { id: tag, name: tag, displayName: tag } });
    await db.user.create({ data: { id: tag, username: tag, displayName: tag, playerId: tag, passwordHash: "fixture-only" } });
    await db.inventoryLocation.create({ data: { id: tag, name: tag, normalizedName: tag, ownerPlayerId: tag, type: "BOX" } });
    await db.$transaction(tx => ensureCorrectionAccount(tx, tag));
    await db.correctionLibraryAccount.update({ where: { ownerPlayerId: tag }, data: { sampleBasisPoints: 0 } });
    const capture = await createAcquisitionSession(db, { userId: tag, adminMode: false }, { requestKey: randomUUID(), ownerPlayerId: tag, locationId: tag, section: "", policy: { kind: "MANUAL", quantity: 1 }, run: { providerId: "phone-photo-v1", runId: randomUUID(), enforcement: "LOGICAL_ALLOCATION", controls: ["STOP", "CANCEL"] } });
    const actor = { userId: tag, adminMode: false }, id = capture.session.id;
    await executeAcquisitionCommand(db, actor, id, { requestKey: "start", revision: 0, command: "START" });
    const { slot } = await reserveAcquisitionCaptureSlot(db, actor, id, "one");
    const bytes = await sharp({ create: { width: 75, height: 105, channels: 3, background: "#778899" } }).png().toBuffer();
    const photo = await beginAcquisitionPhoto(db, actor, id, { slotId: slot.id, uploadKey: randomUUID(), generation: 0, metadata: await inspectAcquisitionPhoto(bytes, "image/png") });
    await writeAcquisitionPhotoBytes(photo.id, bytes, "raw", photo.digest);
    await finalizeAcquisitionPhoto(db, actor, id, photo.id);
    await canonicalizeAcquisitionPhoto(photo.id, photo.digest, new AbortController().signal);
    const privateDir = path.join(uploads, "correction-library-v1", createHash("sha256").update(tag).digest("hex"));
    await mkdir(privateDir, { recursive: true }); await writeFile(path.join(privateDir, "fixture-marker"), tag);
  }
  let primaryFailed = false; let primaryError: unknown;
  try {
    await mkdir(uploads);
    await seed(peer);
    const peerBaseline = await snapshot(), peerFiles = await files();
    await seed(owner);
    const primary = Error("controlled optical workflow failure"), early = Error("controlled first feedback sweep failure");
    let calls = 0;
    const failFirst = source.cleanup(sql => { if (++calls === 1) throw early; return database(sql); });
    assert.throws(() => failFirst(owner, true, primary), (error: unknown) => error instanceof AggregateError && assert.deepEqual(error.errors, [primary, early]) === undefined);
    assert.equal(calls, 3);
    assert.deepEqual(await snapshot(), peerBaseline, "Every full-row public table including populated peer is exact after owned cleanup");
    assert.deepEqual(await files(), peerFiles, "All peer originals, previews and private marker bytes remain exact");
    cleanup(owner); // Real missing-file/row replay is effect-free.
    assert.deepEqual(await snapshot(), peerBaseline); assert.deepEqual(await files(), peerFiles);
    console.log("PASS actual crop cleanup: first feedback SQL refusal still attempts real legacy and final sweep, retains workflow/cleanup causes, clears generated photo/private rows and bytes, and preserves populated peer on retry/replay");
  } catch (error) { primaryFailed = true; primaryError = error; throw error; }
  finally {
    const errors: unknown[] = [];
    for (const tag of [owner, peer]) try { cleanup(tag); } catch (error) { errors.push(error); }
    try { const after = await snapshot(); console.log(JSON.stringify({ event: "scanner-crop-cleanup-conservation", before, after })); assert.deepEqual(after, before); assert.deepEqual(await files(), {}); } catch (error) { errors.push(error); }
    if (priorUploads === undefined) delete process.env.UPLOADS_DATA_PATH; else process.env.UPLOADS_DATA_PATH = priorUploads;
    // Preserve the generated recovery directory on any uncertain cleanup.
    try { assert.equal(errors.length, 0, "Retain private fixture files after uncertain cleanup"); assert.equal(path.dirname(parent), os.tmpdir()); assert.ok(path.basename(parent).startsWith("mtg-crop-cleanup-")); await rm(parent, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(primaryFailed ? [primaryError, ...errors] : errors, "Scanner crop qualification cleanup incomplete");
  }
}
