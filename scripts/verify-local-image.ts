import { execFileSync } from "node:child_process";
import { reviewBuildManifest } from "../lib/review-build-provenance";
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^mtg-archives-[a-z-]+-1$/.test(args[0])))
  throw new Error("Use an MTG Archives local container name");
const container = args[0] ?? "mtg-archives-web-1";
const run = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
const context = run("context", "show").trim();
const endpoint = JSON.parse(
  run(
    "context",
    "inspect",
    context,
    "--format",
    "{{json .Endpoints.docker.Host}}",
  ),
);
if (!/^(npipe:|unix:)/.test(process.env.DOCKER_HOST ?? endpoint))
  throw new Error("Requires a local Docker engine");
const local = reviewBuildManifest();
const actual = JSON.parse(
  run(
    "exec",
    container,
    "node",
    "-e",
    "process.stdout.write(require('fs').readFileSync('/app/build-source-manifest.json','utf8'))",
  ),
);
const mismatches = [
  ...new Set([...Object.keys(local.files), ...Object.keys(actual.files ?? {})]),
].filter((file) => local.files[file] !== actual.files?.[file]);
if (
  actual.version !== 1 ||
  actual.digest !== local.digest ||
  mismatches.length
) {
  console.error(
    "Loaded image does not match this worktree:",
    mismatches.slice(0, 20).join(", "),
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      passed: true,
      image: run("inspect", container, "--format", "{{.Image}}").trim(),
      sourceDigest: local.digest,
      files: Object.keys(local.files).length,
    }),
  );
