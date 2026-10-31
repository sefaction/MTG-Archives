import assert from "node:assert/strict";

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
  containers: Record<Role, { id: string; image: string }>;
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
  return { version: 1, owner, project, sourceCommit, baseURL: url.origin, database, networkId, containers };
}

type ContainerInspection = {
  Id: string; Image: string; State: { Running: boolean };
  HostConfig: { Memory: number };
  Config: { Labels: Record<string, string> | null };
  NetworkSettings: { Networks: Record<string, { NetworkID: string }> };
};
type NetworkInspection = { Id: string; Internal: boolean; Containers: Record<string, unknown> };

/** Refuse a mismatched source, owner, service, peer or externally routed network
 * before the fixture performs its first application/database write. */
export function assertIsolatedAcquisitionLoadRuntime(
  target: IsolatedAcquisitionLoadTarget, containers: ContainerInspection[], network: NetworkInspection,
) {
  assert.equal(network.Id, target.networkId, "Isolated network identity changed");
  assert.equal(network.Internal, true, "Native load network must be internal");
  const expectedIds = isolatedLoadRoles.map(role => target.containers[role].id).sort();
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
}

export function isolatedAcquisitionLoadDatabaseGuard(target: IsolatedAcquisitionLoadTarget): string {
  return `const fixtureUrl=new URL(process.env.DATABASE_URL||'http://invalid');if(fixtureUrl.protocol!=='postgresql:'||fixtureUrl.hostname!=='postgres'||(fixtureUrl.port&&fixtureUrl.port!=='5432')||fixtureUrl.pathname!==${JSON.stringify('/' + target.database)})throw Error('Wrong isolated load database');`;
}
