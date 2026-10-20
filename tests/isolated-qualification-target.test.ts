import assert from "node:assert/strict";
import test from "node:test";
import { parseIsolatedQualificationTarget, verifyIsolatedQualificationTarget } from "./ui/isolated-qualification-target";

function fixture() {
  const target = {
    runId: "12345678-1234-4234-8234-123456789abc", project: "mtg-fixture-example",
    baseURL: "http://127.0.0.1:13991", networkName: "qualification-network",
    web: { id: "a".repeat(64), name: "owned-web" },
    database: { id: "b".repeat(64), name: "owned-db", host: "owned-db", databaseName: "acquisition_filter_example" },
  };
  const labels = { "mtg-isolated-qualification": target.runId, "com.docker.compose.project": target.project };
  const container = (id: string, name: string) => ({
    Id: id, Name: `/${name}`, State: { Running: true, OOMKilled: false },
    Config: { Labels: { ...labels }, Env: [] as string[] }, Mounts: [] as any[],
    NetworkSettings: { Networks: { [target.networkName]: { NetworkID: "private-network-id", Aliases: [name] } }, Ports: {} as Record<string, any> },
  });
  const web = container(target.web.id, target.web.name);
  web.Config.Env = [`DATABASE_URL=postgresql://fixture:fixture@owned-db:5432/acquisition_filter_example`];
  web.NetworkSettings.Ports = { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "13991" }] };
  const database = container(target.database.id, target.database.name);
  const network = { Id: "private-network-id", Name: target.networkName, Driver: "bridge", Scope: "local", Internal: true, Labels: { ...labels }, Containers: { [target.web.id]: {}, [target.database.id]: {} } };
  const volume = { Labels: { ...labels } };
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === "context") return args[1] === "show" ? "desktop-linux" : JSON.stringify("npipe:////./pipe/docker_engine");
    if (args[0] === "network") return JSON.stringify([network]);
    if (args[0] === "volume") return JSON.stringify([volume]);
    assert.equal(args[0], "container");
    assert.equal(args[1], "inspect");
    assert.ok([target.web.id, target.database.id].includes(args[2]));
    return JSON.stringify([args[2] === target.web.id ? web : database]);
  };
  return { target, web, database, network, volume, run, calls };
}

test("owned isolated manifest and Docker identities pass using read-only calls", () => {
  const f = fixture();
  assert.deepEqual(verifyIsolatedQualificationTarget(f.target, f.run, ""), f.target);
  assert.ok(f.calls.every((args) => args.includes("inspect") || args.join(" ") === "context show"));
});

for (const url of ["https://127.0.0.1:13991", "http://example.com:13991", "http://127.0.0.1:13001", "http://127.0.0.1:13011", "http://user:pass@127.0.0.1:13991", "http://127.0.0.1:13991/path"]) {
  test(`isolated target rejects unsafe URL ${url}`, () => assert.throws(() => parseIsolatedQualificationTarget({ ...fixture().target, baseURL: url })));
}

for (const [name, alter] of [
  ["container replacement", (f: ReturnType<typeof fixture>) => { f.web.Id = "c".repeat(64); }],
  ["wrong name", (f: ReturnType<typeof fixture>) => { f.web.Name = "/unrelated-web"; }],
  ["wrong owner", (f: ReturnType<typeof fixture>) => { f.web.Config.Labels["mtg-isolated-qualification"] = "another-run"; }],
  ["wrong project", (f: ReturnType<typeof fixture>) => { f.database.Config.Labels["com.docker.compose.project"] = "mtg-archives"; }],
  ["stopped container", (f: ReturnType<typeof fixture>) => { f.database.State.Running = false; }],
  ["host mount", (f: ReturnType<typeof fixture>) => { f.web.Mounts.push({ Type: "bind", Source: "shared" }); }],
  ["unowned volume", (f: ReturnType<typeof fixture>) => { f.database.Mounts.push({ Type: "volume", Name: "shared" }); f.volume.Labels["mtg-isolated-qualification"] = "wrong"; }],
  ["public port", (f: ReturnType<typeof fixture>) => { f.web.NetworkSettings.Ports["3000/tcp"][0].HostIp = "0.0.0.0"; }],
  ["wrong port", (f: ReturnType<typeof fixture>) => { f.web.NetworkSettings.Ports["3000/tcp"][0].HostPort = "13001"; }],
  ["wrong network owner", (f: ReturnType<typeof fixture>) => { f.network.Labels["mtg-isolated-qualification"] = "wrong"; }],
  ["external network", (f: ReturnType<typeof fixture>) => { f.network.Internal = false; }],
  ["nonlocal network", (f: ReturnType<typeof fixture>) => { f.network.Scope = "swarm"; }],
  ["nonbridge network", (f: ReturnType<typeof fixture>) => { f.network.Driver = "host"; }],
  ["unexpected peer", (f: ReturnType<typeof fixture>) => { f.network.Containers["c".repeat(64)] = {}; }],
  ["wrong network identity", (f: ReturnType<typeof fixture>) => { f.network.Id = "another-network"; }],
  ["wrong database host", (f: ReturnType<typeof fixture>) => { f.web.Config.Env = ["DATABASE_URL=postgresql://fixture:fixture@postgres:5432/acquisition_filter_example"]; }],
  ["wrong database name", (f: ReturnType<typeof fixture>) => { f.web.Config.Env = ["DATABASE_URL=postgresql://fixture:fixture@owned-db:5432/shared"]; }],
] as const) {
  test(`isolated target refuses ${name} before any mutation`, () => {
    const f = fixture(); alter(f);
    assert.throws(() => verifyIsolatedQualificationTarget(f.target, f.run, ""));
  });
}

test("remote Docker override is refused before querying Docker", () => {
  const f = fixture();
  assert.throws(() => verifyIsolatedQualificationTarget(f.target, f.run, "ssh://production"));
  assert.equal(f.calls.length, 0);
});

for (const endpoint of ["npipe:////other-host/pipe/docker_engine", "npipe://other-host/pipe/docker_engine", "unix://other-host/var/run/docker.sock", "tcp://127.0.0.1:2375"]) {
  test(`nonlocal Docker endpoint is refused: ${endpoint}`, () => {
    const f = fixture();
    assert.throws(() => verifyIsolatedQualificationTarget(f.target, f.run, endpoint));
    assert.equal(f.calls.length, 0);
    const contextRun = (args: string[]) => args[0] === "context" && args[1] === "inspect" ? JSON.stringify(endpoint) : f.run(args);
    assert.throws(() => verifyIsolatedQualificationTarget(f.target, contextRun, ""));
  });
}

for (const endpoint of ["npipe:////./pipe/docker_engine", "npipe://localhost/pipe/docker_engine", "unix:///var/run/docker.sock"]) {
  test(`local Docker override is accepted: ${endpoint}`, () => {
    const f = fixture();
    assert.doesNotThrow(() => verifyIsolatedQualificationTarget(f.target, f.run, endpoint));
  });
}

test("matching owned volume is allowed", () => {
  const f = fixture();
  f.database.Mounts.push({ Type: "volume", Name: "owned-volume" });
  assert.doesNotThrow(() => verifyIsolatedQualificationTarget(f.target, f.run, ""));
});
