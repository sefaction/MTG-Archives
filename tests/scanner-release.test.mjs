import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyScannerRelease } from "../scripts/verify-scanner-release.mjs";

test("release fails closed for missing, unqualified, stale or corrupt installer artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "mtg-release-"));
  const source = "1".repeat(40);
  const data = Buffer.from("MZrelease-test-fixture");
  const manifest = { version:"0.3.8", sourceCommit:source, sha256:createHash("sha256").update(data).digest("hex"), distributionMaterialsComplete:true };
  const metadata = join(root, "MTGArchivesScannerSetup.json");
  const exe = join(root, "MTGArchivesScannerSetup.exe");
  try {
    assert.equal(await verifyScannerRelease(root), null);
    await assert.rejects(verifyScannerRelease(root, true));
    await writeFile(exe, data);
    await writeFile(metadata, JSON.stringify({...manifest, distributionMaterialsComplete:false}));
    await assert.rejects(verifyScannerRelease(root, true, source), /materials incomplete/);
    await writeFile(metadata, JSON.stringify(manifest));
    await assert.rejects(verifyScannerRelease(root, true, "2".repeat(40)), /different source revision/);
    assert.equal((await verifyScannerRelease(root, true, source)).version, "0.3.8");
    await writeFile(exe, "MZtampered");
    await assert.rejects(verifyScannerRelease(root, true, source), /checksum mismatch/);
    await writeFile(metadata, " ".repeat(8193));
    await assert.rejects(verifyScannerRelease(root, true, source), /Invalid scanner installer/);
  } finally { await rm(root, {recursive:true, force:true}); }
});