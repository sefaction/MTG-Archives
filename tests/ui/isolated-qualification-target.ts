import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";

const identity = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
});
const manifestSchema = z.object({
  runId: z.string().uuid(),
  project: z.string().regex(/^[a-z0-9][a-z0-9_-]+$/),
  baseURL: z.string(),
  networkName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  web: identity,
  database: identity.extend({
    host: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
    databaseName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
});
export type IsolatedQualificationTarget = z.infer<typeof manifestSchema>;
export type DockerRead = (args: string[]) => string;
const ownershipLabel = "mtg-isolated-qualification";

function requireGuard(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Isolated qualification target: ${message}`);
}

export function parseIsolatedQualificationTarget(value: unknown) {
  const target = manifestSchema.parse(value);
  const url = new URL(target.baseURL);
  requireGuard(
    url.protocol === "http:" && url.hostname === "127.0.0.1" &&
      url.port !== "" && url.pathname === "/" && !url.search && !url.hash &&
      !url.username && !url.password && !["13001", "13011"].includes(url.port),
    "requires a distinct loopback HTTP port",
  );
  requireGuard(target.web.id !== target.database.id, "web and database identities must differ");
  requireGuard(target.web.name !== target.database.name, "web and database names must differ");
  requireGuard(!["mtg-archives", "mtg-anchor-qualification"].includes(target.project), "shared projects are forbidden");
  return target;
}

const readDocker: DockerRead = (args) => execFileSync("docker", args, {
  encoding: "utf8", windowsHide: true, timeout: 30_000,
}).trim();

/** Read-only fences before any fixture query. Queries must subsequently use the
 * immutable web ID, so a same-name replacement cannot redirect a later write. */
export function verifyIsolatedQualificationTarget(
  target: IsolatedQualificationTarget,
  run: DockerRead = readDocker,
  dockerHost = process.env.DOCKER_HOST,
) {
  target = parseIsolatedQualificationTarget(target);
  const local = (endpoint: string) =>
    /^npipe:\/{2,4}(?:\.|localhost)\/pipe\/[a-zA-Z0-9_.-]+$/i.test(endpoint) ||
    /^unix:\/\/\/(?!\/)[^?#]+$/.test(endpoint);
  if (dockerHost) requireGuard(local(dockerHost), "remote Docker override is forbidden");
  const endpoint = JSON.parse(run([
    "context", "inspect", run(["context", "show"]), "--format", "{{json .Endpoints.docker.Host}}",
  ]));
  requireGuard(typeof endpoint === "string" && local(endpoint), "requires a local Docker engine");
  const inspect = (kind: string, name: string) => {
    const result = JSON.parse(run([kind, "inspect", name]));
    requireGuard(Array.isArray(result) && result.length === 1, "inspection identity is ambiguous");
    return result[0];
  };
  const web = inspect("container", target.web.id);
  const database = inspect("container", target.database.id);
  for (const [expected, actual] of [[target.web, web], [target.database, database]] as const) {
    requireGuard(actual.Id === expected.id && actual.Name === `/${expected.name}`, "container identity changed");
    requireGuard(actual.State?.Running && !actual.State?.OOMKilled, "container is not running normally");
    requireGuard(actual.Config?.Labels?.[ownershipLabel] === target.runId, "container ownership label mismatch");
    requireGuard(actual.Config?.Labels?.["com.docker.compose.project"] === target.project, "container project mismatch");
    requireGuard(Array.isArray(actual.Mounts), "container mounts unavailable");
    for (const mount of actual.Mounts) {
      requireGuard(mount.Type === "tmpfs" || mount.Type === "volume", "host bind mounts are forbidden");
      if (mount.Type === "volume") {
        const volume = inspect("volume", mount.Name);
        requireGuard(volume.Labels?.[ownershipLabel] === target.runId, "volume ownership label mismatch");
      }
    }
    const networks = actual.NetworkSettings?.Networks;
    requireGuard(networks && Object.keys(networks).length === 1 && networks[target.networkName], "container must use only its private network");
    for (const bindings of Object.values(actual.NetworkSettings?.Ports ?? {}) as any[]) {
      for (const binding of bindings ?? []) requireGuard(binding.HostIp === "127.0.0.1", "published ports must be loopback-only");
    }
  }
  const bindings = web.NetworkSettings.Ports?.["3000/tcp"];
  requireGuard(Array.isArray(bindings) && bindings.length === 1 && bindings[0].HostPort === new URL(target.baseURL).port, "web port does not match baseURL");
  const network = inspect("network", target.networkName);
  requireGuard(network.Name === target.networkName && network.Labels?.[ownershipLabel] === target.runId, "network ownership mismatch");
  requireGuard(network.Driver === "bridge" && network.Scope === "local" && network.Internal === true, "requires an internal local bridge network");
  const peers = Object.keys(network.Containers ?? {}).sort();
  requireGuard(peers.length === 2 && peers.includes(target.web.id) && peers.includes(target.database.id), "private network contains unexpected containers");
  requireGuard(web.NetworkSettings.Networks[target.networkName].NetworkID === network.Id && database.NetworkSettings.Networks[target.networkName].NetworkID === network.Id, "network identity changed");
  const aliases = database.NetworkSettings.Networks[target.networkName].Aliases ?? [];
  requireGuard(target.database.host === target.database.name || aliases.includes(target.database.host), "database host is not the owned container");
  const urls = (web.Config.Env as string[]).filter((entry) => entry.startsWith("DATABASE_URL="));
  requireGuard(urls.length === 1, "database connection is missing or ambiguous");
  const databaseURL = new URL(urls[0].slice("DATABASE_URL=".length));
  requireGuard(
    ["postgres:", "postgresql:"].includes(databaseURL.protocol) &&
      databaseURL.hostname === target.database.host &&
      (!databaseURL.port || databaseURL.port === "5432") &&
      databaseURL.pathname === `/${target.database.databaseName}`,
    "web connection does not target the owned database",
  );
  return target;
}

export function loadIsolatedQualificationTarget(file = process.env.MTG_ISOLATED_FIXTURE_MANIFEST) {
  if (!file) return undefined;
  return verifyIsolatedQualificationTarget(parseIsolatedQualificationTarget(JSON.parse(readFileSync(file, "utf8"))));
}
