import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export type PricingRecoveryFile = { path: string; sha256: string };
export type PricingRecoveryCopy = PricingRecoveryFile & { destination: string;
  reused: boolean };

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
