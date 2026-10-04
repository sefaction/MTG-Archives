import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureQuiescentLocalDrill } from "../scripts/backup-drill-local-capture";

test("uncertain scanner preflight rejects before creating a capsule, archive or changing services", async () => {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "mtg-drill-preflight-"));
  try {
    process.chdir(root);
    const roots = ["uploads", "imports", "exports", "scryfall"];
    for (const name of roots)
      mkdirSync(join(".local-data", name), { recursive: true });
    const labels = (service: string) => ({
      "com.docker.compose.project": "mtg-archives",
      "com.docker.compose.service": service,
    });
    const network = "mtg-archives_default";
    const web = {
      Id: "owned-web",
      Image: "same-image",
      Config: {
        Labels: labels("web"),
        Env: [
          "DATABASE_URL=postgresql://fixture:fixture@postgres:5432/local_fixture",
        ],
      },
      State: { Running: true, Paused: false },
      NetworkSettings: { Networks: { [network]: {} } },
      HostConfig: {
        Binds: roots.map(
          (name) =>
            `${realpathSync(join(".local-data", name))}:/app/data/${name}:rw`,
        ),
      },
    };
    const postgres = {
      Id: "owned-db",
      Config: { Labels: labels("postgres") },
      State: { Running: true },
      NetworkSettings: { Networks: { [network]: {} } },
    };
    const worker = {
      Id: "owned-worker",
      Config: { Labels: labels("acquisition-worker") },
      State: { Running: true, Paused: false },
    };
    const calls: string[][] = [];
    const docker = (args: string[]) => {
      calls.push(args);
      if (args[0] === "network")
        return JSON.stringify([
          { Labels: { "com.docker.compose.project": "mtg-archives" } },
        ]);
      if (args[0] === "inspect" && args[1] === "mtg-archives-postgres-1")
        return JSON.stringify([postgres]);
      if (args[0] === "ps") return "owned-web owned-worker owned-db";
      if (args[0] === "inspect") return JSON.stringify([web, worker, postgres]);
      if (args[0] === "exec" && args.at(-1) === "check-capture")
        throw Error("Drain or cancel scanner runs before maintenance capture");
      assert.fail(`Unexpected service or capsule action: ${args[0]}`);
    };
    const archive = join(root, "not-created");
    await assert.rejects(
      captureQuiescentLocalDrill(docker, web, "fixture", archive),
      /Drain or cancel/,
    );
    assert.equal(calls.at(-1)?.at(-1), "check-capture");
    assert.ok(
      calls.every((args) =>
        ["network", "inspect", "ps", "exec"].includes(args[0]),
      ),
    );
    assert.equal(existsSync(archive), false);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
