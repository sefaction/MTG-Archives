import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  getBackupDir,
  getBackupPathForFilename,
  getDefaultAppdataPaths,
  parseDatabaseUrl,
  restoreBackup,
  sanitizeManifest,
  timestampForFilename,
  type BackupManifest,
} from "../lib/backup";

test("package exposes backup CLI scripts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(pkg.scripts["backup:create"], "tsx scripts/backup-create.ts");
  assert.equal(pkg.scripts["backup:list"], "tsx scripts/backup-list.ts");
  assert.equal(pkg.scripts["backup:restore"], "tsx scripts/backup-restore.ts");
});

test("backup directory is configurable with safe default", () => {
  assert.equal(getBackupDir({}), "/app/backups");
  assert.equal(getBackupDir({ BACKUP_DIR: "/backups" }), "/backups");
  assert.equal(
    getBackupDir({
      BACKUPS_DATA_PATH: "/mnt/user/appdata/mtg-archive/backups",
    }),
    "/mnt/user/appdata/mtg-archive/backups",
  );
});

test("database URL parsing keeps credentials out of manifest-safe fields", () => {
  const parsed = parseDatabaseUrl(
    "postgresql://mtginventory:secret-password@postgres:5432/mtginventory?schema=public",
  );

  assert.equal(parsed.database, "mtginventory");
  assert.equal(parsed.host, "postgres");
  assert.equal(parsed.port, 5432);
  assert.equal(parsed.schema, "public");
});

test("manifest JSON does not include database passwords or DATABASE_URL", () => {
  const manifest: BackupManifest = {
    app: "MTG Archives",
    createdAt: "2026-06-18T12:00:00.000Z",
    backupVersion: 1,
    backupToolVersion: "1",
    appVersion: "git-sha",
    database: {
      type: "postgres",
      format: "pg_dump_custom",
      filename: "database.dump",
      name: "mtginventory",
      host: "postgres",
      port: 5432,
      schema: "public",
    },
    runtime: {
      hostname: "container",
      containerName: null,
      nodeEnv: "production",
    },
    included: {
      database: true,
      appdata: true,
    },
    appdata: [
      {
        envName: "UPLOADS_DATA_PATH",
        sourcePath: "/app/uploads",
        archivePath: "appdata/uploads",
      },
    ],
  };

  const json = sanitizeManifest(manifest);

  assert.doesNotMatch(json, /secret-password/);
  assert.doesNotMatch(json, /DATABASE_URL/);
  assert.doesNotMatch(json, /postgresql:\/\//);
});

test("appdata defaults include persistent app directories but not backups", () => {
  const paths = getDefaultAppdataPaths({
    UPLOADS_DATA_PATH: "/app/uploads",
    IMPORTS_DATA_PATH: "/app/imports",
    EXPORTS_DATA_PATH: "/app/exports",
    BACKUP_DIR: "/app/backups",
    SCRYFALL_CONTAINER_DATA_PATH: "/app/data/scryfall",
  });

  assert.deepEqual(
    paths.map((entry) => entry.archivePath),
    [
      "appdata/uploads",
      "appdata/imports",
      "appdata/exports",
      "appdata/scryfall",
    ],
  );
  assert.equal(
    paths.some((entry) => entry.sourcePath.includes("backups")),
    false,
  );
});

test("timestamped backup names use UTC compact format", () => {
  assert.equal(
    timestampForFilename(new Date("2026-06-18T12:34:56.000Z")),
    "20260618-123456",
  );
});

test("restore rejects missing backup files before destructive work", async () => {
  await assert.rejects(
    () => restoreBackup("does-not-exist.tar.gz", { force: true }),
    /ENOENT|no such file|cannot find/i,
  );
});

test("restore CLI requires explicit --force", async () => {
  const source = await readFile("scripts/backup-restore.ts", "utf8");

  assert.match(source, /--force/);
  assert.match(source, /restoreBackup\(backupPath, \{ force \}\)/);
});

test("backup filename resolution rejects traversal and non-backup names", () => {
  assert.equal(
    getBackupPathForFilename(
      "mtg-archives-backup-20260618-120000.tar.gz",
      "/app/backups",
    ),
    join("/app/backups", "mtg-archives-backup-20260618-120000.tar.gz"),
  );

  assert.throws(
    () =>
      getBackupPathForFilename("../mtg-archives-backup-20260618-120000.tar.gz"),
    /Invalid backup filename/,
  );
  assert.throws(
    () => getBackupPathForFilename("not-a-backup.tar.gz"),
    /Invalid backup filename/,
  );
});

test("Docker image installs PostgreSQL client tools and copies backup scripts", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");

  assert.match(dockerfile, /apk add --no-cache postgresql-client/);
  assert.match(dockerfile, /\/app\/scripts \.\/scripts/);
});

test("Compose and docs include backup run instructions", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");
  const unraidFlatCompose = await readFile(
    "docker-compose.unraid.flat.yml",
    "utf8",
  );
  const readme = await readFile("README.md", "utf8");
  const flatBackupBlock = unraidFlatCompose.slice(
    unraidFlatCompose.indexOf("  backup:"),
  );

  assert.match(compose, /backup:/);
  assert.match(compose, /npm run backup:create/);
  assert.match(compose, /tail -f \/dev\/null/);
  assert.match(flatBackupBlock, /tail -f \/dev\/null/);
  assert.doesNotMatch(flatBackupBlock, /profiles:/);
  assert.match(readme, /docker compose run --rm web npm run backup:create/);
  assert.match(readme, /docker compose exec backup npm run backup:create/);
});

test("admin backup page is admin-mode protected and exposes create UI", async () => {
  const page = await readFile("app/admin/backups/page.tsx", "utf8");

  assert.match(page, /requireAdminMode/);
  assert.match(page, /Create Backup/);
  assert.match(page, /Upload Backup/);
  assert.match(page, /Restore Backup/);
  assert.match(page, /Delete Backup/);
  assert.match(page, /confirmFilename/);
  assert.match(page, /RESTORE/);
  assert.match(page, /DELETE/);
});

test("admin backup upload route requires admin mode and validates archives", async () => {
  const route = await readFile("app/api/admin/backups/upload/route.ts", "utf8");
  const middleware = await readFile("middleware.ts", "utf8");

  assert.match(route, /isAdminModeEnabled/);
  assert.match(route, /saveUploadedBackupArchive/);
  assert.match(route, /\.tar\.gz/);
  assert.match(middleware, /"\/api\/admin"/);
});

test("Next config allows large GUI backup uploads", async () => {
  const config = await readFile("next.config.ts", "utf8");

  assert.match(config, /middlewareClientMaxBodySize/);
  assert.match(config, /1gb/);
});

test("admin backup download route requires admin mode and streams archives", async () => {
  const route = await readFile(
    "app/api/admin/backups/download/[filename]/route.ts",
    "utf8",
  );
  const page = await readFile("app/admin/backups/page.tsx", "utf8");

  assert.match(route, /isAdminModeEnabled/);
  assert.match(route, /getBackupPathForFilename/);
  assert.match(route, /readManifestFromBackup/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /createReadStream/);
  assert.match(page, /Download/);
  assert.match(page, /encodeURIComponent/);
});

test("backup deletion uses the shared filename guard", async () => {
  const source = await readFile("lib/backup.ts", "utf8");
  const page = await readFile("app/admin/backups/page.tsx", "utf8");

  assert.match(source, /deleteBackupByFilename/);
  assert.match(source, /getBackupPathForFilename\(filename, backupDir\)/);
  assert.match(source, /readManifestFromBackup\(backupPath\)/);
  assert.match(source, /Refusing to delete a backup outside BACKUP_DIR/);
  assert.match(page, /deleteBackupAction/);
  assert.match(page, /deleteBackupByFilename/);
});
