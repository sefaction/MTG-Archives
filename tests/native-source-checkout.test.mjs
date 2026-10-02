import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { nativeSourceCheckout } from "../scripts/verify-native-source.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" } });
}
function fixture() {
  const parent = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(parent, "mtg-native-source-"));
  const seed = path.join(root, "seed"); mkdirSync(seed);
  const inputs = nativeSourceCheckout();
  for (const name of Object.keys(inputs.files)) {
    const target = path.join(seed, name); mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(name));
  }
  writeFileSync(path.join(seed, ".gitattributes"), "*.sh text eol=lf\n");
  git(seed, "init", "--quiet", "--initial-branch=main");
  git(seed, "config", "core.autocrlf", "false");
  const commit = () => { git(seed, "add", "."); git(seed, "-c", "user.name=Owned fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Native checkout fixture"); };
  commit();
  const cleanup = () => {
    const relative = path.relative(parent, root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert.ok(path.basename(root).startsWith("mtg-native-source-"));
    rmSync(root, { recursive: true, force: true });
  };
  return { root, seed, inputs, commit, cleanup };
}

test("native fingerprint bytes match under Windows and Linux Git newline modes", () => {
  const f = fixture();
  try {
    const file = "tools/acquisition-eval/image_encoder.py";
    const broken = path.join(f.root, "without-python-policy");
    git(f.root, "clone", "--quiet", "--no-local", "-c", "core.autocrlf=true", f.seed, broken);
    const brokenBytes = readFileSync(path.join(broken, file));
    assert.ok(brokenBytes.includes(Buffer.from("\r\n")), "baseline reproduces Windows conversion");
    assert.notEqual(sha(brokenBytes), f.inputs.files[file], "raw fingerprint mismatch is reproduced");
    writeFileSync(path.join(f.seed, ".gitattributes"), readFileSync(".gitattributes")); f.commit();
    for (const mode of ["true", "false", "input"]) {
      const clone = path.join(f.root, `fixed-${mode}`);
      git(f.root, "clone", "--quiet", "--no-local", "-c", `core.autocrlf=${mode}`, f.seed, clone);
      assert.deepEqual(nativeSourceCheckout(clone).files, f.inputs.files,
        `every tracked native Python fingerprint remains canonical with autocrlf=${mode}`);
    }
    // The guarded operation also repairs an existing checkout after adoption.
    git(broken, "fetch", "--quiet", "origin");
    git(broken, "checkout", "origin/main", "--", ".gitattributes");
    const repaired = nativeSourceCheckout(broken, true);
    assert.ok(repaired.refreshed.length > 0);
    assert.deepEqual(repaired.files, f.inputs.files);
    assert.deepEqual(nativeSourceCheckout(broken, true).refreshed, [], "refresh is idempotent");
  } finally { f.cleanup(); }
});

test("native refresh preserves code edits and never touches model/index data", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.seed, ".gitattributes"), readFileSync(".gitattributes")); f.commit();
    const names = Object.keys(f.inputs.files), first = names[0], edited = names[1];
    const crlf = name => readFileSync(path.join(f.seed, name)).toString("latin1").replace(/\r?\n/g, "\r\n");
    writeFileSync(path.join(f.seed, first), crlf(first), "latin1");
    writeFileSync(path.join(f.seed, edited), crlf(edited) + "# intentional code change\r\n", "latin1");
    const before = [first, edited].map(name => readFileSync(path.join(f.seed, name)));
    mkdirSync(path.join(f.seed, "models")); const model = path.join(f.seed, "models", "index.json");
    writeFileSync(model, "Retain original model/index bytes\r\n"); const modelBytes = readFileSync(model);
    assert.throws(() => nativeSourceCheckout(f.seed, true), /Preserve unstaged native code edits/);
    for (const [n, name] of [first, edited].entries()) assert.deepEqual(readFileSync(path.join(f.seed, name)), before[n], "failed guard makes no partial writes");
    git(f.seed, "add", edited);
    const repaired = nativeSourceCheckout(f.seed, true);
    assert.notEqual(repaired.files[edited], f.inputs.files[edited], "genuine source change retains its new identity");
    assert.ok(readFileSync(path.join(f.seed, edited)).toString().includes("# intentional code change"));
    assert.deepEqual(readFileSync(model), modelBytes);
  } finally { f.cleanup(); }
});