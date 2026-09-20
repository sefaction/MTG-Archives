/** Windows/Linux host runner. Only the named local MTG stack may be the source. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

function docker(args: string[]) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error: any) {
    const summary = String(error.stderr || "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("Recovery drill "));
    if (summary.length) console.error(summary.join("\n"));
    throw new Error(`Docker drill step failed: ${args[0]}`);
  }
}

async function main() {
  assert.equal(
    process.env.MTG_LOCAL_PILOT_TEST,
    "1",
    "Local fixture opt-in required",
  );
  assert.ok(
    process.argv.includes("--run"),
    "Explicit --run required; see docs/BACKUP_RESTORE_DRILL.md",
  );
  const source = "mtg-archives-web-1";
  const config = JSON.parse(docker(["inspect", source]))[0];
  assert.equal(
    config.Config.Labels["com.docker.compose.project"],
    "mtg-archives",
  );
  assert.equal(config.Config.Labels["com.docker.compose.service"], "web");
  assert.equal(config.State.Health.Status, "healthy");
  const backupMount = config.Mounts.find(
    (m: any) => m.Destination === "/app/data/backups",
  );
  assert.equal(backupMount?.Type, "bind");
  // Docker Desktop reports its Linux host translation, so compare the original
  // configured bind path rather than weakening the check to a suffix match.
  const expectedRoot = realpathSync(resolve(".local-data/backups"));
  const bind = config.HostConfig.Binds?.find((value: string) =>
    value.includes(":/app/data/backups:"),
  );
  assert.ok(bind, "Expected the local Compose backup bind");
  const bindSource = bind.slice(0, bind.indexOf(":/app/data/backups:"));
  assert.equal(
    realpathSync(bindSource),
    expectedRoot,
    "Source backups must belong to this repository's local snapshot",
  );
  const id = randomUUID();
  const reuse = process.argv
    .find((arg) => arg.startsWith("--reuse="))
    ?.slice("--reuse=".length);
  if (reuse)
    assert.match(
      reuse,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  const archiveId = reuse || id;
  const prefix = `mtg-restore-drill-${id}`;
  const network = `${prefix}-net`;
  const postgres = `${prefix}-db`;
  const runner = `${prefix}-app`;
  const label = `mtg.restore-drill=${id}`;
  const archiveDirectory = resolve(expectedRoot, `drill-${archiveId}`);
  assert.ok(
    archiveDirectory.startsWith(`${expectedRoot}\\`) ||
      archiveDirectory.startsWith(`${expectedRoot}/`),
  );
  const created: string[] = [];
  let networkCreated = false;
  try {
    if (!reuse) {
      console.log(
        "Creating private source backup; source data must stay quiescent during capture.",
      );
      console.log(
        docker([
          "exec",
          "-e",
          "MTG_LOCAL_PILOT_TEST=1",
          "-e",
          `BACKUP_DIR=/app/data/backups/drill-${id}`,
          source,
          "/app/node_modules/.bin/tsx",
          "scripts/verify-backup-restore-container.ts",
          "capture",
        ]),
      );
    } else {
      console.log(
        "Reusing the explicitly selected private drill archive; restore target is still newly isolated.",
      );
    }
    docker(["network", "create", "--internal", "--label", label, network]);
    networkCreated = true;
    assert.equal(
      JSON.parse(docker(["network", "inspect", network]))[0].Internal,
      true,
    );
    docker([
      "run",
      "-d",
      "--name",
      postgres,
      "--label",
      label,
      "--network",
      network,
      "--network-alias",
      "restore-db",
      "-e",
      "POSTGRES_USER=drill",
      "-e",
      "POSTGRES_DB=mtg_restore_drill",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:16-alpine",
    ]);
    created.push(postgres);
    for (let attempt = 0; ; attempt++) {
      try {
        docker([
          "exec",
          postgres,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "drill",
          "-d",
          "mtg_restore_drill",
        ]);
        break;
      } catch {
        if (attempt >= 45)
          throw new Error("Isolated database did not become ready");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // No Compose inheritance, host ports, source volumes or source credentials.
    // Trust auth is confined to this unique internal network and disposable DB.
    docker([
      "create",
      "--name",
      runner,
      "--label",
      label,
      "--network",
      network,
      "--entrypoint",
      "/app/node_modules/.bin/tsx",
      "-e",
      "MTG_LOCAL_PILOT_TEST=1",
      "-e",
      "MTG_RESTORE_DRILL_ISOLATED=1",
      "-e",
      "DATABASE_URL=postgresql://drill@restore-db:5432/mtg_restore_drill?schema=public",
      "--mount",
      `type=bind,source=${archiveDirectory},target=/input,readonly`,
      config.Image,
      "scripts/verify-backup-restore-container.ts",
      "restore",
    ]);
    created.push(runner);
    // The drill helper can evolve without rebuilding/restarting the live app.
    // Only this disposable container receives the checked-out test helper.
    docker([
      "cp",
      resolve("scripts/verify-backup-restore-container.ts"),
      `${runner}:/app/scripts/verify-backup-restore-container.ts`,
    ]);
    for (const name of created) {
      const isolated = JSON.parse(docker(["inspect", name]))[0];
      assert.deepEqual(Object.keys(isolated.NetworkSettings.Networks), [
        network,
      ]);
      assert.ok(
        !isolated.HostConfig.PortBindings ||
          Object.keys(isolated.HostConfig.PortBindings).length === 0,
      );
      if (name === runner)
        assert.ok(
          isolated.Mounts.every(
            (m: any) => m.Destination === "/input" && m.RW === false,
          ),
        );
    }
    console.log(
      "Restoring in isolated containers (no host ports or outbound workers).",
    );
    console.log(docker(["start", "--attach", runner]));
    assert.equal(
      JSON.parse(docker(["inspect", runner]))[0].State.ExitCode,
      0,
      "Restore verification failed",
    );
  } finally {
    for (const name of created.reverse()) {
      const owned = JSON.parse(docker(["inspect", name]))[0];
      assert.equal(owned.Config.Labels["mtg.restore-drill"], id);
      docker(["rm", "--force", "--volumes", name]);
    }
    if (networkCreated) {
      const owned = JSON.parse(docker(["network", "inspect", network]))[0];
      assert.equal(owned.Labels["mtg.restore-drill"], id);
      docker(["network", "rm", network]);
    }
    console.log(
      "Drill cleanup complete: only UUID-owned disposable resources were eligible for removal. Any created private source backup/evidence remain under .local-data/backups/drill-" +
        archiveId,
    );
  }
}

main().catch(() => {
  // Never print full docker inspect output, inherited env, or private row data.
  console.error(
    "Isolated recovery drill failed; inspect the current stage and local evidence. No success claimed.",
  );
  process.exitCode = 1;
});
