import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { acquisitionLoadProxyProgram } from "./acquisition-load-proxy";

export const acquisitionLoadProxyMemoryBytes = 128 * 1024 ** 2;

/** Resolve CLI selection without contacting an engine. Pin all later commands to
 * this endpoint so a changed context cannot redirect fixture work. */
export function assertLocalAcquisitionLoadEngine(endpoint: unknown, dockerHost?: string): string {
  assert.equal(typeof endpoint, "string", "Expected the selected Docker context endpoint");
  const local = typeof endpoint === "string" && (
    /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint) ||
    /^unix:\/\/\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(endpoint)
      && !endpoint.slice(8).split("/").some(part => part === "." || part === "..")
  );
  assert.ok(local, "Expected an absolute local Unix socket or local Windows named pipe");
  assert.ok(!dockerHost || dockerHost === endpoint, "Docker host override disagrees with the selected context");
  return endpoint as string;
}

export function acquisitionLoadDockerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...environment };
  delete result.DOCKER_CONTEXT;
  delete result.DOCKER_HOST;
  return result;
}

export const acquisitionLoadRoles = [
  "web", "acquisition-worker", "acquisition-catalog-worker",
  "acquisition-recognition-worker", "acquisition-visual-worker", "acquisition-printing-worker",
] as const;
export const isolatedLoadRoles = ["postgres", ...acquisitionLoadRoles] as const;
export type AcquisitionLoadRole = typeof acquisitionLoadRoles[number];
export const acquisitionLoadMemoryBytes: Record<AcquisitionLoadRole, number> = {
  web: 1024 ** 3, "acquisition-worker": 512 * 1024 ** 2,
  "acquisition-catalog-worker": 1024 ** 3, "acquisition-recognition-worker": 2 * 1024 ** 3,
  "acquisition-visual-worker": 3 * 1024 ** 3, "acquisition-printing-worker": 1024 ** 3,
};
type Role = typeof isolatedLoadRoles[number];
export type IsolatedAcquisitionLoadTarget = {
  version: 1; owner: string; project: string; sourceCommit: string;
  baseURL: string; database: string; networkId: string;
  networkMode?: "ORDINARY_BRIDGE";
  containers: Record<Role, { id: string; image: string }>;
  ingressProxy?: { id: string; image: string; networkId: string; postgresPort: number; environmentSHA256: string };
};

/** Explicit opt-in metadata contains identities, never credentials. */
export function parseIsolatedAcquisitionLoadTarget(value: unknown): IsolatedAcquisitionLoadTarget {
  assert.ok(value && typeof value === "object", "Expected isolated load target metadata");
  const input = value as Record<string, unknown>;
  assert.equal(input.version, 1, "Unsupported isolated load target version");
  const field = (name: string, pattern: RegExp) => {
    const value = input[name];
    assert.ok(typeof value === "string" && pattern.test(value), `Invalid isolated load ${name}`);
    return value;
  };
  const owner = field("owner", /^scanner-load-[a-f0-9-]{36}$/);
  const project = field("project", /^mtg-load-[a-z0-9-]{1,50}$/);
  const sourceCommit = field("sourceCommit", /^[a-f0-9]{40}$/);
  const database = field("database", /^review_[a-z0-9_]{1,50}$/);
  const networkId = field("networkId", /^[a-f0-9]{64}$/);
  assert.equal(typeof input.baseURL, "string", "Expected isolated loopback URL");
  const url = new URL(input.baseURL as string);
  assert.equal(url.protocol, "http:", "Expected local HTTP review endpoint");
  assert.equal(url.hostname, "127.0.0.1", "Expected loopback review endpoint");
  assert.ok(url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
    "Expected a credential-free loopback origin with an explicit port");
  assert.ok(input.containers && typeof input.containers === "object", "Expected immutable container identities");
  const rows = input.containers as Record<string, {id?: unknown; image?: unknown}>;
  assert.deepEqual(Object.keys(rows).sort(), [...isolatedLoadRoles].sort(), "Expected exactly the seven isolated roles");
  const containers = Object.fromEntries(isolatedLoadRoles.map(role => {
    const row = rows[role];
    assert.ok(row && typeof row.id === "string" && /^[a-f0-9]{64}$/.test(row.id), "Expected full container ID");
    assert.ok(typeof row.image === "string" && /^sha256:[a-f0-9]{64}$/.test(row.image), "Expected immutable image ID");
    return [role, { id: row.id, image: row.image }];
  })) as IsolatedAcquisitionLoadTarget["containers"];
  assert.equal(new Set(Object.values(containers).map(row => row.id)).size, isolatedLoadRoles.length,
    "Isolated roles must have distinct container identities");
  let ingressProxy: IsolatedAcquisitionLoadTarget["ingressProxy"];
  assert.ok(input.networkMode === undefined || input.networkMode === "ORDINARY_BRIDGE",
    "Unsupported isolated load network mode");
  assert.ok(input.networkMode === undefined || input.ingressProxy === undefined,
    "Ordinary bridge cannot be combined with internal ingress proxy");
  if (input.ingressProxy !== undefined) {
    const proxy = input.ingressProxy as Record<string, unknown>;
    assert.ok(proxy && typeof proxy === "object", "Expected declared ingress proxy");
    assert.deepEqual(Object.keys(proxy).sort(), ["id", "image", "networkId", "postgresPort", "environmentSHA256"].sort(),
      "Unexpected ingress metadata or credentials");
    for (const field of ["id", "networkId", "environmentSHA256"] as const)
      assert.ok(typeof proxy[field] === "string" && /^[a-f0-9]{64}$/.test(proxy[field]), "Expected immutable ingress identity");
    assert.equal(proxy.image, containers.web.image, "Ingress must use the exact verified web image");
    assert.ok(!Object.values(containers).some(row => row.id === proxy.id), "Ingress cannot reuse an application ID");
    assert.notEqual(proxy.networkId, networkId, "Ingress and internal networks must differ");
    assert.ok(Number.isInteger(proxy.postgresPort) && Number(proxy.postgresPort) > 0 && Number(proxy.postgresPort) < 65536
      && Number(proxy.postgresPort) !== Number(url.port), "Expected a separate explicit loopback database port");
    ingressProxy = proxy as IsolatedAcquisitionLoadTarget["ingressProxy"];
  }
  return { version: 1, owner, project, sourceCommit, baseURL: url.origin, database, networkId, containers,
    ...(input.networkMode === "ORDINARY_BRIDGE" ? { networkMode: input.networkMode } : {}),
    ...(ingressProxy ? { ingressProxy } : {}) };
}

type ContainerInspection = {
  Id: string; Image: string; State: { Running: boolean };
  HostConfig: { Memory: number; NanoCpus?: number; PidsLimit?: number; ReadonlyRootfs?: boolean;
    Privileged?: boolean; PortBindings?: unknown; RestartPolicy?: { Name: string } };
  Config: { Labels: Record<string, string> | null; Entrypoint?: string[] | null; Cmd?: string[] | null; Env?: string[] };
  Mounts?: unknown[];
  NetworkSettings: { Networks: Record<string, { NetworkID: string }>; Ports?: unknown };
};
type NetworkInspection = { Id: string; Internal: boolean; Containers: Record<string, unknown>;
  Labels?: Record<string, string> | null };

/** Refuse a mismatched source, owner, service, peer or undeclared network mode
 * before the fixture performs its first application/database write. */
export function assertIsolatedAcquisitionLoadRuntime(
  target: IsolatedAcquisitionLoadTarget, containers: ContainerInspection[], network: NetworkInspection,
  ingressNetwork?: NetworkInspection,
) {
  assert.equal(network.Id, target.networkId, "Isolated network identity changed");
  assert.equal(network.Internal, target.networkMode !== "ORDINARY_BRIDGE",
    "Native load network must match the declared mode");
  const expectedIds = [...isolatedLoadRoles.map(role => target.containers[role].id),
    ...(target.ingressProxy ? [target.ingressProxy.id] : [])].sort();
  assert.deepEqual(containers.map(row => row.Id).sort(), expectedIds, "Isolated container membership changed");
  assert.deepEqual(Object.keys(network.Containers).sort(), expectedIds, "Unexpected peer on isolated load network");
  for (const role of isolatedLoadRoles) {
    const expected = target.containers[role];
    const actual = containers.find(row => row.Id === expected.id)!;
    assert.equal(actual.Image, expected.image, `${role}: image identity changed`);
    assert.equal(actual.State.Running, true, `${role}: expected a running isolated role`);
    const labels = actual.Config.Labels ?? {};
    assert.equal(labels["mtg.fixture.owner"], target.owner, `${role}: fixture owner changed`);
    assert.equal(labels["com.docker.compose.project"], target.project, `${role}: project changed`);
    assert.equal(labels["com.docker.compose.service"], role, `${role}: service changed`);
    if (role !== "postgres") {
      assert.equal(labels["org.opencontainers.image.revision"], target.sourceCommit, `${role}: source revision changed`);
      assert.equal(actual.HostConfig.Memory, acquisitionLoadMemoryBytes[role], `${role}: declared memory limit changed`);
    }
    assert.deepEqual(Object.values(actual.NetworkSettings.Networks).map(row => row.NetworkID), [target.networkId],
      `${role}: unexpected network attachment`);
  }
  if (!target.ingressProxy) {
    assert.equal(ingressNetwork, undefined, "Undeclared ingress network");
    const web = containers.find(row => row.Id === target.containers.web.id)!;
    const ports = { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: new URL(target.baseURL).port }] };
    assert.deepEqual(web.HostConfig.PortBindings, ports, "Expected the declared loopback web binding");
    assertPublishedPorts(web.NetworkSettings.Ports, ports);
    return;
  }
  const proxy = target.ingressProxy;
  const actual = containers.find(row => row.Id === proxy.id)!;
  assert.ok(ingressNetwork, "Declared ingress network inspection required");
  assert.equal(ingressNetwork.Id, proxy.networkId, "Ingress network identity changed");
  assert.equal(ingressNetwork.Internal, false, "Expected the separate ingress bridge");
  assert.deepEqual(Object.keys(ingressNetwork.Containers), [proxy.id], "Unexpected peer on ingress bridge");
  assert.equal(ingressNetwork.Labels?.["mtg.fixture.owner"], target.owner, "Ingress network owner changed");
  assert.equal(ingressNetwork.Labels?.["com.docker.compose.project"], target.project, "Ingress network project changed");
  assert.equal(actual.Image, proxy.image, "Ingress image changed");
  assert.equal(actual.State.Running, true, "Ingress proxy is not running");
  const labels = actual.Config.Labels ?? {};
  assert.equal(labels["mtg.fixture.owner"], target.owner, "Ingress owner changed");
  assert.equal(labels["com.docker.compose.project"], target.project, "Ingress project changed");
  assert.equal(labels["com.docker.compose.service"], "load-ingress-proxy", "Ingress service changed");
  assert.equal(labels["org.opencontainers.image.revision"], target.sourceCommit, "Ingress source changed");
  assert.equal(actual.HostConfig.Memory, acquisitionLoadProxyMemoryBytes, "Ingress memory limit changed");
  assert.equal(actual.HostConfig.NanoCpus, 250_000_000, "Ingress CPU limit changed");
  assert.equal(actual.HostConfig.PidsLimit, 64, "Ingress PID limit changed");
  assert.equal(actual.HostConfig.ReadonlyRootfs, true, "Ingress root must be read only");
  assert.equal(actual.HostConfig.Privileged, false, "Ingress cannot be privileged");
  assert.equal(actual.HostConfig.RestartPolicy?.Name, "no", "Ingress restart policy changed");
  assert.deepEqual(actual.Mounts, [], "Ingress must not mount files or sockets");
  assert.deepEqual(actual.Config.Entrypoint, ["node"], "Ingress entrypoint changed");
  assert.deepEqual(actual.Config.Cmd, ["-e", acquisitionLoadProxyProgram], "Ingress forwarding program changed");
  assert.ok(Array.isArray(actual.Config.Env), "Expected the verified ingress image environment");
  assert.equal(createHash("sha256").update(JSON.stringify(actual.Config.Env)).digest("hex"), proxy.environmentSHA256,
    "Ingress image environment changed");
  const ports = {
    "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: new URL(target.baseURL).port }],
    "15432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(proxy.postgresPort) }],
  };
  assert.deepEqual(actual.HostConfig.PortBindings, ports, "Only exact loopback web/database ingress ports are permitted");
  assertPublishedPorts(actual.NetworkSettings.Ports, ports);
  assert.deepEqual(Object.values(actual.NetworkSettings.Networks).map(row => row.NetworkID).sort(),
    [target.networkId, proxy.networkId].sort(), "Ingress network attachments changed");
}

function assertPublishedPorts(actual: unknown, expected: Record<string, { HostIp: string; HostPort: string }[]>) {
  assert.ok(actual && typeof actual === "object" && !Array.isArray(actual), "Expected actual published ports");
  // Docker includes null for image-exposed ports which are not published.
  const published = Object.fromEntries(Object.entries(actual).filter(([, bindings]) => bindings !== null));
  assert.deepEqual(published, expected, "Actual loopback publications must match the declared target");
}

export function isolatedAcquisitionLoadDatabaseGuard(target: IsolatedAcquisitionLoadTarget): string {
  return `const fixtureUrl=new URL(process.env.DATABASE_URL||'http://invalid');if(fixtureUrl.protocol!=='postgresql:'||fixtureUrl.hostname!=='postgres'||(fixtureUrl.port&&fixtureUrl.port!=='5432')||fixtureUrl.pathname!==${JSON.stringify('/' + target.database)})throw Error('Wrong isolated load database');`;
}
