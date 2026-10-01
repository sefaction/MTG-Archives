import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const scannerInstallerFilename = "MTGArchivesScannerSetup.exe";

export async function findScannerInstaller(
  importsRoot = process.env.IMPORTS_DATA_PATH ?? "/app/data/imports",
  bundledRoot = join(process.cwd(), "scanner-installer"),
) {
  // The release image takes priority over older persistent staged installers.
  // Development images may still use the existing imports-directory staging.
  for (const folder of [bundledRoot, join(importsRoot, "scanner-installer")]) {
    const path = join(folder, scannerInstallerFilename);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size <= 0 || info.size >= 1024 ** 3) continue;
    let version: string | null = null;
    const manifestPath = join(folder, "MTGArchivesScannerSetup.json");
    const manifestInfo = await stat(manifestPath).catch(() => null);
    if (manifestInfo?.isFile() && manifestInfo.size < 8192) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (typeof manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(manifest.version)) version = manifest.version;
      } catch { /* Older staged installers can still be downloaded. */ }
    }
    return { path, size: info.size, version };
  }
  return null;
}