import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type PricingRecoveryFile = { path: string; sha256: string };
export type PricingRecoveryCopy = PricingRecoveryFile & { destination: string;
  reused: boolean };
export type PricingRecoveryPackage = { schemaVersion: 1; observedDate: string;
  operation: "activation" | "correction" | "daily_compaction";
  files: Array<{ relativePath: string; sha256: string }> };

function inside(root: string, path: string) {
  return path.startsWith(`${root}${sep}`);
}

export async function verifyPricingRecoveryCopyDestination(sourceRoot: string,
  destinationRoot: string) {
  if (!destinationRoot.trim())
    throw new Error("PRICING_RECOVERY_COPY_DIR is required for archive maintenance");
  const sourceBase = await realpath(resolve(sourceRoot));
  const source = await realpath(resolve(sourceRoot, "pricing"));
  const destination = await realpath(resolve(destinationRoot));
  if (sourceBase === destination || inside(sourceBase, destination) ||
      inside(destination, sourceBase))
    throw new Error("Pricing recovery copy destination must be separate from the source");
  if (!(await lstat(destination)).isDirectory())
    throw new Error("Pricing recovery copy destination must be an existing directory");
  return { source, destination };
}

async function fileSha(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Publish an immutable index before copying. Its relative paths let a restore
 * operator use the copied package when the original backup directory is gone. */
export async function createPricingRecoveryPackage(sourceRoot: string,
  packagePath: string, observedDate: string,
  operation: PricingRecoveryPackage["operation"], files: PricingRecoveryFile[]) {
  const expectedFiles = operation === "daily_compaction" ? 2 : 4;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate) || files.length !== expectedFiles)
    throw new Error(`Recovery package requires one date and ${expectedFiles} verified files`);
  const source = await realpath(resolve(sourceRoot, "pricing"));
  const canonicalPackage = resolve(packagePath);
  if (!inside(source, canonicalPackage) || !canonicalPackage.endsWith(".package.json"))
    throw new Error("Recovery package must be under BACKUP_DIR/pricing");
  const entries = [];
  for (const file of files) {
    const canonical = await realpath(resolve(file.path));
    if (!inside(source, canonical) || !/^[a-f0-9]{64}$/i.test(file.sha256) ||
        await fileSha(canonical) !== file.sha256)
      throw new Error("Recovery package source is missing or changed");
    entries.push({ relativePath: relative(source, canonical), sha256: file.sha256 });
  }
  if (new Set(entries.map((entry) => entry.relativePath)).size !== expectedFiles)
    throw new Error("Recovery package files must be distinct");
  const document: PricingRecoveryPackage = { schemaVersion: 1, observedDate,
    operation, files: entries };
  writeFileSync(canonicalPackage, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
  return { path: canonicalPackage, sha256: await fileSha(canonicalPackage) };
}

/** Verify a copied package using only its destination. No source backup path or
 * database connection is required, so this also works during source loss. */
export async function verifyCopiedPricingRecoveryPackage(destinationRoot: string,
  packagePath: string) {
  const destination = await realpath(resolve(destinationRoot));
  if (!(await lstat(destination)).isDirectory())
    throw new Error("Pricing recovery destination must be a directory");
  const specified = resolve(packagePath);
  const packageInfo = await lstat(specified);
  const canonicalPackage = await realpath(specified);
  if (!inside(destination, canonicalPackage) || !canonicalPackage.endsWith(".package.json") ||
      !packageInfo.isFile() || packageInfo.isSymbolicLink())
    throw new Error("Pricing recovery package must be a regular destination file");
  const document = JSON.parse(readFileSync(canonicalPackage, "utf8")) as PricingRecoveryPackage;
  if (document.schemaVersion !== 1 ||
      !["activation", "correction", "daily_compaction"].includes(document.operation) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(document.observedDate) ||
      !Array.isArray(document.files) || document.files.length !==
        (document.operation === "daily_compaction" ? 2 : 4))
    throw new Error("Invalid Pricing recovery package index");
  const files: Array<{ relativePath: string; destination: string; sha256: string }> = [];
  const seen = new Set<string>();
  for (const file of document.files) {
    if (typeof file.relativePath !== "string" || isAbsolute(file.relativePath) ||
        file.relativePath.split(/[\\/]/).includes("..") ||
        !/^[a-f0-9]{64}$/i.test(file.sha256))
      throw new Error("Invalid Pricing recovery package entry");
    const expected = resolve(destination, file.relativePath);
    const info = await lstat(expected);
    const target = await realpath(expected);
    if (!inside(destination, target) || target !== expected || seen.has(target) ||
        !info.isFile() || info.isSymbolicLink() || await fileSha(target) !== file.sha256)
      throw new Error(`Pricing recovery package file missing or changed: ${file.relativePath}`);
    seen.add(target);
    files.push({ relativePath: file.relativePath, destination: target, sha256: file.sha256 });
  }
  const dumps = files.filter((file) => file.relativePath.endsWith(".dump")).length;
  const archives = files.filter((file) => file.relativePath.endsWith(".csv.gz")).length;
  const manifests = files.filter((file) => file.relativePath.endsWith(".json")).length;
  if (dumps !== 1 || archives !== (document.operation === "daily_compaction" ? 0 : 1) ||
      manifests !== (document.operation === "daily_compaction" ? 1 : 2))
    throw new Error("Pricing recovery package lacks expected file roles");
  return { document, files, packagePath: canonicalPackage };
}

/** Copy immutable Pricing recovery files to another mounted storage root and
 * read them back before any caller changes live Pricing state. */
export async function copyVerifiedPricingRecoveryFiles(sourceRoot: string,
  destinationRoot: string, files: PricingRecoveryFile[]): Promise<PricingRecoveryCopy[]> {
  if (!files.length) throw new Error("At least one Pricing recovery file is required");
  const { source, destination } = await verifyPricingRecoveryCopyDestination(
    sourceRoot, destinationRoot);
  const copies: PricingRecoveryCopy[] = [];
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/i.test(file.sha256))
      throw new Error("Pricing recovery file requires a SHA-256 hash");
    const specified = resolve(file.path);
    const info = await lstat(specified);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Pricing recovery source must be a regular file");
    const canonical = await realpath(specified);
    if (!inside(source, canonical))
      throw new Error("Pricing recovery source is outside BACKUP_DIR/pricing");
    if (await fileSha(canonical) !== file.sha256)
      throw new Error("Pricing recovery source hash changed before copy");
    const target = resolve(destination, relative(source, canonical));
    if (!inside(destination, target))
      throw new Error("Pricing recovery destination escaped its root");
    await mkdir(dirname(target), { recursive: true });
    const targetParent = await realpath(dirname(target));
    if (targetParent !== destination && !inside(destination, targetParent))
      throw new Error("Pricing recovery destination parent escaped its root");
    const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current) {
      if (!current.isFile() || current.isSymbolicLink() ||
          await fileSha(target) !== file.sha256)
        throw new Error("Existing Pricing recovery copy differs from source");
      copies.push({ ...file, destination: target, reused: true });
      continue;
    }
    const temporary = `${target}.partial-${randomUUID()}`;
    try {
      await copyFile(canonical, temporary, constants.COPYFILE_EXCL);
      const handle = await open(temporary, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      if (await fileSha(canonical) !== file.sha256 ||
          await fileSha(temporary) !== file.sha256)
        throw new Error("Pricing recovery file changed while copying");
      // An exclusive hard link publishes a complete copy without replacing an
      // immutable earlier generation if another worker raced this one.
      await link(temporary, target);
      if (process.platform !== "win32") {
        const parent = await open(dirname(target), "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
      if (await fileSha(target) !== file.sha256)
        throw new Error("Pricing recovery destination read-back differs");
      copies.push({ ...file, destination: target, reused: false });
    } finally { await rm(temporary, { force: true }); }
  }
  return copies;
}

/** A killed copy can leave an unpublished .partial-UUID beside its target.
 * Only the exact temporary naming scheme is eligible, and only after a week.
 * Published files, package indexes, symlinks and recent copies are untouched. */
export async function pruneStalePricingRecoveryPartials(destinationRoot: string,
  now = Date.now(), apply = false) {
  const destination = await realpath(resolve(destinationRoot));
  if (!(await lstat(destination)).isDirectory())
    throw new Error("Pricing recovery destination must be a directory");
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const pending = [destination];
  let eligible = 0, removed = 0, bytes = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    if (await realpath(directory) !== directory ||
        (directory !== destination && !inside(destination, directory)))
      throw new Error("Pricing recovery cleanup directory changed or escaped its root");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (!inside(destination, path))
        throw new Error("Pricing recovery cleanup path escaped its root");
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!/\.(?:dump|json|csv\.gz)\.partial-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(entry.name))
        continue;
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs > cutoff)
        continue;
      eligible += 1;
      bytes += info.size;
      if (apply) {
        // Recheck after the scan; a resumed or replaced copy must not be removed.
        const current = await lstat(path);
        if (!current.isFile() || current.isSymbolicLink() ||
            current.mtimeMs > cutoff || current.ino !== info.ino ||
            current.size !== info.size)
          continue;
        await rm(path);
        removed += 1;
      }
    }
  }
  return { eligible, removed, bytes };
}
