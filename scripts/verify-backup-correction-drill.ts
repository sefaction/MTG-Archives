/** Actual CLI qualification. Parent owns the two brand-new databases and the
 * disposable Linux runner's /app/data/backups, /input and /drill directories. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, cp, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { correctionRestoreTables, verifyRestoredCorrections, type CorrectionRestoreEvidence } from "./restore-correction-projection";

const sourceURL = new URL(process.env.DATABASE_URL || "http://invalid");
const targetURL = new URL(process.env.CORRECTION_DRILL_RESTORE_URL || "http://invalid");
assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1"); assert.equal(process.env.MTG_CORRECTION_DRILL_FIXTURE, "1");
assert.equal(sourceURL.hostname, "postgres"); assert.equal(sourceURL.pathname, "/mtg_drill_source922");
assert.equal(targetURL.hostname, "restore-db"); assert.equal(targetURL.pathname, "/mtg_restore_drill");
assert.equal(targetURL.port, "5432"); assert.equal(targetURL.username, "drill");
const source = new PrismaClient({ datasources: { db: { url: sourceURL.href } } });
const target = new PrismaClient({ datasources: { db: { url: targetURL.href } } });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function snapshot(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, { rows: number; digest: string }> = {};
  for (const { tablename } of tables) {
    const [row] = await db.$queryRawUnsafe<{ rows: number; digest: string }[]>(`SELECT count(*)::int AS rows,
      md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'')) AS digest FROM public."${tablename.replaceAll('"', '""')}" t`);
    result[tablename] = row;
  }
  return result;
}
async function empty(db: PrismaClient, migrated: boolean) {
  const tables = await snapshot(db);
  if (!migrated) assert.deepEqual(tables, {}, "Restore target must be new and empty");
  else {
    assert.ok(Object.keys(tables).length > 70);
    for (const [table, value] of Object.entries(tables)) if (!["LocationType", "_prisma_migrations"].includes(table))
      assert.equal(value.rows, 0, "Source must be a new disposable fixture: " + table);
    assert.equal(tables.LocationType.rows, 8);
  }
}
function run(mode: string, env: NodeJS.ProcessEnv, expected = 0, stage?: string) {
  const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"),
    "scripts/verify-backup-restore-container.ts", mode], { env, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== expected) {
    // Actual drill diagnostics are intentionally redacted. Do not print env.
    console.error((result.stderr || "").split(/\r?\n/).filter(line => line.startsWith("Recovery drill") || line.startsWith('{"restore')).join("\n"));
    assert.fail(`Actual ${mode} expected exit ${expected}, got ${result.status}; ${result.error?.name || "no spawn error"}`);
  }
  if (stage) assert.ok(result.stderr.includes(stage), "Expected original drill failure stage: " + stage);
  for (const line of result.stdout.split(/\r?\n/)) if (line.startsWith("{")) console.log(line);
}
async function main() {
  const started = Date.now(); await empty(source, true); await empty(target, false);
  // Only this freshly verified empty fixture receives these columns. The real
  // verifier must conserve unknown future fields without enumerating a schema.
  for (const table of correctionRestoreTables) await source.$executeRawUnsafe(`ALTER TABLE public."${table}"
    ADD COLUMN "drillFutureField" jsonb NOT NULL DEFAULT '{"nested":"must survive"}'::jsonb`);
  await mkdir("/input", { recursive: true }); assert.deepEqual(await readdir("/input"), [], "Input belongs to this new runner only");
  await assert.rejects(access("/drill/restore-validation.json"), { code: "ENOENT" });
  const env: NodeJS.ProcessEnv = { ...process.env, MTG_DRILL_REQUIRE_TERMINAL_SCANS: "1" };
  const roots: Record<string, string> = {};
  for (const [name, folder] of [["UPLOADS_DATA_PATH", "uploads"], ["IMPORTS_DATA_PATH", "imports"],
    ["EXPORTS_DATA_PATH", "exports"], ["SCRYFALL_CONTAINER_DATA_PATH", "scryfall"]]) {
    roots[name] = "/drill/source/" + folder; await mkdir(roots[name], { recursive: true }); env[name] = roots[name];
  }
  const originalFile = path.join(roots.UPLOADS_DATA_PATH, "private-original.webp");
  const original = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#456789" } }).webp().toBuffer();
  await writeFile(originalFile, original);
  for (const format of ["jpeg", "png"] as const) await writeFile(path.join(roots.UPLOADS_DATA_PATH, "private-original." + format),
    await sharp({ create: { width: 80, height: 120, channels: 3, background: "#456789" } }).toFormat(format).toBuffer());
  await writeFile(path.join(roots.IMPORTS_DATA_PATH, "unrelated-import.txt"), "Synthetic unrelated import\n");
  const old = new Date("2026-01-01T00:00:00.000Z"), expiresAt = new Date(Date.now() + 300000);
  const owners: Array<{ player: { id: string }; user: { id: string } }> = [];
  for (const label of ["A", "B"]) {
    const player = await source.player.create({ data: { name: randomUUID(), displayName: "Synthetic owner " + label } });
    const user = await source.user.create({ data: { username: randomUUID(), displayName: "Synthetic owner " + label,
      playerId: player.id, passwordHash: "not-a-login" } }); owners.push({ player, user });
    await source.correctionLibraryAccount.create({ data: { ownerPlayerId: player.id, displayKey: hash(randomUUID()),
      evidenceBytes: label === "A" ? 999n : 0n, reservedBytes: 17n, selectedControls: 7 } });
  }
  const owner = owners[0].player.id;
  const card = await source.card.create({ data: { scryfallId: randomUUID(), name: "Synthetic restore printing", setCode: "tst",
    collectorNumber: "1", typeLine: "Artifact", rarity: "common", lang: "en", digital: false, finishes: ["nonfoil"] } });
  await source.inventoryItem.create({ data: { cardId: card.id, currentOwnerId: owner, quantity: 3, condition: "NM" } });
  await source.authSession.create({ data: { tokenHash: hash(randomUUID()), userId: owners[0].user.id, credentialHash: "synthetic", expiresAt } });
  await source.scannerPairing.create({ data: { id: randomUUID(), userId: owners[0].user.id, codeHash: hash(randomUUID()), credentialHash: "synthetic", expiresAt } });
  await source.scannerAgent.create({ data: { id: randomUUID(), userId: owners[0].user.id, tokenHash: hash(randomUUID()), credentialHash: "synthetic", name: "Synthetic no-device agent", expiresAt } });
  await source.correctionBackupGuard.create({ data: { createdAt: old, releasedAt: old } });
  await source.correctionBackupGuard.create({ data: { createdAt: old } });
  for (const [index, status] of ["RUNNING", "PENDING", "COMPLETE"].entries()) {
    const blob = await source.correctionBlob.create({ data: { ownerPlayerId: owner, digest: hash("blob" + index), bytes: 13,
      mediaType: "image/webp", state: "PRESERVED", preservedAt: old } });
    await source.correctionCaptureOutbox.create({ data: { blobId: blob.id, status, attempts: index + 1,
      ...(status === "RUNNING" ? { leaseToken: randomUUID(), leaseExpiresAt: expiresAt } : {}) } });
    if (index === 2) continue;
    const photoId = index === 0 ? "removed" : "kept";
    await source.correctionExample.create({ data: { ownerPlayerId: owner, blobId: blob.id, sourcePhotoId: photoId,
      sourceCandidateId: "candidate-" + index, sourceSessionId: "session", sourceGeneration: 0, physicalCopyGroup: "copy-" + index,
      sourceMetadata: { synthetic: "private metadata" }, label: { synthetic: "saved label" }, metadataBytes: 7, labelState: "UNVERIFIED" } });
    await source.correctionRetentionPin.create({ data: { blobId: blob.id, ownerPlayerId: owner, photoId, sessionId: "session" } });
    await source.correctionEvidence.create({ data: { ownerPlayerId: owner, sourcePhotoId: photoId, bundleHash: hash("evidence" + index), payload: { synthetic: true }, bytes: 13 } });
    await source.correctionReviewEvent.create({ data: { ownerPlayerId: owner, sourceCandidateId: "candidate-" + index, candidateRevision: 1,
      sourcePhotoId: photoId, actorId: owners[0].user.id, origin: "TEST", classification: "TEST", payload: { synthetic: true }, evidenceIds: [], bytes: 11 } });
  }
  await source.correctionDeletionTombstone.create({ data: { ownerPlayerId: owner, sourcePhotoId: "removed", deletedAt: old } });
  const realPgDump = execFileSync("which", ["pg_dump"], { encoding: "utf8" }).trim();
  await mkdir("/drill/probe-bin", { recursive: true });
  // This wrapper still runs actual pg_dump. The deliberate source mutation is
  // performed after its real SQL snapshot and before createBackup can finish.
  const probe = `#!${process.execPath}\nconst cp=require('node:child_process'),fs=require('node:fs');
cp.execFileSync(${JSON.stringify(realPgDump)},process.argv.slice(2),{stdio:'inherit'});
if(!process.argv.includes('--version')) (async()=>{
 if(process.env.MTG_DRILL_MUTATION==='file') fs.writeFileSync(${JSON.stringify(originalFile)},'deliberately changed private bytes');
 if(process.env.MTG_DRILL_MUTATION==='database') {const {PrismaClient}=require(${JSON.stringify(path.resolve("node_modules/@prisma/client"))}); const db=new PrismaClient();
 try {if(new URL(process.env.DATABASE_URL).pathname!=='/mtg_drill_source922')throw Error('wrong fixture');
 await db.player.update({where:{id:${JSON.stringify(owner)}},data:{displayName:'deliberately changed during backup'}});}finally{await db.$disconnect();}}
})().catch(()=>{process.exitCode=1});\n`;
  await writeFile("/drill/probe-bin/pg_dump", probe, { mode: 0o755 });
  for (const mutation of ["database", "file"]) {
    const backupDir = "/app/data/backups/drill-" + randomUUID();
    run("capture", { ...env, BACKUP_DIR: backupDir, MTG_DRILL_MUTATION: mutation,
      PATH: "/drill/probe-bin:" + process.env.PATH }, 1, mutation === "database" ? "source database equality" : "source file equality");
    await assert.rejects(access(path.join(backupDir, "evidence.json")), { code: "ENOENT" });
    if (mutation === "database") {
      const failure = JSON.parse(await readFile(path.join(backupDir, "capture-failure.json"), "utf8"));
      assert.deepEqual(failure.changedTables.map((row: any) => row.table), ["Player"]);
      await source.player.update({ where: { id: owner }, data: { displayName: "Synthetic owner A" } });
    } else await writeFile(originalFile, original);
    console.log(JSON.stringify({ negative: mutation, actualDump: true, unexpectedSourceChangeRefused: true, noQualifiedEvidence: true }));
  }
  const backupDir = "/app/data/backups/drill-" + randomUUID();
  run("capture", { ...env, BACKUP_DIR: backupDir });
  const sourceAfter = await snapshot(source);
  await cp(backupDir, "/input", { recursive: true });
  const evidenceText = await readFile("/input/evidence.json", "utf8"), evidence = JSON.parse(evidenceText);
  const restoreEnv = { ...env, DATABASE_URL: targetURL.href, MTG_RESTORE_DRILL_ISOLATED: "1" };
  const legacy = { ...evidence }; delete legacy.correctionFence;
  await writeFile("/input/evidence.json", JSON.stringify(legacy));
  run("restore-validate", restoreEnv, 1, "initial guards"); await empty(target, false);
  await writeFile("/input/evidence.json", evidenceText);
  run("restore-validate", restoreEnv);
  const restoreStarted = Date.now(); run("restore-apply", restoreEnv); const finished = Date.now();
  const targetBefore = await snapshot(target), correctionEvidence = evidence.correctionFence as CorrectionRestoreEvidence;
  const window = { started: restoreStarted, finished };
  const running = await target.correctionCaptureOutbox.findFirstOrThrow({ where: { attempts: 1 } });
  const rollback = new Error("owned negative rollback");
  for (const table of correctionRestoreTables) {
    await assert.rejects(target.$transaction(async tx => {
      await tx.$executeRawUnsafe(`UPDATE public."${table}" SET "drillFutureField"='{"nested":"changed"}'::jsonb`);
      await assert.rejects(verifyRestoredCorrections(tx as PrismaClient, correctionEvidence, window)); throw rollback;
    }), error => error === rollback);
    assert.deepEqual(await snapshot(target), targetBefore, "Future-field negative rollback must preserve every table");
  }
  const oldAccount = await source.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
  const freshAccount = await target.correctionLibraryAccount.findUniqueOrThrow({ where: { ownerPlayerId: owner } });
  const releasedGuard = await target.correctionBackupGuard.findFirstOrThrow({ where: { createdAt: old, releasedAt: old } });
  for (const mutation of ["field", "missing", "extra", "lease", "old-key", "duplicate-key", "stale-time", "old-guard"]) {
    await assert.rejects(target.$transaction(async tx => {
      if (mutation === "field") await tx.correctionLibraryAccount.update({ where: { ownerPlayerId: owner }, data: { reservedBytes: { increment: 1n } } });
      if (mutation === "missing") await tx.correctionCaptureOutbox.delete({ where: { id: running.id } });
      if (mutation === "extra") await tx.correctionBackupGuard.create({ data: { createdAt: old, releasedAt: old } });
      if (mutation === "lease") await tx.$executeRaw`UPDATE "CorrectionCaptureOutbox" SET status='RUNNING',
        "leaseToken"='stale authority', "leaseExpiresAt"=CURRENT_TIMESTAMP+interval '5 minutes' WHERE id=${running.id}`;
      if (mutation === "old-key") await tx.$executeRaw`UPDATE "CorrectionLibraryAccount" SET "displayKey"=${oldAccount.displayKey} WHERE "ownerPlayerId"=${owner}`;
      if (mutation === "duplicate-key") await tx.$executeRaw`UPDATE "CorrectionLibraryAccount" SET "displayKey"=${freshAccount.displayKey} WHERE "ownerPlayerId"=${owners[1].player.id}`;
      if (mutation === "stale-time") await tx.$executeRaw`UPDATE "CorrectionCaptureOutbox" SET "updatedAt"=${old}, "availableAt"=${old} WHERE id=${running.id}`;
      if (mutation === "old-guard") await tx.$executeRaw`UPDATE "CorrectionBackupGuard" SET "releasedAt"=${new Date(finished)} WHERE id=${releasedGuard.id}`;
      await assert.rejects(verifyRestoredCorrections(tx as PrismaClient, correctionEvidence, window)); throw rollback;
    }), error => error === rollback);
    assert.deepEqual(await snapshot(target), targetBefore, "Negative rollback must preserve every table");
  }
  assert.deepEqual(await snapshot(source), sourceAfter, "Isolated restore must not change any source row");
  assert.deepEqual(await readFile(originalFile), original);
  console.log(JSON.stringify({ passed: true, publicTables: Object.keys(sourceAfter).length, correctionTables: Object.keys(correctionEvidence.tables).length,
    correctionAccounts: 2, runningCorrectionClaims: 1, removedExamples: 1, capturedOriginals: 3, physicalCopies: 3,
    actualCapture: true, restoreValidateAndApply: true, legacyEvidenceRefused: true, sourceMutationNegatives: 2,
    restoredSQLMutationNegatives: 16, sourcePreserved: true, elapsedMs: Date.now() - started }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
});
