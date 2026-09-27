import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

// One repeatable command, no application snapshot or existing container touched.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--core"))
  throw new Error("Only --core is supported");
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(
  root,
  ".local-data",
  "verification",
  `acquisition-${stamp}`,
);
mkdirSync(output, { recursive: true });
const log = path.join(output, "checks.log");
const steps: { name: string; elapsedMs: number; passed: boolean }[] = [];
const started = Date.now();
let container = "";
let cleaned = false;
let source: { commit: string; contentSha256: string } | undefined;
const label = `acquisition-validation-${randomUUID()}`;
let env = { ...process.env };
function command(program: string, parameters: string[]) {
  return execFileSync(program, parameters, {
    cwd: root,
    env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function step(name: string, program: string, parameters: string[]) {
  const start = Date.now();
  try {
    const result = command(program, parameters);
    appendFileSync(log, `\n## ${name}\n${result}\n`);
    steps.push({ name, elapsedMs: Date.now() - start, passed: true });
    console.log(`PASS ${name} (${Date.now() - start} ms)`);
    return result;
  } catch (error: any) {
    const details = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`;
    appendFileSync(log, `\n## FAILED ${name}\n${details}\n`);
    steps.push({ name, elapsedMs: Date.now() - start, passed: false });
    console.error(details.slice(-8000));
    throw new Error(`Failed: ${name}`);
  }
}
const node = (name: string, script: string, ...parameters: string[]) =>
  step(name, process.execPath, [path.join(root, script), ...parameters]);
async function main() {
  const paths = command("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "lib",
    "tests",
    "scripts",
    "prisma",
    "package.json",
    "package-lock.json",
    ".github/workflows/verify.yml",
  ]);
  const hash = createHash("sha256");
  for (const file of [...new Set(paths.split("\0").filter(Boolean))].sort()) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  }
  source = {
    commit: command("git", ["rev-parse", "HEAD"]).trim(),
    contentSha256: hash.digest("hex"),
  };
  const context = command("docker", ["context", "show"]).trim();
  const endpoint = JSON.parse(
    command("docker", [
      "context",
      "inspect",
      context,
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
  );
  const local = (value: string) => /^(npipe:\/\/|unix:\/\/)/.test(value);
  if (
    !local(endpoint) ||
    (process.env.DOCKER_HOST && !local(process.env.DOCKER_HOST))
  )
    throw new Error("Validation requires a local Docker engine");
  container = step("start disposable PostgreSQL", "docker", [
    "run",
    "-d",
    "--name",
    label,
    "--label",
    `mtg-acquisition-validation=${label}`,
    "-e",
    "POSTGRES_USER=mtgfixture",
    "-e",
    "POSTGRES_PASSWORD=fixture-only",
    "-e",
    "POSTGRES_DB=acquisition_fixture",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]).trim();
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error("Unexpected container identity");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      command("docker", [
        "exec",
        container,
        "pg_isready",
        "-U",
        "mtgfixture",
        "-d",
        "acquisition_fixture",
      ]);
      ready = true;
      break;
    } catch {
      await setTimeout(250);
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const port = command("docker", ["port", container, "5432/tcp"])
    .trim()
    .match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error("Expected a loopback-only database port");
  env = {
    ...env,
    DATABASE_URL: `postgresql://mtgfixture:fixture-only@127.0.0.1:${port}/acquisition_fixture`,
    MTG_LOCAL_PILOT_TEST: "1",
  };
  node(
    "generate Prisma client",
    "node_modules/prisma/build/index.js",
    "generate",
  );
  node(
    "apply migrations to disposable database",
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  );
  node(
    "pure acquisition behavior",
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "tests/acquisition-domain.test.ts",
  );
  node(
    "persisted acquisition integrity",
    "node_modules/tsx/dist/cli.mjs",
    "scripts/verify-acquisition-store.ts",
  );
  node(
    "shared receipt and import integrity",
    "node_modules/tsx/dist/cli.mjs",
    "scripts/verify-import-commit.ts",
  );
  if (args.includes("--core")) {
    if (!process.env.npm_execpath)
      throw new Error("Use npm run verify:acquisition -- --core");
    step("full core build verification", process.execPath, [
      process.env.npm_execpath,
      "run",
      "verify:core",
    ]);
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      if (container) {
        const labels = JSON.parse(
          command("docker", [
            "inspect",
            container,
            "--format",
            "{{json .Config.Labels}}",
          ]),
        );
        if (labels["mtg-acquisition-validation"] !== label)
          throw new Error("Refusing cleanup: fixture label mismatch");
        step("remove owned fixture and anonymous volume", "docker", [
          "rm",
          "-f",
          "-v",
          container,
        ]);
      }
      cleaned = true;
    } catch (error: any) {
      console.error(error.message);
      process.exitCode = 1;
    }
    writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          version: 1,
          passed: !process.exitCode,
          cleaned,
          source,
          elapsedMs: Date.now() - started,
          steps,
        },
        null,
        2,
      ),
    );
    console.log(`Evidence: ${output}`);
  });
