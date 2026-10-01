import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findScannerInstaller } from "../lib/scanner-installer";

test("image installer supersedes persistent old package; development staging still works", async () => {
  const root = await mkdtemp(join(tmpdir(), "mtg-installer-"));
  const bundled = join(root, "image");
  const imports = join(root, "imports");
  const staged = join(imports, "scanner-installer");
  try {
    assert.equal(await findScannerInstaller(imports, bundled), null);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, "MTGArchivesScannerSetup.exe"), "old installer");
    await writeFile(join(staged, "MTGArchivesScannerSetup.json"), JSON.stringify({version:"0.3.7"}));
    assert.equal((await findScannerInstaller(imports, bundled))?.version, "0.3.7");
    await mkdir(bundled);
    await writeFile(join(bundled, "MTGArchivesScannerSetup.exe"), "release installer");
    await writeFile(join(bundled, "MTGArchivesScannerSetup.json"), JSON.stringify({version:"0.3.8"}));
    const selected = await findScannerInstaller(imports, bundled);
    assert.equal(selected?.path, join(bundled, "MTGArchivesScannerSetup.exe"));
    assert.equal(selected?.version, "0.3.8");
    assert.equal(selected?.size, 17);
    await writeFile(join(bundled, "MTGArchivesScannerSetup.exe"), "");
    assert.equal((await findScannerInstaller(imports, bundled))?.version, "0.3.7");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy staged installer remains usable with malformed or oversized version metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mtg-installer-"));
  try {
    await writeFile(join(root, "MTGArchivesScannerSetup.exe"), "installer");
    for (const manifest of ["bad JSON", JSON.stringify({version:"not-a-version"}), " ".repeat(8193)]) {
      await writeFile(join(root, "MTGArchivesScannerSetup.json"), manifest);
      assert.equal((await findScannerInstaller(join(root, "missing"), root))?.version, null);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});