import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { acquisitionLoadProxyProgram } from "./acquisition-load-proxy";
import {
  isolatedLoadRoles, acquisitionLoadMemoryBytes, parseIsolatedAcquisitionLoadTarget,
  assertIsolatedAcquisitionLoadRuntime, isolatedAcquisitionLoadDatabaseGuard,
} from "./isolated-acquisition-load-target";

function fixture() {
  const target = parseIsolatedAcquisitionLoadTarget({
    version: 1, owner: "scanner-load-11111111-1111-4111-8111-111111111111",
    project: "mtg-load-controls", sourceCommit: "a".repeat(40),
    baseURL: "http://127.0.0.1:23160", database: "review_load_controls", networkId: "b".repeat(64),
    containers: Object.fromEntries(isolatedLoadRoles.map((role, i) => [role,
      { id: String(i + 1).repeat(64), image: "sha256:" + "c".repeat(64) }])),
  });
  const containers = isolatedLoadRoles.map(role => ({
    Id: target.containers[role].id, Image: target.containers[role].image, State: { Running: true },
    HostConfig: { Memory: role === "postgres" ? 1024 ** 3 : acquisitionLoadMemoryBytes[role] },
    Config: { Labels: { "mtg.fixture.owner": target.owner, "com.docker.compose.project": target.project,
      "com.docker.compose.service": role, "org.opencontainers.image.revision": target.sourceCommit } },
    NetworkSettings: { Networks: { isolated: { NetworkID: target.networkId } } },
  }));
  const network = { Id: target.networkId, Internal: true,
    Containers: Object.fromEntries(containers.map(row => [row.Id, {}])) };
  return { target, containers, network };
}

test("isolated load metadata accepts only explicit local immutable targets", () => {
  const { target } = fixture();
  assert.equal(parseIsolatedAcquisitionLoadTarget(target).baseURL, target.baseURL);
  for (const change of [
    { baseURL: "https://mtgarchive.graymaiden.com" }, { baseURL: "http://127.0.0.1:23160/path" },
    { baseURL: "http://user:secret@127.0.0.1:23160" }, { database: "mtginventory" },
    { project: "mtg-archives" }, { networkId: "short" }, { sourceCommit: "main" },
  ]) assert.throws(() => parseIsolatedAcquisitionLoadTarget({ ...target, ...change }));
  const duplicate = structuredClone(target);
  duplicate.containers.web.id = duplicate.containers.postgres.id;
  assert.throws(() => parseIsolatedAcquisitionLoadTarget(duplicate));
  const extra = structuredClone(target) as any;
  extra.containers.other = extra.containers.web;
  assert.throws(() => parseIsolatedAcquisitionLoadTarget(extra));
});

test("isolated load runtime refuses changed identity, owner, revision and network peers", () => {
  const good = fixture();
  assert.doesNotThrow(() => assertIsolatedAcquisitionLoadRuntime(good.target, good.containers, good.network));
  const mutations = [
    (x: ReturnType<typeof fixture>) => { x.network.Internal = false; },
    (x: ReturnType<typeof fixture>) => { x.network.Containers["f".repeat(64)] = {}; },
    (x: ReturnType<typeof fixture>) => { x.containers[1].Image = "sha256:" + "d".repeat(64); },
    (x: ReturnType<typeof fixture>) => { x.containers[1].State.Running = false; },
    (x: ReturnType<typeof fixture>) => { x.containers[1].HostConfig.Memory *= 2; },
    (x: ReturnType<typeof fixture>) => { x.containers[1].Config.Labels["mtg.fixture.owner"] = "another-owner"; },
    (x: ReturnType<typeof fixture>) => { x.containers[1].Config.Labels["com.docker.compose.project"] = "mtg-archives"; },
    (x: ReturnType<typeof fixture>) => { x.containers[1].Config.Labels["org.opencontainers.image.revision"] = "d".repeat(40); },
    (x: ReturnType<typeof fixture>) => { x.containers[1].NetworkSettings.Networks.isolated.NetworkID = "e".repeat(64); },
    (x: ReturnType<typeof fixture>) => { (x.containers[1].NetworkSettings.Networks as any).egress = { NetworkID: "e".repeat(64) }; },
  ];
  for (const mutate of mutations) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => assertIsolatedAcquisitionLoadRuntime(changed.target, changed.containers, changed.network));
  }
});

test("the repeated SQL guard refuses another database or nonfixture host before executing fixture work", () => {
  const { target } = fixture();
  const guard = isolatedAcquisitionLoadDatabaseGuard(target);
  const run = (url: string) => vm.runInNewContext(guard + "fixtureWorkReached=true;", {
    URL, process: { env: { DATABASE_URL: url } }, fixtureWorkReached: false,
  });
  assert.equal(run("postgresql://fixture:fixture@postgres:5432/review_load_controls"), true);
  for (const url of [
    "postgresql://fixture:fixture@postgres:5432/mtginventory",
    "postgresql://fixture:fixture@192.168.1.2:5432/review_load_controls",
    "postgresql://fixture:fixture@postgres:15435/review_load_controls",
  ]) assert.throws(() => run(url), /Wrong isolated load database/);
});

function proxyFixture() {
  const good = fixture();
  const environment = ["NODE_ENV=production", "NODE_VERSION=22.23.4"];
  const ingress = { id: "8".repeat(64), image: good.target.containers.web.image,
    networkId: "9".repeat(64), postgresPort: 15435,
    environmentSHA256: createHash("sha256").update(JSON.stringify(environment)).digest("hex") };
  const target = parseIsolatedAcquisitionLoadTarget({ ...good.target, ingressProxy: ingress });
  const proxy: any = { Id: ingress.id, Image: ingress.image, State: { Running: true }, Mounts: [],
    HostConfig: { Memory: 128 * 1024 ** 2, NanoCpus: 250_000_000, PidsLimit: 64,
      ReadonlyRootfs: true, Privileged: false, RestartPolicy: { Name: "no" }, PortBindings: {
        "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "23160" }],
        "15432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15435" }],
      } },
    Config: { Env: environment, Entrypoint: ["node"], Cmd: ["-e", acquisitionLoadProxyProgram],
      Labels: { "mtg.fixture.owner": target.owner, "com.docker.compose.project": target.project,
        "com.docker.compose.service": "load-ingress-proxy", "org.opencontainers.image.revision": target.sourceCommit } },
    NetworkSettings: { Networks: { isolated: { NetworkID: target.networkId }, ingress: { NetworkID: ingress.networkId } } } };
  const network = { ...good.network, Containers: { ...good.network.Containers, [ingress.id]: {} } };
  const ingressNetwork = { Id: ingress.networkId, Internal: false, Containers: { [ingress.id]: {} },
    Labels: { "mtg.fixture.owner": target.owner, "com.docker.compose.project": target.project } };
  return { target, containers: [...good.containers, proxy], proxy, network, ingressNetwork };
}

test("declared TCP ingress retains exactly seven isolated application roles and one bounded proxy", () => {
  const good = proxyFixture();
  assert.equal(Object.keys(good.target.containers).length, 7);
  assert.doesNotThrow(() => assertIsolatedAcquisitionLoadRuntime(good.target, good.containers, good.network, good.ingressNetwork));
  assert.throws(() => assertIsolatedAcquisitionLoadRuntime(good.target, good.containers, good.network), /inspection required/);
  const undeclared = fixture();
  assert.throws(() => assertIsolatedAcquisitionLoadRuntime(undeclared.target, good.containers, good.network, good.ingressNetwork));
});

test("ingress metadata cannot smuggle credentials, reuse identities or change the verified image", () => {
  const { target } = proxyFixture();
  for (const change of [
    { password: "must-not-appear" }, { id: target.containers.web.id },
    { networkId: target.networkId }, { image: "sha256:" + "d".repeat(64) },
    { postgresPort: Number(new URL(target.baseURL).port) }, { postgresPort: 0 },
    { postgresPort: 65536 }, { postgresPort: "15435" }, { environmentSHA256: "unknown" },
  ]) assert.throws(() => parseIsolatedAcquisitionLoadTarget({ ...target,
    ingressProxy: { ...target.ingressProxy, ...change } }));
});

test("a proxy cannot widen routing, ports, mounts, execution, ownership or resource limits", () => {
  const mutations: Array<(x: ReturnType<typeof proxyFixture>) => void> = [
    x => { x.network.Internal = false; },
    x => { x.network.Containers["f".repeat(64)] = {}; },
    x => { x.ingressNetwork.Containers["f".repeat(64)] = {}; },
    x => { x.ingressNetwork.Id = "f".repeat(64); },
    x => { x.ingressNetwork.Internal = true; },
    x => { x.ingressNetwork.Labels["mtg.fixture.owner"] = "another-owner"; },
    x => { x.proxy.NetworkSettings.Networks.extra = { NetworkID: "f".repeat(64) }; },
    x => { x.proxy.Image = "sha256:" + "f".repeat(64); },
    x => { x.proxy.State.Running = false; },
    x => { x.proxy.Config.Labels["com.docker.compose.project"] = "mtg-archives"; },
    x => { x.proxy.Config.Labels["com.docker.compose.service"] = "web"; },
    x => { x.proxy.Config.Labels["org.opencontainers.image.revision"] = "f".repeat(40); },
    x => { x.proxy.Config.Labels["mtg.fixture.owner"] = "another-owner"; },
    x => { x.proxy.HostConfig.Memory *= 2; },
    x => { x.proxy.HostConfig.NanoCpus *= 2; },
    x => { x.proxy.HostConfig.PidsLimit = 0; },
    x => { x.proxy.HostConfig.ReadonlyRootfs = false; },
    x => { x.proxy.HostConfig.Privileged = true; },
    x => { x.proxy.HostConfig.RestartPolicy.Name = "always"; },
    x => { x.proxy.HostConfig.PortBindings["8080/tcp"][0].HostIp = "0.0.0.0"; },
    x => { x.proxy.HostConfig.PortBindings["15432/tcp"][0].HostPort = "5432"; },
    x => { x.proxy.HostConfig.PortBindings["9999/tcp"] = []; },
    x => { x.proxy.Mounts.push({ Destination: "/var/run/docker.sock" }); },
    x => { x.proxy.Config.Cmd = ["-e", "fetch('https://example.com')"]; },
    x => { x.proxy.Config.Entrypoint = ["sh"]; },
    x => { x.proxy.Config.Env.push("NODE_OPTIONS=--require=/app/other.js"); },
    x => { x.containers[1].NetworkSettings.Networks = { ingress: { NetworkID: x.ingressNetwork.Id } }; },
  ];
  for (const mutate of mutations) {
    const changed = proxyFixture(); mutate(changed);
    assert.throws(() => assertIsolatedAcquisitionLoadRuntime(changed.target, changed.containers, changed.network, changed.ingressNetwork));
  }
});
