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
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { constants } from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

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

export function loadEnvFile(path = ".env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function getBackupDir(env: Record<string, string | undefined> = process.env) {
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
  const backupDir = resolve(getBackupDir());
  await mkdir(backupDir, { recursive: true });

  const timestamp = timestampForFilename();
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-backup-"));
  const bundleRoot = join(workspace, "bundle");
  await mkdir(bundleRoot, { recursive: true });

  const dumpPath = join(bundleRoot, DB_DUMP_FILENAME);
  await runCommand(
    "pg_dump",
    ["--format=custom", "--file", dumpPath, "--no-owner", "--no-acl"],
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
    .filter((file) => file.startsWith(BACKUP_PREFIX) && file.endsWith(BACKUP_SUFFIX))
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
    days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    if (keep.has(entry.path)) continue;
    const createdAt = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
    const isExpiredByAge = days > 0 && Number.isFinite(createdAt) && createdAt < cutoff;
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

export async function restoreBackup(backupPath: string, options: { force?: boolean } = {}) {
  loadEnvFile();
  if (!backupPath) throw new Error("Backup path is required.");
  const fullBackupPath = resolve(backupPath);
  await access(fullBackupPath, constants.R_OK);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const connection = parseDatabaseUrl(databaseUrl);
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-restore-"));
  const extractDir = join(workspace, "extract");
  await mkdir(extractDir, { recursive: true });
  await runCommand("tar", ["-xzf", fullBackupPath, "-C", extractDir]);

  const manifest = JSON.parse(
    await readFile(join(extractDir, MANIFEST_FILENAME), "utf8"),
  ) as BackupManifest;
  validateManifest(manifest);

  if (!options.force) {
    await rm(workspace, { recursive: true, force: true });
    return {
      dryRun: true as const,
      manifest,
      message:
        "Restore was not run. Re-run with --force and type RESTORE to replace the current database.",
    };
  }

  await requireRestoreConfirmation();
  const schema = connection.schema || "public";
  await runCommand(
    "psql",
    [
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `DROP SCHEMA IF EXISTS ${quotePgIdentifier(schema)} CASCADE; CREATE SCHEMA ${quotePgIdentifier(schema)};`,
    ],
    { env: buildPgEnv(connection) },
  );
  await runCommand(
    "pg_restore",
    ["--dbname", connection.database, "--no-owner", "--no-acl", join(extractDir, DB_DUMP_FILENAME)],
    { env: buildPgEnv(connection) },
  );

  if (manifest.included.appdata) {
    await restoreAppdata(extractDir, manifest);
  }
  await rm(workspace, { recursive: true, force: true });
  return { dryRun: false as const, manifest };
}

export async function readManifestFromBackup(backupPath: string) {
  const workspace = await mkdtemp(join(tmpdir(), "mtg-archives-manifest-"));
  try {
    await runCommand("tar", ["-xzf", backupPath, "-C", workspace, MANIFEST_FILENAME]);
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
    await mkdir(dirname(join(bundleRoot, entry.archivePath)), { recursive: true });
    await cp(sourcePath, join(bundleRoot, entry.archivePath), {
      recursive: true,
      dereference: false,
      filter: (source) => !isInsidePath(source, resolve(getBackupDir())),
    });
    existing.push({ ...entry, sourcePath });
  }
  if (existing.length === 0) return [];
  await runCommand("tar", ["-czf", join(bundleRoot, APPDATA_ARCHIVE_FILENAME), "-C", bundleRoot, "appdata"]);
  await rm(stagingRoot, { recursive: true, force: true });
  return existing;
}

async function restoreAppdata(extractDir: string, manifest: BackupManifest) {
  await runCommand("tar", [
    "-xzf",
    join(extractDir, APPDATA_ARCHIVE_FILENAME),
    "-C",
    extractDir,
  ]);
  for (const entry of manifest.appdata) {
    const targetPath = resolve(process.env[entry.envName] || entry.sourcePath);
    assertSafeRestoreTarget(targetPath);
    await mkdir(targetPath, { recursive: true });
    for (const child of await readdir(targetPath)) {
      await rm(join(targetPath, child), { recursive: true, force: true });
    }
    await cp(join(extractDir, entry.archivePath), targetPath, { recursive: true });
  }
}

function assertSafeRestoreTarget(targetPath: string) {
  const parsed = parse(targetPath);
  if (targetPath === parsed.root || targetPath.length < parsed.root.length + 4) {
    throw new Error(`Refusing to restore appdata into unsafe path: ${targetPath}`);
  }
  if (isInsidePath(resolve(getBackupDir()), targetPath)) {
    throw new Error("Refusing to restore appdata into the backup directory.");
  }
}

function validateManifest(manifest: BackupManifest) {
  if (
    manifest.app !== "MTG Archives" ||
    manifest.backupVersion !== 1 ||
    manifest.database?.format !== "pg_dump_custom" ||
    manifest.database?.filename !== DB_DUMP_FILENAME
  ) {
    throw new Error("Backup manifest is not compatible with this restore tool.");
  }
}

async function requireRestoreConfirmation() {
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
  const match = filename.match(/^mtg-archives-backup-(\d{8})-(\d{6})\.tar\.gz$/);
  if (!match) return null;
  const [, date, time] = match;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(
    6,
    8,
  )}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
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
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
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
