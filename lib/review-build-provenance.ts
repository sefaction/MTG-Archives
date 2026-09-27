import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// Explicit build inputs only; no .env, private data, credentials or git metadata.
const roots = [
  "app",
  "components",
  "lib",
  "prisma",
  "scripts",
  "public",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "docker-entrypoint.sh",
  "next.config.ts",
  "tsconfig.json",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
];
export function reviewBuildManifest(root = process.cwd()) {
  const files: Record<string, string> = {};
  function visit(relative: string) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    const name = path.basename(relative);
    if (name.startsWith(".env"))
      throw new Error("Secret paths must not be build inputs");
    const entries = readdirSync(path.dirname(absolute), {
      withFileTypes: true,
    });
    const info = entries.find((entry) => entry.name === name)!;
    if (info.isSymbolicLink())
      throw new Error("Build source symlinks require explicit review");
    if (info.isDirectory())
      for (const entry of readdirSync(absolute).sort())
        visit(`${relative}/${entry}`);
    else
      files[relative] = createHash("sha256")
        .update(readFileSync(absolute))
        .digest("hex");
  }
  roots.forEach(visit);
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  return {
    version: 1,
    files: sorted,
    digest: createHash("sha256").update(JSON.stringify(sorted)).digest("hex"),
  };
}
