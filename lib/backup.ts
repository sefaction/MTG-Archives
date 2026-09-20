import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  lstat,
  realpath,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { constants } from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { tmpdir, homedir } from "node:os";

const BACKUP_PREFIX = "mtg-archives-backup-";
const BACKUP_SUFFIX = ".tar.gz";
const DB_DUMP_FILENAME = "database.dump";
const MANIFEST_FILENAME = "manifest.json";
const RESTORE_README_FILENAME = "README-restore.txt";
const APPDATA_ARCHIVE_FILENAME = "appdata.tar.gz";

export type BackupManifest = {
  app: "MTG Archives";
  createdAt: string;
  backupVersion: 1;
  backupToolVersion: string;
  appVersion: string | null;
  database: {
    type: "postgres";
    format: "pg_dump_custom";
    filename: typeof DB_DUMP_FILENAME;
    name: string;
    host: string;
    port: number;
    schema: string | null;
  };
  runtime: {
    hostname: string | null;
    containerName: string | null;
    nodeEnv: string | null;
  };
  included: {
    database: true;
    appdata: boolean;
  };
  appdata: Array<{
    envName: string;
    sourcePath: string;
    archivePath: string;
  }>;
};

type PgConnection = {
  database: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  schema: string | null;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type BackupListEntry = {
  path: string;
  filename: string;
  sizeBytes: number;
  createdAt: string | null;
  manifest: BackupManifest | null;
};

export type RestoreOptions = {
  force?: boolean;
  confirmation?: string;
};

export function loadEnvFile(path = ".env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function getBackupDir(
  env: Record<string, string | undefined> = process.env,
) {
  return env.BACKUP_DIR || env.BACKUPS_DATA_PATH || "/app/backups";
}

export function getDefaultAppdataPaths(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.BACKUP_APPDATA_PATHS;
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((sourcePath, index) => ({
        envName: `BACKUP_APPDATA_PATHS_${index + 1}`,
        sourcePath,
        archivePath: `appdata/custom-${index + 1}`,
      }));
  }

  return [
    ["UPLOADS_DATA_PATH", "uploads"],
    ["IMPORTS_DATA_PATH", "imports"],
    ["EXPORTS_DATA_PATH", "exports"],
    ["SCRYFALL_CONTAINER_DATA_PATH", "scryfall"],
  ]
    .map(([envName, archiveName]) => {
      const sourcePath = env[envName];
      if (!sourcePath) return null;
      return {
        envName,
        sourcePath,
        archivePath: `appdata/${archiveName}`,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
}

export function parseDatabaseUrl(databaseUrl: string): PgConnection {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name.");
  return {
    database,
    host: parsed.hostname || "localhost",
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username || ""),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    schema: parsed.searchParams.get("schema"),
  };
}

export function buildPgEnv(connection: PgConnection) {
  return {
    ...process.env,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGDATABASE: connection.database,
    PGUSER: connection.user,
    ...(connection.password ? { PGPASSWORD: connection.password } : {}),
  };
}

export function timestampForFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds(),
  )}`;
}

export function sanitizeManifest(manifest: BackupManifest) {
  return JSON.stringify(manifest);
}

export async function createBackup() {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const connection = parseDatabaseUrl(databaseUrl);
  await assertMatchingDumpClient(connection);
  const backupDir = resolve(getBackupDir());
  await mkdir(backupDir, { recursive: true });

  const timestamp = timestampForFilename();
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-backup-"));
  const bundleRoot = join(workspace, "bundle");
  await mkdir(bundleRoot, { recursive: true });

  const dumpPath = join(bundleRoot, DB_DUMP_FILENAME);
  await runCommand(
    "pg_dump",
    [
      "--format=custom",
      "--file",
      dumpPath,
      "--no-owner",
      "--no-acl",
      "--schema",
      connection.schema || "public",
    ],
    {
      env: buildPgEnv(connection),
    },
  );

  const appdataEntries = await prepareAppdataArchive(bundleRoot);
  const manifest = await buildManifest(connection, appdataEntries);
  await writeFile(
    join(bundleRoot, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(join(bundleRoot, RESTORE_README_FILENAME), restoreReadme());

  const finalPath = join(
    backupDir,
    `${BACKUP_PREFIX}${timestamp}${BACKUP_SUFFIX}`,
  );
  await runCommand("tar", [
    "-czf",
    finalPath,
    "-C",
    bundleRoot,
    MANIFEST_FILENAME,
    DB_DUMP_FILENAME,
    ...(manifest.included.appdata ? [APPDATA_ARCHIVE_FILENAME] : []),
    RESTORE_README_FILENAME,
  ]);

  const sizeBytes = (await stat(finalPath)).size;
  await applyRetention(backupDir);
  await rm(workspace, { recursive: true, force: true });

  return {
    path: finalPath,
    sizeBytes,
    manifest,
  };
}

export async function listBackups(
  backupDir = resolve(getBackupDir()),
): Promise<BackupListEntry[]> {
  await mkdir(backupDir, { recursive: true });
  const files = await readdir(backupDir);
  const backups = files
    .filter(
      (file) => file.startsWith(BACKUP_PREFIX) && file.endsWith(BACKUP_SUFFIX),
    )
    .sort()
    .reverse();

  const entries: BackupListEntry[] = [];
  for (const filename of backups) {
    const path = join(backupDir, filename);
    const info = await stat(path);
    const manifest = await readManifestFromBackup(path).catch(() => null);
    entries.push({
      path,
      filename,
      sizeBytes: info.size,
      createdAt: manifest?.createdAt ?? timestampFromBackupFilename(filename),
      manifest,
    });
  }
  return entries;
}

export function getBackupPathForFilename(
  filename: string,
  backupDir = resolve(getBackupDir()),
) {
  const cleanFilename = filename.trim();
  if (
    !cleanFilename ||
    cleanFilename !== basename(cleanFilename) ||
    !cleanFilename.startsWith(BACKUP_PREFIX) ||
    !cleanFilename.endsWith(BACKUP_SUFFIX)
  ) {
    throw new Error("Invalid backup filename.");
  }
  return join(backupDir, cleanFilename);
}

export async function saveUploadedBackupArchive(
  content: Buffer,
  originalFilename: string,
) {
  loadEnvFile();
  if (content.byteLength === 0) throw new Error("Uploaded backup is empty.");
  const backupDir = resolve(getBackupDir());
  await mkdir(backupDir, { recursive: true });
  const filename = uploadedBackupFilename(originalFilename);
  const finalPath = getBackupPathForFilename(filename, backupDir);
  const tempPath = join(
    backupDir,
    `.upload-${timestampForFilename()}-${Math.random().toString(36).slice(2)}.tar.gz`,
  );

  await writeFile(tempPath, content);
  try {
    const manifest = await readManifestFromBackup(tempPath);
    validateManifest(manifest);
    await rename(tempPath, finalPath);
    return {
      path: finalPath,
      filename,
      manifest,
      sizeBytes: (await stat(finalPath)).size,
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function deleteBackupByFilename(filename: string) {
  loadEnvFile();
  const backupDir = resolve(getBackupDir());
  const backupPath = getBackupPathForFilename(filename, backupDir);
  if (resolve(dirname(backupPath)) !== backupDir) {
    throw new Error("Refusing to delete a backup outside BACKUP_DIR.");
  }
  await readManifestFromBackup(backupPath);
  await rm(backupPath, { force: false });
  return backupPath;
}

export async function applyRetention(backupDir = resolve(getBackupDir())) {
  const count = Number(process.env.BACKUP_RETENTION_COUNT || 0);
  const days = Number(process.env.BACKUP_RETENTION_DAYS || 0);
  if (!count && !days) return [];

  const entries = await listBackups(backupDir);
  const keep = new Set<string>();
  const deleted: string[] = [];
  if (count > 0) {
    for (const entry of entries.slice(0, count)) keep.add(entry.path);
  }
  const cutoff =
    days > 0
      ? Date.now() - days * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    if (keep.has(entry.path)) continue;
    const createdAt = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
    const isExpiredByAge =
      days > 0 && Number.isFinite(createdAt) && createdAt < cutoff;
    const isExpiredByCount = count > 0 && entries.indexOf(entry) >= count;
    if (!isExpiredByAge && !isExpiredByCount) continue;
    if (resolve(dirname(entry.path)) !== resolve(backupDir)) {
      throw new Error("Refusing to delete a backup outside BACKUP_DIR.");
    }
    await rm(entry.path, { force: true });
    deleted.push(entry.path);
  }
  return deleted;
}

export async function restoreBackup(
  backupPath: string,
  options: RestoreOptions = {},
) {
  loadEnvFile();
  if (!backupPath) throw new Error("Backup path is required.");
  const fullBackupPath = resolve(backupPath);
  await access(fullBackupPath, constants.R_OK);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const connection = parseDatabaseUrl(databaseUrl);
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-restore-"));
  try {
    const extractDir = join(workspace, "extract");
    await mkdir(extractDir, { recursive: true });
    await validateArchiveMembers(fullBackupPath, (name) =>
      [
        MANIFEST_FILENAME,
        DB_DUMP_FILENAME,
        APPDATA_ARCHIVE_FILENAME,
        RESTORE_README_FILENAME,
      ].includes(name),
    );
    await runCommand("tar", ["-xzf", fullBackupPath, "-C", extractDir]);

    const manifest = JSON.parse(
      await readFile(join(extractDir, MANIFEST_FILENAME), "utf8"),
    ) as BackupManifest;
    validateManifest(manifest);
    const schema = connection.schema || "public";
    if ((manifest.database.schema || "public") !== schema) {
      throw new Error("Backup schema must match the configured target schema.");
    }
    const dumpPath = join(extractDir, DB_DUMP_FILENAME);
    if (!(await lstat(dumpPath)).isFile())
      throw new Error("Database dump must be a regular file.");
    const listing = await runCommand("pg_restore", ["--list", dumpPath]);
    const dumpMajor = Number(
      listing.stdout.match(/Dumped by pg_dump version: (\d+)/)?.[1],
    );
    const serverMajor = await getServerMajor(connection);
    if (!dumpMajor || dumpMajor > serverMajor)
      throw new Error(
        "Backup was created by a newer or unknown PostgreSQL client; assess compatibility before restoring.",
      );
    // Fully read/decompress the dump before any destructive step. This SQL file
    // is then executed with the schema replacement in ONE database transaction.
    const sqlPath = join(workspace, "restore.sql");
    await runCommand("pg_restore", [
      "--no-owner",
      "--no-acl",
      "--schema",
      schema,
      "--file",
      sqlPath,
      dumpPath,
    ]);
    const appdataPlan = manifest.included.appdata
      ? await prepareRestoreAppdata(extractDir, manifest)
      : [];

    if (!options.force) {
      return {
        dryRun: true as const,
        manifest,
        message:
          "Restore was not run. Re-run with --force and type RESTORE to replace the current database.",
      };
    }

    await requireRestoreConfirmation(options.confirmation);
    const prelude = join(workspace, "replace-schema.sql");
    await writeFile(
      prelude,
      `DROP SCHEMA IF EXISTS ${quotePgIdentifier(schema)} CASCADE;\n`,
    );
    await runCommand(
      "psql",
      [
        "--no-psqlrc",
        "--single-transaction",
        "--set",
        "ON_ERROR_STOP=1",
        "--file",
        prelude,
        "--file",
        sqlPath,
      ],
      { env: buildPgEnv(connection) },
    );

    await applyRestoreAppdata(appdataPlan);
    return { dryRun: false as const, manifest };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function readManifestFromBackup(backupPath: string) {
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-manifest-"));
  try {
    await runCommand("tar", [
      "-xzf",
      backupPath,
      "-C",
      workspace,
      MANIFEST_FILENAME,
    ]);
    return JSON.parse(
      await readFile(join(workspace, MANIFEST_FILENAME), "utf8"),
    ) as BackupManifest;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function formatBytes(sizeBytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = sizeBytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function buildManifest(
  connection: PgConnection,
  appdata: BackupManifest["appdata"],
): Promise<BackupManifest> {
  return {
    app: "MTG Archives",
    createdAt: new Date().toISOString(),
    backupVersion: 1,
    backupToolVersion: "1",
    appVersion: await getGitSha(),
    database: {
      type: "postgres",
      format: "pg_dump_custom",
      filename: DB_DUMP_FILENAME,
      name: connection.database,
      host: connection.host,
      port: connection.port,
      schema: connection.schema,
    },
    runtime: {
      hostname: process.env.HOSTNAME || null,
      containerName: process.env.CONTAINER_NAME || null,
      nodeEnv: process.env.NODE_ENV || null,
    },
    included: {
      database: true,
      appdata: appdata.length > 0,
    },
    appdata,
  };
}

async function prepareAppdataArchive(bundleRoot: string) {
  const configured = getDefaultAppdataPaths();
  const existing: BackupManifest["appdata"] = [];
  const stagingRoot = join(bundleRoot, "appdata");
  for (const entry of configured) {
    const sourcePath = resolve(entry.sourcePath);
    const info = await stat(sourcePath).catch(() => null);
    if (!info?.isDirectory()) continue;
    await mkdir(dirname(join(bundleRoot, entry.archivePath)), {
      recursive: true,
    });
    await cp(sourcePath, join(bundleRoot, entry.archivePath), {
      recursive: true,
      dereference: false,
      filter: (source) => !isInsidePath(source, resolve(getBackupDir())),
    });
    existing.push({ ...entry, sourcePath });
  }
  if (existing.length === 0) return [];
  await runCommand("tar", [
    "-czf",
    join(bundleRoot, APPDATA_ARCHIVE_FILENAME),
    "-C",
    bundleRoot,
    "appdata",
  ]);
  await rm(stagingRoot, { recursive: true, force: true });
  return existing;
}

type RestoreAppdataEntry = { sourcePath: string; targetPath: string };

async function validateArchiveMembers(
  archive: string,
  allowed: (name: string) => boolean,
) {
  const names = (await runCommand("tar", ["-tzf", archive])).stdout
    .trim()
    .split("\n");
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\/$/, "");
    if (
      !name ||
      /[\\\x00-\x1f]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      !allowed(name) ||
      seen.has(name)
    ) {
      throw new Error(
        "Backup archive contains an unexpected or unsafe member.",
      );
    }
    seen.add(name);
  }
  const verbose = (await runCommand("tar", ["-tvzf", archive])).stdout
    .trim()
    .split("\n");
  if (verbose.some((line) => !["-", "d"].includes(line[0]))) {
    throw new Error(
      "Backup archives may contain only regular files and directories, not links or special files.",
    );
  }
}

export function resolveRestoreAppdataTarget(
  entry: { envName: string; archivePath: string },
  env: Record<string, string | undefined> = process.env,
) {
  const known = new Set([
    "UPLOADS_DATA_PATH",
    "IMPORTS_DATA_PATH",
    "EXPORTS_DATA_PATH",
    "SCRYFALL_CONTAINER_DATA_PATH",
  ]);
  if (
    (!known.has(entry.envName) &&
      !/^BACKUP_APPDATA_PATHS_[1-9]\d*$/.test(entry.envName)) ||
    !/^appdata\/(uploads|imports|exports|scryfall|custom-[1-9]\d*)$/.test(
      entry.archivePath,
    )
  ) {
    throw new Error("Unsupported appdata mapping in backup manifest.");
  }
  const configured =
    env[entry.envName] ||
    getDefaultAppdataPaths(env).find((item) => item.envName === entry.envName)
      ?.sourcePath;
  if (!configured)
    throw new Error(
      `Configure ${entry.envName} before restoring appdata; archive source paths are never restore targets.`,
    );
  return resolve(configured);
}

async function canonicalTarget(path: string): Promise<string> {
  const info = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        "Appdata target must be a directory, not a file or symbolic link.",
      );
    return realpath(path);
  }
  return join(await canonicalTarget(dirname(path)), basename(path));
}

async function prepareRestoreAppdata(
  extractDir: string,
  manifest: BackupManifest,
) {
  const roots = manifest.appdata.map((entry) => entry.archivePath);
  // Validate all mappings before extracting any inner payload or touching targets.
  const targets = manifest.appdata.map((entry) =>
    resolveRestoreAppdataTarget(entry),
  );
  await validateArchiveMembers(
    join(extractDir, APPDATA_ARCHIVE_FILENAME),
    (name) =>
      name === "appdata" ||
      roots.some((root) => name === root || name.startsWith(`${root}/`)),
  );
  await runCommand("tar", [
    "-xzf",
    join(extractDir, APPDATA_ARCHIVE_FILENAME),
    "-C",
    extractDir,
  ]);
  const plan: RestoreAppdataEntry[] = [];
  const canonicalBackupDir = await canonicalTarget(resolve(getBackupDir()));
  for (const [index, entry] of manifest.appdata.entries()) {
    const targetPath = await canonicalTarget(targets[index]);
    assertSafeRestoreTarget(targetPath);
    if (
      isInsidePath(targetPath, canonicalBackupDir) ||
      isInsidePath(canonicalBackupDir, targetPath)
    )
      throw new Error("Restore target overlaps the backup directory.");
    if (
      isInsidePath(extractDir, targetPath) ||
      isInsidePath(targetPath, extractDir)
    )
      throw new Error("Restore target overlaps the restore workspace.");
    if (
      plan.some(
        (other) =>
          isInsidePath(targetPath, other.targetPath) ||
          isInsidePath(other.targetPath, targetPath),
      )
    )
      throw new Error("Appdata restore targets must not overlap.");
    const sourcePath = join(extractDir, entry.archivePath);
    if (!(await lstat(sourcePath)).isDirectory())
      throw new Error("An appdata payload is missing or is not a directory.");
    plan.push({ sourcePath, targetPath });
  }
  return plan;
}

async function applyRestoreAppdata(plan: RestoreAppdataEntry[]) {
  for (const { sourcePath, targetPath } of plan) {
    await mkdir(targetPath, { recursive: true });
    for (const child of await readdir(targetPath)) {
      await rm(join(targetPath, child), { recursive: true, force: true });
    }
    await cp(sourcePath, targetPath, {
      recursive: true,
    });
  }
}

export function assertSafeRestoreTarget(targetPath: string) {
  targetPath = resolve(targetPath);
  const parsed = parse(targetPath);
  if (
    targetPath === parsed.root ||
    targetPath.length < parsed.root.length + 4 ||
    isInsidePath(process.cwd(), targetPath) ||
    isInsidePath(homedir(), targetPath)
  ) {
    throw new Error(
      `Refusing to restore appdata into unsafe path: ${targetPath}`,
    );
  }
  if (
    isInsidePath(resolve(getBackupDir()), targetPath) ||
    isInsidePath(targetPath, resolve(getBackupDir()))
  ) {
    throw new Error("Refusing to restore appdata into the backup directory.");
  }
}

function validateManifest(manifest: BackupManifest) {
  if (
    manifest.app !== "MTG Archives" ||
    manifest.backupVersion !== 1 ||
    manifest.database?.format !== "pg_dump_custom" ||
    manifest.database?.filename !== DB_DUMP_FILENAME ||
    manifest.included?.database !== true ||
    typeof manifest.included?.appdata !== "boolean" ||
    !Array.isArray(manifest.appdata) ||
    manifest.included.appdata !== manifest.appdata.length > 0
  ) {
    throw new Error(
      "Backup manifest is not compatible with this restore tool.",
    );
  }
}

async function getServerMajor(connection: PgConnection) {
  const result = await runCommand(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      "SHOW server_version_num",
    ],
    { env: buildPgEnv(connection) },
  );
  const major = Math.floor(Number(result.stdout.trim()) / 10000);
  if (!Number.isInteger(major) || major < 10)
    throw new Error("Cannot determine supported PostgreSQL server version.");
  return major;
}

async function assertMatchingDumpClient(connection: PgConnection) {
  const client = (await runCommand("pg_dump", ["--version"])).stdout;
  const major = Number(client.match(/PostgreSQL\) (\d+)/)?.[1]);
  if (major !== (await getServerMajor(connection)))
    throw new Error(
      "Backup requires pg_dump matching the PostgreSQL server major version. Update the backup image before creating an archive.",
    );
}

async function requireRestoreConfirmation(confirmation?: string) {
  if (confirmation === "RESTORE") return;
  if (process.env.BACKUP_RESTORE_CONFIRM === "RESTORE") return;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      "Type RESTORE to replace the current MTG Archives database: ",
    );
    if (answer !== "RESTORE") throw new Error("Restore confirmation failed.");
  } finally {
    rl.close();
  }
}

function quotePgIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function getGitSha() {
  const envSha = process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (envSha) return envSha;
  try {
    const result = await runCommand("git", [
      "-c",
      `safe.directory=${process.cwd().replace(/\\/g, "/")}`,
      "rev-parse",
      "HEAD",
    ]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function timestampFromBackupFilename(filename: string) {
  const match = filename.match(
    /^mtg-archives-backup-(\d{8})-(\d{6})\.tar\.gz$/,
  );
  if (!match) return null;
  const [, date, time] = match;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(
    6,
    8,
  )}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
}

function uploadedBackupFilename(originalFilename: string) {
  const cleanName = basename(originalFilename.trim());
  if (
    cleanName.startsWith(BACKUP_PREFIX) &&
    cleanName.endsWith(BACKUP_SUFFIX)
  ) {
    return cleanName;
  }
  return `${BACKUP_PREFIX}${timestampForFilename()}-uploaded${BACKUP_SUFFIX}`;
}

function restoreReadme() {
  return `MTG Archives backup restore

This archive contains a PostgreSQL custom-format dump created with pg_dump -Fc.

Restore from the application container or a backup utility container:

  npm run backup:restore -- /path/to/mtg-archives-backup-YYYYMMDD-HHMMSS.tar.gz --force

The restore command requires typing RESTORE and replaces the configured target
database schema. Backups may include sensitive user, inventory, deck, import,
audit, and appdata records. Store them on persistent private storage.
`;
}

async function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveCommand({ stdout, stderr });
      else
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function isInsidePath(candidate: string, parent: string) {
  const resolvedCandidate = resolve(candidate);
  const resolvedParent = resolve(parent);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${sep}`)
  );
}
