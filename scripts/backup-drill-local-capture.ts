import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDatabaseUrl } from "../lib/backup";
import {
  withQuiescentDrill,
  type DrillService,
} from "../lib/backup-drill-quiescence";

type Docker = (args: string[]) => string;
const workerRoles = new Set([
  "acquisition-worker",
  "acquisition-catalog-worker",
  "acquisition-recognition-worker",
  "acquisition-visual-worker",
  "acquisition-printing-worker",
  "acquisition-reference-maintenance",
  "pricing-worker",
  "notification-worker",
]);
const appdata = {
  uploads: "UPLOADS_DATA_PATH",
  imports: "IMPORTS_DATA_PATH",
  exports: "EXPORTS_DATA_PATH",
  scryfall: "SCRYFALL_CONTAINER_DATA_PATH",
};

export async function captureQuiescentLocalDrill(
  docker: Docker,
  config: any,
  id: string,
  archiveDirectory: string,
) {
  const networks = Object.keys(config.NetworkSettings.Networks);
  assert.deepEqual(networks, ["mtg-archives_default"]);
  const network = JSON.parse(docker(["network", "inspect", networks[0]]))[0];
  assert.equal(network.Labels["com.docker.compose.project"], "mtg-archives");
  const database = JSON.parse(
    docker(["inspect", "mtg-archives-postgres-1"]),
  )[0];
  assert.equal(
    database.Config.Labels["com.docker.compose.project"],
    "mtg-archives",
  );
  assert.equal(
    database.Config.Labels["com.docker.compose.service"],
    "postgres",
  );
  assert.equal(database.State.Running, true);
  assert.ok(database.NetworkSettings.Networks[networks[0]]);
  const mounts: string[] = [];
  for (const root of Object.keys(appdata)) {
    const target = `/app/data/${root}`;
    const matches = config.HostConfig.Binds.filter((bind: string) =>
      bind.includes(`:${target}:`),
    );
    assert.equal(matches.length, 1, "Expected exactly one local appdata bind");
    const source = matches[0].slice(0, matches[0].indexOf(`:${target}:`));
    assert.equal(
      realpathSync(source),
      realpathSync(resolve(`.local-data/${root}`)),
    );
    mounts.push(
      "--mount",
      `type=bind,source=${source},target=${target},readonly`,
    );
  }
  const ids = docker([
    "ps",
    "-aq",
    "--filter",
    "label=com.docker.compose.project=mtg-archives",
  ])
    .split(/\s+/)
    .filter(Boolean);
  const containers = JSON.parse(docker(["inspect", ...ids]));
  const services: DrillService[] = containers
    .filter(
      (entry: any) =>
        entry.Id === config.Id ||
        workerRoles.has(entry.Config.Labels["com.docker.compose.service"]),
    )
    .map((entry: any) => ({
      id: entry.Id,
      service: entry.Config.Labels["com.docker.compose.service"],
      running: entry.State.Running,
      paused: entry.State.Paused,
    }));
  assert.equal(
    new Set(services.map((entry) => entry.service)).size,
    services.length,
    "Duplicate service identities",
  );
  assert.equal(services.filter((entry) => entry.service === "web").length, 1);
  const databaseEnv = config.Config.Env.find((value: string) =>
    value.startsWith("DATABASE_URL="),
  );
  assert.ok(databaseEnv, "Local database configuration missing");
  const connection = parseDatabaseUrl(
    databaseEnv.slice("DATABASE_URL=".length),
  );
  assert.equal(connection.host, "postgres");
  assert.equal(connection.port, 5432);
  assert.ok(
    !config.Config.Env.some(
      (value: string) =>
        value.startsWith("BACKUP_APPDATA_PATHS=") &&
        value !== "BACKUP_APPDATA_PATHS=",
    ),
  );
  // Reject active/queued physical work before stopping anything; capture rechecks
  // after pausing to catch a website-start race during this preflight.
  docker([
    "exec",
    "-e",
    "MTG_LOCAL_PILOT_TEST=1",
    config.Id,
    "/app/node_modules/.bin/tsx",
    "scripts/verify-backup-restore-container.ts",
    "check-capture",
  ]);
  mkdirSync(archiveDirectory, { recursive: true });
  const capsule = `mtg-restore-drill-${id}-capture`;
  let created = false;
  try {
    docker([
      "create",
      "--name",
      capsule,
      "--label",
      `mtg.restore-drill=${id}`,
      "--network",
      networks[0],
      "--entrypoint",
      "/app/node_modules/.bin/tsx",
      "-e",
      databaseEnv,
      "-e",
      "MTG_LOCAL_PILOT_TEST=1",
      "-e",
      "MTG_DRILL_REQUIRE_TERMINAL_SCANS=1",
      "-e",
      `BACKUP_DIR=/app/data/backups/drill-${id}`,
      ...Object.entries(appdata).flatMap(([root, env]) => [
        "-e",
        `${env}=/app/data/${root}`,
      ]),
      ...mounts,
      "--mount",
      `type=bind,source=${archiveDirectory},target=/app/data/backups/drill-${id}`,
      config.Image,
      "scripts/verify-backup-restore-container.ts",
      "capture",
    ]);
    created = true;
    const helper = JSON.parse(docker(["inspect", capsule]))[0];
    assert.equal(helper.Image, config.Image);
    assert.deepEqual(Object.keys(helper.NetworkSettings.Networks), networks);
    assert.ok(
      !helper.HostConfig.PortBindings ||
        !Object.keys(helper.HostConfig.PortBindings).length,
    );
    assert.equal(helper.Mounts.length, 5);
    assert.ok(
      helper.Mounts.every((mount: any) =>
        mount.Destination === `/app/data/backups/drill-${id}`
          ? mount.RW === true
          : Object.keys(appdata).some(
              (root) => mount.Destination === `/app/data/${root}`,
            ) && mount.RW === false,
      ),
    );
    await withQuiescentDrill(
      services,
      (action, entry) => {
        // Names may be replaced during an interruption; mutate only recorded identities.
        const actual = JSON.parse(docker(["inspect", entry.id]))[0];
        assert.equal(actual.Id, entry.id);
        assert.equal(
          actual.Config.Labels["com.docker.compose.project"],
          "mtg-archives",
        );
        assert.equal(
          actual.Config.Labels["com.docker.compose.service"],
          entry.service,
        );
        if (action === "unpause" && !actual.State.Paused) return;
        docker([action, entry.id]);
        const restored = JSON.parse(docker(["inspect", entry.id]))[0];
        assert.equal(restored.Id, entry.id);
        if (action === "stop" || action === "start")
          assert.equal(restored.State.Running, action === "start");
        else assert.equal(restored.State.Paused, action === "pause");
      },
      (state) =>
        writeFileSync(
          resolve(archiveDirectory, "service-state.json"),
          JSON.stringify({ id, ...state }),
        ),
      async () => {
        const web = JSON.parse(docker(["inspect", config.Id]))[0];
        assert.equal(web.State.Paused, true);
        console.log(
          "Website paused; capturing through a same-image helper with read-only source files.",
        );
        console.log(docker(["start", "--attach", capsule]));
        assert.equal(
          JSON.parse(docker(["inspect", capsule]))[0].State.ExitCode,
          0,
        );
      },
    );
    console.log(
      "Original website and worker states restored before isolated restore.",
    );
  } finally {
    if (created) {
      const helper = JSON.parse(docker(["inspect", capsule]))[0];
      assert.equal(helper.Config.Labels["mtg.restore-drill"], id);
      docker(["rm", "--force", "--volumes", capsule]);
    }
  }
}
