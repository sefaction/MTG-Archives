import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
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
