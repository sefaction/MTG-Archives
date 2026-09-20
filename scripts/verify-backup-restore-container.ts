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
  buildPgEnv,
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
let stage = "initial guards";

async function databaseDigest(db: PrismaClient) {
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const result: Record<string, Digest> = {};
  for (const { table_name: name } of tables) {
    if (volatileTables.has(name)) continue;
    stage = `database comparison: ${name}`;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    // Legacy price cache still exists in older primary snapshots. Restoring it
    // matters, but sorting millions of row hashes needlessly monopolizes disk.
    // Compare its row count explicitly; all authoritative tables keep full hashes.
    if (name === "CardPriceSnapshot") {
      const [row] = await db.$queryRawUnsafe<Array<{ rows: number }>>(
        `SELECT count(*)::int AS rows FROM public.${quoted}`,
      );
      result[name] = { ...row, digest: "count-only-refreshable-price-cache" };
      continue;
    }
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
  stage = "create application backup";
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
  stage = "negative restore guards and rollback";
  // Synthetic canary only, in the already-validated empty disposable database.
  // A check function is true while seeding but false during a new restore
  // session, producing a real SQL load failure after DROP SCHEMA has executed.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL mtg.restore_drill_allow = 'yes'");
    await tx.$executeRawUnsafe(
      "CREATE FUNCTION public.restore_drill_check() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('mtg.restore_drill_allow', true) = 'yes', false) $$",
    );
    await tx.$executeRawUnsafe(
      "CREATE TABLE public.restore_drill_canary (value integer CHECK (public.restore_drill_check()))",
    );
    await tx.$executeRawUnsafe(
      "INSERT INTO public.restore_drill_canary VALUES (1)",
    );
  });
  const canary = async () =>
    assert.deepEqual(
      await db.$queryRawUnsafe("SELECT value FROM public.restore_drill_canary"),
      [{ value: 1 }],
    );
  const negativeRoot = "/drill/negative";
  await mkdir(negativeRoot, { recursive: true });
  await writeFile(
    join(negativeRoot, "manifest.json"),
    JSON.stringify({
      ...dry.manifest,
      included: { database: true, appdata: false },
      appdata: [],
    }),
  );
  const negativeArchive = "/drill/negative.tar.gz";
  const pack = (members: string[]) =>
    execFileSync("tar", [
      "-czf",
      negativeArchive,
      "-C",
      negativeRoot,
      "manifest.json",
      ...members,
    ]);
  pack([]);
  await assert.rejects(() =>
    restoreBackup(negativeArchive, { force: true, confirmation: "RESTORE" }),
  );
  await canary();
  await writeFile(join(negativeRoot, "database.dump"), "not a database dump");
  pack(["database.dump"]);
  await assert.rejects(() =>
    restoreBackup(negativeArchive, { force: true, confirmation: "RESTORE" }),
  );
  await canary();
  execFileSync(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--schema",
      "public",
      "--file",
      join(negativeRoot, "database.dump"),
    ],
    {
      env: buildPgEnv(parseDatabaseUrl(process.env.DATABASE_URL!)),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  pack(["database.dump"]);
  await assert.rejects(
    () =>
      restoreBackup(negativeArchive, { force: true, confirmation: "RESTORE" }),
    /violates check constraint/,
  );
  await canary();
  for (const entry of evidence.appdata)
    assert.equal(
      await readFile(
        join(process.env[entry.envName]!, "pre-restore-sentinel"),
        "utf8",
      ),
      "replace only this disposable target",
    );
  await db.$executeRawUnsafe("DROP TABLE public.restore_drill_canary");
  await db.$executeRawUnsafe("DROP FUNCTION public.restore_drill_check()");
  const started = Date.now();
  stage = "forced restore to isolated target";
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
      missingAndCorruptDumpPreservedCanary: true,
      sqlFailureRolledBackSchemaAndPreservedCanary: true,
      volatileTablesNotCompared: [...volatileTables],
      countOnlyTables: ["CardPriceSnapshot"],
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
  const message = String(error?.message || "");
  console.error(
    JSON.stringify({
      restoreCompatibilityDiagnostics: {
        transactionTimeoutUnsupported: message.includes(
          'unrecognized configuration parameter "transaction_timeout"',
        ),
        publicSchemaAlreadyExists: message.includes(
          'schema "public" already exists',
        ),
        restoreErrors:
          message.match(/errors ignored on restore: (\d+)/)?.[1] || null,
      },
    }),
  );
  // Assertion messages can contain private source fingerprints/paths. Keep
  // failed diagnostic details only inside the disposable/local container.
  console.error(
    `Recovery drill ${process.argv[2] || "mode"} failed at ${stage} (${error?.code || error?.name || "error"}); no success claimed.`,
  );
  process.exitCode = 1;
});
