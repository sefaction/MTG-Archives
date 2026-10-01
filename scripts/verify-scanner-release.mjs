import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyScannerRelease(folder, required = false, sourceCommit) {
  const installer = join(folder, "MTGArchivesScannerSetup.exe");
  const manifestPath = join(folder, "MTGArchivesScannerSetup.json");
  if (!existsSync(installer) && !existsSync(manifestPath) && !required) return null;
  const info = lstatSync(installer);
  const manifestInfo = lstatSync(manifestPath);
  if (!info.isFile() || info.size < 2 || info.size >= 1024 ** 3 ||
      !manifestInfo.isFile() || manifestInfo.size > 8192)
    throw new Error("Invalid scanner installer file or manifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "") ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? "") ||
      !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "") ||
      manifest.distributionMaterialsComplete !== true)
    throw new Error("Scanner release metadata or distribution materials incomplete");
  if (sourceCommit && manifest.sourceCommit !== sourceCommit)
    throw new Error("Scanner installer belongs to a different source revision");
  const hash = createHash("sha256");
  let prefix;
  for await (const chunk of createReadStream(installer)) {
    prefix ??= chunk.subarray(0, 2).toString("ascii");
    hash.update(chunk);
  }
  if (prefix !== "MZ" || hash.digest("hex") !== manifest.sha256)
    throw new Error("Scanner installer binary/checksum mismatch");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await verifyScannerRelease(process.argv[2] ?? "scanner-installer", process.argv[3] === "true", process.argv[4]);
  console.log(manifest ? `Verified Windows scanner installer ${manifest.version}` : "Development image: no bundled scanner installer");
}