import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { reviewBuildManifest } from "../lib/review-build-provenance";

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "mtg-build-provenance-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function put(root: string, file: string, content = "initial") {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

for (const file of [
  "middleware.ts",
  "types.d.ts",
  "next-env.d.ts",
  "prisma.config.ts",
  "eslint.config.mjs",
  "playwright.config.ts",
  ".dockerignore",
  "tests/typecheck-input.test.ts",
  "tools/typecheck/input.ts",
]) {
  test(`build identity binds mutations and removal of ${file}`, () =>
    fixture((root) => {
      put(root, file);
      const before = reviewBuildManifest(root);
      assert.equal(
        before.files[file],
        createHash("sha256").update("initial").digest("hex"),
      );
      put(root, file, "changed");
      const after = reviewBuildManifest(root);
      assert.notEqual(after.files[file], before.files[file]);
      assert.notEqual(after.digest, before.digest);
      rmSync(path.join(root, file));
      assert.notEqual(reviewBuildManifest(root).digest, before.digest);
    }));
}

test("manifest covers current TypeScript build inputs and Docker build configuration", () => {
  const root = process.cwd();
  const config = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);
  const manifest = reviewBuildManifest(root);
  const inputs = parsed.fileNames
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
    // Generated inputs excluded from Docker are not source inputs to its build.
    .filter(
      (file) =>
        !file.startsWith(".next/") &&
        !/^tools\/scanner-agent\/(bin|obj)\//.test(file),
    );
  assert.ok(inputs.length > 0);
  for (const file of [
    ...inputs,
    "Dockerfile",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "docker-entrypoint.sh",
    "next.config.ts",
    "prisma.config.ts",
    "eslint.config.mjs",
    "postcss.config.js",
    "tailwind.config.ts",
  ]) {
    assert.ok(manifest.files[file], `unbound build input: ${file}`);
    assert.equal(
      manifest.files[file],
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
    );
  }
});

test("manifest is deterministic across creation order and retains exact source bytes", () =>
  fixture((left) =>
    fixture((right) => {
      const files = ["lib/z.ts", "lib/a.ts", "app/page.tsx", "types.d.ts"];
      for (const file of files) put(left, file, "line\r\n");
      for (const file of [...files].reverse()) put(right, file, "line\r\n");
      const manifest = reviewBuildManifest(left);
      assert.deepEqual(manifest, reviewBuildManifest(right));
      assert.equal(manifest.version, 1);
      assert.deepEqual(
        Object.keys(manifest.files),
        [...files].sort((a, b) => a.localeCompare(b, "en")),
      );
      assert.equal(
        manifest.digest,
        createHash("sha256")
          .update(JSON.stringify(manifest.files))
          .digest("hex"),
      );
      put(right, "types.d.ts", "line\n");
      assert.notEqual(reviewBuildManifest(right).digest, manifest.digest);
    }),
  ));

test("private, environment, generated, dependency and Git paths remain excluded", () =>
  fixture((root) => {
    put(root, "app/page.tsx");
    const before = reviewBuildManifest(root);
    for (const file of [
      ".env",
      ".env.local",
      ".env.example",
      ".local-data/private.json",
      ".git/config",
      ".codex/config.toml",
      "node_modules/package/index.js",
      ".next/types/routes.d.ts",
      "build-source-manifest.json",
      "tools/scanner-agent/bin/private.dll",
      "tools/scanner-agent/obj/project.assets.json",
      "tools/acquisition-eval/__pycache__/worker.pyc",
      "tools/acquisition-eval/worker.pyc",
      "tests/nested/__pycache__/test.pyc",
      "lib/__pycache__/generated.pyc",
    ])
      put(root, file, "private sentinel");
    assert.deepEqual(reviewBuildManifest(root), before);
  }));

test("environment files inside included roots are refused", () => {
  for (const file of [
    "app/.env.local",
    "tests/.env",
    "tools/nested/.env.secret",
  ])
    fixture((root) => {
      put(root, file);
      assert.throws(
        () => reviewBuildManifest(root),
        /Secret paths must not be build inputs/,
      );
    });
});

test("symlink files and directories in build inputs are refused", () =>
  fixture((root) => {
    put(root, "private/secret.ts");
    mkdirSync(path.join(root, "lib"));
    // A directory junction requires no Windows symlink privilege and exercises
    // the same Dirent guard. Linux also checks file symlinks.
    const link = path.join(root, "lib/linked");
    symlinkSync(
      path.join(root, "private"),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => reviewBuildManifest(root),
      /symlinks require explicit review/,
    );
    rmSync(link);
    if (process.platform !== "win32") {
      symlinkSync(
        path.join(root, "private/secret.ts"),
        path.join(root, "types.d.ts"),
      );
      assert.throws(
        () => reviewBuildManifest(root),
        /symlinks require explicit review/,
      );
    }
  }));
