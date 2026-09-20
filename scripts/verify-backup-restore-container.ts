/** Internal half of the opt-in isolated recovery drill; never run restore mode in web. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedDrillDatabase } from "../lib/backup-drill";
import {
  createBackup,
  getDefaultAppdataPaths,
  parseDatabaseUrl,
  restoreBackup,
} from "../lib/backup";

type Digest = { rows: number; digest: string };
type Evidence = {
  path: string;
  sizeBytes: number;
  backupMs: number;
  database: Record<string, Digest>;
  physicalCopies: number;
  files: Record<string, Record<string, string>>;
  appdata: Array<{ envName: string; archivePath: string }>;
};

// These tables change asynchronously under the normal delivery worker. They are
// restored by pg_restore, but are not a quiescent source/content comparison.
const volatileTables = new Set([
  "Notification",
  "NotificationDeliveryJob",
  "NotificationDeliveryAttempt",
  "TradeWishlistNotificationActivity",
]);

async function databaseDigest(db: PrismaClient) {
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const result: Record<string, Digest> = {};
  for (const { table_name: name } of tables) {
    if (volatileTables.has(name)) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    // Table identifiers originate only from PostgreSQL's catalog. Digests never
    // expose row contents, password hashes, private deck names or webhook URLs.
    const [row] = await db.$queryRawUnsafe<
      Array<{ rows: number; digest: string }>
    >(
      `SELECT count(*)::int AS rows, md5(coalesce(string_agg(digest, '' ORDER BY digest), '')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS digest FROM public.${quoted} t) rows`,
    );
    result[name] = row;
  }
  return result;
}

async function fileDigest(root: string) {
  const result: Record<string, string> = {};
  async function visit(relative: string) {
    const path = join(root, relative);
    const info = await lstat(path);
    assert.ok(
      !info.isSymbolicLink(),
      "Drill requires appdata without symlinks",
    );
    if (info.isDirectory()) {
      result[`${relative}/`] = "directory";
      for (const child of (await readdir(path)).sort())
        await visit(relative ? `${relative}/${child}` : child);
    } else {
      assert.ok(info.isFile(), "Unsupported appdata file type");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      result[relative] = hash.digest("hex");
    }
  }
  await visit("");
  return result;
}

async function capture(db: PrismaClient) {
  const backupDir = process.env.BACKUP_DIR || "";
  assert.match(backupDir, /^\/app\/data\/backups\/drill-[0-9a-f-]+$/);
  assert.equal(
    parseDatabaseUrl(process.env.DATABASE_URL || "").host,
    "postgres",
  );
  process.env.BACKUP_RETENTION_COUNT = "0";
  process.env.BACKUP_RETENTION_DAYS = "0";
  assert.ok(
    !process.env.BACKUP_APPDATA_PATHS,
    "Use the standard appdata mapping for this drill",
  );
  const paths = getDefaultAppdataPaths();
  assert.equal(
    paths.length,
    4,
    "All four local appdata roots must be configured",
  );
  const database = await databaseDigest(db);
  const files: Evidence["files"] = {};
  for (const entry of paths)
    files[entry.envName] = await fileDigest(entry.sourcePath);
  const started = Date.now();
  const backup = await createBackup();
  const backupMs = Date.now() - started;
  assert.deepEqual(
    await databaseDigest(db),
    database,
    "Source changed during backup; rerun when quiescent",
  );
  for (const entry of paths)
    assert.deepEqual(
      await fileDigest(entry.sourcePath),
      files[entry.envName],
      "Source files changed during backup",
    );
  const physicalCopies =
    (await db.inventoryItem.aggregate({ _sum: { quantity: true } }))._sum
      .quantity || 0;
  const evidence: Evidence = {
    path: backup.path,
    sizeBytes: backup.sizeBytes,
    backupMs,
    database,
    physicalCopies,
    files,
    appdata: backup.manifest.appdata.map(({ envName, archivePath }) => ({
      envName,
      archivePath,
    })),
  };
  assert.equal(evidence.appdata.length, 4);
  await writeFile(join(backupDir, "evidence.json"), JSON.stringify(evidence));
  console.log(
    JSON.stringify({
      backupMs,
      sizeBytes: backup.sizeBytes,
      tables: Object.keys(database).length,
    }),
  );
}

async function restore(db: PrismaClient) {
  assertIsolatedDrillDatabase(
    process.env.DATABASE_URL || "",
    process.env.MTG_RESTORE_DRILL_ISOLATED,
  );
  assert.equal(
    (
      await db.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`
    )[0].count,
    0,
    "Restore target must be empty",
  );
  const evidence = JSON.parse(
    await readFile("/input/evidence.json", "utf8"),
  ) as Evidence;
  const archive = join("/input", basename(evidence.path));
  process.env.BACKUP_DIR = "/drill/backups";
  await mkdir("/drill/backups", { recursive: true });
  const allowed = new Set([
    "UPLOADS_DATA_PATH",
    "IMPORTS_DATA_PATH",
    "EXPORTS_DATA_PATH",
    "SCRYFALL_CONTAINER_DATA_PATH",
  ]);
  for (const entry of evidence.appdata) {
    assert.ok(allowed.has(entry.envName));
    const target = resolve("/drill/restored", entry.envName);
    assert.ok(target.startsWith("/drill/restored/"));
    process.env[entry.envName] = target;
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, "pre-restore-sentinel"),
      "replace only this disposable target",
    );
  }
  const dry = await restoreBackup(archive);
  assert.equal(dry.dryRun, true);
  assert.equal(
    (
      await db.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`
    )[0].count,
    0,
  );
  for (const entry of evidence.appdata) {
    assert.equal(
      await readFile(
        join(process.env[entry.envName]!, "pre-restore-sentinel"),
        "utf8",
      ),
      "replace only this disposable target",
    );
  }
  const started = Date.now();
  const restored = await restoreBackup(archive, {
    force: true,
    confirmation: "RESTORE",
  });
  const restoreMs = Date.now() - started;
  assert.equal(restored.dryRun, false);
  assert.deepEqual(await databaseDigest(db), evidence.database);
  assert.equal(
    (await db.inventoryItem.aggregate({ _sum: { quantity: true } }))._sum
      .quantity || 0,
    evidence.physicalCopies,
  );
  for (const entry of evidence.appdata)
    assert.deepEqual(
      await fileDigest(process.env[entry.envName]!),
      evidence.files[entry.envName],
    );
  const migrations = execFileSync(
    "/app/node_modules/.bin/prisma",
    ["migrate", "status"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.match(migrations, /up to date/i);
  // A restored DB is usable without starting the production entrypoint, admin
  // bootstrap, pricing ingestion or any outbound notification worker.
  console.log(
    JSON.stringify({
      pass: true,
      backupMs: evidence.backupMs,
      restoreMs,
      archiveBytes: evidence.sizeBytes,
      comparedTables: Object.keys(evidence.database).length,
      physicalCopies: evidence.physicalCopies,
      appdataRoots: evidence.appdata.length,
      fileEntries: Object.values(evidence.files).reduce(
        (n, files) => n + Object.keys(files).length,
        0,
      ),
      dryRunUnchanged: true,
      migrationsCurrent: true,
      volatileTablesNotCompared: [...volatileTables],
    }),
  );
}

async function main() {
  assert.equal(process.env.MTG_LOCAL_PILOT_TEST, "1");
  const db = new PrismaClient();
  try {
    if (process.argv[2] === "capture") await capture(db);
    else if (process.argv[2] === "restore") await restore(db);
    else throw new Error("Expected capture or restore mode");
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  // Assertion messages can contain private source fingerprints/paths. Keep
  // failed diagnostic details only inside the disposable/local container.
  console.error(
    `Recovery drill ${process.argv[2] || "mode"} failed (${error?.code || error?.name || "error"}); no success claimed.`,
  );
  process.exitCode = 1;
});
