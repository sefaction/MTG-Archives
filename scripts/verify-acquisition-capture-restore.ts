import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { createBackup, restoreBackup } from "../lib/backup";
import { createStoredSession, resolveStoredSession } from "../lib/auth-sessions";
import { createAcquisitionSession, executeAcquisitionCommand, getAcquisitionProgress,
  reserveAcquisitionCaptureSlot, getAcquisitionCardReview, saveAcquisitionReview } from "../lib/acquisition-store";
import { previewAcquisitionCommit, commitAcquisitionCards } from "../lib/acquisition-commit-service";
import { ensureCorrectionAccount } from "../lib/acquisition-correction-library";

// The parent runner owns BOTH disposable databases. Never run against a saved
// review installation, or redirect the restore to the capture source.
const sourceURL = new URL(process.env.DATABASE_URL || "http://invalid");
const targetURL = new URL(process.env.CAPTURE_RESTORE_DATABASE_URL || "http://invalid");
assert.equal(process.env.MTG_CAPTURE_RESTORE_FIXTURE, "1");
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
assert.ok(["127.0.0.1", "localhost", "postgres"].includes(sourceURL.hostname));
assert.equal(sourceURL.pathname, "/acquisition_capture_source305");
assert.equal(targetURL.pathname, "/acquisition_capture_restore305");
for (const field of ["protocol", "hostname", "port", "username", "password"] as const)
  assert.ok(sourceURL[field] === targetURL[field], `Fixture ${field} must match`);
for (const url of [sourceURL, targetURL]) assert.ok(!url.searchParams.get("schema") || url.searchParams.get("schema") === "public");

const source = new PrismaClient({ datasources: { db: { url: sourceURL.href } } });
const target = new PrismaClient({ datasources: { db: { url: targetURL.href } } });
type Rows = Record<string, Record<string, any>[]>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash("sha256").update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");

async function snapshot(db: PrismaClient): Promise<Rows> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Rows = {};
  for (const { tablename } of tables) {
    const name = '"' + tablename.replaceAll('"', '""') + '"';
    const rows = await db.$queryRawUnsafe<{ row: Record<string, any> }[]>(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`);
    result[tablename] = rows.map(({ row }) => row);
  }
  return result;
}
function equalTables(actual: Rows, expected: Rows) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected), "Every public table must remain accounted for");
  for (const name of Object.keys(expected)) assert.equal(hash(actual[name]), hash(expected[name]), `${name}: every row and field must be conserved`);
}
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(relative: string) {
    const filename = path.join(root, relative), info = await lstat(filename);
    assert.ok(!info.isSymbolicLink(), "Fixture file tree must not contain symlinks");
    if (info.isDirectory()) for (const name of (await readdir(filename)).sort()) await visit(path.join(relative, name));
    else { assert.ok(info.isFile()); result[relative] = hash(await readFile(filename)); }
  }
  await visit(""); return result;
}
async function roots(root: string) {
  for (const [env, folder] of [["UPLOADS_DATA_PATH", "uploads"], ["IMPORTS_DATA_PATH", "imports"],
    ["EXPORTS_DATA_PATH", "exports"], ["SCRYFALL_CONTAINER_DATA_PATH", "scryfall"]]) {
    process.env[env] = path.join(root, folder); await mkdir(process.env[env]!, { recursive: true });
  }
}

// Execute the real routes/API/auth-session policy. Only Next's ambient cookie
// provider is adapted to the fixture's real stored credential; origin, actor,
// owner, upload, SQL and filesystem decisions are not replaced.
function actual(relative: string, replace: (name: string) => unknown): any {
  const filename = path.resolve(relative), realRequire = createRequire(filename), loaded = new (Module as any)(filename);
  loaded.filename = filename; loaded.paths = (Module as any)._nodeModulePaths(path.dirname(filename));
  loaded.require = (name: string) => replace(name) ?? realRequire(name.startsWith("@/") ? path.resolve(name.slice(2)) : name);
  loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}
function routes(db: PrismaClient, token: () => string) {
  const api = actual("lib/acquisition-api.ts", name => name === "./auth" ? {
    getCurrentUser: () => resolveStoredSession(db, token()), isAdminModeEnabled: async () => false,
  } : undefined);
  const replace = (name: string) => name === "@/lib/prisma" ? { prisma: db } : name === "@/lib/acquisition-api" ? api : undefined;
  return { upload: actual("app/api/acquisition/[sessionId]/photos/route.ts", replace),
    photo: actual("app/api/acquisition/[sessionId]/photos/[photoId]/route.ts", replace) };
}
function request(sessionId: string, slot: string, key: string, bytes: Buffer, mediaType: string) {
  return new Request(`http://fixture.local/api/acquisition/${sessionId}/photos?slot=${slot}&key=${key}&generation=0`, {
    method: "POST", headers: { "content-type": mediaType, origin: "http://fixture.local", host: "fixture.local" }, body: new Uint8Array(bytes),
  });
}

async function run() {
  const started = Date.now();
  const initial = await snapshot(source);
  assert.ok(Object.keys(initial).length > 70, "Source must have the actual migrated application schema");
  assert.deepEqual(initial.LocationType.map(row => row.name).sort(), ["Binder", "Box", "Bulk", "Case", "Deckbox", "Other", "Shelf", "Unassigned"], "Only the actual migration's eight location-type seeds are allowed");
  for (const [name, rows] of Object.entries(initial)) if (!["_prisma_migrations", "LocationType"].includes(name)) assert.equal(rows.length, 0, "Source fixture must be empty: " + name);
  assert.deepEqual(await snapshot(target), {}, "Restore target must be a separate empty database");
  const root = await mkdtemp(path.join(process.env.TMPDIR || "/tmp", "mtg-capture-restore-"));
  const sourceRoot = path.join(root, "source"), targetRoot = path.join(root, "restored");
  process.env.BACKUP_DIR = path.join(root, "backups");
  process.env.BACKUP_RETENTION_COUNT = "0"; process.env.BACKUP_RETENTION_DAYS = "0";
  delete process.env.BACKUP_APPDATA_PATHS;
  await roots(sourceRoot);
  await writeFile(path.join(sourceRoot, "imports", "existing-upload.txt"), "Unrelated imported file survives restore\n");
  const tag = "capture-restore-" + randomUUID(), people = [];
  for (let index = 0; index < 2; index++) {
    const player = await source.player.create({ data: { name: tag + index, displayName: "Synthetic capture owner " + index } });
    const user = await source.user.create({ data: { username: tag + index, displayName: "Synthetic capture owner " + index,
      passwordHash: "fixture-credential-" + randomUUID(), playerId: player.id } });
    people.push({ player, user });
  }
  const owner = people[0], actor = { userId: owner.user.id, adminMode: false };
  await source.$transaction(async tx => {
    await ensureCorrectionAccount(tx, owner.player.id);
    await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: owner.player.id }, data: { sampleBasisPoints: 0 } });
  });
  const destination = await source.inventoryLocation.create({ data: { ownerPlayerId: owner.player.id,
    name: "Capture restore destination", normalizedName: tag, storageLayout: { capacity: 10, sections: [{ name: "A", capacity: 10 }] } } });
  const card = await source.card.create({ data: { scryfallId: randomUUID(), name: "Capture restore printing", setCode: "tst",
    collectorNumber: "1", typeLine: "Artifact", rarity: "common", lang: "en", digital: false, finishes: ["nonfoil"] } });
  const oldToken = await createStoredSession(source, owner.user);
  const sourceRoutes = routes(source, () => oldToken);
  async function capture(quantity: number) {
    const state = await createAcquisitionSession(source, actor, { requestKey: randomUUID(), ownerPlayerId: owner.player.id,
      locationId: destination.id, section: "A", policy: { kind: "MANUAL", quantity }, run: { providerId: "phone-photo-v1",
        runId: randomUUID(), enforcement: "LOGICAL_ALLOCATION", controls: ["STOP", "CANCEL", "PAUSE", "RESUME"] } });
    await executeAcquisitionCommand(source, actor, state.session.id, { requestKey: randomUUID(), revision: 0, command: "START" });
    return state.session.id;
  }
  const samples = await Promise.all(["jpeg", "png", "webp"].map(format => sharp({ create: {
    width: 80, height: 120, channels: 3, background: "#345678" } }).toFormat(format as "jpeg" | "png" | "webp").toBuffer()));
  const media = ["image/jpeg", "image/png", "image/webp"];
  const savedSession = await capture(2), photoIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const { slot } = await reserveAcquisitionCaptureSlot(source, actor, savedSession, randomUUID());
    const response = await sourceRoutes.upload.POST(request(savedSession, slot.id, randomUUID(), samples[index], media[index]), { params: Promise.resolve({ sessionId: savedSession }) });
    assert.equal(response.status, 200); photoIds.push((await response.json()).id);
  }
  const review = await getAcquisitionCardReview(source, actor, savedSession, photoIds[0]);
  await saveAcquisitionReview(source, actor, savedSession, { action: "accept", photoId: photoIds[0], revision: review.revision,
    decision: { cardId: card.id, language: "en", finish: "NONFOIL", condition: "NM" } });
  const progress = await getAcquisitionProgress(source, actor, savedSession);
  await executeAcquisitionCommand(source, actor, savedSession, { requestKey: randomUUID(), revision: progress.revision, command: "STOP" });
  const selection = { locationId: destination.id, section: "A", photoIds: [photoIds[0]] };
  const preview = await previewAcquisitionCommit(source, actor, savedSession, selection);
  const commitRequest = { ...selection, requestKey: randomUUID(), previewToken: preview.token, overfillReason: null };
  const receipt = await commitAcquisitionCards(source, actor, savedSession, commitRequest);
  assert.equal(receipt.count, 1);

  const liveSession = await capture(2), { slot } = await reserveAcquisitionCaptureSlot(source, actor, liveSession, randomUUID()), uploadKey = randomUUID();
  const withheld = await sourceRoutes.upload.POST(request(liveSession, slot.id, uploadKey, samples[2], media[2]), { params: Promise.resolve({ sessionId: liveSession }) });
  assert.equal(withheld.status, 200); assert.equal(withheld.bodyUsed, false, "Client acknowledgement must remain unconsumed");
  const unacknowledged = await source.acquisitionPhoto.findFirstOrThrow({ where: { uploadKey } });
  assert.equal(unacknowledged.ready, true);
  for (const model of [source.acquisitionProcessingJob, source.acquisitionCatalogLookup, source.correctionCaptureOutbox])
    assert.equal(await (model as any).count({ where: { status: "RUNNING" } }), 0, "Capture must have no live mutation workers");
  const before = await snapshot(source), sourceFiles = await files(sourceRoot);
  const backup = await createBackup();
  assert.equal(backup.manifest.included.appdata, true); assert.equal(backup.manifest.appdata.length, 4);
  const after = await snapshot(source), beforeWithGuard = clone(before);
  assert.equal(before.CorrectionBackupGuard.length, 0); assert.equal(after.CorrectionBackupGuard.length, 1);
  assert.ok(after.CorrectionBackupGuard[0].releasedAt, "Completed backup releases its exact durable guard");
  beforeWithGuard.CorrectionBackupGuard = after.CorrectionBackupGuard;
  equalTables(after, beforeWithGuard); assert.deepEqual(await files(sourceRoot), sourceFiles);
  assert.ok(await resolveStoredSession(source, oldToken));

  process.env.DATABASE_URL = targetURL.href; await roots(targetRoot);
  const empty = await snapshot(target);
  assert.equal((await restoreBackup(backup.path)).dryRun, true); equalTables(await snapshot(target), empty);
  const restored = await restoreBackup(backup.path, { force: true, confirmation: "RESTORE" });
  assert.equal(restored.dryRun, false); assert.ok("credentialsRevalidated" in restored && restored.credentialsRevalidated);
  const restoredRows = await snapshot(target), expected = clone(after), projected = clone(restoredRows);
  expected.AuthSession = [];
  assert.equal(restoredRows.AuthSession.length, 0); assert.equal(await resolveStoredSession(target, oldToken), null);
  assert.equal(projected.CorrectionBackupGuard.length, 1);
  assert.ok(projected.CorrectionBackupGuard[0].releasedAt, "Restore must release the archived in-progress guard");
  projected.CorrectionBackupGuard[0].releasedAt = expected.CorrectionBackupGuard[0].releasedAt = "verified-backup-or-restore-release";
  assert.equal(projected.CorrectionLibraryAccount.length, 1);
  assert.match(projected.CorrectionLibraryAccount[0].displayKey, /^[a-f0-9]{64}$/);
  assert.ok(projected.CorrectionLibraryAccount[0].displayKey !== expected.CorrectionLibraryAccount[0].displayKey, "Restore rotates the library display credential");
  projected.CorrectionLibraryAccount[0].displayKey = expected.CorrectionLibraryAccount[0].displayKey = "verified-rotated-display-key";
  equalTables(projected, expected);
  assert.deepEqual(await files(targetRoot), sourceFiles, "Every original and unrelated appdata byte must restore exactly");
  equalTables(await snapshot(source), after);

  let token = oldToken;
  const targetRoutes = routes(target, () => token), params = { params: Promise.resolve({ sessionId: liveSession, photoId: unacknowledged.id }) };
  const get = () => targetRoutes.photo.GET(new Request(`http://fixture.local/api/acquisition/${liveSession}/photos/${unacknowledged.id}`), params);
  assert.equal((await get()).status, 403, "Restored old website credential cannot retrieve private images");
  const freshToken = await createStoredSession(target, owner.user), otherToken = await createStoredSession(target, people[1].user);
  token = freshToken;
  const frozen = await snapshot(target), frozenFiles = await files(targetRoot);
  const original = await get(); assert.equal(original.status, 200); assert.equal(original.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), samples[2]);
  const retry = () => targetRoutes.upload.POST(request(liveSession, slot.id, uploadKey, samples[2], media[2]), { params: Promise.resolve({ sessionId: liveSession }) });
  const retried = await retry(); assert.equal(retried.status, 200);
  const acknowledgement = await retried.json(); assert.deepEqual(acknowledgement, await withheld.json());
  assert.deepEqual(await (await retry()).json(), acknowledgement);
  const changed = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#abcdef" } }).webp().toBuffer();
  assert.equal((await targetRoutes.upload.POST(request(liveSession, slot.id, uploadKey, changed, media[2]), { params: Promise.resolve({ sessionId: liveSession }) })).status, 409);
  token = otherToken; assert.equal((await get()).status, 403); assert.equal((await retry()).status, 403); token = freshToken;
  const replay = await commitAcquisitionCards(target, actor, savedSession, commitRequest);
  assert.equal(replay.id, receipt.id); assert.equal(replay.replay, true);
  equalTables(await snapshot(target), frozen); assert.deepEqual(await files(targetRoot), frozenFiles);
  const pending = await getAcquisitionProgress(target, actor, savedSession);
  assert.equal(pending.slots.filter(value => value.committed).length, 1);
  assert.equal(pending.slots.filter(value => !value.committed).length, 1);
  assert.equal(await target.inventoryItem.count(), 1);
  const another = await reserveAcquisitionCaptureSlot(target, actor, liveSession, randomUUID());
  const duplicate = await targetRoutes.upload.POST(request(liveSession, another.slot.id, randomUUID(), samples[2], media[2]), { params: Promise.resolve({ sessionId: liveSession }) });
  assert.equal(duplicate.status, 200); assert.notEqual((await duplicate.json()).id, unacknowledged.id, "Equal bytes in a new physical slot must remain a distinct copy");
  assert.equal(await target.inventoryItem.count(), 1); assert.equal(await target.acquisitionPhoto.count(), 4);
  equalTables(await snapshot(source), after); assert.deepEqual(await files(sourceRoot), sourceFiles);
  console.log(JSON.stringify({ passed: true, publicTables: Object.keys(after).length, originalPhotos: 3,
    formats: ["JPEG", "PNG", "WebP"], committedCopies: 1, retainedPendingCopies: 1, restoredAckReplays: 2,
    differentPayloadRefused: true, privateOwnerFence: true, distinctEqualByteCopy: true, sourcePreserved: true,
    archiveSHA256: hash(await readFile(backup.path)), archiveBytes: backup.sizeBytes, elapsedMs: Date.now() - started }));
}
void run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
});
