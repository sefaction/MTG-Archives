import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const image = process.argv[2];
if (!image || !/^mtg-archives-web:[a-z0-9-]+$/.test(image)) throw Error("Supply a prepared local MTG Archives web image");
const id = `restore-workers-${randomUUID()}`;
const network = `${id}-net`;
let database = "";
let networkCreated = false;
let cleaned = false;
mkdirSync(".local-data", { recursive: true });
const report = `.local-data/${id}.json`;
const run = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const state = () => writeFileSync(report, JSON.stringify({ id, image, network, database, cleaned }));
async function main() {
  const context = run(["context", "show"]).trim();
  const endpoint = run(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  if (!/^(npipe:|unix:)/.test(endpoint.trim()) || process.env.DOCKER_HOST && !/^(npipe:|unix:)/.test(process.env.DOCKER_HOST)) throw Error("Requires local Docker");
  run(["network", "create", "--internal", "--label", `mtg-restore-workers=${id}`, network]);
  networkCreated = true;
  state();
  database = run(["run", "-d", "--name", id, "--label", `mtg-restore-workers=${id}`, "--network", network, "--network-alias", "restore-fixture", "-e", "POSTGRES_USER=mtgfixture", "-e", "POSTGRES_PASSWORD=fixture-only", "-e", "POSTGRES_DB=acquisition_restore_fixture", "postgres:16-alpine"]).trim();
  if (!/^[a-f0-9]{64}$/.test(database)) throw Error("Unexpected owned database identity");
  state();
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { run(["exec", database, "pg_isready", "-U", "mtgfixture", "-d", "acquisition_restore_fixture"]); ready = true; break; }
    catch { await setTimeout(250); }
  }
  if (!ready) throw Error("Fixture did not become ready");
  const base = ["run", "--rm", "--name", `${id}-app`, "--label", `mtg-restore-workers=${id}`, "--network", network,
    "-e", "DATABASE_URL=postgresql://mtgfixture:fixture-only@restore-fixture:5432/acquisition_restore_fixture",
    "-e", "MTG_LOCAL_PILOT_TEST=1", "-e", "BACKUP_DIR=/tmp/mtg-worker-restore-backups",
    "-e", "BACKUP_RETENTION_COUNT=0", "-e", "BACKUP_RETENTION_DAYS=0", "--entrypoint", "node", image];
  run([...base, "node_modules/prisma/build/index.js", "migrate", "deploy"]);
  console.log(run([...base, "node_modules/tsx/dist/cli.mjs", "scripts/verify-restore-worker-archive.ts"]).trim());
}
void main().catch(error => { console.error(error.stdout ?? ""); console.error(error.stderr ?? ""); console.error(error.message); process.exitCode = 1; }).finally(() => {
  for (const name of [`${id}-app`, database].filter(Boolean)) {
    let label = "";
    try { label = run(["inspect", name, "--format", '{{index .Config.Labels "mtg-restore-workers"}}']).trim(); } catch { continue; }
    if (label !== id) throw Error("Refusing cleanup of unowned container");
    run(["rm", "-f", "-v", name]);
  }
  if (networkCreated) {
    const label = run(["network", "inspect", network, "--format", '{{index .Labels "mtg-restore-workers"}}']).trim();
    if (label !== id) throw Error("Refusing cleanup of unowned network");
    run(["network", "rm", network]);
  }
  cleaned = true;
  state();
  console.log("Owned isolated restore containers, volume and internal network removed.");
});
